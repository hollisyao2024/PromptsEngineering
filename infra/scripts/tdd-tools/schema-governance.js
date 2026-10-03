/**
 * Schema 变更治理（ADR-034）：基于 architecture.config.json 登记的数据存储，
 * 校验 schema 与迁移配对、已发布迁移只追加、数据字典覆盖与新增迁移的语义约定。
 *
 * 纯函数与 git 采集分离：collectChanges 读取 git 状态，evaluateSchemaGate 只依赖传入数据，便于单测。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const AUDIT_COLUMNS = ['created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by'];
const DEFAULT_EXEMPT_TABLES = [
  'user', 'session', 'account', 'verification', 'organization', 'member', 'invitation',
  'FileObject', 'file_object', '_prisma_migrations', '__drizzle_migrations', 'app_metadata', 'xirang_migrations', 'pgboss.*',
];
const SEMANTIC_MODES = ['off', 'warn', 'required'];
const DICTIONARY_DOC = 'docs/data/dictionary.md';
const DATA_MIGRATION_MARKER = /--\s*xirang:data-migration\b/i;
const EXEMPT_MARKER = /--\s*xirang:exempt\s+(\S+)\s+(\S.*)$/gim;
const STATUS_LIKE_COLUMN = /(?:^|_)(?:status|state|type|kind|level|stage)$/i;
const INTEGER_TYPE = /^(?:tiny|small|medium|big)?int(?:eger)?\d*\b|^(?:small|big)?serial\b|^number\b/i;
const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;
const CONSTRAINT_ENTRY = /^(?:constraint|primary|unique|foreign|check|index|key|fulltext|spatial|exclude)\b/i;

function normalizePath(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

function resolveGateConfig(config = {}) {
  const gate = config.tdd?.schemaGate || {};
  const semantic = gate.semantic === undefined ? 'warn' : gate.semantic;
  if (!SEMANTIC_MODES.includes(semantic)) {
    throw new Error(`invalid tdd.schemaGate.semantic: ${JSON.stringify(semantic)} (expected off|warn|required)`);
  }
  const exemptTables = gate.exemptTables === undefined ? [] : gate.exemptTables;
  if (!Array.isArray(exemptTables) || exemptTables.some((name) => typeof name !== 'string' || !name.trim())) {
    throw new Error('invalid tdd.schemaGate.exemptTables: expected an array of table names');
  }
  if (gate.datastores !== undefined && !Array.isArray(gate.datastores)) {
    throw new Error('invalid tdd.schemaGate.datastores: expected an array');
  }
  return { semantic, exemptTables: [...DEFAULT_EXEMPT_TABLES, ...exemptTables], datastores: gate.datastores };
}

function normalizeStore(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || !normalizePath(entry.path)) {
    throw new Error(`invalid datastore entry: ${JSON.stringify(entry)}`);
  }
  const access = entry.access || null;
  if (access && !['prisma', 'drizzle'].includes(access)) throw new Error(`unsupported datastore access: ${access}`);
  return { id: entry.id || normalizePath(entry.path), path: normalizePath(entry.path), access, engine: entry.engine || 'postgres' };
}

function resolveDatastores(repoRoot, gateConfig) {
  if (gateConfig.datastores) return gateConfig.datastores.map(normalizeStore);
  const file = path.join(repoRoot, 'architecture.config.json');
  if (!fs.existsSync(file)) return [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`architecture.config.json 解析失败: ${error.message}`);
  }
  return (Array.isArray(parsed.datastores) ? parsed.datastores : []).map(normalizeStore);
}

/** 返回 { store, kind: schema|migration|snapshot } 或 null。 */
function classifyFile(file, stores) {
  const normalized = normalizePath(file);
  for (const store of stores) {
    const prefix = `${store.path}/`;
    if (!normalized.startsWith(prefix)) continue;
    const rel = normalized.slice(prefix.length);
    if (store.access === 'prisma') {
      if (rel === 'prisma/schema.prisma' || /^prisma\/schema\/.+\.prisma$/.test(rel)) return { store, kind: 'schema' };
      if (/^prisma\/migrations\/[^/]+\/migration\.sql$/.test(rel)) return { store, kind: 'migration' };
    } else if (store.access === 'drizzle') {
      if (/^src\/schema\/.+\.ts$/.test(rel)) return { store, kind: 'schema' };
      if (/^drizzle\/[^/]+\.sql$/.test(rel)) return { store, kind: 'migration' };
      if (/^drizzle\/meta\/[^/]+_snapshot\.json$/.test(rel)) return { store, kind: 'snapshot' };
    } else if (/^migrations\/[^/]+\.sql$/.test(rel)) {
      return { store, kind: 'migration' };
    }
  }
  return null;
}

function diffLines(diff) {
  const added = [];
  const removed = [];
  for (const line of String(diff || '').split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
    else if (line.startsWith('-')) removed.push(line.slice(1));
  }
  return { added, removed };
}

/** schema 结构变化：忽略空白与所有注释（普通注释与文档注释都不改变数据库结构）。 */
function hasStructuralChange(diff) {
  const { added, removed } = diffLines(diff);
  return [...added, ...removed].some((line) => {
    const content = line.trim();
    if (!content) return false;
    return !/^(?:\/\/|\/\*|\*\/|\*)/.test(content);
  });
}

function stripSqlComments(sql) {
  return String(sql || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

function unquote(name) {
  const raw = String(name || '').trim();
  const parts = raw.split('.').map((part) => part.replace(/^["`[]|["`\]]$/g, ''));
  return parts[parts.length - 1];
}

function qualifiedName(name) {
  return String(name || '').trim().split('.').map((part) => part.replace(/^["`[]|["`\]]$/g, '')).join('.');
}

function splitTopLevel(body) {
  const items = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (const ch of body) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function readBalanced(text, openIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { body: text.slice(openIndex + 1, i), end: i };
    }
  }
  return null;
}

const NAME = '((?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*)(?:\\.(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*))?)';

function parseColumn(entry) {
  const match = entry.match(new RegExp(`^${NAME}\\s+(.*)$`, 's'));
  if (!match) return null;
  const rest = match[2];
  const comment = rest.match(/\bCOMMENT\s+'((?:[^']|'')*)'/i);
  return {
    name: unquote(match[1]),
    type: rest.trim(),
    comment: comment ? comment[1].replace(/''/g, "'") : null,
    hasCheck: /\bCHECK\s*\(/i.test(rest),
  };
}

/** 解析迁移 SQL 中新增的表与字段。 */
function parseMigrationSql(sql) {
  const raw = String(sql || '');
  const text = stripSqlComments(raw);
  const tables = [];
  const createRe = new RegExp(`CREATE\\s+(?:TEMP(?:ORARY)?\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${NAME}\\s*\\(`, 'gi');
  let match;
  while ((match = createRe.exec(text))) {
    const balanced = readBalanced(text, createRe.lastIndex - 1);
    if (!balanced) continue;
    const entries = splitTopLevel(balanced.body);
    const columns = [];
    const checks = [];
    for (const entry of entries) {
      if (CONSTRAINT_ENTRY.test(entry)) {
        if (/\bCHECK\s*\(/i.test(entry)) checks.push(entry);
        continue;
      }
      const column = parseColumn(entry);
      if (column) columns.push(column);
    }
    const tail = text.slice(balanced.end + 1, text.indexOf(';', balanced.end) === -1 ? undefined : text.indexOf(';', balanced.end));
    const tableComment = tail.match(/\bCOMMENT\s*=?\s*'((?:[^']|'')*)'/i);
    tables.push({
      name: unquote(match[1]),
      qualified: qualifiedName(match[1]),
      created: true,
      columns,
      checks,
      comment: tableComment ? tableComment[1] : null,
    });
    createRe.lastIndex = balanced.end;
  }
  const alterRe = new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:IF\\s+EXISTS\\s+)?${NAME}\\s+([^;]+)`, 'gi');
  while ((match = alterRe.exec(text))) {
    const columns = [];
    for (const clause of splitTopLevel(match[2])) {
      const add = clause.match(/^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(.+)$/is);
      if (!add || CONSTRAINT_ENTRY.test(add[1])) continue;
      const column = parseColumn(add[1].trim());
      if (column) columns.push(column);
    }
    if (columns.length) {
      tables.push({ name: unquote(match[1]), qualified: qualifiedName(match[1]), created: false, columns, checks: [], comment: null });
    }
  }
  // SQLite 表重建（CREATE new_x → RENAME TO x）按最终表名评估
  const renameRe = new RegExp(`ALTER\\s+TABLE\\s+${NAME}\\s+RENAME\\s+TO\\s+${NAME}`, 'gi');
  while ((match = renameRe.exec(text))) {
    const from = unquote(match[1]).toLowerCase();
    for (const table of tables.filter((item) => item.name.toLowerCase() === from)) {
      table.name = unquote(match[2]);
      table.qualified = qualifiedName(match[2]);
    }
  }
  const comments = { tables: new Set(), columns: new Map() };
  const commentRe = new RegExp(`COMMENT\\s+ON\\s+(TABLE|COLUMN)\\s+${NAME}(?:\\.${NAME})?\\s+IS\\s+'((?:[^']|'')*)'`, 'gi');
  while ((match = commentRe.exec(text))) {
    if (match[1].toUpperCase() === 'TABLE') {
      comments.tables.add(unquote(match[3] ? `${match[2]}.${match[3]}` : match[2]).toLowerCase());
    } else {
      const parts = [match[2], match[3]].filter(Boolean).join('.').split('.').map(unquote);
      const column = parts.pop();
      const table = parts.pop();
      comments.columns.set(`${String(table).toLowerCase()}.${String(column).toLowerCase()}`, match[4].replace(/''/g, "'"));
    }
  }
  const exempt = new Map();
  let exemptMatch;
  EXEMPT_MARKER.lastIndex = 0;
  while ((exemptMatch = EXEMPT_MARKER.exec(raw))) exempt.set(unquote(exemptMatch[1]).toLowerCase(), exemptMatch[2].trim());
  return { tables, comments, exempt, dataMigration: DATA_MIGRATION_MARKER.test(raw) };
}

function isExemptTable(table, exemptList, inlineExempt) {
  const names = [table.name, table.qualified].map((name) => String(name).toLowerCase());
  if (names.some((name) => inlineExempt.has(name))) return true;
  return exemptList.some((pattern) => {
    const p = String(pattern).toLowerCase();
    if (p.endsWith('.*')) return names[1].startsWith(p.slice(0, -1));
    return names.includes(p);
  });
}

/** 字典索引：包含 `表名` 的章节及该章节字段表首列。 */
function parseDictionary(text) {
  const sections = [];
  let current = null;
  for (const line of String(text || '').split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      current = { heading: line, lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  const index = new Map();
  for (const section of sections) {
    const all = [section.heading, ...section.lines].join('\n');
    const tableNames = [...all.matchAll(/`([^`\s]+)`/g)].map((m) => unquote(m[1]).toLowerCase());
    if (!tableNames.length) continue;
    const columns = new Set();
    for (const line of section.lines) {
      if (!line.trim().startsWith('|')) continue;
      const first = line.trim().replace(/^\|/, '').split('|')[0].trim().replace(/`/g, '');
      if (!first || /^:?-+:?$/.test(first)) continue;
      columns.add(first.toLowerCase());
    }
    for (const name of tableNames) {
      const existing = index.get(name) || new Set();
      for (const column of columns) existing.add(column);
      index.set(name, existing);
    }
  }
  return index;
}

function semanticFindings(table, parsed, store) {
  const issues = [];
  const label = table.qualified;
  if (!SNAKE_CASE.test(table.name)) issues.push(`${label}: 表名应为业务语言 snake_case`);
  for (const column of table.columns) {
    if (!SNAKE_CASE.test(column.name)) issues.push(`${label}.${column.name}: 字段名应为 snake_case`);
  }
  if (table.created) {
    const present = new Set(table.columns.map((column) => column.name.toLowerCase()));
    const missing = AUDIT_COLUMNS.filter((name) => !present.has(name));
    if (missing.length) issues.push(`${label}: 缺少审计/软删除字段 ${missing.join(', ')}`);
  }
  const engine = store.engine;
  const columnComment = (column) => column.comment
    || parsed.comments.columns.get(`${table.name.toLowerCase()}.${column.name.toLowerCase()}`)
    || null;
  if (engine !== 'sqlite') {
    if (table.created && !table.comment && !parsed.comments.tables.has(table.name.toLowerCase())) {
      issues.push(`${label}: 缺少表注释（${engine === 'postgres' ? 'COMMENT ON TABLE' : '表选项 COMMENT'}）`);
    }
    const uncommented = table.columns.filter((column) => !columnComment(column)).map((column) => column.name);
    if (uncommented.length) issues.push(`${label}: 字段缺少注释 ${uncommented.join(', ')}`);
  }
  for (const column of table.columns) {
    if (!STATUS_LIKE_COLUMN.test(column.name) || !INTEGER_TYPE.test(column.type)) continue;
    const checked = column.hasCheck || table.checks.some((check) => new RegExp(`\\b${column.name}\\b`, 'i').test(check));
    const comment = columnComment(column);
    if (!checked && !(comment && comment.includes('='))) {
      issues.push(`${label}.${column.name}: 整数状态字段须有 CHECK 约束或写明取值的注释（如 1=待支付 2=已发货），优先字符串枚举`);
    }
  }
  return issues;
}

/**
 * 纯评估。changes: [{ status: A|M|D|R, file, oldFile? }]；
 * readFile(file) 读取工作区内容；fileDiff(file) 返回相对基线的 unified diff。
 */
function evaluateSchemaGate({ stores, gateConfig, changes, readFile, fileDiff }) {
  const errors = [];
  const warnings = [];
  const notes = [];
  if (!stores.length) return { errors, warnings, notes, managed: false };

  for (const change of changes) {
    for (const file of [change.oldFile, change.status === 'R' ? null : change.file].filter(Boolean)) {
      if (change.status === 'A') continue;
      const hit = classifyFile(file, stores);
      if (hit && hit.kind !== 'schema') {
        const action = { M: '修改', D: '删除', R: '重命名' }[change.status] || change.status;
        errors.push(`只追加：已发布${hit.kind === 'snapshot' ? '快照' : '迁移'}被${action}: ${file}（请新增迁移修正，禁止改写历史）`);
      }
    }
  }

  const dictionary = parseDictionary(readFile(DICTIONARY_DOC) || '');
  for (const store of stores) {
    const storeChanges = changes
      .map((change) => ({ change, hit: classifyFile(change.file, [store]) }))
      .filter((item) => item.hit);
    const newMigrations = storeChanges.filter((item) => item.hit.kind === 'migration' && item.change.status === 'A');
    const schemaChanged = storeChanges
      .filter((item) => item.hit.kind === 'schema')
      .some((item) => hasStructuralChange(fileDiff(item.change.file)));

    const migrations = newMigrations.map((item) => ({ file: item.change.file, parsed: parseMigrationSql(readFile(item.change.file) || '') }));
    if (store.access) {
      if (schemaChanged && !migrations.length) {
        errors.push(`配对：${store.path} 的 schema 结构变化但没有新增迁移；请用数据包的迁移生成命令离线生成并审查`);
      }
      if (!schemaChanged) {
        for (const migration of migrations.filter((item) => !item.parsed.dataMigration)) {
          errors.push(`配对：${migration.file} 没有对应的 schema 变化；纯数据迁移须在 SQL 中声明 -- xirang:data-migration`);
        }
      }
    }

    const merged = { comments: { tables: new Set(), columns: new Map() }, exempt: new Map() };
    for (const { parsed } of migrations) {
      parsed.comments.tables.forEach((name) => merged.comments.tables.add(name));
      parsed.comments.columns.forEach((value, key) => merged.comments.columns.set(key, value));
      parsed.exempt.forEach((value, key) => merged.exempt.set(key, value));
    }
    for (const { file, parsed } of migrations) {
      for (const table of parsed.tables) {
        if (isExemptTable(table, gateConfig.exemptTables, merged.exempt)) {
          notes.push(`豁免：${table.qualified}（${file}）`);
          continue;
        }
        const documented = dictionary.get(table.name.toLowerCase());
        if (!documented) {
          errors.push(`字典覆盖：${DICTIONARY_DOC} 未以 \`${table.name}\` 记录新表（${file}）`);
        } else {
          const missing = table.columns.map((column) => column.name).filter((name) => !documented.has(name.toLowerCase()));
          if (missing.length) errors.push(`字典覆盖：\`${table.name}\` 的字段表缺少 ${missing.join(', ')}（${file}）`);
        }
        if (gateConfig.semantic === 'off') continue;
        const target = gateConfig.semantic === 'required' ? errors : warnings;
        for (const issue of semanticFindings(table, merged, store)) target.push(`语义：${issue}（${file}）`);
      }
    }
  }
  return { errors, warnings, notes, managed: true };
}

function runGit(args, repoRoot) {
  return spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function resolveBaseCommit(base, repoRoot) {
  const mergeBase = runGit(['merge-base', base, 'HEAD'], repoRoot);
  if (mergeBase.status === 0 && mergeBase.stdout.trim()) return { commit: mergeBase.stdout.trim(), mode: 'range' };
  const head1 = runGit(['rev-parse', '--verify', '--quiet', 'HEAD~1'], repoRoot);
  if (head1.status === 0 && head1.stdout.trim()) return { commit: head1.stdout.trim(), mode: 'head1' };
  const head = runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], repoRoot);
  if (head.status === 0 && head.stdout.trim()) return { commit: head.stdout.trim(), mode: 'working' };
  return { commit: null, mode: 'working' };
}

function parseNameStatus(text) {
  const changes = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0].charAt(0);
    if (code === 'R' || code === 'C') {
      changes.push({ status: code === 'R' ? 'R' : 'A', file: normalizePath(parts[2]), oldFile: code === 'R' ? normalizePath(parts[1]) : undefined });
    } else if (parts[1]) {
      changes.push({ status: code === 'T' ? 'M' : code, file: normalizePath(parts[1]) });
    }
  }
  return changes;
}

/** 相对基线提交（merge-base）比较工作区，含已暂存、未暂存和未跟踪文件。 */
function collectChanges(base, repoRoot) {
  const resolved = resolveBaseCommit(base, repoRoot);
  const changes = [];
  if (resolved.commit) {
    const diff = runGit(['diff', '--name-status', '-M', resolved.commit], repoRoot);
    if (diff.status !== 0) throw new Error(`git diff 失败: ${(diff.stderr || '').trim()}`);
    changes.push(...parseNameStatus(diff.stdout));
  } else {
    const staged = runGit(['diff', '--cached', '--name-status', '--root'], repoRoot);
    changes.push(...parseNameStatus(staged.stdout).map((change) => ({ ...change, status: 'A' })));
  }
  const untracked = runGit(['ls-files', '--others', '--exclude-standard'], repoRoot);
  for (const file of String(untracked.stdout || '').split('\n').map(normalizePath).filter(Boolean)) {
    if (!changes.some((change) => change.file === file)) changes.push({ status: 'A', file });
  }
  const readFile = (file) => {
    const absolute = path.join(repoRoot, file);
    return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null;
  };
  const fileDiff = (file) => {
    const change = changes.find((item) => item.file === file);
    if (!change || change.status === 'A' || !resolved.commit) {
      return String(readFile(file) || '').split('\n').map((line) => `+${line}`).join('\n');
    }
    return runGit(['diff', resolved.commit, '--', file], repoRoot).stdout || '';
  };
  return { mode: resolved.mode, baseCommit: resolved.commit, changes, readFile, fileDiff };
}

module.exports = {
  AUDIT_COLUMNS,
  DEFAULT_EXEMPT_TABLES,
  classifyFile,
  collectChanges,
  evaluateSchemaGate,
  hasStructuralChange,
  parseDictionary,
  parseMigrationSql,
  parseNameStatus,
  resolveDatastores,
  resolveGateConfig,
};

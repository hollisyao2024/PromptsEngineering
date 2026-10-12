/**
 * Schema 变更治理（ADR-034）的迁移 SQL 解析：从迁移文本提取建表、改列、删除与治理标记。
 * 纯函数，无文件或 git 依赖；由 schema-governance.js 重新导出。
 */

const DATA_MIGRATION_MARKER = /--\s*xirang:data-migration\b/i;
const EXEMPT_MARKER = /--\s*xirang:exempt\s+(\S+)\s+(\S.*)$/gim;
const HARD_DELETE_MARKER = /--\s*xirang:hard-delete\s+(\S+)\s+(\S.*)$/gim;
const CONSTRAINT_ENTRY = /^(?:constraint|primary|unique|foreign|check|index|key|fulltext|spatial|exclude)\b/i;

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
  const hardDelete = new Map();
  HARD_DELETE_MARKER.lastIndex = 0;
  while ((exemptMatch = HARD_DELETE_MARKER.exec(raw))) hardDelete.set(unquote(exemptMatch[1]).toLowerCase(), exemptMatch[2].trim());
  return { tables, comments, exempt, hardDelete, dataMigration: DATA_MIGRATION_MARKER.test(raw) };
}

module.exports = {
  parseMigrationSql,
  unquote,
};

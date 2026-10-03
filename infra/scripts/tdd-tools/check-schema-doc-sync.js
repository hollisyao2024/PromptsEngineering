#!/usr/bin/env node
/**
 * Schema 变更门禁（TDD 文档回写 Gate Step 1.7，ADR-034）
 *
 * 1. 文档同步（阻断）：schema 或迁移有实质变化时，必须同时改动 docs/data/ERD.md 与 docs/data/dictionary.md
 * 2. 对 architecture.config.json 登记的数据存储另行执行（见 schema-governance.js）：
 *    schema↔迁移配对、已发布迁移/快照只追加、字典覆盖（阻断）；语义检查按 tdd.schemaGate.semantic 告警或阻断
 * 绕过：--skip-schema-doc-sync=<原因> 显式声明（reason 必填，会回显到 stderr）
 *
 * 启发式：仅含普通注释（//）/ @@map **新增** / 空白调整的 schema diff 不需要文档同步；
 * Prisma `///` 与 Drizzle `/** *\/` 文档注释是数据字典内容，视为实质变化。
 */

const { loadConfig, resolveRepoRoot } = require('../shared/config');
const {
  classifyFile,
  collectChanges,
  evaluateSchemaGate,
  resolveDatastores,
  resolveGateConfig,
} = require('./schema-governance');

const SCHEMA_PATTERNS = [/schema\.prisma$/, /\/migrations\/.+\.sql$/];
const REQUIRED_DOCS = ['docs/data/ERD.md', 'docs/data/dictionary.md'];
const VALID_BASE_REF = /^[A-Za-z0-9_./@~^-]+$/; // 防御 CLI 参数 shell 注入

function parseFlags(argv) {
  const flags = { skip: false, skipReason: '', base: 'origin/main', quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--skip-schema-doc-sync') {
      flags.skip = true;
    } else if (arg.startsWith('--skip-schema-doc-sync=')) {
      flags.skip = true;
      flags.skipReason = arg.slice('--skip-schema-doc-sync='.length).trim();
    } else if (arg.startsWith('--base=')) {
      flags.base = arg.slice('--base='.length);
    } else if (arg === '--base' && argv[i + 1]) {
      flags.base = argv[i + 1];
      i += 1;
    } else if (arg === '--quiet') {
      flags.quiet = true;
    }
  }
  // base ref 安全校验（避免 shell 注入）
  if (!VALID_BASE_REF.test(flags.base)) {
    throw new Error(
      `非法 --base 值（仅允许字母/数字/./_/-/@/~/^/）: ${JSON.stringify(flags.base)}`
    );
  }
  return flags;
}

function parseStatusFileList(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const file = line.slice(3).trim();
      if (!file) return [];
      if (file.includes(' -> ')) return file.split(' -> ').map((item) => item.trim());
      return [file];
    });
}

function isSchemaFile(file, stores = []) {
  if (SCHEMA_PATTERNS.some((re) => re.test(file))) return true;
  const hit = classifyFile(file, stores);
  return Boolean(hit && hit.kind !== 'snapshot');
}

function isMigrationFile(file, stores = []) {
  if (/\/migrations\/.+\.sql$/.test(file)) return true;
  const hit = classifyFile(file, stores);
  return Boolean(hit && hit.kind === 'migration');
}

function analyzeDiffTrivial(diff) {
  const lines = String(diff || '').split('\n');
  // 收集所有 + 和 - 行（去掉 +++/--- 文件头），按内容做配对分析
  const added = [];
  const removed = [];
  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
    else if (line.startsWith('-')) removed.push(line.slice(1));
  }
  // 任何 - 包含非 trivial 内容（如 `@@map(...)` 删除/改值）→ 视为实质变更
  const hasNonTrivialAddition = added.some((l) => !isTrivialLine(l, /* isAddition */ true));
  const hasNonTrivialRemoval = removed.some((l) => !isTrivialLine(l, /* isAddition */ false));
  return !hasNonTrivialAddition && !hasNonTrivialRemoval;
}

function isTrivialLine(line, isAddition) {
  const content = line.trim();
  if (!content) return true;
  if (content.startsWith('///')) return false; // Prisma 文档注释即数据字典内容
  if (content.startsWith('//')) return true; // 普通注释
  // @@map 仅在 **新增**（addition）时视为 trivial；删除或修改值都不是 trivial
  if (isAddition && /^@@map\(".+"\)$/.test(content)) return true;
  return false;
}

function printList(title, items) {
  console.error(`  ${title}`);
  items.forEach((item) => console.error(`    • ${item}`));
}

function main() {
  let flags;
  try {
    flags = parseFlags(process.argv.slice(2));
  } catch (e) {
    console.error(`❌ Schema-Doc Sync Gate: ${e.message}`);
    process.exit(2);
  }
  const log = flags.quiet ? () => {} : console.log;

  if (flags.skip) {
    if (!flags.skipReason) {
      console.error('❌ --skip-schema-doc-sync 必须提供原因');
      console.error('   用法: --skip-schema-doc-sync=<具体原因>');
      console.error('   例如: --skip-schema-doc-sync="仅调整 prisma format，无字段变更"');
      process.exit(2);
    }
    // 输出到 stderr 让 PR 评审者从日志中容易看到
    console.error(`⏭  Schema-Doc Sync Gate: 已绕过`);
    console.error(`  原因: ${flags.skipReason}`);
    console.error(`  ⚠️  请确保 PR 描述中也记录此原因供评审`);
    console.log('SCHEMA_GATE_STATUS=SKIPPED');
    process.exit(0);
  }

  const repoRoot = resolveRepoRoot({ scriptDir: __dirname, warn: false });
  let gateConfig;
  let stores;
  let collected;
  try {
    gateConfig = resolveGateConfig(loadConfig({ repoRoot }));
    stores = resolveDatastores(repoRoot, gateConfig);
    collected = collectChanges(flags.base, repoRoot);
  } catch (e) {
    console.error(`❌ Schema-Doc Sync Gate: ${e.message}`);
    console.log('SCHEMA_GATE_STATUS=BLOCKED');
    process.exit(2);
  }
  const files = Array.from(new Set(collected.changes.flatMap((c) => [c.file, c.oldFile]).filter(Boolean)));

  // 无法解析 base ref 也无 HEAD~1 时文件列表可能为空，输出 WARN 而非静默通过
  if (collected.mode === 'working' && files.length === 0) {
    console.error('⚠️  Schema-Doc Sync Gate: 无法解析 base ref 也无法用 HEAD~1，');
    console.error(`   请确认 origin/${flags.base.split('/').pop()} 已 fetch，或显式传 --base=<可达 ref>`);
    console.error('   保守处理：跳过本次检查并放行（请人工复核 schema/doc 同步）');
    console.log('SCHEMA_GATE_STATUS=UNVERIFIED');
    process.exit(0);
  }

  const errors = [];
  const schemaFiles = files.filter((f) => isSchemaFile(f, stores));
  const nonTrivial = schemaFiles.filter((f) => {
    if (isMigrationFile(f, stores)) return true; // SQL 迁移一律视为实质变更
    return !analyzeDiffTrivial(collected.fileDiff(f));
  });
  const missingDocs = nonTrivial.length ? REQUIRED_DOCS.filter((doc) => !files.includes(doc)) : [];
  if (missingDocs.length) {
    errors.push(...missingDocs.map((doc) => `文档同步：schema 实质变化但未更新 ${doc}`));
  }

  const result = evaluateSchemaGate({
    stores,
    gateConfig,
    changes: collected.changes,
    readFile: collected.readFile,
    fileDiff: collected.fileDiff,
  });
  errors.push(...result.errors);

  result.notes.forEach((note) => log(`ℹ️  ${note}`));
  if (result.warnings.length) {
    console.error('⚠️  Schema 语义检查告警（tdd.schemaGate.semantic=warn，配置 required 后阻断）：');
    result.warnings.forEach((w) => console.error(`    • ${w}`));
  }

  if (!errors.length) {
    const scope = result.managed ? `受管存储 ${stores.map((s) => s.path).join(', ')}` : '未登记数据存储，仅文档同步';
    if (!schemaFiles.length) log(`ℹ️  Schema-Doc Sync Gate: 本次未改动 schema/migrations（mode=${collected.mode}，${scope}）`);
    else if (!nonTrivial.length) log('✅ Schema-Doc Sync Gate: 改动仅含普通注释 / @@map 新增 / 空白，跳过 Doc Sync 检查');
    else log(`✅ Schema-Doc Sync Gate 通过（mode=${collected.mode}，${scope}）`);
    console.log(`SCHEMA_GATE_STATUS=${result.warnings.length ? 'WARN' : 'PASS'}`);
    process.exit(0);
  }

  console.error('');
  console.error('❌ Schema-Doc Sync Gate 失败');
  console.error('');
  if (nonTrivial.length) printList('改动的 schema/迁移文件：', nonTrivial);
  printList('阻断项：', errors);
  console.error('');
  console.error('修复方式：');
  console.error('  1. schema 变化须同一交付：修改 schema → 用数据包命令离线生成新迁移并审查 → 更新 ERD.md 与 dictionary.md');
  console.error('     - dictionary.md：表以 `表名` 出现在章节中，字段表首列为数据库列名');
  console.error('  2. 已发布迁移与快照只追加：恢复被改写的文件，以新迁移修正');
  console.error('  3. 纯数据迁移在 SQL 中声明 -- xirang:data-migration；第三方/系统表用 -- xirang:exempt <表名> <原因>');
  console.error('     详见 architecture/standards/data.md「Schema 变更流程」与 AgentRoles/TDD-PROGRAMMING-EXPERT.md');
  console.error('  4. 或显式绕过（仅极少数场景，必填原因）：');
  console.error('     pnpm agent -- tdd sync --skip-schema-doc-sync=<具体原因>');
  console.error('');
  console.log('SCHEMA_GATE_STATUS=BLOCKED');
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  isSchemaFile,
  isMigrationFile,
  analyzeDiffTrivial,
  isTrivialLine,
  parseFlags,
  parseStatusFileList,
  REQUIRED_DOCS,
  SCHEMA_PATTERNS,
  VALID_BASE_REF,
};

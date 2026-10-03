'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  classifyFile,
  evaluateSchemaGate,
  hasStructuralChange,
  parseDictionary,
  parseMigrationSql,
  parseNameStatus,
  resolveGateConfig,
} = require('../schema-governance');
const { analyzeDiffTrivial, parseFlags } = require('../check-schema-doc-sync');

const repoRoot = path.resolve(__dirname, '../../../..');
const prisma = { id: 'main', path: 'packages/database-main', access: 'prisma', engine: 'postgres' };
const drizzle = { id: 'main', path: 'packages/database-main', access: 'drizzle', engine: 'sqlite' };
const legacy = { id: 'main', path: 'packages/db-main', access: null, engine: 'postgres' };

const goodPgTask = `CREATE TABLE "task" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'todo' CHECK ("status" IN ('todo', 'doing', 'done')),
  "created_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" TEXT,
  CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);
COMMENT ON TABLE "task" IS '任务';
${['id', 'status', 'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by']
    .map((c) => `COMMENT ON COLUMN "task"."${c}" IS '${c === 'status' ? 'todo=待办 doing=进行中 done=完成' : c}';`).join('\n')}
`;
const dictionary = `# 数据字典\n\n## \`task\`\n\n| 字段 | 类型 | 说明 |\n| --- | --- | --- |\n${
  ['id', 'status', 'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by', 'priority']
    .map((c) => `| ${c} | TEXT | x |`).join('\n')}\n`;

function evaluate({ stores = [prisma], semantic = 'warn', exemptTables, changes, files = {}, diffs = {} }) {
  return evaluateSchemaGate({
    stores,
    gateConfig: resolveGateConfig({ tdd: { schemaGate: { semantic, exemptTables } } }),
    changes,
    readFile: (file) => (file in files ? files[file] : null),
    fileDiff: (file) => diffs[file] || '',
  });
}

const schemaFile = 'packages/database-main/prisma/schema.prisma';
const migration = 'packages/database-main/prisma/migrations/20261003000000_task/migration.sql';

test('resolves prisma, drizzle and legacy datastore paths', () => {
  assert.equal(classifyFile(schemaFile, [prisma]).kind, 'schema');
  assert.equal(classifyFile('packages/database-main/prisma/schema/task.prisma', [prisma]).kind, 'schema');
  assert.equal(classifyFile(migration, [prisma]).kind, 'migration');
  assert.equal(classifyFile('packages/database-main/src/schema/tasks.ts', [drizzle]).kind, 'schema');
  assert.equal(classifyFile('packages/database-main/drizzle/0001_task.sql', [drizzle]).kind, 'migration');
  assert.equal(classifyFile('packages/database-main/drizzle/meta/0001_snapshot.json', [drizzle]).kind, 'snapshot');
  assert.equal(classifyFile('packages/database-main/drizzle/meta/_journal.json', [drizzle]), null);
  assert.equal(classifyFile('packages/db-main/migrations/0002_x.sql', [legacy]).kind, 'migration');
  assert.equal(classifyFile('apps/api/src/index.ts', [prisma]), null);
});

test('gate config validates semantic mode and exempt tables', () => {
  assert.equal(resolveGateConfig({}).semantic, 'required');
  assert.ok(!resolveGateConfig({}).exemptTables.includes('account'));
  assert.throws(() => resolveGateConfig({ tdd: { schemaGate: { semantic: 'strict' } } }), /semantic/);
  assert.throws(() => resolveGateConfig({ tdd: { schemaGate: { exemptTables: [''] } } }), /exemptTables/);
  assert.ok(resolveGateConfig({ tdd: { schemaGate: { exemptTables: ['legacy_log'] } } }).exemptTables.includes('legacy_log'));
});

test('doc comments are dictionary changes but not structural changes', () => {
  assert.equal(analyzeDiffTrivial('+  /// 任务标题'), false);
  assert.equal(analyzeDiffTrivial('+  // 临时备注'), true);
  assert.equal(analyzeDiffTrivial('+  /** 任务标题 */'), false);
  assert.equal(hasStructuralChange('+  /// 任务标题\n+  /** x */\n+  // y'), false);
  assert.equal(hasStructuralChange('+  priority Int @default(0)'), true);
});

test('parseFlags accepts both --base=<ref> and --base <ref>', () => {
  assert.equal(parseFlags(['--base=origin/dev']).base, 'origin/dev');
  assert.equal(parseFlags(['--base', 'origin/dev']).base, 'origin/dev');
  assert.throws(() => parseFlags(['--base=$(id)']), /非法/);
});

test('parseNameStatus maps renames and copies', () => {
  assert.deepEqual(parseNameStatus('M\ta.sql\nR100\told.sql\tnew.sql\nC90\tx\ty\nD\tz'), [
    { status: 'M', file: 'a.sql' },
    { status: 'R', file: 'new.sql', oldFile: 'old.sql' },
    { status: 'A', file: 'y', oldFile: undefined },
    { status: 'D', file: 'z' },
  ]);
});

test('blocks structural schema change without a new migration', () => {
  const result = evaluate({ changes: [{ status: 'M', file: schemaFile }], diffs: { [schemaFile]: '+  priority Int' } });
  assert.match(result.errors.join('\n'), /配对.*没有新增迁移/);
  const docOnly = evaluate({ changes: [{ status: 'M', file: schemaFile }], diffs: { [schemaFile]: '+  /// 说明' } });
  assert.deepEqual(docOnly.errors, []);
});

test('blocks migration without schema change unless declared as data migration', () => {
  const sql = "UPDATE task SET status = 'todo' WHERE status IS NULL;";
  const blocked = evaluate({ changes: [{ status: 'A', file: migration }], files: { [migration]: sql } });
  assert.match(blocked.errors.join('\n'), /xirang:data-migration/);
  const allowed = evaluate({ changes: [{ status: 'A', file: migration }], files: { [migration]: `-- xirang:data-migration 回填状态\n${sql}` } });
  assert.deepEqual(allowed.errors, []);
});

test('legacy SQL stores skip pairing but stay append-only', () => {
  const file = 'packages/db-main/migrations/0002_note.sql';
  const added = evaluate({ stores: [legacy], changes: [{ status: 'A', file }], files: { [file]: '-- xirang:exempt note 临时\nCREATE TABLE note (id TEXT);', 'docs/data/dictionary.md': '## `note`\n| id | x |' } });
  assert.deepEqual(added.errors, []);
  const edited = evaluate({ stores: [legacy], changes: [{ status: 'M', file: 'packages/db-main/migrations/0001_initial.sql' }] });
  assert.match(edited.errors.join('\n'), /只追加.*被修改/);
});

test('blocks modified, deleted and renamed published migrations and snapshots', () => {
  const result = evaluate({
    stores: [drizzle],
    changes: [
      { status: 'M', file: 'packages/database-main/drizzle/0000_init.sql' },
      { status: 'D', file: 'packages/database-main/drizzle/meta/0000_snapshot.json' },
      { status: 'R', file: 'packages/database-main/drizzle/0001_b.sql', oldFile: 'packages/database-main/drizzle/0001_a.sql' },
      { status: 'M', file: 'packages/database-main/drizzle/meta/_journal.json' },
    ],
  });
  assert.equal(result.errors.filter((e) => e.startsWith('只追加')).length, 3);
  assert.match(result.errors.join('\n'), /快照被删除/);
  assert.match(result.errors.join('\n'), /被重命名: packages\/database-main\/drizzle\/0001_a\.sql/);
});

test('dictionary must cover new tables and columns', () => {
  const sql = goodPgTask;
  const changes = [{ status: 'M', file: schemaFile }, { status: 'A', file: migration }];
  const diffs = { [schemaFile]: '+model Task {}' };
  const missingTable = evaluate({ changes, diffs, files: { [migration]: sql, 'docs/data/dictionary.md': '# 空' } });
  assert.match(missingTable.errors.join('\n'), /未以 `task` 记录新表/);
  const covered = evaluate({ changes, diffs, files: { [migration]: sql, 'docs/data/dictionary.md': dictionary } });
  assert.deepEqual(covered.errors, []);
  assert.deepEqual(covered.warnings, []);
  const alter = 'ALTER TABLE "task" ADD COLUMN "priority" TEXT, ADD COLUMN "owner_id" TEXT;';
  const partial = evaluate({ changes, diffs, files: { [migration]: alter, 'docs/data/dictionary.md': dictionary } });
  assert.match(partial.errors.join('\n'), /缺少 owner_id/);
  assert.doesNotMatch(partial.errors.join('\n'), /priority/);
});

test('semantic lint warns in warn mode, blocks when required, and is silent when off', () => {
  const sql = 'CREATE TABLE "Order" ("id" TEXT PRIMARY KEY, "payStatus" INTEGER NOT NULL, "createdAt" TIMESTAMP);';
  const dict = '## `Order`\n| id | x |\n| payStatus | x |\n| createdAt | x |';
  const changes = [{ status: 'M', file: schemaFile }, { status: 'A', file: migration }];
  const input = { changes, diffs: { [schemaFile]: '+model Order {}' }, files: { [migration]: sql, 'docs/data/dictionary.md': dict } };
  const warned = evaluate(input);
  assert.deepEqual(warned.errors, []);
  const text = warned.warnings.join('\n');
  assert.match(text, /Order: 表名应为业务语言 snake_case/);
  assert.match(text, /payStatus: 字段名应为 snake_case/);
  assert.match(text, /缺少审计\/软删除字段 created_at, updated_at, created_by, updated_by, deleted_at, deleted_by/);
  assert.match(text, /缺少表注释/);
  assert.match(text, /字段缺少注释 id, payStatus, createdAt/);
  const required = evaluate({ ...input, semantic: 'required' });
  assert.ok(required.errors.some((e) => e.startsWith('语义：')));
  assert.deepEqual(evaluate({ ...input, semantic: 'off' }).warnings, []);
});

test('integer status columns need CHECK or a value comment', () => {
  const base = ['"id" TEXT', '"created_at" TEXT', '"updated_at" TEXT', '"created_by" TEXT', '"updated_by" TEXT', '"deleted_at" TEXT', '"deleted_by" TEXT'];
  const sqlite = { ...prisma, engine: 'sqlite' };
  const run = (sql) => evaluate({
    stores: [sqlite],
    changes: [{ status: 'M', file: schemaFile }, { status: 'A', file: migration }],
    diffs: { [schemaFile]: '+x' },
    files: { [migration]: sql, 'docs/data/dictionary.md': '## `orders`\n| id |\n| pay_status |\n' + base.map((c) => `| ${c.split('"')[1]} |`).join('\n') },
  }).warnings.join('\n');
  assert.match(run(`CREATE TABLE "orders" (${[...base, '"pay_status" INTEGER NOT NULL'].join(', ')});`), /pay_status: 整数状态字段/);
  assert.doesNotMatch(run(`CREATE TABLE "orders" (${[...base, '"pay_status" INTEGER NOT NULL CHECK ("pay_status" IN (1, 2))'].join(', ')});`), /整数状态/);
  const mysql = parseMigrationSql("CREATE TABLE `orders` (`pay_status` TINYINT NOT NULL COMMENT '1=待支付 2=已发货') COMMENT='订单';");
  assert.equal(mysql.tables[0].columns[0].comment, '1=待支付 2=已发货');
  assert.equal(mysql.tables[0].comment, '订单');
});

test('exempt tables skip dictionary and semantic checks', () => {
  const sql = 'CREATE TABLE "_prisma_migrations" ("id" TEXT); CREATE TABLE pgboss.job (id TEXT); -- xirang:exempt audit_raw 第三方原始日志\nCREATE TABLE audit_raw (id TEXT); CREATE TABLE legacy_log (id TEXT);';
  const result = evaluate({
    exemptTables: ['legacy_log'],
    changes: [{ status: 'M', file: schemaFile }, { status: 'A', file: migration }],
    diffs: { [schemaFile]: '+x' },
    files: { [migration]: sql, 'docs/data/dictionary.md': '' },
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.notes.length, 4);
});

test('SQLite table redefinition is evaluated under the final table name', () => {
  const parsed = parseMigrationSql('CREATE TABLE "new_task" ("id" TEXT); INSERT INTO "new_task" SELECT * FROM "task"; DROP TABLE "task"; ALTER TABLE "new_task" RENAME TO "task";');
  assert.equal(parsed.tables[0].name, 'task');
  assert.equal(parsed.tables.length, 1);
});

test('parseDictionary indexes first-column fields per backticked table section', () => {
  const index = parseDictionary('## 任务 `task`\n\n| 字段 | 说明 |\n| --- | --- |\n| `deleted_at` | 删除时间 |\n\n## 其他\n| x | y |');
  assert.ok(index.get('task').has('deleted_at'));
  assert.ok(!index.has('其他'));
});

test('gate CLI blocks published migration edits in a registered datastore', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-gate-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'architecture.config.json'), JSON.stringify({ datastores: [prisma] }));
  const migrationPath = path.join(dir, migration);
  fs.mkdirSync(path.dirname(migrationPath), { recursive: true });
  fs.writeFileSync(migrationPath, goodPgTask);
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  fs.appendFileSync(migrationPath, '\nALTER TABLE "task" ADD COLUMN "x" TEXT;\n');
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'infra/scripts/tdd-tools/check-schema-doc-sync.js'), '--base', 'HEAD'], { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /只追加：已发布迁移被修改/);
  assert.match(result.stderr, /文档同步：schema 实质变化但未更新 docs\/data\/ERD\.md/);
  assert.match(result.stdout, /SCHEMA_GATE_STATUS=BLOCKED/);
});

const authMigration = 'packages/database-main/prisma/migrations/20260909020000_auth/migration.sql';
const fileMigration = 'packages/database-main/prisma/migrations/20260909010000_file_storage/migration.sql';

test('module tables are exempt only when the legacy module is installed in that store', () => {
  const sql = 'ALTER TABLE "session" ADD COLUMN "device" TEXT; ALTER TABLE "FileObject" ADD COLUMN "etag" TEXT;';
  const base = { semantic: 'required', changes: [{ status: 'M', file: schemaFile }, { status: 'A', file: migration }], diffs: { [schemaFile]: '+x' } };
  const fresh = evaluate({ ...base, files: { [migration]: sql, 'docs/data/dictionary.md': '' } });
  assert.match(fresh.errors.join('\n'), /未以 `session` 记录新表/);
  assert.match(fresh.errors.join('\n'), /未以 `FileObject` 记录新表/);
  const installed = evaluate({ ...base, files: {
    [migration]: sql, 'docs/data/dictionary.md': '',
    [authMigration]: 'CREATE TABLE "user" ("id" TEXT, "emailVerified" BOOLEAN);',
    [fileMigration]: 'CREATE TABLE "FileObject" ("id" TEXT);',
  } });
  assert.deepEqual(installed.errors, []);
  assert.equal(installed.notes.length, 2);
  const drizzleInstalled = evaluate({ ...base, stores: [drizzle], changes: [{ status: 'M', file: 'packages/database-main/src/schema/x.ts' }, { status: 'A', file: 'packages/database-main/drizzle/0003_x.sql' }],
    diffs: { 'packages/database-main/src/schema/x.ts': '+x' },
    files: { 'packages/database-main/drizzle/0003_x.sql': sql, 'docs/data/dictionary.md': '', 'packages/database-main/src/schema/auth.ts': "text('emailVerified')" } });
  assert.doesNotMatch(drizzleInstalled.errors.join('\n'), /session/);
  assert.match(drizzleInstalled.errors.join('\n'), /FileObject/);
});

test('hard-delete marker only waives soft delete columns', () => {
  const cols = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by'];
  const sqlite = { ...prisma, engine: 'sqlite' };
  const dict = '## `login_session`\n| 字段 | 说明 |\n| --- | --- |\n' + cols.map((c) => `| ${c} | ${c} 说明 |`).join('\n');
  const run = (sql) => evaluate({ stores: [sqlite], semantic: 'required', changes: [{ status: 'M', file: schemaFile }, { status: 'A', file: migration }], diffs: { [schemaFile]: '+x' }, files: { [migration]: sql, 'docs/data/dictionary.md': dict } });
  const table = `CREATE TABLE "login_session" (${cols.map((c) => `"${c}" TEXT`).join(', ')});`;
  assert.match(run(table).errors.join('\n'), /缺少审计\/软删除字段 deleted_at, deleted_by.*xirang:hard-delete/);
  assert.deepEqual(run(`-- xirang:hard-delete login_session 会话过期即物理删除\n${table}`).errors, []);
  const partial = run(`-- xirang:hard-delete login_session 会话\nCREATE TABLE "login_session" ("id" TEXT, "created_at" TEXT);`);
  assert.match(partial.errors.join('\n'), /缺少审计\/软删除字段 updated_at, created_by, updated_by（/);
});

test('dictionary descriptions must be non-empty for new columns', () => {
  const sqlite = { ...prisma, engine: 'sqlite' };
  const audit = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at', 'deleted_by'];
  const sql = `CREATE TABLE "note" (${audit.map((c) => `"${c}" TEXT`).join(', ')});`;
  const dict = (blank) => '## `note`\n| 字段 | 类型 | 说明 |\n| --- | --- | --- |\n' + audit.map((c) => `| ${c} | TEXT | ${c === blank ? '' : '说明'} |`).join('\n');
  const run = (text) => evaluate({ stores: [sqlite], semantic: 'required', changes: [{ status: 'M', file: schemaFile }, { status: 'A', file: migration }], diffs: { [schemaFile]: '+x' }, files: { [migration]: sql, 'docs/data/dictionary.md': text } });
  assert.deepEqual(run(dict(null)).errors, []);
  assert.match(run(dict('created_by')).errors.join('\n'), /字段说明为空 created_by/);
  assert.equal(parseDictionary('## `note`\n| id | 主键 |').get('note').get('id'), '主键');
});

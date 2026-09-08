const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateConfig, detectProject, createArchitecturePlan, catalog, derivePaths } = require('../scripts/project');
const { applyPlan } = require('../../tooling/xirang/engine');
const source = path.resolve(__dirname, '../..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-arch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'repo'); fs.mkdirSync(target);
  return { target, runRoot: path.join(root, 'runs') };
}
const config = () => ({ schemaVersion: 1, applications: [{ id: 'web', stack: 'react-vite', path: 'apps/web', components: { ui: 'apps/web/src/components/ui', dataTable: 'apps/web/src/components/data-table' } }, { id: 'api', stack: 'node', path: 'apps/server' }], datastores: [{ id: 'platform', engine: 'postgres', path: 'packages/database', consumers: ['api'] }], modules: [] });
test('TC-ARCHPLAT-002 selects per-application and per-store stacks with path mapping', t => {
  const f = fixture(t), c = config();
  c.applications.push({ id: 'desktop', stack: 'tauri', path: 'apps/desktop', targets: ['mac-arm64', 'win-x64'] });
  c.datastores.push({ id: 'local', engine: 'sqlite', path: 'db/local', consumers: ['desktop'] });
  const result = validateConfig(c, { target: f.target }); assert.equal(result.applications.length, 3);
  assert.equal(derivePaths(c).apiAppDir, 'apps/server'); assert.equal(derivePaths(c).databaseDir, 'packages/database');
  for (const [key, value] of [['stack', 'mystery'], ['path', '../escape']]) {
    const bad = config(); bad.applications[0][key] = value; assert.throws(() => validateConfig(bad, { target: f.target }));
  }
  const collision = config(); collision.applications[1].path = 'apps/web'; assert.throws(() => validateConfig(collision, { target: f.target }), /overlap|duplicate/);
  const badDb = config(); badDb.datastores[0].consumers = ['missing']; assert.throws(() => validateConfig(badDb, { target: f.target }), /consumer/);
  const badTarget = config(); badTarget.applications[0].targets = ['ios-arm64']; assert.throws(() => validateConfig(badTarget, { target: f.target }), /target/);
});
test('TC-ARCHPLAT-003 empty project generates selected stacks, standards, shared UI and converges', t => {
  const f = fixture(t), c = config(); const plan = createArchitecturePlan({ source, target: f.target, config: c });
  assert.equal(plan.conflicts.length, 0); assert.equal(fs.readdirSync(f.target).length, 0);
  applyPlan(plan, { runRoot: f.runRoot });
  for (const p of ['architecture.config.json', 'apps/web/components.json', 'apps/web/src/components/ui/button.tsx', 'apps/web/src/components/data-table/data-table.tsx', 'apps/server/src/server.mjs', 'packages/database/migrations/0001_initial.sql', 'docs/standards/directories.md', 'xirang.lock.json']) assert.ok(fs.existsSync(path.join(f.target, p)), p);
  assert.equal(fs.existsSync(path.join(f.target, 'apps/desktop')), false);
  assert.equal(fs.existsSync(path.join(f.target, 'RULES.md')), false);
  const again = createArchitecturePlan({ source, target: f.target, config: c });
  assert.equal(again.conflicts.length, 0); assert.equal(again.changes.length, 0);
});
test('TC-ARCHPLAT-004 detection uses actual paths and existing shadcn aliases without mutation', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.target, 'apps/server'), { recursive: true }); fs.writeFileSync(path.join(f.target, 'apps/server/package.json'), JSON.stringify({ dependencies: { fastify: '5' } }));
  fs.mkdirSync(path.join(f.target, 'apps/web'), { recursive: true }); fs.writeFileSync(path.join(f.target, 'apps/web/package.json'), JSON.stringify({ dependencies: { next: '16' } }));
  fs.writeFileSync(path.join(f.target, 'apps/web/tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: './src', paths: { '@/*': ['*'] } } }));
  fs.writeFileSync(path.join(f.target, 'apps/web/components.json'), JSON.stringify({ aliases: { ui: '@/components/ui' } }));
  const found = detectProject(f.target); assert.ok(found.applications.some(a => a.path === 'apps/server' && a.stack === 'node'));
  const web = found.applications.find(a => a.id === 'web'); assert.equal(web.stack, 'react-next'); assert.equal(web.components.ui, 'apps/web/src/components/ui');
  assert.equal(fs.existsSync(path.join(f.target, 'architecture.config.json')), false);
});
test('TC-ARCHPLAT-003 all declared stack/store generators create concrete assets', t => {
  const f = fixture(t);
  for (const stack of Object.keys(catalog().stacks)) {
    const c = { schemaVersion: 1, applications: [{ id: stack, stack, path: `apps/${stack}` }], datastores: [], modules: [] };
    const p = createArchitecturePlan({ source, target: f.target, config: c });
    assert.ok(p.entries.some(e => e.path.startsWith(`apps/${stack}/`))); assert.equal(p.conflicts.length, 0);
  }
});

test('TC-ARCHPLAT-002 rejects mistyped fields and overlapping component ownership', t => {
  const f = fixture(t), c = config();
  c.applications[0].component = {};
  assert.throws(() => validateConfig(c, { target: f.target }), /unknown application field/);
  const nested = config(); nested.applications[0].components.ui = nested.applications[0].components.dataTable + '/ui';
  assert.throws(() => validateConfig(nested, { target: f.target }), /separate/);
  const overlap = config(); overlap.applications[0].components.ui = 'packages/database/ui';
  assert.throws(() => validateConfig(overlap, { target: f.target }), /component.*overlap/);
});
test('TC-ARCHPLAT-004 existing project choices must be edited explicitly before applying a different config', t => {
  const f = fixture(t), c = config();
  applyPlan(createArchitecturePlan({ source, target: f.target, config: c, includeRuntime: false }), { runRoot: f.runRoot });
  c.applications[1].path = 'apps/api';
  assert.throws(() => createArchitecturePlan({ source, target: f.target, config: c }), /Project configuration differs/);
});
test('TC-ARCHPLAT-003 malformed CLI arguments fail before running any mutation', () => {
  const { args } = require('../scripts/cli');
  for (const input of [['init','--target'], ['init','--config','--write'], ['init','--no-install=false'], ['init','--mystery']]) assert.throws(() => args(input));
});
test('TC-ARCHPLAT-005 registry payloads include pinned dependencies and the complete local UI closure', () => {
  const { buildRegistry } = require('../scripts/build-registry');
  const items = buildRegistry(source);
  assert.equal(items.length, 25);
  for (const item of items) {
    assert.ok(!item.registryDependencies?.length);
    for (const dep of item.dependencies) assert.match(dep, /@\d+\.\d+\.\d+$/);
    for (const file of item.files) {
      assert.equal(typeof file.content, 'string');
      for (const match of file.content.matchAll(/@\/components\/ui\/([a-z-]+)/g)) {
        assert.ok(item.files.some(f => f.target === `@ui/${match[1]}.tsx`), `${item.name}: missing ${match[1]}`);
      }
    }
  }
});

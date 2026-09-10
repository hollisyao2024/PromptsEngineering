const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createTemplatePlan } = require('../../tooling/xirang/template');
const { createArchitecturePlan, walk } = require('../scripts/project');
const { applyPlan, planUpdate, readLock, read, json, hash, resumePlan } = require('../../tooling/xirang/engine');
const { preparePlanSource } = require('../../tooling/xirang/source-cache');
const source = path.resolve(__dirname, '../..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-demand-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'repo'); fs.mkdirSync(target);
  return { root, target, runRoot: path.join(root, 'runs') };
}
test('TC-LAZYARCH-002 explicit kit installs lightweight metadata and CLI without unselected source', t => {
  const f = fixture(t), plan = createTemplatePlan({ source, target: f.target, include: ['architecture'] });
  assert.deepEqual(plan.conflicts, []); applyPlan(plan, f);
  const files = walk(path.join(f.target, 'architecture'));
  assert.ok(files.includes('runtime.json'));
  assert.ok(files.includes('scripts/cli.js'));
  assert.ok(files.length <= 8, files.join('\n'));
  assert.ok(!files.some(p => /^(modules|stacks|tests|__tests__|examples|blueprints)\//.test(p)));
  assert.ok(!files.some(p => /registry\//.test(p)));
  assert.ok(!fs.existsSync(path.join(f.target, 'apps')));
  const catalog = spawnSync(process.execPath, ['architecture/scripts/cli.js', 'catalog'], { cwd: f.target, encoding: 'utf8' });
  assert.equal(catalog.status, 0, catalog.stderr); assert.equal(JSON.parse(catalog.stdout).id, 'architecture');
  assert.equal(createTemplatePlan({ source, target: f.target }).changes.length, 0);
});
test('TC-LAZYARCH-003 standalone init creates only chosen application and lightweight runtime', t => {
  const f = fixture(t), config = { schemaVersion: 1, applications: [{ id: 'api', path: 'apps/api', stack: 'node' }] };
  applyPlan(createArchitecturePlan({ source, target: f.target, config }), f);
  assert.ok(fs.existsSync(path.join(f.target, 'apps/api/src/server.mjs')));
  assert.ok(fs.existsSync(path.join(f.target, 'architecture/runtime.json')));
  assert.ok(!fs.existsSync(path.join(f.target, 'architecture/stacks')));
  assert.ok(!fs.existsSync(path.join(f.target, 'packages')));
});
test('TC-LAZYARCH-005 legacy runtime shrink protects customized and unknown files', t => {
  const f = fixture(t);
  applyPlan(createTemplatePlan({ source, target: f.target, scope: 'agent' }), f);
  const legacy = ['architecture/manifest.json', 'architecture/scripts/cli.js', 'architecture/modules/unused.ts'];
  applyPlan(planUpdate({ target: f.target, assets: legacy.map(p => ({ path: p, content: p.endsWith('manifest.json') ? json({ id: 'architecture', version: '3.3.0' }) : '// original runtime\n', owner: 'architecture:runtime', version: '3.3.0', strategy: 'overwrite' })), packages: { 'architecture:runtime': { version: '3.3.0' } } }), f);
  fs.writeFileSync(path.join(f.target, 'architecture/project-notes.md'), 'project-owned note');
  fs.appendFileSync(path.join(f.target, legacy[2]), '// customization\n');
  assert.ok(createTemplatePlan({ source, target: f.target }).conflicts.some(c => c.path === legacy[2] && /removal conflict/.test(c.reason)));
  fs.writeFileSync(path.join(f.target, legacy[2]), '// original runtime\n');
  const plan = createTemplatePlan({ source, target: f.target }); assert.deepEqual(plan.conflicts, []); applyPlan(plan, f);
  assert.equal(read(f.target, legacy[2]), null); assert.equal(read(f.target, 'architecture/project-notes.md'), 'project-owned note');
  assert.equal(read(f.target, '.xirang/baselines/' + hash('// original runtime\n'), true), null);
  assert.equal(createTemplatePlan({ source, target: f.target }).changes.length, 0);
});
test('TC-LAZYARCH-005 retired baselines are removed only after last reference and recover after lock publication', t => {
  const f = fixture(t), old = 'shared old baseline\n';
  const asset = p => ({ path: p, content: old, owner: p.startsWith('architecture/') ? 'architecture:runtime' : 'other', version: '1', strategy: 'overwrite' });
  applyPlan(planUpdate({ target: f.target, assets: [asset('architecture/a.js'), asset('packages/a.js')] }), f);
  const removal = p => ({ ...asset(p), content: null, strategy: 'remove' });
  applyPlan(planUpdate({ target: f.target, assets: [removal('architecture/a.js')] }), f);
  assert.equal(read(f.target, '.xirang/baselines/' + hash(old), true), old);
  const plan = planUpdate({ target: f.target, assets: [removal('packages/a.js')] });
  assert.throws(() => applyPlan(plan, { ...f, afterLockWrite() { throw new Error('power loss'); } }), /power loss/);
  resumePlan(f.target, f);
  assert.equal(read(f.target, '.xirang/baselines/' + hash(old), true), null);
  assert.deepEqual(readLock(f.target).files, {});
});
test('TC-LAZYARCH-001/006 agent scope leaves installed architecture pointer and choices unchanged', t => {
  const f = fixture(t); applyPlan(createTemplatePlan({ source, target: f.target, include: ['architecture'] }), f);
  const before = read(f.target, 'architecture/runtime.json');
  const plan = createTemplatePlan({ source, target: f.target, scope: 'agent' });
  assert.ok(!plan.entries.some(e => e.path.startsWith('architecture/'))); applyPlan(plan, f);
  assert.equal(read(f.target, 'architecture/runtime.json'), before);
});

test('TC-LAZYARCH-003/004 installed standalone CLI executes pinned generator, frozen apply and checks', t => {
  const f = fixture(t), config = { schemaVersion: 1, applications: [{ id: 'api', path: 'apps/api', stack: 'node' }] };
  const plan = createArchitecturePlan({ source, target: f.target, config }); preparePlanSource(plan, source); applyPlan(plan, f);
  function cli(args) { const r = spawnSync(process.execPath, ['architecture/scripts/cli.js', ...args], { cwd: f.target, encoding: 'utf8', timeout: 60000 }); assert.equal(r.status, 0, r.stdout + r.stderr); return r; }
  assert.match(cli(['detect']).stdout, /existingConfig/);
  assert.match(cli(['validate']).stdout, /STATUS=OK/);
  assert.match(cli(['check']).stdout, /"status": "OK"/);
  assert.match(cli(['plan']).stdout, /CHANGED_FILES=0/);
  config.modules = [{ id: 'observability', path: 'packages/logging' }]; fs.writeFileSync(path.join(f.target, 'architecture.config.json'), json(config));
  const frozen = path.join(f.root, 'plan.json'); cli(['plan', '--out', frozen]);
  assert.ok(!fs.existsSync(path.join(f.target, 'packages/logging')));
  assert.match(cli(['apply', '--plan', frozen]).stdout, /DEPENDENCIES=NOT_RUN/);
  assert.ok(fs.existsSync(path.join(f.target, 'packages/logging/index.mjs'))); cli(['check']);
  assert.match(cli(['plan']).stdout, /CHANGED_FILES=0/);
  assert.ok(!fs.existsSync(path.join(f.target, 'architecture/modules')));
  fs.appendFileSync(path.join(f.target, 'architecture/runtime.json'), ' ');
  const rejected = spawnSync(process.execPath, ['architecture/scripts/cli.js', 'validate'], { cwd: f.target, encoding: 'utf8' });
  assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /modified architecture runtime pointer/);
});

test('TC-LAZYARCH-004/005 CLI resume completes a frozen update with a pointer written before the lock', t => {
  const f = fixture(t), config = { schemaVersion: 1, applications: [{ id: 'api', path: 'apps/api', stack: 'node' }] };
  f.runRoot = path.join(f.root, 'tmp', 'xirang-runs');
  applyPlan(createArchitecturePlan({ source, target: f.target, config }), f);
  const pointer = JSON.parse(read(f.target, 'architecture/runtime.json'));
  pointer.commit = 'a'.repeat(40); // This source does not exist: resume must not fetch or execute it.
  const plan = planUpdate({ target: f.target, assets: [
    { path: 'architecture/runtime.json', content: json(pointer), owner: 'architecture:runtime', strategy: 'overwrite' },
    { path: 'packages/recovery.txt', content: 'frozen result\n', owner: 'fixture', strategy: 'overwrite' },
  ] });
  assert.throws(() => applyPlan(plan, { ...f, afterWrite(entry) {
    if (entry.path === 'architecture/runtime.json') throw new Error('interrupted pointer write');
  } }), /interrupted pointer write/);
  const canonical = path.join(f.runRoot, hash(fs.realpathSync(f.target)).slice(0, 24));
  const legacy = path.join(f.runRoot, hash(path.resolve(f.target)).slice(0, 24));
  if (canonical !== legacy) fs.renameSync(canonical, legacy);
  const result = spawnSync(process.execPath, ['architecture/scripts/cli.js', 'resume', '--run-root', f.runRoot], { cwd: f.target, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(read(f.target, 'packages/recovery.txt'), 'frozen result\n');
  assert.equal(readLock(f.target).files['architecture/runtime.json'].base, hash(json(pointer)));
  assert.ok(!fs.existsSync(path.join(f.root, 'cache')), 'frozen recovery needs no source cache');
  const direct = spawnSync(process.execPath, ['tooling/xirang/resume.js'], { cwd: f.target, encoding: 'utf8', timeout: 15000 });
  assert.equal(direct.status, 0, direct.stdout + direct.stderr);
});

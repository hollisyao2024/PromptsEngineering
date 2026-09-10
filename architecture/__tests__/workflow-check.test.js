const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTemplatePlan } = require('../../tooling/xirang/template');
const { createArchitecturePlan } = require('../scripts/project');
const { applyPlan, json, readLock } = require('../../tooling/xirang/engine');
const { preparePlanSource, cacheLocation } = require('../../tooling/xirang/source-cache');
const { runArchitectureCheck } = require('../../infra/scripts/shared/architecture-check');
const source = path.resolve(__dirname, '../..');
const config = { schemaVersion: 1, applications: [{ id: 'api', path: 'apps/api', stack: 'node' }], datastores: [{ id: 'local', engine: 'sqlite', path: 'db/local', consumers: ['api'] }] };

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-workflow-check-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'repo'); fs.mkdirSync(target);
  return { root, target, runRoot: path.join(root, 'runs') };
}
function install(f) {
  applyPlan(createTemplatePlan({ source, target: f.target, scope: 'agent' }), f);
  const plan = createArchitecturePlan({ source, target: f.target, config }); preparePlanSource(plan, source); applyPlan(plan, f);
  return require(path.join(f.target, 'infra/scripts/shared/architecture-check')).runArchitectureCheck;
}

test('installed TDD/QA architecture gate checks lightweight projects from the pinned cache and detects violations', t => {
  const f = fixture(t), check = install(f);
  assert.equal(fs.existsSync(path.join(f.target, 'architecture/checks')), false);
  assert.equal(check(f.target).status, 'OK');
  fs.appendFileSync(path.join(f.target, 'db/local/migrations/0001_initial.sql'), '\n-- untracked migration change\n');
  assert.throws(() => check(f.target), /Migration checksum mismatch/);
});

test('on-demand workflow checks never fall back to leftover full-runtime files when the pointer is missing or modified', async t => {
  for (const damage of ['missing', 'modified']) await t.test(damage, t => {
    const f = fixture(t), check = install(f);
    fs.mkdirSync(path.join(f.target, 'architecture/checks'), { recursive: true });
    fs.writeFileSync(path.join(f.target, 'architecture/checks/project-check.js'), 'exports.checkProject = () => ({status: "OK"});\n');
    const pointer = path.join(f.target, 'architecture/runtime.json');
    if (damage === 'missing') fs.unlinkSync(pointer); else fs.appendFileSync(pointer, ' ');
    assert.throws(() => check(f.target), /Missing or modified architecture runtime pointer/);
  });
});

test('on-demand workflow checks reject corrupted source cache without falling back', t => {
  const f = fixture(t), check = install(f), pointer = JSON.parse(fs.readFileSync(path.join(f.target, 'architecture/runtime.json'), 'utf8'));
  const cache = cacheLocation(f.target, pointer).directory;
  fs.appendFileSync(path.join(cache, 'architecture/checks/project-check.js'), '\n// corrupt\n');
  assert.throws(() => check(f.target), /source version\/content mismatch/);
});

test('workflow gate keeps unselected projects optional and checks legacy full-runtime layouts', t => {
  const f = fixture(t);
  assert.equal(runArchitectureCheck(f.target).status, 'SKIPPED');
  fs.writeFileSync(path.join(f.target, 'architecture.config.json'), json(config));
  assert.throws(() => runArchitectureCheck(f.target), /architecture package is missing/);
  applyPlan(createArchitecturePlan({ source, target: f.target, config, adopt: true }), f);
  fs.cpSync(path.join(source, 'architecture'), path.join(f.target, 'architecture'), { recursive: true });
  fs.unlinkSync(path.join(f.target, 'architecture/runtime.json'));
  const lock = readLock(f.target); delete lock.files['architecture/runtime.json'];
  lock.packages['architecture:runtime'].selection = { id: 'architecture' };
  fs.writeFileSync(path.join(f.target, 'xirang.lock.json'), json(lock));
  assert.equal(runArchitectureCheck(f.target).status, 'OK');
  fs.rmSync(path.join(f.target, 'apps/api'), { recursive: true });
  assert.throws(() => runArchitectureCheck(f.target), /Application directory missing/);
});

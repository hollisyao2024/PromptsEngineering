const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildRuntimeAssets } = require('../../../../tooling/xirang/architecture-kit');
const { createTemplatePlan } = require('../../../../tooling/xirang/template');
const { createArchitecturePlan } = require('../../../../architecture/scripts/project');
const { applyPlan, readLock } = require('../../../../tooling/xirang/engine');
const source = path.resolve(__dirname, '../../../..');
const version = JSON.parse(fs.readFileSync(path.join(source, 'infra/templates/agent/template.manifest.json'), 'utf8')).templateVersion;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-engine-version-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'repo'); fs.mkdirSync(target);
  return { target, runRoot: path.join(root, 'runs') };
}
test('RUL-BASE-010 architecture kit uses the agent version only for shared engine assets', t => {
  const f = fixture(t), kit = buildRuntimeAssets({ source, target: f.target });
  const engine = kit.assets.filter(a => a.owner === 'xirang:engine');
  assert.ok(engine.length > 0);
  assert.deepEqual([...new Set(engine.map(a => a.version))], [version]);
  assert.ok(kit.assets.filter(a => a.owner === 'architecture:runtime').every(a => a.version === kit.descriptor.version));
});
test('RUL-BASE-010 adopted project converges while alternating template and architecture updates', t => {
  const f = fixture(t), config = { schemaVersion: 1, applications: [{ id: 'api', path: 'apps/api', stack: 'node' }] };
  applyPlan(createArchitecturePlan({ source, target: f.target, config }), f);
  applyPlan(createTemplatePlan({ source, target: f.target }), f);
  assert.deepEqual(createArchitecturePlan({ source, target: f.target, config }).changes, []);
  assert.deepEqual(createTemplatePlan({ source, target: f.target }).changes, []);
  assert.ok(Object.values(readLock(f.target).files).filter(r => r.owner === 'xirang:engine').every(r => r.version === version));
});
test('RUL-BASE-010 custom manifests freeze the canonical engine version before writes', t => {
  const f = fixture(t), source = path.join(path.dirname(f.target), 'source');
  const canonical = path.join(source, 'infra/templates/agent/template.manifest.json');
  fs.mkdirSync(path.dirname(canonical), { recursive: true });
  fs.mkdirSync(path.join(source, 'tooling/xirang'), { recursive: true });
  fs.writeFileSync(canonical, JSON.stringify({ templateVersion: '7.0.0' }));
  fs.writeFileSync(path.join(source, 'tooling/xirang/example.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(source, 'custom.json'), JSON.stringify({ templateVersion: '99.0.0', rules: [{ path: 'tooling/xirang', strategy: 'overwrite' }] }));
  const plan = createTemplatePlan({ source, target: f.target, scope: 'agent', manifestPath: 'custom.json' });
  assert.equal(JSON.parse(plan.lockAfter).files['tooling/xirang/example.js'].version, '7.0.0');
  assert.ok(plan.inputs.some(input => input.path === canonical));
  fs.writeFileSync(canonical, JSON.stringify({ templateVersion: '7.0.1' }));
  assert.throws(() => applyPlan(plan, f), /source.*(changed|drift)|input.*(changed|drift)/i);
  assert.deepEqual(fs.readdirSync(f.target), []);
});

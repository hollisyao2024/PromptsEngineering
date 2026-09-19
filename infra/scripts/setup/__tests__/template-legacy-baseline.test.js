const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createTemplatePlan } = require('../../../../tooling/xirang/template');
const { applyPlan, json } = require('../../../../tooling/xirang/engine');
const manifestPath = 'infra/templates/agent/template.manifest.json';
const root = path.resolve(__dirname, '../../../..');
function write(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
function fixture(t, rules = [], identity = 'xirang') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-legacy-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const main = path.join(dir, 'repo'), source = path.join(dir, 'source'), target = path.join(dir, 'worktrees/task');
  const manifest = { template: { id: identity }, templateVersion: '1', rules: [{ path: 'owned', strategy: 'overwrite' }, ...rules] };
  write(main, manifestPath, json(manifest)); write(main, 'owned/a.txt', 'old\n');
  write(main, 'owned/local.txt', 'project\n'); write(main, 'RULES.md', 'project rules\n');
  git(main, 'init', '--quiet'); git(main, 'add', '.');
  git(main, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'legacy template');
  const commit = git(main, 'rev-parse', 'HEAD');
  git(main, 'update-ref', 'refs/agent/backfill-baseline', commit);
  git(main, 'worktree', 'add', '--quiet', '-b', 'upgrade', target);
  write(source, manifestPath, json({ ...manifest, template: { id: 'xirang' }, templateVersion: '2', rules: [{ path: 'owned', strategy: 'overwrite' }] }));
  write(source, 'owned/a.txt', 'new\n');
  return { dir, source, target, commit, legacyBaseline: 'refs/agent/backfill-baseline' };
}
test('explicit legacy Git baseline upgrades unchanged overwrite assets without dry-run writes and converges', t => {
  const f = fixture(t);
  assert.equal(createTemplatePlan({ ...f, legacyBaseline: undefined }).conflicts.length, 1);
  const plan = createTemplatePlan(f);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.legacyBaselineCommit, f.commit);
  assert.equal(fs.readFileSync(path.join(f.target, 'owned/a.txt'), 'utf8'), 'old\n');
  assert.equal(fs.existsSync(path.join(f.target, 'xirang.lock.json')), false);
  applyPlan(plan, { runRoot: path.join(f.dir, 'runs') });
  assert.equal(fs.readFileSync(path.join(f.target, 'owned/a.txt'), 'utf8'), 'new\n');
  assert.equal(fs.readFileSync(path.join(f.target, 'RULES.md'), 'utf8'), 'project rules\n');
  assert.deepEqual(createTemplatePlan(f).changes, []);
  write(f.target, 'owned/a.txt', 'local drift\n');
  assert.equal(createTemplatePlan(f).conflicts.length, 1, 'legacy option cannot bypass current lock');
});
test('legacy local drift blocks the entire plan without partial writes', t => {
  const f = fixture(t); write(f.target, 'owned/a.txt', 'custom\n'); write(f.source, 'owned/new.txt', 'new asset');
  const plan = createTemplatePlan(f);
  assert.match(plan.conflicts[0].reason, /local content changed/);
  assert.throws(() => applyPlan(plan, { runRoot: path.join(f.dir, 'runs') }), /conflict/);
  assert.equal(fs.existsSync(path.join(f.target, 'owned/new.txt')), false);
  assert.equal(fs.existsSync(path.join(f.target, 'xirang.lock.json')), false);
});
test('invalid legacy refs, foreign manifests and ambiguous adopt input fail closed', t => {
  const f = fixture(t);
  for (const legacyBaseline of ['missing-ref', '--help', '', true]) assert.throws(() => createTemplatePlan({ ...f, legacyBaseline }), /legacy|baseline/i);
  assert.throws(() => createTemplatePlan({ ...f, adopt: true }), /adopt/);
  const foreign = fixture(t, [], 'foreign');
  assert.throws(() => createTemplatePlan(foreign), /Xirang|xirang/);
  assert.equal(fs.existsSync(path.join(f.target, 'xirang.lock.json')), false);
});
test('legacy most-specific project ownership is never borrowed as an overwrite baseline', t => {
  const f = fixture(t, [{ path: 'owned/local.txt', strategy: 'project-owned' }]);
  write(f.source, 'owned/local.txt', 'new upstream');
  const plan = createTemplatePlan(f);
  assert.deepEqual(plan.conflicts.map(c => c.path), ['owned/local.txt']);
  assert.match(plan.conflicts[0].reason, /adoption required/);
});
test('frozen legacy plan pins the commit and rejects target drift at apply', t => {
  const f = fixture(t), plan = createTemplatePlan(f);
  assert.equal(plan.legacyBaselineCommit, f.commit);
  write(f.target, 'owned/a.txt', 'drift after planning');
  assert.throws(() => applyPlan(plan, { runRoot: path.join(f.dir, 'runs') }), /drift/);
  assert.equal(fs.existsSync(path.join(f.target, 'xirang.lock.json')), false);
});
test('legacy symlink blobs and paths absent from the old manifest cannot authorize overwrite', t => {
  const f = fixture(t);
  const blob = git(f.target, 'rev-parse', 'HEAD:owned/a.txt');
  git(f.target, 'update-index', '--cacheinfo', `120000,${blob},owned/a.txt`);
  git(f.target, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'historical link');
  git(f.target, 'update-ref', f.legacyBaseline, 'HEAD');
  assert.match(createTemplatePlan(f).conflicts[0].reason, /adoption required/);
  const incoming = JSON.parse(fs.readFileSync(path.join(f.source, manifestPath)));
  incoming.rules.push({ path: 'unmanaged.txt', strategy: 'overwrite' });
  write(f.source, manifestPath, json(incoming));
  write(f.source, 'unmanaged.txt', 'upstream'); write(f.target, 'unmanaged.txt', 'project');
  assert.ok(createTemplatePlan(f).conflicts.some(c => c.path === 'unmanaged.txt'));
});
test('CLI baseline arguments require values and cannot silently fall back to the legacy copier', t => {
  const f = fixture(t);
  for (const script of ['template-apply-engine.js', 'update-template.js']) {
    const run = spawnSync(process.execPath, [path.join(root, 'infra/scripts/setup', script), '--source', f.source, '--target', f.target, '--legacy-baseline'], { encoding: 'utf8' });
    assert.notEqual(run.status, 0); assert.match(run.stderr, /legacy-baseline requires a value/);
  }
  const fallback = spawnSync(process.execPath, [path.join(root, 'infra/scripts/setup/template-apply-engine.js'), '--source', f.source, '--target', f.target, '--legacy-baseline', f.commit], { encoding: 'utf8' });
  assert.notEqual(fallback.status, 0); assert.match(fallback.stderr, /requires the shared update engine/);
  const { parseArgs } = require('../template-sync');
  assert.throws(() => parseArgs(['--legacy-baseline']), /requires a value/);
});
test('public engine accepts the explicit legacy baseline and reports its fixed commit', t => {
  const f = fixture(t);
  // Use the minimal source with the actual shared engine for a complete CLI fixture.
  fs.cpSync(path.join(root, 'tooling/xirang'), path.join(f.source, 'tooling/xirang'), { recursive: true });
  const run = spawnSync(process.execPath, [path.join(root, 'infra/scripts/setup/template-apply-engine.js'), '--source', f.source, '--target', f.target, '--legacy-baseline', f.legacyBaseline], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, new RegExp('LEGACY_BASELINE_COMMIT=' + f.commit));
});

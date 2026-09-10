const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createTemplatePlan } = require('../../../../tooling/xirang/template');
const { json, hash } = require('../../../../tooling/xirang/engine');
const source = path.resolve(__dirname, '../../../..');
const engine = path.join(source, 'infra/scripts/setup/template-apply-engine.js');
const updater = path.join(source, 'infra/scripts/setup/update-template.js');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-boundary-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'repo'); fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'README.md'), 'project-owned sentinel\n');
  return { root, target };
}
function invoke(script, args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: source, encoding: 'utf8', timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
}
function git(target, args) {
  const r = spawnSync('git', args, { cwd: target, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}
function initGit(target) {
  git(target, ['init', '--quiet']); git(target, ['add', 'README.md']);
  git(target, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'fixture']);
}
function snapshot(root) {
  const result = {};
  function visit(dir, relative = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name), key = relative + entry.name;
      if (entry.isDirectory()) visit(p, key + '/');
      else result[key] = entry.isSymbolicLink() ? fs.readlinkSync(p) : hash(fs.readFileSync(p));
    }
  }
  visit(root); return result;
}
function blocked(result, pattern) {
  assert.notEqual(result.status, 0, result.stdout.slice(-2000));
  assert.match(result.stdout + result.stderr, pattern);
}

test('template writes reject Git main worktrees before changing files or the index, including frozen plans', async t => {
  for (const mode of ['direct', 'frozen', 'updater']) await t.test(mode, t => {
    const f = fixture(t); initGit(f.target);
    fs.writeFileSync(path.join(f.target, 'staged.txt'), 'staged sentinel'); git(f.target, ['add', 'staged.txt']);
    const before = snapshot(f.target), planPath = path.join(f.root, 'plan.json');
    const dry = invoke(engine, ['--source', source, '--target', f.target, '--plan-out', planPath]);
    assert.equal(dry.status, 0, dry.stderr); assert.deepEqual(snapshot(f.target), before);
    const result = mode === 'updater' ? invoke(updater, [f.target, '--source', source])
      : invoke(engine, ['--source', source, '--target', f.target, '--write', ...(mode === 'frozen' ? ['--plan', planPath] : [])]);
    blocked(result, /dedicated linked worktree/);
    assert.deepEqual(snapshot(f.target), before, 'includes environment files, lock, baselines and Git index');
  });
});

test('template source-role targets reject direct and frozen writes', async t => {
  for (const frozen of [false, true]) await t.test(String(frozen), t => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.target, 'agent.config.json'), json({ template: { role: 'source' } }));
    const before = snapshot(f.target), planPath = path.join(f.root, 'plan.json');
    fs.writeFileSync(planPath, json(createTemplatePlan({ source, target: f.target })));
    const result = invoke(engine, ['--source', source, '--target', f.target, '--write', ...(frozen ? ['--plan', planPath] : [])]);
    blocked(result, /source repository/); assert.deepEqual(snapshot(f.target), before);
  });
});

test('standalone template update still creates the workflow and converges', t => {
  const f = fixture(t), result = invoke(updater, [f.target, '--source', source]);
  assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /CONVERGENCE_STATUS=OK/);
  assert.equal(fs.readFileSync(path.join(f.target, 'README.md'), 'utf8'), 'project-owned sentinel\n');
  assert.equal(createTemplatePlan({ source, target: f.target }).changes.length, 0);
});

test('unknown include and invalid scope values block without target writes', t => {
  const f = fixture(t), before = snapshot(f.target);
  for (const include of [['archtecture'], ['architecture', 'unknown'], 'architecture', true]) {
    assert.throws(() => createTemplatePlan({ source, target: f.target, include }), /include/);
  }
  for (const scope of ['unknown', true, '']) assert.throws(() => createTemplatePlan({ source, target: f.target, scope }), /scope/);
  assert.deepEqual(snapshot(f.target), before);
  for (const include of [[], ['architecture'], ['all']]) assert.deepEqual(createTemplatePlan({ source, target: f.target, include }).conflicts, []);
  assert.throws(() => createTemplatePlan({ source, target: f.target, scope: 'agent', include: ['architecture'] }), /agent scope/);
});

test('public template CLIs reject misspelled or missing selection values before writes', t => {
  const f = fixture(t), before = snapshot(f.target);
  for (const script of [engine, updater]) for (const args of [['--include', 'archtecture'], ['--include='], ['--include'], ['--scope='], ['--scope'], ['--include', 'architecture,']]) {
    blocked(invoke(script, ['--source', source, '--target', f.target, ...(script === engine ? ['--write'] : []), ...args]), /include|scope/);
    assert.deepEqual(snapshot(f.target), before);
  }
  blocked(invoke(engine, ['--source', source, '--target', f.target, '--write=false']), /--write does not take a value/);
  assert.deepEqual(snapshot(f.target), before);
});

test('updater rejects project-local report directories before creating reports or changing either worktree', t => {
  const f = fixture(t); initGit(f.target);
  const linked = path.join(f.root, 'worktrees/task'); git(f.target, ['worktree', 'add', '--quiet', '-b', 'test', linked]);
  fs.writeFileSync(path.join(linked, 'agent.config.json'), json({ template: { applyReportDir: 'generated/reports' } }));
  const mainBefore = snapshot(f.target), linkedBefore = snapshot(linked);
  blocked(invoke(updater, ['--source', source, '--target', linked]), /outside the project/);
  assert.deepEqual(snapshot(f.target), mainBefore); assert.deepEqual(snapshot(linked), linkedBefore);
});

test('template plan output cannot overwrite project files, metadata, Git index or use a symlink alias', async t => {
  for (const destination of ['README.md', 'xirang.lock.json', '.git/index', 'alias']) await t.test(destination, t => {
    const f = fixture(t); initGit(f.target);
    const alias = path.join(f.root, 'alias'); fs.symlinkSync(f.target, alias);
    const out = destination === 'alias' ? path.join(alias, 'README.md') : path.join(f.target, destination);
    const before = snapshot(f.target);
    blocked(invoke(engine, ['--source', source, '--target', f.target, '--plan-out', out]), /outside the project|symlink/);
    assert.deepEqual(snapshot(f.target), before);
  });
});

test('architecture and template plans cannot write through an alias or into a linked worktree main repository', async t => {
  for (const kind of ['architecture-alias', 'architecture-main', 'template-main']) await t.test(kind, t => {
    const f = fixture(t); initGit(f.target);
    const linked = path.join(f.root, 'worktrees/task'); git(f.target, ['worktree', 'add', '--quiet', '-b', 'test', linked]);
    const configFile = path.join(f.root, 'config.json'); fs.writeFileSync(configFile, json({ schemaVersion: 1, applications: [{ id: 'api', path: 'apps/api', stack: 'node' }] }));
    const alias = path.join(f.root, 'alias'); fs.symlinkSync(linked, alias);
    const beforeMain = snapshot(f.target), beforeLinked = snapshot(linked);
    const out = path.join(kind === 'architecture-alias' ? alias : f.target, 'README.md');
    const result = kind.startsWith('architecture')
      ? invoke(path.join(source, 'architecture/scripts/cli.js'), ['plan', '--target', linked, '--config', configFile, '--out', out])
      : invoke(engine, ['--source', source, '--target', linked, '--plan-out', out]);
    blocked(result, /outside the project|symlink/);
    assert.deepEqual(snapshot(f.target), beforeMain); assert.deepEqual(snapshot(linked), beforeLinked);
  });
});

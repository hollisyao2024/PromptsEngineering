'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildAgentAssets } = require('../../../../tooling/xirang/template');
const { planUpdate, applyPlan, hash } = require('../../../../tooling/xirang/engine');

const ROOT = path.resolve(__dirname, '../../../..');
const START = '<!-- xirang:source-only:start -->';
const END = '<!-- xirang:source-only:end -->';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-initialize-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), target = path.join(root, 'project');
  fs.mkdirSync(source); fs.mkdirSync(target);
  fs.mkdirSync(path.join(source, 'infra/templates/agent'), { recursive: true });
  fs.writeFileSync(path.join(source, 'infra/templates/agent/template.manifest.json'), JSON.stringify({
    templateVersion: '1.0.0', rules: [{ path: 'AGENTS.md', strategy: 'overwrite' }],
  }));
  return { root, source, target, runs: path.join(root, 'runs') };
}

// AC1: source guidance is absent from consumer assets, including their saved baseline.
for (const newline of ['\n', '\r\n']) test(`AC1 source-only sections are excluded without changing shared bytes (${JSON.stringify(newline)})`, t => {
  const f = fixture(t);
  const text = ['# Shared', START, 'Initialize another project', END, 'Update this project', ''].join(newline);
  fs.writeFileSync(path.join(f.source, 'AGENTS.md'), text);
  const built = buildAgentAssets(f.source, f.target);
  assert.equal(built.assets[0].content, ['# Shared', 'Update this project', ''].join(newline));
  assert.equal(built.inputs.find(input => input.path.endsWith('AGENTS.md')).hash, hash(text), 'frozen inputs still bind the complete source');
  applyPlan(planUpdate({ target: f.target, assets: built.assets }), { runRoot: f.runs });
  assert.equal(fs.readFileSync(path.join(f.target, 'AGENTS.md'), 'utf8'), built.assets[0].content);
  assert.equal(planUpdate({ target: f.target, assets: buildAgentAssets(f.source, f.target).assets }).changes.length, 0);
});

test('AC1 malformed source-only sections fail before any target write', t => {
  const f = fixture(t);
  for (const text of [`${START}\nsecret\n`, `${END}\n`, `${START}\n${START}\n${END}\n${END}\n`]) {
    fs.writeFileSync(path.join(f.source, 'AGENTS.md'), text);
    assert.throws(() => buildAgentAssets(f.source, f.target), /source-only.*AGENTS\.md/i);
    assert.deepEqual(fs.readdirSync(f.target), []);
  }
});

test('AC1 legacy installed source guidance is removed on upgrade while local drift remains protected', t => {
  const f = fixture(t), old = '# Shared\nInitialize another project\nUpdate this project\n';
  const legacy = { path: 'AGENTS.md', content: old, strategy: 'overwrite', owner: 'agent', version: '0.9.0' };
  applyPlan(planUpdate({ target: f.target, assets: [legacy] }), { runRoot: f.runs });
  fs.writeFileSync(path.join(f.source, 'AGENTS.md'), `# Shared\n${START}\nInitialize another project\n${END}\nUpdate this project\n`);
  const assets = buildAgentAssets(f.source, f.target).assets;
  const upgrade = planUpdate({ target: f.target, assets });
  assert.deepEqual(upgrade.conflicts, []);
  applyPlan(upgrade, { runRoot: f.runs });
  assert.equal(fs.readFileSync(path.join(f.target, 'AGENTS.md'), 'utf8'), '# Shared\nUpdate this project\n');
  assert.equal(planUpdate({ target: f.target, assets }).changes.length, 0);
  fs.appendFileSync(path.join(f.target, 'AGENTS.md'), 'Project customization\n');
  assert.ok(planUpdate({ target: f.target, assets }).conflicts.length, 'do not erase local customization while cleaning guidance');
});

test('AC1 the real consumer package retains template sync but excludes source initialization pointers', t => {
  const f = fixture(t), { assets } = buildAgentAssets(ROOT, f.target);
  const agents = assets.find(asset => asset.path === 'AGENTS.md').content;
  assert.match(agents, /pnpm agent -- template sync/u);
  assert.doesNotMatch(agents, /source-initialization\.md|docs\/guides\/commands\.md|初始化项目＋路径/u);
  assert.equal(assets.some(asset => asset.path.startsWith('docs/guides/')), false);
});

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim();
}

function snapshot(directory) {
  const entries = {};
  function visit(root, prefix = '') {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name), relative = prefix + entry.name;
      if (entry.isDirectory()) visit(file, relative + '/');
      else entries[relative] = entry.isSymbolicLink() ? fs.readlinkSync(file) : hash(fs.readFileSync(file));
    }
  }
  visit(directory); return entries;
}

function initialize(target, extra = []) {
  return spawnSync(process.execPath, [path.join(ROOT, 'infra/scripts/setup/update-template.js'), target,
    '--scope', 'agent', '--initialize', ...extra], {
    cwd: ROOT, encoding: 'utf8', timeout: 180000, maxBuffer: 10 * 1024 * 1024,
  });
}

// AC2: both Git states are explicitly supported; no commit, ref, index or info/exclude changes.
for (const committed of [false, true]) test(`AC2 initialization supports ${committed ? 'committed' : 'unborn'} Git repositories without Git writes`, t => {
  const f = fixture(t);
  git(f.target, ['init', '--quiet']);
  fs.writeFileSync(path.join(f.target, 'README.md'), 'Business content\n');
  git(f.target, ['add', 'README.md']);
  if (committed) git(f.target, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'fixture']);
  fs.writeFileSync(path.join(f.target, 'staged.txt'), 'Staged content\n');
  git(f.target, ['add', 'staged.txt']);
  const before = snapshot(path.join(f.target, '.git'));
  const preview = initialize(f.target, ['--dry-run']);
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.equal(fs.existsSync(path.join(f.target, 'AGENTS.md')), false);
  assert.deepEqual(snapshot(path.join(f.target, '.git')), before);
  const applied = initialize(f.target);
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  assert.match(applied.stdout, /CONVERGENCE_STATUS=OK/u);
  assert.match(applied.stdout, /BACKFILL_BASELINE=skipped/u);
  assert.deepEqual(snapshot(path.join(f.target, '.git')), before);
  assert.equal(fs.readFileSync(path.join(f.target, 'README.md'), 'utf8'), 'Business content\n');
  assert.ok(fs.existsSync(path.join(f.target, 'RULES.md')));
  const again = initialize(f.target, ['--dry-run']);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.deepEqual(snapshot(path.join(f.target, '.git')), before);
});

test('AC2 initialization still refuses the template source and malformed mode values', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.target, 'agent.config.json'), JSON.stringify({ template: { role: 'source' } }));
  const before = snapshot(f.target);
  const source = initialize(f.target);
  assert.notEqual(source.status, 0);
  assert.match(source.stdout + source.stderr, /source repository/u);
  assert.deepEqual(snapshot(f.target), before);
  const invalid = initialize(f.target, ['--initialize=false']);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stdout + invalid.stderr, /initialize.*does not take a value/u);
  assert.deepEqual(snapshot(f.target), before);
});

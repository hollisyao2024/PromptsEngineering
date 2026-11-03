'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ENVIRONMENT_FILE_PAIRS, initializeProjectEnvironmentFiles } = require('../update-template');

function canonical(file) {
  const resolved = fs.realpathSync(file);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function fixture(t, linked = true) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'env-main-repo-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const main = path.join(root, 'repo');
  const source = path.join(root, 'source');
  fs.mkdirSync(main);
  fs.mkdirSync(source);
  const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  for (const { example } of ENVIRONMENT_FILE_PAIRS) {
    fs.writeFileSync(path.join(source, example), `SOURCE=${example}\n${example === '.env.example' ? 'GH_TOKEN=\n' : ''}`);
  }
  if (!linked) return { main, source, target: main, git };
  git(main, ['init', '-b', 'main']);
  git(main, ['-c', 'user.name=Environment Test', '-c', 'user.email=environment@example.invalid', 'commit', '--allow-empty', '-m', 'fixture']);
  const target = path.join(root, 'linked');
  git(main, ['worktree', 'add', '-b', 'test-environment', target]);
  return { main, source, target, git };
}

test('main repo initialization creates six files and ignores runtime files without populating linked worktree', t => {
  const f = fixture(t);
  const result = initializeProjectEnvironmentFiles(f.source, f.target, true);
  assert.equal(canonical(result.root), canonical(f.main));
  assert.equal(result.files.length, 6);
  assert.ok(result.files.every(file => file.status === 'created'));
  for (const { example, runtime } of ENVIRONMENT_FILE_PAIRS) {
    assert.equal(fs.readFileSync(path.join(f.main, example), 'utf8'), `SOURCE=${example}\n${example === '.env.example' ? 'GH_TOKEN=\n' : ''}`);
    assert.deepEqual(fs.readFileSync(path.join(f.main, runtime)), fs.readFileSync(path.join(f.main, example)));
    assert.equal(fs.existsSync(path.join(f.target, runtime)), false);
    assert.equal(fs.existsSync(path.join(f.target, example)), false);
    assert.equal(f.git(f.main, ['check-ignore', runtime]), runtime);
    assert.throws(() => f.git(f.main, ['check-ignore', example]));
  }
  const again = initializeProjectEnvironmentFiles(f.source, f.target, true);
  assert.ok(again.files.every(file => file.status === 'unchanged'));
});

test('main repo examples take priority over differing linked worktree examples', t => {
  const f = fixture(t);
  for (const { example } of ENVIRONMENT_FILE_PAIRS) {
    fs.writeFileSync(path.join(f.main, example), `MAIN=${example}\n${example === '.env.example' ? 'GH_TOKEN=\n' : ''}`);
    fs.writeFileSync(path.join(f.target, example), `LINKED=${example}\n`);
  }
  initializeProjectEnvironmentFiles(f.source, f.target, true);
  for (const { example, runtime } of ENVIRONMENT_FILE_PAIRS) {
    assert.equal(fs.readFileSync(path.join(f.main, runtime), 'utf8'), `MAIN=${example}\n${example === '.env.example' ? 'GH_TOKEN=\n' : ''}`);
    assert.equal(fs.existsSync(path.join(f.target, runtime)), false);
    assert.equal(fs.readFileSync(path.join(f.target, example), 'utf8'), `LINKED=${example}\n`);
  }
});

test('main repo initialization preserves all six existing files byte for byte including empty files', t => {
  const f = fixture(t);
  const contents = new Map();
  for (const { example, runtime } of ENVIRONMENT_FILE_PAIRS) {
    contents.set(example, Buffer.from(`MAIN=${example}\r\n${example === '.env.example' ? 'GH_TOKEN=\r\n' : ''}`));
    contents.set(runtime, runtime === '.env.local' ? Buffer.from('GH_TOKEN=fixture-value\r\n')
      : runtime === '.env.staging' ? Buffer.alloc(0) : Buffer.from([0, 255, 13, 10]));
  }
  for (const [file, content] of contents) fs.writeFileSync(path.join(f.main, file), content);
  const result = initializeProjectEnvironmentFiles(f.source, f.target, true);
  assert.ok(result.files.every(file => file.status === 'unchanged'));
  for (const [file, content] of contents) assert.deepEqual(fs.readFileSync(path.join(f.main, file)), content);
});

test('main repo dry-run reports six missing files without writing files or Git exclude', t => {
  const f = fixture(t);
  const exclude = path.join(f.main, '.git', 'info', 'exclude');
  const before = fs.readFileSync(exclude);
  const result = initializeProjectEnvironmentFiles(f.source, f.target, false);
  assert.equal(canonical(result.root), canonical(f.main));
  assert.equal(result.files.length, 6);
  assert.ok(result.files.every(file => file.status === 'created'));
  for (const { example, runtime } of ENVIRONMENT_FILE_PAIRS) {
    assert.equal(fs.existsSync(path.join(f.main, example)), false);
    assert.equal(fs.existsSync(path.join(f.main, runtime)), false);
  }
  assert.deepEqual(fs.readFileSync(exclude), before);
});

test('main repo missing source fails before any environment file is created', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.source, '.env.production.example'));
  assert.throws(() => initializeProjectEnvironmentFiles(f.source, f.target, true), /example.*missing/i);
  for (const { example, runtime } of ENVIRONMENT_FILE_PAIRS) {
    assert.equal(fs.existsSync(path.join(f.main, example)), false);
    assert.equal(fs.existsSync(path.join(f.main, runtime)), false);
  }
});

test('non-Git project uses the explicit target instead of template repository', t => {
  const f = fixture(t, false);
  const result = initializeProjectEnvironmentFiles(f.source, f.target, true);
  assert.equal(result.root, f.main);
  for (const { runtime } of ENVIRONMENT_FILE_PAIRS) {
    assert.equal(fs.existsSync(path.join(f.main, runtime)), true);
    assert.equal(fs.existsSync(path.join(f.source, runtime)), false);
  }
});

// AC1 comes from the user: both local files must declare GH_TOKEN without
// replacing existing values or adding it to staging/production configuration.
test('AC1 appends an empty GH_TOKEN only to the two local files and converges', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.main, '.env.example'), '# GH_TOKEN=commented\r\nLOCAL=example');
  fs.writeFileSync(path.join(f.main, '.env.local'), 'LOCAL=runtime\r\n');
  const dry = initializeProjectEnvironmentFiles(f.source, f.target, false);
  for (const file of ['.env.example', '.env.local']) {
    assert.equal(dry.files.find(row => row.path === file).status, 'updated');
  }
  assert.equal(fs.readFileSync(path.join(f.main, '.env.example'), 'utf8'), '# GH_TOKEN=commented\r\nLOCAL=example');
  assert.equal(fs.readFileSync(path.join(f.main, '.env.local'), 'utf8'), 'LOCAL=runtime\r\n');
  const applied = initializeProjectEnvironmentFiles(f.source, f.target, true);
  assert.equal(fs.readFileSync(path.join(f.main, '.env.example'), 'utf8'), '# GH_TOKEN=commented\r\nLOCAL=example\r\nGH_TOKEN=\r\n');
  assert.equal(fs.readFileSync(path.join(f.main, '.env.local'), 'utf8'), 'LOCAL=runtime\r\nGH_TOKEN=\r\n');
  assert.equal(applied.files.find(row => row.path === '.env.local').status, 'updated');
  for (const { example, runtime } of ENVIRONMENT_FILE_PAIRS.slice(1)) {
    assert.doesNotMatch(fs.readFileSync(path.join(f.main, example), 'utf8'), /GH_TOKEN/u);
    assert.doesNotMatch(fs.readFileSync(path.join(f.main, runtime), 'utf8'), /GH_TOKEN/u);
  }
  assert.ok(initializeProjectEnvironmentFiles(f.source, f.target, true).files.every(row => row.status === 'unchanged'));
});

test('AC1 preserves existing empty, exported and populated token declarations exactly', t => {
  for (const declaration of ['GH_TOKEN=', 'export GH_TOKEN = fixture-value', '\uFEFF  GH_TOKEN=""']) {
    const f = fixture(t, false);
    for (const file of ['.env.example', '.env.local']) fs.writeFileSync(path.join(f.main, file), declaration);
    initializeProjectEnvironmentFiles(f.source, f.target, true);
    for (const file of ['.env.example', '.env.local']) {
      assert.equal(fs.readFileSync(path.join(f.main, file), 'utf8'), declaration);
    }
  }
});

test('AC1 empty local files receive only an empty token declaration', t => {
  const f = fixture(t, false);
  for (const file of ['.env.example', '.env.local']) fs.writeFileSync(path.join(f.main, file), '');
  initializeProjectEnvironmentFiles(f.source, f.target, true);
  for (const file of ['.env.example', '.env.local']) {
    assert.equal(fs.readFileSync(path.join(f.main, file), 'utf8'), 'GH_TOKEN=\n');
  }
});

test('AC1 missing declarations in newly created examples and local files converge', t => {
  const f = fixture(t, false);
  fs.writeFileSync(path.join(f.source, '.env.example'), 'LOCAL=value');
  assert.ok(initializeProjectEnvironmentFiles(f.source, f.target, false).files.every(row => row.status === 'created'));
  const result = initializeProjectEnvironmentFiles(f.source, f.target, true);
  for (const file of ['.env.example', '.env.local']) {
    assert.equal(fs.readFileSync(path.join(f.main, file), 'utf8'), 'LOCAL=value\nGH_TOKEN=\n');
    assert.equal(result.files.find(row => row.path === file).status, 'created');
  }
  assert.ok(initializeProjectEnvironmentFiles(f.source, f.target, false).files.every(row => row.status === 'unchanged'));
});

test('AC1 invalid local file fails before creating any environment files', t => {
  const f = fixture(t, false);
  fs.mkdirSync(path.join(f.main, '.env.local'));
  assert.throws(() => initializeProjectEnvironmentFiles(f.source, f.target, true), /regular file: \.env\.local/u);
  for (const { example } of ENVIRONMENT_FILE_PAIRS) assert.equal(fs.existsSync(path.join(f.main, example)), false);
});

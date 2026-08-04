const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { stageConfiguredVersionFiles, syncConfiguredVersionFiles } = require('./qa-merge');

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-merge-version-sync-'));
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src-tauri'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ version: '0.1.0' }, null, 2)}\n`);
  fs.writeFileSync(
    path.join(dir, 'config', 'tauri.json'),
    `${JSON.stringify({ package: { version: '0.1.0' } }, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(dir, 'src-tauri', 'Cargo.toml'),
    '[package]\nname = "app"\nversion = "0.1.0"\n\n[dependencies]\nserde = { version = "1.0" }\n'
  );
  fs.writeFileSync(
    path.join(dir, 'src-tauri', 'Cargo.lock'),
    '[[package]]\nname = "app"\nversion = "0.1.0"\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n'
  );
  return dir;
}

test('syncConfiguredVersionFiles updates configured JSON and Cargo release files', (t) => {
  const workspace = makeWorkspace();
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const entries = [
    { path: 'package.json', format: 'json', field: 'version' },
    { path: 'config/tauri.json', format: 'json', field: 'package.version' },
    { path: 'src-tauri/Cargo.toml', format: 'cargo-package' },
    { path: 'src-tauri/Cargo.lock', format: 'cargo-lock-package', package: 'app' },
  ];
  assert.deepEqual(syncConfiguredVersionFiles(workspace, entries, '0.1.1'), [
    'package.json',
    path.join('config', 'tauri.json'),
    path.join('src-tauri', 'Cargo.toml'),
    path.join('src-tauri', 'Cargo.lock'),
  ]);
  // A running Cargo process may update Cargo.lock before qa-merge reaches the
  // sync step. Every configured release file must still be returned for
  // staging even when its content is already synchronized.
  assert.deepEqual(syncConfiguredVersionFiles(workspace, entries, '0.1.1'), [
    'package.json',
    path.join('config', 'tauri.json'),
    path.join('src-tauri', 'Cargo.toml'),
    path.join('src-tauri', 'Cargo.lock'),
  ]);
});

test('syncConfiguredVersionFiles rejects unsafe paths and unknown formats', (t) => {
  const workspace = makeWorkspace();
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  assert.throws(
    () => syncConfiguredVersionFiles(workspace, [{ path: '../package.json', format: 'json' }], '0.1.1'),
    /不能指向仓库外/
  );
  assert.throws(
    () => syncConfiguredVersionFiles(workspace, [{ path: 'package.json', format: 'yaml' }], '0.1.1'),
    /format 不支持/
  );
});

test('stageConfiguredVersionFiles retries when a Cargo watcher rewrites a file before git add', (t) => {
  const workspace = makeWorkspace();
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8' });
  git('init', '--initial-branch=main');
  git('config', 'user.email', 'qa-merge-test@example.invalid');
  git('config', 'user.name', 'QA Merge Test');
  git('add', '.');
  git('commit', '-m', 'initial');

  const entries = [
    { path: 'package.json', format: 'json', field: 'version' },
    { path: 'config/tauri.json', format: 'json', field: 'package.version' },
    { path: 'src-tauri/Cargo.toml', format: 'cargo-package' },
    { path: 'src-tauri/Cargo.lock', format: 'cargo-lock-package', package: 'app' },
  ];
  let injectedRace = false;
  const staged = stageConfiguredVersionFiles(workspace, entries, '0.1.1', {
    beforeStage(attempt) {
      if (attempt !== 1) return;
      injectedRace = true;
      fs.writeFileSync(
        path.join(workspace, 'src-tauri', 'Cargo.lock'),
        '[[package]]\nname = "app"\nversion = "0.1.0"\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n'
      );
    },
  });

  assert.equal(injectedRace, true);
  assert.deepEqual(staged, entries.map((entry) => path.normalize(entry.path)));
  assert.match(git('show', ':src-tauri/Cargo.lock'), /name = "app"\nversion = "0\.1\.1"/);
});

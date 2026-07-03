const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { syncConfiguredVersionFiles } = require('./qa-merge');

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-merge-version-sync-'));
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src-tauri'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ version: '0.1.0' }, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'config', 'tauri.json'),
    `${JSON.stringify({ package: { version: '0.1.0' } }, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'src-tauri', 'Cargo.toml'),
    [
      '[package]',
      'name = "app"',
      'version = "0.1.0"',
      '',
      '[dependencies]',
      'serde = { version = "1.0" }',
      '',
    ].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'src-tauri', 'Cargo.lock'),
    [
      '[[package]]',
      'name = "app"',
      'version = "0.1.0"',
      '',
      '[[package]]',
      'name = "serde"',
      'version = "1.0.0"',
      '',
    ].join('\n'),
    'utf8'
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

  const changed = syncConfiguredVersionFiles(workspace, entries, '0.1.1');
  assert.deepEqual(changed, [
    'package.json',
    path.join('config', 'tauri.json'),
    path.join('src-tauri', 'Cargo.toml'),
    path.join('src-tauri', 'Cargo.lock'),
  ]);

  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8')).version, '0.1.1');
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(workspace, 'config', 'tauri.json'), 'utf8')).package.version,
    '0.1.1'
  );
  const cargoToml = fs.readFileSync(path.join(workspace, 'src-tauri', 'Cargo.toml'), 'utf8');
  assert.match(cargoToml, /\nversion = "0\.1\.1"\n/);
  assert.match(cargoToml, /serde = \{ version = "1\.0" \}/);
  const cargoLock = fs.readFileSync(path.join(workspace, 'src-tauri', 'Cargo.lock'), 'utf8');
  assert.match(cargoLock, /name = "app"\nversion = "0\.1\.1"/);
  assert.match(cargoLock, /name = "serde"\nversion = "1\.0\.0"/);

  assert.deepEqual(syncConfiguredVersionFiles(workspace, entries, '0.1.1'), []);
});

test('syncConfiguredVersionFiles rejects paths outside the workspace', () => {
  const workspace = makeWorkspace();
  try {
    assert.throws(
      () => syncConfiguredVersionFiles(workspace, [{ path: '../package.json', format: 'json' }], '0.1.1'),
      /不能指向仓库外/
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('syncConfiguredVersionFiles updates Cargo.lock package with CRLF line endings', () => {
  const workspace = makeWorkspace();
  try {
    const cargoLockPath = path.join(workspace, 'src-tauri', 'Cargo.lock');
    fs.writeFileSync(
      cargoLockPath,
      [
        '[[package]]',
        'name = "app"',
        'version = "0.1.0"',
        'dependencies = []',
        '',
      ].join('\r\n'),
      'utf8'
    );

    assert.deepEqual(
      syncConfiguredVersionFiles(
        workspace,
        [{ path: 'src-tauri/Cargo.lock', format: 'cargo-lock-package', package: 'app' }],
        '0.1.1'
      ),
      [path.join('src-tauri', 'Cargo.lock')]
    );

    const cargoLock = fs.readFileSync(cargoLockPath, 'utf8');
    assert.match(cargoLock, /name = "app"\r\nversion = "0\.1\.1"/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('syncConfiguredVersionFiles rejects unknown formats', () => {
  const workspace = makeWorkspace();
  try {
    assert.throws(
      () => syncConfiguredVersionFiles(workspace, [{ path: 'package.json', format: 'yaml' }], '0.1.1'),
      /format 不支持/
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

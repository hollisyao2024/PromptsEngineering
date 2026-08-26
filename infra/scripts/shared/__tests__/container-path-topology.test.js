'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ensureContainerDirectories,
  resolveContainerPath,
  resolveRuntimePath,
  validateContainerTopology,
} = require('../config');

test('container paths stay anchored to main root when called from a linked worktree', () => {
  const mainRoot = path.resolve('/container/repo');
  const config = { containerDirs: { worktrees: '../worktrees', tmp: '../tmp' } };
  assert.equal(resolveContainerPath(config, mainRoot, 'tmp'), path.resolve('/container/tmp'));
  assert.doesNotThrow(() => validateContainerTopology(config, mainRoot));
});

test('session and lock runtime paths must remain inside the container tmp root', () => {
  const mainRoot = path.resolve('/container/repo');
  const config = { containerDirs: { worktrees: '../worktrees', tmp: '../tmp' } };
  assert.equal(
    resolveRuntimePath(config, mainRoot, '../tmp/worktree-sessions', 'worktree-sessions'),
    path.resolve('/container/tmp/worktree-sessions'),
  );
  assert.throws(
    () => resolveRuntimePath(config, mainRoot, '../worktrees/locks', 'agent-locks'),
    /runtime path.*container tmp/iu,
  );
});

test('container topology fails closed when tmp is inside the worktrees root', () => {
  const mainRoot = path.resolve('/container/repo');
  const config = { containerDirs: { worktrees: '../worktrees', tmp: '../worktrees/tmp' } };
  assert.throws(
    () => validateContainerTopology(config, mainRoot),
    /tmp.*worktrees|worktrees.*tmp/iu,
  );
});

test('resolving a container path remains side-effect free', (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'container-path-pure-'));
  t.after(() => fs.rmSync(container, { recursive: true, force: true }));
  const mainRoot = path.join(container, 'repo');
  fs.mkdirSync(mainRoot);

  const resolved = resolveContainerPath({}, mainRoot, 'cache');

  assert.equal(resolved, path.join(container, 'cache'));
  assert.equal(fs.existsSync(resolved), false);
});

test('initializes requested container directories recursively and idempotently', (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'container-path-init-'));
  t.after(() => fs.rmSync(container, { recursive: true, force: true }));
  const mainRoot = path.join(container, 'nested', 'repo');
  fs.mkdirSync(mainRoot, { recursive: true });
  const config = {
    containerDirs: {
      worktrees: '../../worktrees',
      tmp: '../../tmp',
      cache: '../../cache',
      artifacts: '../../artifacts',
    },
  };

  const first = ensureContainerDirectories(config, mainRoot, ['worktrees', 'tmp', 'cache', 'artifacts']);
  fs.writeFileSync(path.join(first.cache, 'sentinel.txt'), 'keep\n');
  const second = ensureContainerDirectories(config, mainRoot, ['worktrees', 'tmp', 'cache', 'artifacts']);

  assert.deepEqual(second, first);
  for (const directoryPath of Object.values(first)) {
    assert.equal(fs.lstatSync(directoryPath).isDirectory(), true);
    assert.equal(fs.lstatSync(directoryPath).isSymbolicLink(), false);
  }
  assert.equal(fs.readFileSync(path.join(first.cache, 'sentinel.txt'), 'utf8'), 'keep\n');
});

test('rejects unknown container keys before creating any directory', (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'container-path-key-'));
  t.after(() => fs.rmSync(container, { recursive: true, force: true }));
  const mainRoot = path.join(container, 'repo');
  fs.mkdirSync(mainRoot);

  assert.throws(
    () => ensureContainerDirectories({}, mainRoot, ['cache', 'unknown']),
    /unknown container directory key: unknown/iu,
  );
  assert.equal(fs.existsSync(path.join(container, 'cache')), false);
});

test('rejects a file that occupies a configured container directory', (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'container-path-file-'));
  t.after(() => fs.rmSync(container, { recursive: true, force: true }));
  const mainRoot = path.join(container, 'repo');
  const cachePath = path.join(container, 'cache');
  fs.mkdirSync(mainRoot);
  fs.writeFileSync(cachePath, 'not a directory\n');

  assert.throws(
    () => ensureContainerDirectories({ containerDirs: { cache: cachePath } }, mainRoot, ['cache']),
    /container directory cache must be a real directory/iu,
  );
});

test('rejects a directory link that occupies a configured container directory', (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'container-path-link-'));
  t.after(() => fs.rmSync(container, { recursive: true, force: true }));
  const mainRoot = path.join(container, 'repo');
  const targetPath = path.join(container, 'external-cache');
  const cachePath = path.join(container, 'cache');
  fs.mkdirSync(mainRoot);
  fs.mkdirSync(targetPath);
  try {
    fs.symlinkSync(targetPath, cachePath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip(`directory links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  assert.throws(
    () => ensureContainerDirectories({ containerDirs: { cache: cachePath } }, mainRoot, ['cache']),
    /container directory cache must be a real directory/iu,
  );
});

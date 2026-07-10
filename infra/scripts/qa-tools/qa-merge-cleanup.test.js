'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  cleanupOrphanWorktreeDirs,
  cleanupOrphanSessions,
} = require('./qa-merge');
const { safeRemoveTreeNoFollow } = require('../worktree-tools/worktree-core');

function makeContainer() {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-merge-cleanup-'));
  const mainRoot = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  fs.mkdirSync(mainRoot, { recursive: true });
  fs.mkdirSync(worktreesRoot, { recursive: true });
  return { container, mainRoot, worktreesRoot };
}

test('orphan cleanup fails closed when git worktree listing fails', (t) => {
  const fixture = makeContainer();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: os.tmpdir() }));
  const unknown = path.join(fixture.worktreesRoot, 'unknown-directory');
  fs.mkdirSync(unknown);
  fs.writeFileSync(path.join(unknown, 'sentinel.txt'), 'keep\n');

  const result = cleanupOrphanWorktreeDirs(fixture.mainRoot, {
    runListPorcelain: () => ({ status: 1, stdout: '', stderr: 'simulated failure' }),
    readSessions: () => [],
  });

  assert.deepEqual(result.removed, []);
  assert.equal(result.skipped.some((item) => item.reason === 'git-list-failed'), true);
  assert.equal(fs.readFileSync(path.join(unknown, 'sentinel.txt'), 'utf8'), 'keep\n');
});

test('orphan cleanup skips unregistered directories without managed provenance', (t) => {
  const fixture = makeContainer();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: os.tmpdir() }));
  const unknown = path.join(fixture.worktreesRoot, 'personal-files');
  fs.mkdirSync(unknown);
  fs.writeFileSync(path.join(unknown, 'sentinel.txt'), 'keep\n');

  const result = cleanupOrphanWorktreeDirs(fixture.mainRoot, {
    runListPorcelain: () => ({
      status: 0,
      stdout: `worktree ${fixture.mainRoot}\nHEAD deadbeef\nbranch refs/heads/main\n\n`,
      stderr: '',
    }),
    readSessions: () => [],
  });

  assert.deepEqual(result.removed, []);
  assert.equal(result.skipped.some((item) => item.path === unknown && item.reason === 'unmanaged'), true);
  assert.equal(fs.readFileSync(path.join(unknown, 'sentinel.txt'), 'utf8'), 'keep\n');
});

test('managed orphan cleanup unlinks junctions without touching external targets', (t) => {
  const fixture = makeContainer();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: os.tmpdir() }));
  const managed = path.join(fixture.worktreesRoot, 'managed-orphan');
  const external = path.join(fixture.container, 'external-dependencies');
  fs.mkdirSync(managed);
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, 'sentinel.txt'), 'keep external\n');
  fs.symlinkSync(external, path.join(managed, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const adminPath = path.join(fixture.mainRoot, '.git', 'worktrees', 'managed-orphan');
  fs.mkdirSync(path.dirname(adminPath), { recursive: true });
  fs.writeFileSync(path.join(managed, '.git'), `gitdir: ${adminPath}\n`);

  const result = cleanupOrphanWorktreeDirs(fixture.mainRoot, {
    runListPorcelain: () => ({
      status: 0,
      stdout: `worktree ${fixture.mainRoot}\nHEAD deadbeef\nbranch refs/heads/main\n\n`,
      stderr: '',
    }),
    readSessions: () => [{ worktree: managed, branch: 'fix/managed-orphan' }],
  });

  assert.deepEqual(result.removed, [managed]);
  assert.equal(fs.existsSync(managed), false);
  assert.equal(fs.readFileSync(path.join(external, 'sentinel.txt'), 'utf8'), 'keep external\n');
});

test('orphan cleanup never treats a stale session as deletion authorization', (t) => {
  const fixture = makeContainer();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: os.tmpdir() }));
  const reused = path.join(fixture.worktreesRoot, 'reused-personal-directory');
  fs.mkdirSync(reused);
  fs.writeFileSync(path.join(reused, 'sentinel.txt'), 'keep reused\n');

  const result = cleanupOrphanWorktreeDirs(fixture.mainRoot, {
    runListPorcelain: () => ({
      status: 0,
      stdout: `worktree ${fixture.mainRoot}\nHEAD deadbeef\nbranch refs/heads/main\n\n`,
      stderr: '',
    }),
    readSessions: () => [{ worktree: reused, branch: 'fix/stale-session' }],
  });

  assert.deepEqual(result.removed, []);
  assert.equal(
    result.skipped.some((item) => item.path === reused && item.reason === 'session-without-git-marker'),
    true,
  );
  assert.equal(fs.readFileSync(path.join(reused, 'sentinel.txt'), 'utf8'), 'keep reused\n');
});

test('orphan session cleanup fails closed when Git worktree listing fails', () => {
  const removedBranches = [];
  const result = cleanupOrphanSessions('C:\\unused-main-root', {
    loadConfig: () => ({}),
    readSessions: () => [{ branch: 'fix/must-survive', worktree: 'C:\\missing' }],
    removeSession: (_config, _root, branch) => removedBranches.push(branch),
    runListPorcelain: () => ({ status: 1, stdout: '', stderr: 'simulated failure' }),
  });

  assert.deepEqual(result, []);
  assert.deepEqual(removedBranches, []);
});

test('orphan session cleanup preserves active worktrees with normalized Windows paths', () => {
  const removedBranches = [];
  const activePath = process.platform === 'win32'
    ? 'C:\\Projects\\Example\\Worktrees\\Active'
    : '/tmp/example/worktrees/active';
  const sessionPath = process.platform === 'win32' ? activePath.toLowerCase() : activePath;
  const result = cleanupOrphanSessions('C:\\unused-main-root', {
    loadConfig: () => ({}),
    readSessions: () => [{ branch: 'fix/active', worktree: sessionPath }],
    removeSession: (_config, _root, branch) => removedBranches.push(branch),
    runListPorcelain: () => ({
      status: 0,
      stdout: `worktree ${activePath}\nHEAD deadbeef\nbranch refs/heads/fix/active\n\n`,
      stderr: '',
    }),
  });

  assert.deepEqual(result, []);
  assert.deepEqual(removedBranches, []);
});

test('production cleanup sources never invoke git worktree remove', () => {
  const sources = [
    path.resolve(__dirname, '../worktree-tools/worktree-remove.js'),
    path.resolve(__dirname, 'qa-merge.js'),
  ];

  for (const source of sources) {
    const text = fs.readFileSync(source, 'utf8');
    assert.doesNotMatch(text, /['"]worktree['"]\s*,\s*['"]remove['"]/u, source);
  }
});

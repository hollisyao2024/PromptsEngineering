'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  markCleanupPending,
  reconcilePendingCleanups,
} = require('../deferred-cleanup-state');
const { safeRemoveTreeNoFollow } = require('../worktree-core');

const realTemporaryRoot = fs.realpathSync(os.tmpdir());

function makeFixture() {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'deferred-cleanup-state-'));
  const mainRoot = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  fs.mkdirSync(mainRoot, { recursive: true });
  fs.mkdirSync(worktreesRoot, { recursive: true });
  return { container, mainRoot, worktreesRoot };
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test('cleanup intent is persisted before synchronous filesystem mutation begins', (t) => {
  const fixture = makeFixture();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
  const writes = [];

  markCleanupPending({
    config: {},
    mainRoot: fixture.mainRoot,
    branch: 'fix/persist-before-spawn',
    worktreePath: path.join(fixture.worktreesRoot, 'persist-before-spawn'),
    writeSession: (_config, _root, payload) => writes.push(payload),
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].status, 'cleanup_pending');
  assert.equal(writes[0].cleanup.branch, 'fix/persist-before-spawn');
  assert.equal(writes[0].cleanup.mainRoot, fixture.mainRoot);
});

test('reconciler resumes an unregistered partial deletion after process restart', (t) => {
  const fixture = makeFixture();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
  const worktreePath = path.join(fixture.worktreesRoot, 'partial');
  fs.mkdirSync(worktreePath);
  fs.writeFileSync(path.join(worktreePath, 'remaining.txt'), 'partial\n');
  const removedSessions = [];
  const deletedBranches = [];
  const session = {
    branch: 'fix/partial',
    worktree: worktreePath,
    status: 'cleanup_pending',
    cleanup: {
      mainRoot: fixture.mainRoot,
      branch: 'fix/partial',
      worktree: worktreePath,
    },
  };

  const result = reconcilePendingCleanups({
    config: {},
    mainRoot: fixture.mainRoot,
    worktreesRoot: fixture.worktreesRoot,
    readSessions: () => [session],
    listWorktrees: () => [{ branch: 'main', path: fixture.mainRoot }],
    removeSession: (_config, _root, branch) => removedSessions.push(branch),
    deleteBranch: (_root, branch) => deletedBranches.push(branch),
  });

  assert.deepEqual(result.completed, ['fix/partial']);
  assert.deepEqual(result.pending, []);
  assert.equal(fs.existsSync(worktreePath), false);
  assert.deepEqual(removedSessions, ['fix/partial']);
  assert.deepEqual(deletedBranches, ['fix/partial']);
});

test('reconciler retains authorization and records failures for a later process', (t) => {
  const fixture = makeFixture();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
  const worktreePath = path.join(fixture.worktreesRoot, 'busy');
  fs.mkdirSync(worktreePath);
  const writes = [];
  const session = {
    branch: 'fix/busy',
    worktree: worktreePath,
    status: 'cleanup_pending',
    cleanup: {
      mainRoot: fixture.mainRoot,
      branch: 'fix/busy',
      worktree: worktreePath,
    },
  };

  const result = reconcilePendingCleanups({
    config: {},
    mainRoot: fixture.mainRoot,
    worktreesRoot: fixture.worktreesRoot,
    readSessions: () => [session],
    listWorktrees: () => [{ branch: 'fix/busy', path: worktreePath }],
    removeRegisteredWorktree: () => {
      const error = new Error('simulated busy handle');
      error.code = 'EBUSY';
      throw error;
    },
    writeSession: (_config, _root, payload) => writes.push(payload),
  });

  assert.deepEqual(result.completed, []);
  assert.deepEqual(result.pending, ['fix/busy']);
  assert.match(result.errors[0].error, /simulated busy handle/);
  assert.equal(writes[0].status, 'cleanup_pending');
  assert.equal(writes[0].cleanup.attempts, 1);
  assert.match(writes[0].cleanup.lastError, /simulated busy handle/);
});

test('reconciler completes registered worktree, Git metadata, branch, and session atomically', (t) => {
  const fixture = makeFixture();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
  runGit(fixture.mainRoot, ['init', '-b', 'main']);
  runGit(fixture.mainRoot, ['config', 'user.email', 'cleanup-test@example.com']);
  runGit(fixture.mainRoot, ['config', 'user.name', 'Cleanup Test']);
  fs.writeFileSync(path.join(fixture.mainRoot, 'README.md'), 'fixture\n');
  runGit(fixture.mainRoot, ['add', 'README.md']);
  runGit(fixture.mainRoot, ['commit', '-m', 'init']);
  const worktreePath = path.join(fixture.worktreesRoot, 'registered');
  runGit(fixture.mainRoot, ['worktree', 'add', '-b', 'fix/registered', worktreePath]);
  const removedSessions = [];
  const session = {
    branch: 'fix/registered',
    worktree: worktreePath,
    status: 'cleanup_pending',
    cleanup: {
      mainRoot: fixture.mainRoot,
      branch: 'fix/registered',
      worktree: worktreePath,
    },
  };

  const result = reconcilePendingCleanups({
    config: {},
    mainRoot: fixture.mainRoot,
    worktreesRoot: fixture.worktreesRoot,
    readSessions: () => [session],
    removeSession: (_config, _root, branch) => removedSessions.push(branch),
  });

  assert.deepEqual(result.completed, ['fix/registered']);
  assert.deepEqual(result.pending, []);
  assert.equal(fs.existsSync(worktreePath), false);
  assert.equal(
    spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/fix/registered'], {
      cwd: fixture.mainRoot,
    }).status,
    1,
  );
  assert.deepEqual(removedSessions, ['fix/registered']);
});

test('reconciler prunes the exact authorized registration after the physical tree is already gone', (t) => {
  const fixture = makeFixture();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
  runGit(fixture.mainRoot, ['init', '-b', 'main']);
  runGit(fixture.mainRoot, ['config', 'user.email', 'cleanup-test@example.com']);
  runGit(fixture.mainRoot, ['config', 'user.name', 'Cleanup Test']);
  fs.writeFileSync(path.join(fixture.mainRoot, 'README.md'), 'fixture\n');
  runGit(fixture.mainRoot, ['add', 'README.md']);
  runGit(fixture.mainRoot, ['commit', '-m', 'init']);
  const worktreePath = path.join(fixture.worktreesRoot, 'missing-registered');
  runGit(fixture.mainRoot, ['worktree', 'add', '-b', 'fix/missing-registered', worktreePath]);
  safeRemoveTreeNoFollow(worktreePath, { allowedRoot: fixture.worktreesRoot });
  const removedSessions = [];
  const session = {
    branch: 'fix/missing-registered',
    worktree: worktreePath,
    status: 'cleanup_pending',
    cleanup: {
      mainRoot: fixture.mainRoot,
      branch: 'fix/missing-registered',
      worktree: worktreePath,
    },
  };

  const result = reconcilePendingCleanups({
    config: {},
    mainRoot: fixture.mainRoot,
    worktreesRoot: fixture.worktreesRoot,
    readSessions: () => [session],
    removeSession: (_config, _root, branch) => removedSessions.push(branch),
  });

  assert.deepEqual(result.completed, ['fix/missing-registered']);
  assert.deepEqual(result.pending, []);
  assert.equal(
    runGit(fixture.mainRoot, ['worktree', 'list', '--porcelain']).includes(worktreePath),
    false,
  );
  assert.equal(
    spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/fix/missing-registered'], {
      cwd: fixture.mainRoot,
    }).status,
    1,
  );
  assert.deepEqual(removedSessions, ['fix/missing-registered']);
});

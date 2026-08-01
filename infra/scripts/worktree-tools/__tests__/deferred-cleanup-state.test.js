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
const { readSessions, safeRemoveTreeNoFollow } = require('../worktree-core');

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
    expectedHead: '0123456789abcdef',
    writeSession: (_config, _root, payload) => writes.push(payload),
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].status, 'cleanup_pending');
  assert.equal(writes[0].cleanup.branch, 'fix/persist-before-spawn');
  assert.equal(writes[0].cleanup.mainRoot, fixture.mainRoot);
  assert.equal(writes[0].cleanup.expectedHead, '0123456789abcdef');
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
      expectedHead: 'partial-head',
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
    inspectCleanupState: () => ({ branchHead: 'partial-head', worktreeHead: '', dirty: false }),
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
      expectedHead: 'busy-head',
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
    inspectCleanupState: () => ({ branchHead: 'busy-head', worktreeHead: 'busy-head', dirty: false }),
  });

  assert.deepEqual(result.completed, []);
  assert.deepEqual(result.pending, ['fix/busy']);
  assert.match(result.errors[0].error, /simulated busy handle/);
  const retained = writes.at(-1);
  assert.equal(retained.status, 'cleanup_pending');
  assert.equal(retained.cleanup.attempts, 1);
  assert.match(retained.cleanup.lastError, /simulated busy handle/);
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
  const expectedHead = runGit(worktreePath, ['rev-parse', 'HEAD']);
  const removedSessions = [];
  const session = {
    branch: 'fix/registered',
    worktree: worktreePath,
    status: 'cleanup_pending',
    cleanup: {
      mainRoot: fixture.mainRoot,
      branch: 'fix/registered',
      worktree: worktreePath,
      expectedHead,
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
  const expectedHead = runGit(fixture.mainRoot, ['rev-parse', 'fix/missing-registered']);
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
      expectedHead,
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

test('reconciler preserves a worktree and enters recovery when HEAD advances after merge', (t) => {
  const fixture = makeFixture();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
  const worktreePath = path.join(fixture.worktreesRoot, 'advanced');
  fs.mkdirSync(worktreePath);
  fs.writeFileSync(path.join(worktreePath, 'sentinel.txt'), 'must survive\n');
  const writes = [];
  const removals = [];
  const session = {
    branch: 'fix/advanced',
    worktree: worktreePath,
    status: 'cleanup_pending',
    cleanup: {
      mainRoot: fixture.mainRoot,
      branch: 'fix/advanced',
      worktree: worktreePath,
      expectedHead: 'merged-head',
    },
  };

  const result = reconcilePendingCleanups({
    config: {},
    mainRoot: fixture.mainRoot,
    worktreesRoot: fixture.worktreesRoot,
    readSessions: () => [session],
    listWorktrees: () => [{ branch: 'fix/advanced', path: worktreePath }],
    inspectCleanupState: () => ({ branchHead: 'new-local-head', worktreeHead: 'new-local-head', dirty: false }),
    removeRegisteredWorktree: () => removals.push('worktree'),
    deleteBranch: () => removals.push('branch'),
    removeSession: () => removals.push('session'),
    writeSession: (_config, _root, payload) => writes.push(payload),
  });

  assert.deepEqual(result.completed, []);
  assert.deepEqual(result.recoveryRequired, ['fix/advanced']);
  assert.deepEqual(removals, []);
  assert.equal(fs.readFileSync(path.join(worktreePath, 'sentinel.txt'), 'utf8'), 'must survive\n');
  assert.equal(writes[0].status, 'recovery_required');
  assert.equal(writes[0].cleanup.expectedHead, 'merged-head');
  assert.equal(writes[0].cleanup.actualHead, 'new-local-head');
});

test('reconciler preserves dirty post-merge work even when HEAD is unchanged', (t) => {
  const fixture = makeFixture();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
  const worktreePath = path.join(fixture.worktreesRoot, 'dirty');
  fs.mkdirSync(worktreePath);
  const writes = [];

  const result = reconcilePendingCleanups({
    config: {},
    mainRoot: fixture.mainRoot,
    worktreesRoot: fixture.worktreesRoot,
    readSessions: () => [{
      branch: 'fix/dirty',
      worktree: worktreePath,
      status: 'cleanup_pending',
      cleanup: {
        mainRoot: fixture.mainRoot,
        branch: 'fix/dirty',
        worktree: worktreePath,
        expectedHead: 'sealed-head',
      },
    }],
    listWorktrees: () => [{ branch: 'fix/dirty', path: worktreePath }],
    inspectCleanupState: () => ({ branchHead: 'sealed-head', worktreeHead: 'sealed-head', dirty: true }),
    writeSession: (_config, _root, payload) => writes.push(payload),
  });

  assert.deepEqual(result.recoveryRequired, ['fix/dirty']);
  assert.equal(writes[0].status, 'recovery_required');
  assert.equal(writes[0].cleanup.dirty, true);
  assert.equal(fs.existsSync(worktreePath), true);
});

test('real Git post-merge commit is detected and recovered instead of deleted', (t) => {
  const fixture = makeFixture();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
  runGit(fixture.mainRoot, ['init', '-b', 'main']);
  runGit(fixture.mainRoot, ['config', 'user.email', 'cleanup-test@example.com']);
  runGit(fixture.mainRoot, ['config', 'user.name', 'Cleanup Test']);
  fs.writeFileSync(path.join(fixture.mainRoot, 'README.md'), 'fixture\n');
  runGit(fixture.mainRoot, ['add', 'README.md']);
  runGit(fixture.mainRoot, ['commit', '-m', 'init']);
  const worktreePath = path.join(fixture.worktreesRoot, 'real-advanced');
  runGit(fixture.mainRoot, ['worktree', 'add', '-b', 'fix/real-advanced', worktreePath]);
  const expectedHead = runGit(worktreePath, ['rev-parse', 'HEAD']);
  const config = { worktree: { sessionDir: path.join(fixture.container, 'sessions') } };
  markCleanupPending({
    config,
    mainRoot: fixture.mainRoot,
    branch: 'fix/real-advanced',
    worktreePath,
    expectedHead,
  });

  fs.writeFileSync(path.join(worktreePath, 'late.txt'), 'late work\n');
  runGit(worktreePath, ['add', 'late.txt']);
  runGit(worktreePath, ['commit', '-m', 'late work after merge']);
  const actualHead = runGit(worktreePath, ['rev-parse', 'HEAD']);
  const result = reconcilePendingCleanups({
    config,
    mainRoot: fixture.mainRoot,
    worktreesRoot: fixture.worktreesRoot,
  });

  assert.deepEqual(result.recoveryRequired, ['fix/real-advanced']);
  assert.equal(fs.existsSync(path.join(worktreePath, 'late.txt')), true);
  assert.equal(runGit(worktreePath, ['rev-parse', 'HEAD']), actualHead);
  const session = readSessions(config, fixture.mainRoot).find((item) => item.branch === 'fix/real-advanced');
  assert.equal(session.status, 'recovery_required');
  assert.equal(session.cleanup.expectedHead, expectedHead);
  assert.equal(session.cleanup.actualHead, actualHead);
});

test('legacy cleanup without a HEAD seal becomes recovery_required without deletion', (t) => {
  const fixture = makeFixture();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
  const worktreePath = path.join(fixture.worktreesRoot, 'legacy-unsealed');
  fs.mkdirSync(worktreePath);
  const writes = [];
  const result = reconcilePendingCleanups({
    config: {},
    mainRoot: fixture.mainRoot,
    worktreesRoot: fixture.worktreesRoot,
    readSessions: () => [{
      branch: 'fix/legacy-unsealed',
      worktree: worktreePath,
      status: 'cleanup_pending',
      cleanup: { mainRoot: fixture.mainRoot, branch: 'fix/legacy-unsealed', worktree: worktreePath },
    }],
    listWorktrees: () => [{ branch: 'fix/legacy-unsealed', path: worktreePath }],
    writeSession: (_config, _root, payload) => writes.push(payload),
  });

  assert.deepEqual(result.recoveryRequired, ['fix/legacy-unsealed']);
  assert.equal(writes[0].status, 'recovery_required');
  assert.equal(fs.existsSync(worktreePath), true);
});

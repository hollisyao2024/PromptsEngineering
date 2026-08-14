'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  cleanupWorktree,
  cleanupOrphanWorktreeDirs,
  cleanupOrphanSessions,
} = require('./qa-merge');
const { safeRemoveTreeNoFollow } = require('../worktree-tools/worktree-core');

const realTemporaryRoot = fs.realpathSync(os.tmpdir());

function makeContainer() {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'qa-merge-cleanup-'));
  const mainRoot = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  fs.mkdirSync(mainRoot, { recursive: true });
  fs.mkdirSync(worktreesRoot, { recursive: true });
  return { container, mainRoot, worktreesRoot };
}

test('orphan cleanup fails closed when git worktree listing fails', (t) => {
  const fixture = makeContainer();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
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
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
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
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
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
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
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

test('qa merge persists the sealed cleanup intent before scheduling deferred cleanup', (t) => {
  const fixture = makeContainer();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
  const worktreePath = path.join(fixture.worktreesRoot, 'sealed');
  fs.mkdirSync(worktreePath);
  const events = [];

  const result = cleanupWorktree('fix/sealed', fixture.mainRoot, {
    currentCwd: worktreePath,
    listWorktrees: () => [{ branch: 'fix/sealed', path: worktreePath, head: 'sealed-head' }],
    config: { containerDirs: { worktrees: fixture.worktreesRoot } },
    markCleanupPending: (input) => events.push(['persist', input.expectedHead]),
    scheduleDeferredCleanup: () => events.push(['schedule']),
  });

  assert.equal(result.deferred, true);
  assert.deepEqual(events, [['persist', 'sealed-head'], ['schedule']]);
});

test('qa merge cascades sealed predecessor cleanup before scheduling current worktree removal', (t) => {
  const fixture = makeContainer();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
  const worktreePath = path.join(fixture.worktreesRoot, 'current');
  fs.mkdirSync(worktreePath);
  const events = [];

  const result = cleanupWorktree('feature/current', fixture.mainRoot, {
    currentCwd: worktreePath,
    listWorktrees: () => [{ branch: 'feature/current', path: worktreePath, head: 'current-head' }],
    config: { containerDirs: { worktrees: fixture.worktreesRoot } },
    markCleanupPending: () => events.push('seal-current'),
    sealSupersededSessions: () => ({
      sealed: ['docs/prd-current'], alreadyPending: [], alreadyRemoved: [], errors: [],
    }),
    reconcilePendingCleanups: (input) => {
      events.push(`reconcile:${input.excludeBranch}`);
      return { completed: ['docs/prd-current'], errors: [] };
    },
    scheduleDeferredCleanup: () => events.push('schedule-current'),
  });

  assert.equal(result.deferred, true);
  assert.deepEqual(events, [
    'seal-current',
    'reconcile:feature/current',
    'schedule-current',
  ]);
});

test('qa merge blocks when a declared predecessor seal cannot be verified', (t) => {
  const fixture = makeContainer();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
  const worktreePath = path.join(fixture.worktreesRoot, 'current');
  fs.mkdirSync(worktreePath);

  assert.throws(() => cleanupWorktree('feature/current', fixture.mainRoot, {
    currentCwd: worktreePath,
    listWorktrees: () => [{ branch: 'feature/current', path: worktreePath, head: 'current-head' }],
    config: { containerDirs: { worktrees: fixture.worktreesRoot } },
    markCleanupPending: () => {},
    sealSupersededSessions: () => ({
      sealed: [],
      alreadyPending: [],
      alreadyRemoved: [],
      errors: [{ branch: 'docs/prd-current', error: 'predecessor worktree changed' }],
    }),
  }), /cannot seal superseded worktrees/u);
});

test('qa merge deferred cleanup does not return before main synchronization and push steps', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'qa-merge.js'), 'utf8');
  const deferredBlock = source.match(/if \(cleanupResult\.deferred\) \{([\s\S]*?)\n\s*\}/u);
  assert.ok(deferredBlock);
  assert.doesNotMatch(deferredBlock[1], /\breturn\b/u);
  assert.ok(source.indexOf('pushMainAndTag(mainWorkspacePath') > source.indexOf('cleanupResult = cleanupWorktree'));
});

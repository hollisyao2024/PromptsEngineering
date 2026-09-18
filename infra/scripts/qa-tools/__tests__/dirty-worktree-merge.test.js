'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkMergeWorktrees, cleanupWorktree, localSquashMerge, printSummary } = require('../qa-merge');
const { readSessions, safeRemoveTreeNoFollow } = require('../../worktree-tools/worktree-core');

const tmp = fs.realpathSync(os.tmpdir());
function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmp, 'dirty-merge-'));
  t.after(() => safeRemoveTreeNoFollow(root, { allowedRoot: tmp }));
  const main = path.join(root, 'repo');
  const feature = path.join(root, 'worktrees', 'feature');
  const origin = path.join(root, 'origin.git');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(root, 'init', '--bare', origin);
  git(root, 'init', '-b', 'main', main);
  git(main, 'config', 'core.autocrlf', 'false');
  git(main, 'config', 'user.name', 'Fixture');
  git(main, 'config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(main, 'tracked.txt'), 'base\n');
  git(main, 'add', '.'); git(main, 'commit', '-m', 'base');
  git(main, 'remote', 'add', 'origin', origin); git(main, 'push', 'origin', 'main');
  const base = git(main, 'rev-parse', 'HEAD');
  git(main, 'worktree', 'add', '-b', 'fix/dirty', feature);
  fs.writeFileSync(path.join(feature, 'verified.txt'), 'verified\n');
  git(feature, 'add', '.'); git(feature, 'commit', '-m', 'verified change');
  const head = git(feature, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(feature, 'tracked.txt'), 'staged local edit\n');
  git(feature, 'add', 'tracked.txt');
  fs.writeFileSync(path.join(feature, 'tracked.txt'), 'unstaged local edit\n');
  fs.writeFileSync(path.join(feature, 'untracked.txt'), 'local only\n');
  const snapshot = () => ({
    status: git(feature, 'status', '--porcelain', '--untracked-files=all'),
    index: git(feature, 'diff', '--cached', '--binary'),
    worktree: git(feature, 'diff', '--binary'),
    untracked: fs.readFileSync(path.join(feature, 'untracked.txt'), 'utf8'),
    head: git(feature, 'rev-parse', 'HEAD'),
  });
  return { root, main, feature, git, base, head, snapshot };
}

test('dirty feature permits a fixed-head squash merge and keeps all local content unchanged', async t => {
  const f = fixture(t); const before = f.snapshot();
  assert.equal(checkMergeWorktrees(f.feature, f.main).featureDirty, true);
  await localSquashMerge('fix/dirty', { number: 1, title: 'verified change', body: '' }, f.main,
    { expectedBaseSha: f.base, expectedHeadSha: f.head });
  assert.equal(fs.readFileSync(path.join(f.main, 'tracked.txt'), 'utf8'), 'base\n');
  assert.equal(fs.readFileSync(path.join(f.main, 'verified.txt'), 'utf8'), 'verified\n');
  assert.equal(fs.existsSync(path.join(f.main, 'untracked.txt')), false);
  assert.deepEqual(f.snapshot(), before);
});

test('dirty destination or non-isolated dirty checkout is rejected without changing either checkout', t => {
  const f = fixture(t); const before = f.snapshot();
  assert.throws(() => checkMergeWorktrees(f.feature, f.feature), /independent|独立/);
  fs.writeFileSync(path.join(f.main, 'tracked.txt'), 'main local edit\n');
  assert.throws(() => checkMergeWorktrees(f.feature, f.main), /目标.*未提交|destination/i);
  assert.deepEqual(f.snapshot(), before);
  assert.equal(fs.readFileSync(path.join(f.main, 'tracked.txt'), 'utf8'), 'main local edit\n');
});

test('dirty worktree is sealed and retained without scheduling cleanup or deleting any local data', t => {
  const f = fixture(t); const before = f.snapshot();
  const result = cleanupWorktree('fix/dirty', f.main, {
    config: {}, expectedHead: f.head,
    scheduleDeferredCleanup() { assert.fail('dirty worktree must not launch a cleanup worker'); },
    reconcilePendingCleanups() { assert.fail('dirty worktree must not attempt deletion'); },
    sealSupersededSessions() { assert.fail('retaining this worktree must not clean other sessions'); },
  });
  assert.equal(result.preserved, true);
  assert.equal(result.deferred, true);
  assert.deepEqual(f.snapshot(), before);
  const session = readSessions({}, f.main).find(s => s.branch === 'fix/dirty');
  assert.equal(session.cleanup.expectedHead, f.head);
  const output = [];
  t.mock.method(console, 'log', (...args) => output.push(args.join(' ')));
  printSummary({ number: 1, title: 'verified change' }, 'fix/dirty', f.head, 'gh', { status: 'already-complete' }, '', f.main, result);
  assert.match(output.join('\n'), /MERGE_STATUS=MERGED/);
  assert.match(output.join('\n'), /CLEANUP_STATUS=PRESERVED/);
});

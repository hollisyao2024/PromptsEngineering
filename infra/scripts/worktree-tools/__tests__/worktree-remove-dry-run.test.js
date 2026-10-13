'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { safeRemoveTreeNoFollow, writeSession } = require('../worktree-core');

const realTemporaryRoot = fs.realpathSync(os.tmpdir());
const removeScript = path.resolve(__dirname, '..', 'worktree-remove.js');
const cancelScript = path.resolve(__dirname, '..', 'worktree-cancel.js');
const agentCliScript = 'infra/scripts/agent-runner/agent-cli.js';
const BRANCH = 'feature/dry-run-demo';

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`,
  );
  return result.stdout.trim();
}

function initFixture(t) {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-remove-dry-run-'));
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: realTemporaryRoot }));
  const repo = path.join(container, 'repo');
  const config = {
    baseBranch: 'main',
    containerDirs: { worktrees: '../worktrees', tmp: '../tmp' },
    worktree: { sessionDir: '../tmp/sessions', lockDir: '../tmp/locks' },
  };
  fs.mkdirSync(repo);
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'agent.config.json'), `${JSON.stringify(config, null, 2)}\n`);
  fs.writeFileSync(path.join(repo, 'README.md'), '# dry-run\n');
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', 'init']);
  // agent-cli only routes to scripts installed in the current repo.
  fs.symlinkSync(path.resolve(__dirname, '..', '..', '..'), path.join(repo, 'infra'), 'dir');
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '/infra\n');

  const worktree = path.join(container, 'worktrees', 'dry-run-demo');
  runGit(repo, ['worktree', 'add', '-b', BRANCH, worktree, 'main']);
  writeSession(config, repo, { branch: BRANCH, worktree, status: 'in_progress', head: 'abc123' });
  const sessionFile = path.join(container, 'tmp', 'sessions', 'feature-dry-run-demo.json');
  const lockFile = path.join(container, 'tmp', 'locks', 'unrelated-holder.lock');
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, `${JSON.stringify({ pid: process.pid })}\n`);
  // Uncommitted work: a destructive run (especially cancel) would discard it.
  fs.writeFileSync(path.join(worktree, 'WIP.md'), 'unsaved work\n');
  return { container, repo, worktree, sessionFile, lockFile };
}

function snapshot(fixture) {
  return {
    worktreeExists: fs.existsSync(fixture.worktree),
    wip: fs.existsSync(path.join(fixture.worktree, 'WIP.md')),
    registered: runGit(fixture.repo, ['worktree', 'list', '--porcelain']).includes(fixture.worktree),
    branch: runGit(fixture.repo, ['branch', '--list', BRANCH]).length > 0,
    session: fs.existsSync(fixture.sessionFile) ? fs.readFileSync(fixture.sessionFile, 'utf8') : null,
    lock: fs.existsSync(fixture.lockFile),
  };
}

function run(fixture, script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: fixture.repo,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

const DRY_RUN_VARIANTS = [
  ['remove', removeScript, (target) => [target, '--dry-run']],
  ['remove', removeScript, (target) => ['--dry-run', target]],
  ['remove', removeScript, (target) => [target, '--dry-run=true']],
  ['remove', removeScript, (target) => [target, '--force', '--dry-run']],
  ['remove', agentCliScript, (target) => ['--', 'worktree', 'remove', target, '--dry-run']],
  ['cancel', cancelScript, (target) => [target, '--dry-run']],
  ['cancel', cancelScript, (target) => [target, '--force', '--dry-run']],
  ['cancel', cancelScript, (target) => ['--dry-run', target, '--force']],
  ['cancel', agentCliScript, (target) => ['--', 'worktree', 'cancel', target, '--force', '--dry-run']],
];

for (const [action, script, buildArgs] of DRY_RUN_VARIANTS) {
  for (const targetKind of ['branch', 'path']) {
    const label = `${path.basename(script)} ${buildArgs('<target>').join(' ')} (${targetKind})`;
    test(`worktree ${action} dry-run leaves worktree, branch, session and locks intact: ${label}`, (t) => {
      const fixture = initFixture(t);
      const target = targetKind === 'branch' ? BRANCH : fixture.worktree;
      const before = snapshot(fixture);

      const result = run(fixture, script, buildArgs(target));

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /^STATUS=DRY_RUN$/mu);
      assert.match(result.stdout, new RegExp(`^ACTION=${action}$`, 'mu'));
      assert.match(result.stdout, new RegExp(`^BRANCH_NAME=${BRANCH}$`, 'mu'));
      assert.match(result.stdout, /^WORKTREE_PATH=.+dry-run-demo$/mu);
      assert.match(result.stdout, /^PLANNED=/mu);
      assert.doesNotMatch(result.stdout, /STATUS=(REMOVED|CANCELLED)/u);
      assert.deepEqual(snapshot(fixture), before);
      assert.equal(before.worktreeExists && before.registered && before.branch && before.lock, true);
      assert.notEqual(before.session, null);
    });
  }
}

test('worktree remove dry-run reports the same uncommitted-change block as a real run', (t) => {
  const fixture = initFixture(t);
  const before = snapshot(fixture);

  const result = run(fixture, removeScript, [BRANCH, '--dry-run']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^WOULD_BLOCK=worktree has uncommitted changes/mu);
  assert.deepEqual(snapshot(fixture), before);
});

test('worktree remove without dry-run still removes a clean worktree and its session', (t) => {
  const fixture = initFixture(t);
  fs.rmSync(path.join(fixture.worktree, 'WIP.md'));

  const result = run(fixture, removeScript, [BRANCH]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^STATUS=REMOVED$/mu);
  const after = snapshot(fixture);
  assert.equal(after.worktreeExists, false);
  assert.equal(after.registered, false);
  assert.equal(after.session, null);
  assert.equal(after.branch, true, 'remove keeps the local branch');
  assert.equal(after.lock, true);
});

test('worktree cancel without dry-run still requires --force, then removes worktree, session and branch', (t) => {
  const fixture = initFixture(t);

  const refused = run(fixture, cancelScript, [BRANCH]);
  assert.equal(refused.status, 1, refused.stdout);
  assert.match(refused.stderr, /pass --force/u);
  assert.equal(snapshot(fixture).worktreeExists, true);

  const result = run(fixture, cancelScript, [BRANCH, '--force']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^STATUS=CANCELLED$/mu);
  const after = snapshot(fixture);
  assert.equal(after.worktreeExists, false);
  assert.equal(after.branch, false);
  assert.equal(after.session, null);
  assert.equal(after.lock, true);
});

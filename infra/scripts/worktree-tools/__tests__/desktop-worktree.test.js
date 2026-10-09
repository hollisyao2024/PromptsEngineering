'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  adoptDesktopWorktree,
  createOrResumeWorktree,
  detectDesktopAdoption,
  readSessions,
  slugify,
  safeRemoveTreeNoFollow,
  writeSession,
  MANAGED_MARKER,
} = require('../worktree-core');
const {
  DESKTOP_ORIGIN,
  resolveDesktopWorktreesRoot,
  resolveSessionRemovalRoot,
} = require('../desktop-worktree');
const { markCleanupPending, reconcilePendingCleanups } = require('../deferred-cleanup-state');
const { auditManagedWorktrees } = require('../worktree-audit');

const realTemporaryRoot = fs.realpathSync(os.tmpdir());
const worktreeNewScript = path.resolve(__dirname, '..', 'worktree-new.js');

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`,
  );
  return result.stdout.trim();
}

function commitFile(cwd, name, content, message) {
  fs.writeFileSync(path.join(cwd, name), content);
  runGit(cwd, ['add', name]);
  runGit(cwd, ['commit', '-m', message]);
  return runGit(cwd, ['rev-parse', 'HEAD']);
}

function initDesktopFixture(t) {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'desktop-worktree-'));
  const repo = path.join(container, 'repo');
  const remote = path.join(container, 'origin.git');
  fs.mkdirSync(repo);
  runGit(container, ['init', '--bare', remote]);
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, '.gitignore'), '.claude/worktrees/\n');
  fs.writeFileSync(path.join(repo, 'agent.config.json'), JSON.stringify({
    baseBranch: 'main',
    containerDirs: { worktrees: '../worktrees', tmp: '../tmp' },
    worktree: {
      envSymlinks: [],
      sharedConfigSymlinks: [],
      sessionDir: '../tmp/sessions',
      lockDir: '../tmp/locks',
      bootstrap: { mode: 'skip' },
    },
  }, null, 2));
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', 'init']);
  runGit(repo, ['remote', 'add', 'origin', remote]);
  runGit(repo, ['push', '-u', 'origin', 'main']);
  runGit(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  const config = JSON.parse(fs.readFileSync(path.join(repo, 'agent.config.json'), 'utf8'));
  t.after(() => {
    process.chdir(realTemporaryRoot);
    if (fs.existsSync(container)) safeRemoveTreeNoFollow(container, { allowedRoot: realTemporaryRoot });
  });
  return { container, repo, remote, config };
}

function advanceRemoteMain(fixture, name = 'REMOTE.md') {
  const publisher = path.join(fixture.container, `publisher-${name.replace(/[^a-z0-9]+/giu, '-')}`);
  runGit(fixture.container, ['clone', fixture.remote, publisher]);
  runGit(publisher, ['config', 'user.email', 'publisher@example.com']);
  runGit(publisher, ['config', 'user.name', 'Publisher']);
  const head = commitFile(publisher, name, `${name}\n`, `advance ${name}`);
  runGit(publisher, ['push', 'origin', 'main']);
  return head;
}

// Mirrors Claude Desktop: a linked worktree under <main>/.claude/worktrees on
// claude/<name>, cut from the (possibly stale) local main HEAD.
function addDesktopWorktree(fixture, name = 'brave-otter') {
  const root = path.join(fixture.repo, '.claude', 'worktrees');
  fs.mkdirSync(root, { recursive: true });
  const worktreePath = path.join(root, name);
  runGit(fixture.repo, ['worktree', 'add', '-b', `claude/${name}`, worktreePath, 'main']);
  return { worktreePath, branch: `claude/${name}` };
}

function sessionFor(fixture, branch) {
  return readSessions(fixture.config, fixture.repo).find((session) => session.branch === branch) || null;
}

function adopt(cwd, cli = {}) {
  return createOrResumeWorktree({ cwd, cli: { phase: 'tdd', task: 'TASK-ADOPT-001', ...cli } });
}

test('adopts a pristine Desktop worktree in place at the verified remote base', (t) => {
  const fixture = initDesktopFixture(t);
  const desktop = addDesktopWorktree(fixture);
  const staleHead = runGit(desktop.worktreePath, ['rev-parse', 'HEAD']);
  const remoteHead = advanceRemoteMain(fixture);

  const result = adopt(desktop.worktreePath);

  assert.equal(result.adopted, true);
  assert.equal(result.branch, 'feature/TASK-ADOPT-001');
  assert.equal(result.originalBranch, desktop.branch);
  assert.equal(result.adoptionReset, true);
  assert.equal(result.previousHead, staleHead);
  assert.equal(fs.realpathSync(result.worktreePath), fs.realpathSync(desktop.worktreePath));
  assert.equal(result.fetchStatus, 'OK');
  assert.equal(result.baseFreshness, 'VERIFIED');
  assert.equal(result.baseCommit, remoteHead);
  assert.equal(runGit(desktop.worktreePath, ['rev-parse', 'HEAD']), remoteHead);
  assert.equal(runGit(desktop.worktreePath, ['branch', '--show-current']), 'feature/TASK-ADOPT-001');
  assert.equal(runGit(fixture.repo, ['branch', '--list', desktop.branch]), '');
  assert.equal(fs.existsSync(path.join(fixture.container, 'worktrees')), false, 'no nested or container worktree is created');

  const session = sessionFor(fixture, 'feature/TASK-ADOPT-001');
  assert.equal(session.status, 'in_progress');
  assert.equal(session.step, 'adopted');
  assert.equal(session.provenance.origin, DESKTOP_ORIGIN);
  assert.equal(session.provenance.original_branch, desktop.branch);
  assert.equal(session.provenance.worktree, session.worktree);
  assert.ok(session.lifecycle.keys.includes('task:task-adopt-001'));
  const marker = JSON.parse(fs.readFileSync(path.join(desktop.worktreePath, MANAGED_MARKER), 'utf8'));
  assert.equal(marker.branch, 'feature/TASK-ADOPT-001');
  assert.equal(runGit(desktop.worktreePath, ['status', '--porcelain']), '');
});

test('adoption keeps own commits that already sit on the verified remote base', (t) => {
  const fixture = initDesktopFixture(t);
  const desktop = addDesktopWorktree(fixture);
  const ownHead = commitFile(desktop.worktreePath, 'work.txt', 'work\n', 'desktop work');

  const result = adopt(desktop.worktreePath);

  assert.equal(result.adopted, true);
  assert.equal(result.adoptionReset, false);
  assert.equal(runGit(desktop.worktreePath, ['rev-parse', 'HEAD']), ownHead);
  assert.equal(sessionFor(fixture, 'feature/TASK-ADOPT-001').head, ownHead);
});

test('adoption blocks when own commits are behind the remote base and never rebases', (t) => {
  const fixture = initDesktopFixture(t);
  const desktop = addDesktopWorktree(fixture);
  const ownHead = commitFile(desktop.worktreePath, 'work.txt', 'work\n', 'desktop work');
  advanceRemoteMain(fixture);

  assert.throws(() => adopt(desktop.worktreePath), (error) => {
    assert.match(error.message, /behind origin\/main/u);
    assert.match(error.nextManualAction, /rebase|merge/iu);
    assert.equal(error.originalBranch, desktop.branch);
    return true;
  });
  assert.equal(runGit(desktop.worktreePath, ['rev-parse', 'HEAD']), ownHead);
  assert.equal(runGit(desktop.worktreePath, ['branch', '--show-current']), desktop.branch);
  assert.equal(readSessions(fixture.config, fixture.repo).length, 0);
  assert.equal(fs.existsSync(path.join(desktop.worktreePath, MANAGED_MARKER)), false);
});

test('adoption blocks on a dirty Desktop worktree before fetching or renaming', (t) => {
  const fixture = initDesktopFixture(t);
  const desktop = addDesktopWorktree(fixture);
  fs.writeFileSync(path.join(desktop.worktreePath, 'scratch.txt'), 'unsaved\n');

  assert.throws(() => adopt(desktop.worktreePath), (error) => {
    assert.match(error.message, /uncommitted changes/u);
    assert.match(error.dirtyFiles, /scratch\.txt/u);
    return true;
  });
  assert.equal(runGit(desktop.worktreePath, ['branch', '--show-current']), desktop.branch);
  assert.equal(fs.existsSync(path.join(fixture.repo, '.git', 'FETCH_HEAD')), false);
  assert.equal(readSessions(fixture.config, fixture.repo).length, 0);
});

test('adoption is idempotent once the Desktop worktree is managed', (t) => {
  const fixture = initDesktopFixture(t);
  const desktop = addDesktopWorktree(fixture);
  const first = adopt(desktop.worktreePath);

  const second = adopt(desktop.worktreePath);

  assert.equal(second.adopted, undefined);
  assert.equal(second.resumed, true);
  assert.equal(second.branch, first.branch);
  assert.equal(fs.realpathSync(second.worktreePath), fs.realpathSync(desktop.worktreePath));
  const session = sessionFor(fixture, first.branch);
  assert.equal(session.provenance.origin, DESKTOP_ORIGIN);
  assert.equal(session.provenance.original_branch, desktop.branch);
  assert.equal(readSessions(fixture.config, fixture.repo).length, 1);
});

test('a stale concurrent adoption is rejected under the lock without renaming the adopted branch', (t) => {
  const fixture = initDesktopFixture(t);
  const desktop = addDesktopWorktree(fixture);
  const staleEntry = detectDesktopAdoption(fixture.config, fixture.repo, desktop.worktreePath);
  assert.equal(staleEntry.branch, desktop.branch);
  const first = adopt(desktop.worktreePath);

  assert.throws(() => adoptDesktopWorktree({
    cli: { phase: 'tdd', task: 'TASK-ADOPT-002' },
    branch: 'feature/TASK-ADOPT-002',
    cwd: desktop.worktreePath,
    mainRoot: fixture.repo,
    config: fixture.config,
    entry: staleEntry,
    options: {},
  }), /adopted or switched branches during adoption/u);

  assert.equal(runGit(desktop.worktreePath, ['branch', '--show-current']), first.branch);
  assert.equal(runGit(fixture.repo, ['branch', '--list', 'feature/TASK-ADOPT-002']), '');
  assert.equal(readSessions(fixture.config, fixture.repo).length, 1);
});

test('a failure before the session is persisted rolls back the reset and rename', (t) => {
  const fixture = initDesktopFixture(t);
  const desktop = addDesktopWorktree(fixture);
  const staleHead = runGit(desktop.worktreePath, ['rev-parse', 'HEAD']);
  advanceRemoteMain(fixture);
  // A directory at the session file path makes the atomic session write fail.
  const blocked = path.join(fixture.container, 'tmp', 'sessions', `${slugify('feature/TASK-ADOPT-001')}.json`);
  fs.mkdirSync(path.join(blocked, 'occupied'), { recursive: true });

  assert.throws(() => adopt(desktop.worktreePath), (error) => {
    assert.match(error.adoptionRollback, /branch restored to claude\/brave-otter/u);
    assert.match(error.adoptionRollback, new RegExp(`HEAD restored to ${staleHead}`, 'u'));
    return true;
  });
  assert.equal(runGit(desktop.worktreePath, ['branch', '--show-current']), desktop.branch);
  assert.equal(runGit(desktop.worktreePath, ['rev-parse', 'HEAD']), staleHead);
  assert.equal(fs.existsSync(path.join(desktop.worktreePath, MANAGED_MARKER)), false);
  assert.equal(runGit(desktop.worktreePath, ['status', '--porcelain']), '');
});

test('dry-run adoption reports the plan without touching Git or sessions', (t) => {
  const fixture = initDesktopFixture(t);
  const desktop = addDesktopWorktree(fixture);

  const result = adopt(desktop.worktreePath, { dryRun: true });

  assert.equal(result.dryRun, true);
  assert.equal(result.adopted, true);
  assert.equal(result.originalBranch, desktop.branch);
  assert.equal(result.branch, 'feature/TASK-ADOPT-001');
  assert.equal(runGit(desktop.worktreePath, ['branch', '--show-current']), desktop.branch);
  assert.equal(fs.existsSync(path.join(fixture.repo, '.git', 'FETCH_HEAD')), false);
  assert.equal(readSessions(fixture.config, fixture.repo).length, 0);
});

test('worktree new CLI reports in-place Desktop adoption evidence', (t) => {
  const fixture = initDesktopFixture(t);
  const desktop = addDesktopWorktree(fixture);

  const result = spawnSync(process.execPath, [worktreeNewScript, '--phase', 'tdd', '--task', 'TASK-ADOPT-001'], {
    cwd: desktop.worktreePath,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^STATUS=ADOPTED$/mu);
  assert.match(result.stdout, /^WORKTREE_ORIGIN=claude-desktop$/mu);
  assert.match(result.stdout, /^ORIGINAL_BRANCH=claude\/brave-otter$/mu);
  assert.match(result.stdout, /^BRANCH_NAME=feature\/TASK-ADOPT-001$/mu);
  assert.match(result.stdout, /^ADOPTION_RESET=false$/mu);
  assert.match(result.stdout, /^BASE_FRESHNESS=VERIFIED$/mu);
});

test('post-merge lifecycle removes an adopted Desktop worktree, branch, and session', (t) => {
  const fixture = initDesktopFixture(t);
  const desktop = addDesktopWorktree(fixture);
  const adopted = adopt(desktop.worktreePath);
  const head = commitFile(desktop.worktreePath, 'feature.txt', 'feature\n', 'feature');
  runGit(fixture.repo, ['merge', '--ff-only', adopted.branch]);

  markCleanupPending({
    config: fixture.config,
    mainRoot: fixture.repo,
    branch: adopted.branch,
    worktreePath: adopted.worktreePath,
    expectedHead: head,
  });
  const result = reconcilePendingCleanups({ mainRoot: fixture.repo, config: fixture.config, branch: adopted.branch });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.completed, [adopted.branch]);
  assert.equal(fs.existsSync(desktop.worktreePath), false);
  assert.equal(runGit(fixture.repo, ['branch', '--list', adopted.branch]), '');
  assert.equal(sessionFor(fixture, adopted.branch), null);
  assert.doesNotMatch(runGit(fixture.repo, ['worktree', 'list', '--porcelain']), /brave-otter/u);
  assert.equal(fs.existsSync(path.join(fixture.repo, '.claude', 'worktrees')), true, 'the Desktop root itself is kept');
});

test('worktree audit leaves a never-adopted Desktop worktree untouched', (t) => {
  const fixture = initDesktopFixture(t);
  const desktop = addDesktopWorktree(fixture);
  runGit(fixture.repo, ['fetch', 'origin']);

  const audit = auditManagedWorktrees({
    mainRoot: fixture.repo,
    config: fixture.config,
    cwd: fixture.repo,
    apply: true,
    baseRef: 'refs/remotes/origin/main',
  });

  const record = audit.records.find((item) => item.branch === desktop.branch);
  assert.equal(record.state, 'ignored');
  assert.equal(record.reason, 'unmanaged-worktree');
  assert.equal(fs.existsSync(desktop.worktreePath), true);
  assert.match(runGit(fixture.repo, ['branch', '--list', desktop.branch]), /claude\/brave-otter/u);
});

test('cleanup refuses a Desktop path whose session lacks matching provenance', (t) => {
  const fixture = initDesktopFixture(t);
  const forged = addDesktopWorktree(fixture, 'forged-seal');
  const mismatched = addDesktopWorktree(fixture, 'mismatched-seal');
  for (const target of [forged, mismatched]) {
    const head = runGit(target.worktreePath, ['rev-parse', 'HEAD']);
    writeSession(fixture.config, fixture.repo, {
      branch: target.branch,
      worktree: target.worktreePath,
      status: 'in_progress',
      ...(target === mismatched
        ? { provenance: { origin: DESKTOP_ORIGIN, original_branch: target.branch, worktree: forged.worktreePath } }
        : {}),
    });
    markCleanupPending({
      config: fixture.config,
      mainRoot: fixture.repo,
      branch: target.branch,
      worktreePath: target.worktreePath,
      expectedHead: head,
    });
  }

  const result = reconcilePendingCleanups({ mainRoot: fixture.repo, config: fixture.config });

  assert.deepEqual(result.completed, []);
  assert.deepEqual(result.pending.sort(), [forged.branch, mismatched.branch].sort());
  assert.equal(fs.existsSync(forged.worktreePath), true);
  assert.equal(fs.existsSync(mismatched.worktreePath), true);
});

test('removal root resolution is fail-closed for paths outside an exact Desktop child', (t) => {
  const fixture = initDesktopFixture(t);
  const desktop = addDesktopWorktree(fixture);
  const containerRoot = path.join(fixture.container, 'worktrees');
  const desktopRoot = resolveDesktopWorktreesRoot(fixture.repo);
  const provenance = (worktree) => ({ origin: DESKTOP_ORIGIN, original_branch: 'claude/x', worktree });

  assert.equal(fs.realpathSync(desktopRoot), fs.realpathSync(path.join(fixture.repo, '.claude', 'worktrees')));
  assert.equal(
    resolveSessionRemovalRoot(fixture.repo, containerRoot, { worktree: path.join(containerRoot, 'a') }),
    containerRoot,
  );
  assert.equal(
    fs.realpathSync(resolveSessionRemovalRoot(fixture.repo, containerRoot, {
      worktree: desktop.worktreePath,
      provenance: provenance(desktop.worktreePath),
    })),
    fs.realpathSync(desktopRoot),
  );
  assert.equal(resolveSessionRemovalRoot(fixture.repo, containerRoot, { worktree: desktop.worktreePath }), '');
  const nested = path.join(desktop.worktreePath, 'nested');
  assert.equal(resolveSessionRemovalRoot(fixture.repo, containerRoot, {
    worktree: nested,
    provenance: provenance(nested),
  }), '');
  assert.equal(resolveSessionRemovalRoot(fixture.repo, containerRoot, {
    worktree: fixture.repo,
    provenance: provenance(fixture.repo),
  }), '');
});

test('a symlinked .claude directory disables Desktop removal roots', (t) => {
  const fixture = initDesktopFixture(t);
  const elsewhere = path.join(fixture.container, 'elsewhere');
  fs.mkdirSync(path.join(elsewhere, 'worktrees'), { recursive: true });
  fs.symlinkSync(elsewhere, path.join(fixture.repo, '.claude'));
  const target = path.join(fixture.repo, '.claude', 'worktrees', 'escape');

  assert.equal(resolveDesktopWorktreesRoot(fixture.repo), '');
  assert.equal(resolveSessionRemovalRoot(fixture.repo, path.join(fixture.container, 'worktrees'), {
    worktree: target,
    provenance: { origin: DESKTOP_ORIGIN, original_branch: 'claude/x', worktree: target },
  }), '');
});

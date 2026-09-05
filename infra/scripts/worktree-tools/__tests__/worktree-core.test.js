'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  acquireLock,
  assertNoConflictingRecovery,
  createOrResumeWorktree,
  isPathInside,
  materializeReusablePaths,
  planSupersededSessions,
  readSessions,
  recoverSessionAsBranch,
  removeWorktreeSafely,
  reclaimMergedManagedWorktrees,
  runWorktreeBootstrap,
  safeRemoveTreeNoFollow,
  setupSharedLinks,
  writeManagedMarker,
  writeSession,
  MANAGED_MARKER,
} = require('../worktree-core');
const { retryWritable: retryRemoveOperation } = require('../worktree-safe-remove');

const realTemporaryRoot = fs.realpathSync(os.tmpdir());
const worktreeNewScript = path.resolve(__dirname, '..', 'worktree-new.js');
const tddNewWorktreeScript = path.resolve(__dirname, '..', '..', 'tdd-tools', 'tdd-new-worktree.js');
const agentRunScript = path.resolve(__dirname, '..', '..', 'agent-runner', 'agent-run.js');

test('safe removal retries transient non-empty directories without weakening permission handling', () => {
  let attempts = 0;
  retryRemoveOperation('/unused', () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error('directory changed during traversal');
      error.code = 'ENOTEMPTY';
      throw error;
    }
  });
  assert.equal(attempts, 3);
});

test('session writes add and renew versioned ownership without rotating the diagnostic token', (t) => {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-session-v2-'));
  const mainRoot = path.join(container, 'repo');
  const config = {
    worktree: {
      sessionDir: '../tmp/sessions',
      lockDir: '../tmp/locks',
      leaseTtlMinutes: 60,
    },
  };
  fs.mkdirSync(mainRoot, { recursive: true });
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: realTemporaryRoot }));

  writeSession(config, mainRoot, {
    branch: 'feature/TASK-DEMO-001',
    worktree: path.join(container, 'worktrees', 'demo'),
    status: 'in_progress',
    lifecycle: { keys: ['task:demo', 'topic:demo'] },
    head: 'abc123',
  });
  const first = readSessions(config, mainRoot)[0];
  writeSession(config, mainRoot, {
    branch: first.branch,
    worktree: first.worktree,
    status: 'in_progress',
    step: 'renewed',
  });
  const second = readSessions(config, mainRoot)[0];

  assert.equal(first.schema_version, 2);
  assert.equal(first.revision, 1);
  assert.equal(typeof first.owner.token, 'string');
  assert.ok(Date.parse(first.lease.expires_at) > Date.parse(first.updated_at));
  assert.equal(second.revision, 2);
  assert.equal(second.owner.token, first.owner.token);
  assert.ok(Date.parse(second.lease.expires_at) >= Date.parse(first.lease.expires_at));
});

test('a recovery-required lifecycle blocks a duplicate branch for the same task', () => {
  assert.throws(() => assertNoConflictingRecovery({}, '/container/repo', {
    phase: 'tdd',
    task: 'TASK-DEMO-001',
    desc: 'demo',
  }, 'feature/TASK-DEMO-001-demo', {
    readSessions: () => [{
      branch: 'docs/prd-demo',
      worktree: '/container/worktrees/prd-demo',
      status: 'recovery_required',
      lifecycle: { keys: ['task:task-demo-001', 'topic:demo'] },
    }],
  }), /recovery_required worktree conflicts/);
});

test('legacy reclaimer is observe-only even for a clean merged managed worktree', (t) => {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-reclaim-'));
  const repo = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  const worktreePath = path.join(worktreesRoot, 'merged');
  fs.mkdirSync(repo, { recursive: true });
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# test\n');
  runGit(repo, ['add', 'README.md']);
  runGit(repo, ['commit', '-m', 'init']);
  fs.mkdirSync(worktreesRoot, { recursive: true });
  runGit(repo, ['worktree', 'add', '-b', 'fix/merged-cleanup', worktreePath]);
  writeManagedMarker(repo, worktreePath, 'fix/merged-cleanup');
  fs.writeFileSync(path.join(worktreePath, 'done.txt'), 'done\n');
  runGit(worktreePath, ['add', 'done.txt']);
  runGit(worktreePath, ['commit', '-m', 'done']);
  runGit(repo, ['merge', '--ff-only', 'fix/merged-cleanup']);
  t.after(() => {
    process.chdir(realTemporaryRoot);
    if (fs.existsSync(container)) safeRemoveTreeNoFollow(container, { allowedRoot: realTemporaryRoot });
  });

  const result = reclaimMergedManagedWorktrees({
    mainRoot: repo,
    config: { baseBranch: 'main' },
    worktreesRoot,
    baseRef: 'main',
  });

  assert.deepEqual(result.removed, []);
  assert.equal(fs.existsSync(worktreePath), true);
  assert.match(runGit(repo, ['branch', '--list', 'fix/merged-cleanup']), /fix\/merged-cleanup/);
  assert.match(result.retained[0].reason, /legacy-reclaimer-disabled/);
});

test('retains a freshly created worktree while its session is in progress', (t) => {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-active-session-'));
  const repo = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  const worktreePath = path.join(worktreesRoot, 'active');
  const config = {
    baseBranch: 'main',
    containerDirs: { tmp: path.join(container, 'tmp') },
    worktree: { sessionDir: path.join(container, 'tmp', 'sessions') },
  };
  fs.mkdirSync(repo, { recursive: true });
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# test\n');
  runGit(repo, ['add', 'README.md']);
  runGit(repo, ['commit', '-m', 'init']);
  fs.mkdirSync(worktreesRoot, { recursive: true });
  runGit(repo, ['worktree', 'add', '-b', 'fix/active-session', worktreePath]);
  writeManagedMarker(repo, worktreePath, 'fix/active-session');
  writeSession(config, repo, {
    phase: 'tdd',
    branch: 'fix/active-session',
    worktree: worktreePath,
    status: 'in_progress',
    step: 'created',
  });
  t.after(() => {
    process.chdir(realTemporaryRoot);
    if (fs.existsSync(container)) safeRemoveTreeNoFollow(container, { allowedRoot: realTemporaryRoot });
  });

  const result = reclaimMergedManagedWorktrees({
    mainRoot: repo,
    config,
    worktreesRoot,
    baseRef: 'main',
  });

  assert.deepEqual(result.removed, []);
  assert.equal(fs.existsSync(worktreePath), true);
  assert.equal(result.retained.length, 1);
  assert.equal(result.retained[0].branch, 'fix/active-session');
  assert.match(result.retained[0].reason, /legacy-reclaimer-disabled:active/);
  assert.equal(path.resolve(result.retained[0].path), path.resolve(worktreePath));
});

test('retains a dirty owned worktree even when its branch is merged', (t) => {
  const fixture = initLinkedWorktreeFixture();
  writeManagedMarker(fixture.repo, fixture.worktreePath, 'fix/junction-case');
  fs.writeFileSync(path.join(fixture.worktreePath, 'uncommitted.txt'), 'keep\n');
  t.after(() => {
    process.chdir(realTemporaryRoot);
    spawnSync('git', ['worktree', 'prune', '--expire', 'now'], { cwd: fixture.repo, stdio: 'pipe' });
    safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot });
  });

  const result = reclaimMergedManagedWorktrees({
    mainRoot: fixture.repo,
    config: { baseBranch: 'main' },
    worktreesRoot: fixture.worktreesRoot,
    baseRef: 'main',
  });

  assert.deepEqual(result.removed, []);
  assert.equal(fs.existsSync(fixture.worktreePath), true);
  assert.match(result.retained[0].reason, /legacy-reclaimer-disabled:recovery_required/);
});

test('safe removal rescans a directory when a late file makes the final rmdir non-empty', (t) => {
  const tempRoot = realTemporaryRoot;
  const root = fs.mkdtempSync(path.join(tempRoot, 'worktree-late-child-'));
  const originalRmdirSync = fs.rmdirSync;
  let injected = false;
  t.after(() => {
    fs.rmdirSync = originalRmdirSync;
    if (fs.existsSync(root)) safeRemoveTreeNoFollow(root, { allowedRoot: tempRoot });
  });

  fs.rmdirSync = (targetPath, ...args) => {
    if (!injected && path.resolve(targetPath) === path.resolve(root)) {
      injected = true;
      fs.writeFileSync(path.join(root, 'late-child.txt'), 'late write\n');
    }
    return originalRmdirSync(targetPath, ...args);
  };

  safeRemoveTreeNoFollow(root, { allowedRoot: tempRoot });

  assert.equal(injected, true);
  assert.equal(fs.existsSync(root), false);
});

test('managed worktree marker records ownership and stays excluded from Git status', (t) => {
  const tempRoot = realTemporaryRoot;
  const container = fs.mkdtempSync(path.join(tempRoot, 'worktree-managed-marker-'));
  const mainRoot = path.join(container, 'repo');
  const worktreePath = path.join(container, 'worktree');
  fs.mkdirSync(path.join(mainRoot, '.git', 'info'), { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: tempRoot }));

  writeManagedMarker(mainRoot, worktreePath, 'fix/managed-marker');

  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(worktreePath, MANAGED_MARKER), 'utf8')), {
    version: 1,
    mainRoot: path.resolve(mainRoot),
    branch: 'fix/managed-marker',
  });
  assert.match(fs.readFileSync(path.join(mainRoot, '.git', 'info', 'exclude'), 'utf8'), /\/.agent-worktree\.json/);
});

test('reusable generated resources are copied from main without creating links', (t) => {
  const root = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-reuse-runtime-'));
  const mainRoot = path.join(root, 'repo');
  const worktreePath = path.join(root, 'worktree');
  const relativePath = 'apps/desktop/resources/kb-model-runtime';
  fs.mkdirSync(path.join(mainRoot, relativePath), { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.writeFileSync(path.join(mainRoot, relativePath, 'runtime.js'), 'ready\n');
  t.after(() => safeRemoveTreeNoFollow(root, { allowedRoot: realTemporaryRoot }));

  const result = materializeReusablePaths({
    mainRoot,
    worktreePath,
    entries: [relativePath],
  });

  const copied = path.join(worktreePath, relativePath, 'runtime.js');
  assert.deepEqual(result.reusedPaths, [relativePath]);
  assert.equal(fs.readFileSync(copied, 'utf8'), 'ready\n');
  assert.equal(fs.lstatSync(path.dirname(copied)).isSymbolicLink(), false);
});

test('reusable generated resources dereference links that stay inside main', (t) => {
  const root = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-reuse-link-'));
  const mainRoot = path.join(root, 'repo');
  const worktreePath = path.join(root, 'worktree');
  const relativePath = 'generated/runtime';
  const packageStore = path.join(mainRoot, relativePath, '.store', 'runtime-package');
  const packageLink = path.join(mainRoot, relativePath, 'node_modules', 'runtime-package');
  fs.mkdirSync(packageStore, { recursive: true });
  fs.mkdirSync(path.dirname(packageLink), { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.writeFileSync(path.join(packageStore, 'index.js'), 'runtime\n');
  fs.symlinkSync(packageStore, packageLink, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => safeRemoveTreeNoFollow(root, { allowedRoot: realTemporaryRoot }));

  const result = materializeReusablePaths({ mainRoot, worktreePath, entries: [relativePath] });
  const copiedPackage = path.join(worktreePath, relativePath, 'node_modules', 'runtime-package');

  assert.deepEqual(result.reusedPaths, [relativePath]);
  assert.equal(fs.readFileSync(path.join(copiedPackage, 'index.js'), 'utf8'), 'runtime\n');
  assert.equal(fs.lstatSync(copiedPackage).isSymbolicLink(), false);
});

test('reusable generated resources reject links that escape main', (t) => {
  const root = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-reuse-escape-'));
  const mainRoot = path.join(root, 'repo');
  const worktreePath = path.join(root, 'worktree');
  const outside = path.join(root, 'outside');
  const relativePath = 'generated/runtime';
  const sourcePath = path.join(mainRoot, relativePath);
  fs.mkdirSync(sourcePath, { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.symlinkSync(outside, path.join(sourcePath, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => safeRemoveTreeNoFollow(root, { allowedRoot: realTemporaryRoot }));

  assert.throws(
    () => materializeReusablePaths({ mainRoot, worktreePath, entries: [relativePath] }),
    /link escapes the main repo/i,
  );
});

test('reusable generated resources reject dependency and escaping paths', () => {
  assert.throws(
    () => materializeReusablePaths({ mainRoot: 'C:/repo', worktreePath: 'C:/worktree', entries: ['node_modules'] }),
    /forbidden.*node_modules/i,
  );
  assert.throws(
    () => materializeReusablePaths({ mainRoot: 'C:/repo', worktreePath: 'C:/worktree', entries: ['../outside'] }),
    /relative.*inside/i,
  );
});

function runGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`
  );
  return result.stdout.trim();
}

function initRepo() {
  const repo = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-core-dry-run-'));
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# test\n');
  runGit(repo, ['add', 'README.md']);
  runGit(repo, ['commit', '-m', 'init']);
  return repo;
}

function initRemoteWorktreeFixture() {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-base-sync-'));
  const repo = path.join(container, 'repo');
  const remote = path.join(container, 'origin.git');
  fs.mkdirSync(repo);
  runGit(container, ['init', '--bare', remote]);
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# base sync test\n');
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
  return { container, repo, remote };
}

function advanceRemoteMain(fixture) {
  const publisher = path.join(fixture.container, 'publisher');
  runGit(fixture.container, ['clone', fixture.remote, publisher]);
  runGit(publisher, ['config', 'user.email', 'publisher@example.com']);
  runGit(publisher, ['config', 'user.name', 'Publisher']);
  fs.writeFileSync(path.join(publisher, 'REMOTE.md'), 'new remote commit\n');
  runGit(publisher, ['add', 'REMOTE.md']);
  runGit(publisher, ['commit', '-m', 'advance remote']);
  runGit(publisher, ['push', 'origin', 'main']);
  return runGit(publisher, ['rev-parse', 'HEAD']);
}

function publishRemoteBranch(fixture, branch) {
  const publisher = path.join(
    fixture.container,
    `publisher-${branch.replace(/[^a-z0-9]+/giu, '-')}`,
  );
  runGit(fixture.container, ['clone', fixture.remote, publisher]);
  runGit(publisher, ['config', 'user.email', 'publisher@example.com']);
  runGit(publisher, ['config', 'user.name', 'Publisher']);
  runGit(publisher, ['switch', '-c', branch]);
  fs.writeFileSync(path.join(publisher, 'REMOTE-BRANCH.md'), `${branch}\n`);
  runGit(publisher, ['add', 'REMOTE-BRANCH.md']);
  runGit(publisher, ['commit', '-m', `publish ${branch}`]);
  runGit(publisher, ['push', '-u', 'origin', branch]);
  return runGit(publisher, ['rev-parse', 'HEAD']);
}

function runNodeScript(repo, script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repo,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function assertNoGeneratedTddWorktree(repo) {
  assert.equal(runGit(repo, ['branch', '--list', 'feature/tdd']), '');
  assert.doesNotMatch(runGit(repo, ['worktree', 'list', '--porcelain']), /tdd-tdd|feature\/tdd/u);
  assert.equal(fs.existsSync(path.join(repo, '.git', 'FETCH_HEAD')), false);
}

test('worktree creation help is side-effect free across direct, TDD, and agent-runner entrypoints', (t) => {
  const repo = initRepo();
  t.after(() => safeRemoveTreeNoFollow(repo, { allowedRoot: realTemporaryRoot }));

  const commands = [
    [worktreeNewScript, ['--help']],
    [worktreeNewScript, ['-h']],
    [tddNewWorktreeScript, ['--help']],
    [agentRunScript, ['--help']],
  ];

  for (const [script, args] of commands) {
    const result = runNodeScript(repo, script, args);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Usage:/u);
    assertNoGeneratedTddWorktree(repo);
  }
});

test('worktree creation rejects missing identity before Git or filesystem mutation', (t) => {
  const repo = initRepo();
  t.after(() => safeRemoveTreeNoFollow(repo, { allowedRoot: realTemporaryRoot }));

  const commands = [
    [worktreeNewScript, []],
    [worktreeNewScript, ['--phase=tdd']],
    [worktreeNewScript, ['--phase', 'tdd', '--desc']],
    [tddNewWorktreeScript, []],
    [agentRunScript, ['--mode=change', '--phase=tdd']],
  ];

  for (const [script, args] of commands) {
    const result = runNodeScript(repo, script, args);
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /STATUS=BLOCKED/u);
    assert.match(result.stderr, /identity is required|requires a non-empty value/u);
    assert.match(result.stderr, /NEXT_MANUAL_ACTION=/u);
    assertNoGeneratedTddWorktree(repo);
  }
});

test('worktree creation still accepts an explicit identity in dry-run mode', (t) => {
  const repo = initRepo();
  t.after(() => safeRemoveTreeNoFollow(repo, { allowedRoot: realTemporaryRoot }));

  const result = runNodeScript(repo, worktreeNewScript, [
    '--phase=tdd',
    '--kind=fix',
    '--desc=argument-safety',
    '--dry-run',
    '--skip-fetch',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /STATUS=DRY_RUN/u);
  assert.match(result.stdout, /BRANCH_NAME=fix\/argument-safety/u);
  assert.match(result.stdout, /FETCH_STATUS=NOT_RUN_DRY_RUN/u);
  assert.match(result.stdout, /BASE_FRESHNESS=UNVERIFIED/u);
  assertNoGeneratedTddWorktree(repo);
});

test('dry-run worktree creation does not fetch or create its requested worktree', (t) => {
  const repo = initRepo();
  t.after(() => safeRemoveTreeNoFollow(repo, { allowedRoot: realTemporaryRoot }));

  const result = createOrResumeWorktree({
    cwd: repo,
    cli: {
      dryRun: true,
      phase: 'tdd',
      kind: 'fix',
      desc: 'dry run should stay read only',
    },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.branch, 'fix/dry-run-should-stay-read-only');
  assert.equal(fs.existsSync(path.join(repo, '.git', 'FETCH_HEAD')), false);
  assert.equal(fs.existsSync(result.worktreePath), false);
});

test('default creation fetches the advanced remote base and records the exact created commit', (t) => {
  const fixture = initRemoteWorktreeFixture();
  const remoteHead = advanceRemoteMain(fixture);
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));

  const result = createOrResumeWorktree({
    cwd: fixture.repo,
    cli: { phase: 'tdd', kind: 'fix', desc: 'verified remote base' },
  });

  assert.equal(result.fetchStatus, 'OK');
  assert.equal(result.baseFreshness, 'VERIFIED');
  assert.equal(result.baseRef, 'refs/remotes/origin/main');
  assert.equal(result.baseCommit, remoteHead);
  assert.equal(runGit(result.worktreePath, ['rev-parse', 'HEAD']), remoteHead);
});

test('worktree new blocks when another computer already pushed the same branch', (t) => {
  const fixture = initRemoteWorktreeFixture();
  const branch = 'fix/cross-host-collision';
  const remoteHead = publishRemoteBranch(fixture, branch);
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));

  assert.throws(
    () => createOrResumeWorktree({
      cwd: fixture.repo,
      cli: { phase: 'tdd', branch },
    }),
    (error) => {
      assert.match(error.message, /remote branch origin\/fix\/cross-host-collision already exists/i);
      assert.equal(error.remoteBranch, `origin/${branch}`);
      assert.equal(error.remoteHead, remoteHead);
      assert.match(error.nextManualAction, /worktree resume/i);
      return true;
    },
  );

  assert.equal(runGit(fixture.repo, ['branch', '--list', branch]), '');
  assert.doesNotMatch(runGit(fixture.repo, ['worktree', 'list', '--porcelain']), /cross-host-collision/u);
});

test('explicit remote resume creates a local worktree at the exact origin branch SHA', (t) => {
  const fixture = initRemoteWorktreeFixture();
  const branch = 'fix/cross-host-resume';
  const remoteHead = publishRemoteBranch(fixture, branch);
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));

  const result = createOrResumeWorktree({
    cwd: fixture.repo,
    cli: { phase: 'tdd', branch, resumeRemote: true },
  });

  assert.equal(result.resumed, true);
  assert.equal(result.resumedRemote, true);
  assert.equal(result.remoteBranch, `origin/${branch}`);
  assert.equal(result.remoteHead, remoteHead);
  assert.equal(runGit(result.worktreePath, ['rev-parse', 'HEAD']), remoteHead);
  assert.equal(runGit(result.worktreePath, ['rev-parse', `refs/remotes/origin/${branch}`]), remoteHead);
  assert.equal(runGit(result.worktreePath, ['rev-parse', '@{upstream}']), remoteHead);
  assert.equal(readSessions(result.config, fixture.repo).some((session) => (
    session.branch === branch && path.resolve(session.worktree) === path.resolve(result.worktreePath)
  )), true);
});

test('default creation blocks on fetch failure before branch worktree or session creation', (t) => {
  const fixture = initRemoteWorktreeFixture();
  const missingRemote = path.join(fixture.container, 'missing-origin.git');
  runGit(fixture.repo, ['remote', 'set-url', 'origin', missingRemote]);
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));

  assert.throws(
    () => createOrResumeWorktree({
      cwd: fixture.repo,
      cli: { phase: 'tdd', kind: 'fix', desc: 'required fetch failure' },
    }),
    /fetch.*origin.*failed/i,
  );

  assert.equal(runGit(fixture.repo, ['branch', '--list', 'fix/required-fetch-failure']), '');
  assert.doesNotMatch(
    runGit(fixture.repo, ['worktree', 'list', '--porcelain']),
    /required-fetch-failure/u,
  );
  assert.equal(fs.existsSync(path.join(fixture.container, 'tmp', 'sessions')), false);
});

test('default creation blocks when fetch succeeds but the configured remote base is missing', (t) => {
  const fixture = initRemoteWorktreeFixture();
  runGit(fixture.remote, ['update-ref', '-d', 'refs/heads/main']);
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));

  assert.throws(
    () => createOrResumeWorktree({
      cwd: fixture.repo,
      cli: { phase: 'tdd', kind: 'fix', desc: 'missing remote base' },
    }),
    /remote base origin\/main is unavailable after fetch/i,
  );

  assert.equal(runGit(fixture.repo, ['branch', '--list', 'fix/missing-remote-base']), '');
  assert.doesNotMatch(runGit(fixture.repo, ['worktree', 'list', '--porcelain']), /missing-remote-base/u);
  assert.equal(fs.existsSync(path.join(fixture.container, 'tmp', 'sessions')), false);
});

test('skip-fetch records an unverified cached base commit without contacting origin', (t) => {
  const fixture = initRemoteWorktreeFixture();
  const cachedHead = runGit(fixture.repo, ['rev-parse', 'refs/remotes/origin/main']);
  fs.rmSync(path.join(fixture.repo, '.git', 'FETCH_HEAD'), { force: true });
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));

  const result = createOrResumeWorktree({
    cwd: fixture.repo,
    cli: {
      'skip-fetch': true,
      phase: 'tdd',
      kind: 'fix',
      desc: 'cached base evidence',
    },
  });

  assert.equal(result.fetchStatus, 'SKIPPED');
  assert.equal(result.baseFreshness, 'UNVERIFIED');
  assert.equal(result.baseRef, 'refs/remotes/origin/main');
  assert.equal(result.baseCommit, cachedHead);
  assert.equal(runGit(result.worktreePath, ['rev-parse', 'HEAD']), cachedHead);
  assert.equal(fs.existsSync(path.join(fixture.repo, '.git', 'FETCH_HEAD')), false);
});

test('skip-fetch blocks instead of falling back to an unrelated HEAD', (t) => {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-no-base-'));
  const repo = path.join(container, 'repo');
  fs.mkdirSync(repo);
  runGit(repo, ['init', '-b', 'topic']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# unrelated topic\n');
  fs.writeFileSync(path.join(repo, 'agent.config.json'), JSON.stringify({
    baseBranch: 'main',
    containerDirs: { worktrees: '../worktrees', tmp: '../tmp' },
    worktree: {
      envSymlinks: [],
      sharedConfigSymlinks: [],
      sessionDir: '../tmp/sessions',
      bootstrap: { mode: 'skip' },
    },
  }, null, 2));
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', 'topic only']);
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: realTemporaryRoot }));

  assert.throws(
    () => createOrResumeWorktree({
      cwd: repo,
      cli: {
        'skip-fetch': true,
        phase: 'tdd',
        kind: 'fix',
        desc: 'reject unrelated head',
      },
    }),
    /no cached origin\/main or local main exists/i,
  );

  assert.equal(runGit(repo, ['branch', '--list', 'fix/reject-unrelated-head']), '');
  assert.doesNotMatch(runGit(repo, ['worktree', 'list', '--porcelain']), /reject-unrelated-head/u);
});

test('skip-fetch can use the configured local base when no cached remote base exists', (t) => {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-local-base-'));
  const repo = path.join(container, 'repo');
  fs.mkdirSync(repo);
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# local base\n');
  fs.writeFileSync(path.join(repo, 'agent.config.json'), JSON.stringify({
    baseBranch: 'main',
    containerDirs: { worktrees: '../worktrees', tmp: '../tmp' },
    worktree: {
      envSymlinks: [],
      sharedConfigSymlinks: [],
      sessionDir: '../tmp/sessions',
      bootstrap: { mode: 'skip' },
    },
  }, null, 2));
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', 'local base']);
  const localHead = runGit(repo, ['rev-parse', 'main']);
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: realTemporaryRoot }));

  const result = createOrResumeWorktree({
    cwd: repo,
    cli: {
      'skip-fetch': true,
      phase: 'tdd',
      kind: 'fix',
      desc: 'local base evidence',
    },
  });

  assert.equal(result.fetchStatus, 'SKIPPED');
  assert.equal(result.baseFreshness, 'UNVERIFIED');
  assert.equal(result.baseSource, 'local-base');
  assert.equal(result.baseRef, 'refs/heads/main');
  assert.equal(result.baseCommit, localHead);
  assert.equal(runGit(result.worktreePath, ['rev-parse', 'HEAD']), localHead);
});

test('worktree CLI reports verified base evidence and structured fetch failures', (t) => {
  const success = initRemoteWorktreeFixture();
  const remoteHead = advanceRemoteMain(success);
  const failed = initRemoteWorktreeFixture();
  runGit(failed.repo, ['remote', 'set-url', 'origin', path.join(failed.container, 'missing.git')]);
  t.after(() => safeRemoveTreeNoFollow(success.container, { allowedRoot: realTemporaryRoot }));
  t.after(() => safeRemoveTreeNoFollow(failed.container, { allowedRoot: realTemporaryRoot }));

  const successResult = runNodeScript(success.repo, worktreeNewScript, [
    '--phase=tdd',
    '--kind=fix',
    '--desc=cli-base-evidence',
  ]);
  assert.equal(successResult.status, 0, successResult.stderr || successResult.stdout);
  assert.match(successResult.stdout, /STATUS=CREATED/u);
  assert.match(successResult.stdout, /FETCH_STATUS=OK/u);
  assert.match(successResult.stdout, /BASE_REF=refs\/remotes\/origin\/main/u);
  assert.match(successResult.stdout, new RegExp(`BASE_COMMIT=${remoteHead}`, 'u'));
  assert.match(successResult.stdout, /BASE_FRESHNESS=VERIFIED/u);

  const failureResult = runNodeScript(failed.repo, worktreeNewScript, [
    '--phase=tdd',
    '--kind=fix',
    '--desc=cli-fetch-failure',
  ]);
  assert.equal(failureResult.status, 1, failureResult.stdout || failureResult.stderr);
  assert.match(failureResult.stderr, /STATUS=BLOCKED/u);
  assert.match(failureResult.stderr, /FETCH_STATUS=FAILED/u);
  assert.match(failureResult.stderr, /BASE_FRESHNESS=UNVERIFIED/u);
  assert.match(failureResult.stderr, /NEXT_MANUAL_ACTION=/u);
});

test('resuming an existing worktree does not fetch or change its head', (t) => {
  const fixture = initRemoteWorktreeFixture();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot }));
  const cli = {
    'skip-fetch': true,
    phase: 'tdd',
    kind: 'fix',
    desc: 'resume without network',
  };
  const created = createOrResumeWorktree({ cwd: fixture.repo, cli });
  const originalHead = runGit(created.worktreePath, ['rev-parse', 'HEAD']);
  runGit(fixture.repo, ['remote', 'set-url', 'origin', path.join(fixture.container, 'missing.git')]);
  fs.rmSync(path.join(fixture.repo, '.git', 'FETCH_HEAD'), { force: true });

  const resumed = createOrResumeWorktree({
    cwd: fixture.repo,
    cli: { phase: 'tdd', kind: 'fix', desc: 'resume without network' },
  });

  assert.equal(resumed.resumed, true);
  assert.equal(runGit(resumed.worktreePath, ['rev-parse', 'HEAD']), originalHead);
  assert.equal(fs.existsSync(path.join(fixture.repo, '.git', 'FETCH_HEAD')), false);
});

function initLinkedWorktreeFixture() {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-safe-remove-'));
  const repo = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  const worktreePath = path.join(worktreesRoot, 'junction-case');
  const externalTarget = path.join(container, 'external-target');

  fs.mkdirSync(repo, { recursive: true });
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(repo, 'README.md'), '# safe remove test\n');
  runGit(repo, ['add', '.gitignore', 'README.md']);
  runGit(repo, ['commit', '-m', 'init']);
  fs.mkdirSync(worktreesRoot, { recursive: true });
  runGit(repo, ['worktree', 'add', '-b', 'fix/junction-case', worktreePath]);

  fs.mkdirSync(externalTarget, { recursive: true });
  fs.writeFileSync(path.join(externalTarget, 'sentinel.txt'), 'DO NOT DELETE\n');

  return { container, repo, worktreesRoot, worktreePath, externalTarget };
}

test('safe worktree removal never follows an external node_modules junction', (t) => {
  const fixture = initLinkedWorktreeFixture();
  t.after(() => {
    process.chdir(realTemporaryRoot);
    safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot });
  });

  const linkPath = path.join(fixture.worktreePath, 'node_modules');
  fs.symlinkSync(
    path.resolve(fixture.externalTarget),
    linkPath,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.equal(fs.lstatSync(linkPath).isSymbolicLink(), true);

  process.chdir(fixture.worktreePath);
  const result = removeWorktreeSafely({
    mainRoot: fixture.repo,
    worktreePath: fixture.worktreePath,
    worktreesRoot: fixture.worktreesRoot,
    force: true,
  });

  assert.equal(result.removed, true);
  assert.equal(path.resolve(process.cwd()), path.resolve(fixture.repo));
  assert.equal(fs.existsSync(fixture.worktreePath), false);
  assert.equal(fs.readFileSync(path.join(fixture.externalTarget, 'sentinel.txt'), 'utf8'), 'DO NOT DELETE\n');
  assert.doesNotMatch(runGit(fixture.repo, ['worktree', 'list', '--porcelain']), /junction-case/);
  runGit(fixture.repo, ['branch', '-D', 'fix/junction-case']);
});

test('safe removal recovers an empty registered worktree after a Windows partial cleanup', (t) => {
  const fixture = initLinkedWorktreeFixture();
  t.after(() => {
    process.chdir(realTemporaryRoot);
    safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot });
  });

  fs.rmSync(path.join(fixture.worktreePath, '.git'), { force: true });
  fs.rmSync(path.join(fixture.worktreePath, '.gitignore'), { force: true });
  fs.rmSync(path.join(fixture.worktreePath, 'README.md'), { force: true });

  const result = removeWorktreeSafely({
    mainRoot: fixture.repo,
    worktreePath: fixture.worktreePath,
    worktreesRoot: fixture.worktreesRoot,
  });

  assert.equal(result.removed, true);
  assert.equal(fs.existsSync(fixture.worktreePath), false);
  assert.doesNotMatch(runGit(fixture.repo, ['worktree', 'list', '--porcelain']), /junction-case/);
});

test('safe no-follow removal unlinks broken links without traversing their targets', (t) => {
  const root = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-broken-link-'));
  t.after(() => safeRemoveTreeNoFollow(root, { allowedRoot: realTemporaryRoot }));
  const brokenTarget = path.join(root, 'missing-target');
  const brokenLink = path.join(root, 'broken-link');
  fs.symlinkSync(brokenTarget, brokenLink, process.platform === 'win32' ? 'junction' : 'dir');

  const result = safeRemoveTreeNoFollow(brokenLink, { allowedRoot: root });

  assert.equal(result.removedLinks, 1);
  assert.equal(fs.lstatSync(root).isDirectory(), true);
  assert.throws(() => fs.lstatSync(brokenLink), { code: 'ENOENT' });
});

test('safe removal rejects a symlinked container root before resolving descendants', (t) => {
  const root = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-linked-container-'));
  const externalRoot = path.join(root, 'external-worktrees');
  const linkedRoot = path.join(root, 'worktrees-link');
  const externalChild = path.join(externalRoot, 'must-survive');
  fs.mkdirSync(externalChild, { recursive: true });
  fs.writeFileSync(path.join(externalChild, 'sentinel.txt'), 'keep\n');
  fs.symlinkSync(externalRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => safeRemoveTreeNoFollow(root, { allowedRoot: realTemporaryRoot }));

  assert.throws(() => safeRemoveTreeNoFollow(
    path.join(linkedRoot, 'must-survive'),
    { allowedRoot: linkedRoot },
  ), /container root.*link|real directory/i);
  assert.equal(fs.readFileSync(path.join(externalChild, 'sentinel.txt'), 'utf8'), 'keep\n');
});

test('safe removal rejects main, container root, and paths outside the worktrees container', (t) => {
  const fixture = initLinkedWorktreeFixture();
  t.after(() => {
    process.chdir(realTemporaryRoot);
    safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot });
  });

  assert.equal(isPathInside(fixture.worktreesRoot, fixture.worktreePath), true);
  assert.equal(isPathInside(fixture.worktreePath, `${fixture.worktreePath}-other`), false);
  assert.throws(() => removeWorktreeSafely({
    mainRoot: fixture.repo,
    worktreePath: fixture.repo,
    worktreesRoot: fixture.worktreesRoot,
    force: true,
  }), /main worktree/i);
  assert.throws(() => removeWorktreeSafely({
    mainRoot: fixture.repo,
    worktreePath: fixture.worktreesRoot,
    worktreesRoot: fixture.worktreesRoot,
    force: true,
  }), /container root/i);
  assert.throws(() => removeWorktreeSafely({
    mainRoot: fixture.repo,
    worktreePath: fixture.externalTarget,
    worktreesRoot: fixture.worktreesRoot,
    force: true,
  }), /outside.*worktrees/i);

  const unregistered = path.join(fixture.worktreesRoot, 'unregistered');
  fs.mkdirSync(unregistered);
  fs.writeFileSync(path.join(unregistered, 'sentinel.txt'), 'keep\n');
  assert.throws(() => removeWorktreeSafely({
    mainRoot: fixture.repo,
    worktreePath: unregistered,
    worktreesRoot: fixture.worktreesRoot,
    force: true,
  }), /not registered/i);
  assert.equal(fs.readFileSync(path.join(unregistered, 'sentinel.txt'), 'utf8'), 'keep\n');

  assert.equal(fs.readFileSync(path.join(fixture.externalTarget, 'sentinel.txt'), 'utf8'), 'DO NOT DELETE\n');
});

test('safe removal refuses to prune unrelated stale worktree metadata', (t) => {
  const fixture = initLinkedWorktreeFixture();
  const stalePath = path.join(fixture.worktreesRoot, 'unrelated-stale');
  runGit(fixture.repo, ['worktree', 'add', '-b', 'fix/unrelated-stale', stalePath]);
  safeRemoveTreeNoFollow(stalePath, { allowedRoot: fixture.worktreesRoot });
  t.after(() => {
    process.chdir(realTemporaryRoot);
    spawnSync('git', ['worktree', 'prune', '--expire', 'now'], { cwd: fixture.repo, stdio: 'pipe' });
    safeRemoveTreeNoFollow(fixture.container, { allowedRoot: realTemporaryRoot });
  });

  assert.throws(() => removeWorktreeSafely({
    mainRoot: fixture.repo,
    worktreePath: fixture.worktreePath,
    worktreesRoot: fixture.worktreesRoot,
    force: true,
  }), /unrelated.*prunable|prune.*unrelated/i);
  assert.equal(fs.existsSync(fixture.worktreePath), true);
});

test('shared worktree links reject dependency and Git metadata paths', (t) => {
  const root = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-shared-links-'));
  const mainRoot = path.join(root, 'repo');
  const worktreePath = path.join(root, 'worktree');
  fs.mkdirSync(path.join(mainRoot, 'node_modules'), { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });
  t.after(() => safeRemoveTreeNoFollow(root, { allowedRoot: realTemporaryRoot }));

  assert.throws(() => setupSharedLinks(mainRoot, worktreePath, {
    worktree: { sharedConfigSymlinks: ['node_modules'] },
  }), /forbidden.*node_modules/i);
  assert.equal(fs.existsSync(path.join(worktreePath, 'node_modules')), false);

  assert.throws(() => setupSharedLinks(mainRoot, worktreePath, {
    worktree: { sharedConfigSymlinks: ['../outside'] },
  }), /relative.*inside/i);
});

test('invalid shared-link config is rejected before Git or filesystem mutation', (t) => {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-link-preflight-'));
  const repo = path.join(container, 'repo');
  fs.mkdirSync(repo);
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# test\n');
  runGit(repo, ['add', 'README.md']);
  runGit(repo, ['commit', '-m', 'init']);
  fs.writeFileSync(path.join(repo, 'agent.config.json'), JSON.stringify({
    worktree: { sharedConfigSymlinks: ['node_modules'] },
  }));
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: realTemporaryRoot }));

  assert.throws(() => createOrResumeWorktree({
    cwd: repo,
    cli: { phase: 'tdd', kind: 'fix', desc: 'reject dangerous shared links' },
  }), /forbidden.*node_modules/i);

  assert.doesNotMatch(runGit(repo, ['worktree', 'list', '--porcelain']), /reject-dangerous-shared-links/u);
  assert.equal(runGit(repo, ['branch', '--list', 'fix/reject-dangerous-shared-links']), '');
  assert.equal(fs.existsSync(path.join(container, 'worktrees')), false);
  assert.equal(fs.existsSync(path.join(repo, '.git', 'FETCH_HEAD')), false);
});

test('skip-fetch creates a worktree without contacting origin', () => {
  const repo = initRepo();
  const remote = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-core-remote-'));
  runGit(remote, ['init', '--bare']);
  runGit(repo, ['remote', 'add', 'origin', remote]);
  runGit(repo, ['push', '-u', 'origin', 'main']);
  fs.rmSync(path.join(repo, '.git', 'FETCH_HEAD'), { force: true });

  const bindings = [];
  const result = createOrResumeWorktree({
    cwd: repo,
    bindTaskLocation: (input) => {
      bindings.push(input);
      return { status: 'BOUND', taskId: input.taskId };
    },
    cli: {
      'skip-fetch': true,
      phase: 'tdd',
      kind: 'fix',
      task: 'local-fast-path',
      desc: 'local fast path',
    },
  });

  assert.equal(result.fetchSkipped, true);
  assert.equal(result.branch, 'fix/local-fast-path');
  assert.equal(fs.existsSync(result.worktreePath), true);
  assert.equal(fs.existsSync(path.join(repo, '.git', 'FETCH_HEAD')), false);
  assert.deepEqual(bindings.map((item) => item.taskId), ['local-fast-path']);
  assert.equal(bindings[0].worktree, result.worktreePath);
  assert.equal(bindings[0].branch, result.branch);
});

test('auto bootstrap can always reconcile dependencies even when the readiness check passes', (t) => {
  const repo = initRepo();
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  runGit(repo, ['add', '.gitignore']);
  runGit(repo, ['commit', '-m', 'ignore dependencies']);
  fs.mkdirSync(path.join(repo, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'node_modules', 'ready'), 'ready\n');
  t.after(() => safeRemoveTreeNoFollow(repo, { allowedRoot: realTemporaryRoot }));

  const result = runWorktreeBootstrap({
    worktreePath: repo,
    mainRoot: repo,
    config: {
      projectName: 'bootstrap-test',
      containerDirs: { tmp: path.join(repo, '.git', 'runtime') },
      worktree: {
        lockDir: path.join(repo, '.git', 'runtime', 'bootstrap-locks'),
        bootstrap: {
          mode: 'auto',
          alwaysRun: true,
          command: 'node -e "const fs=require(\'fs\');const p=\'node_modules/bootstrap-count\';const n=fs.existsSync(p)?Number(fs.readFileSync(p,\'utf8\')):0;fs.writeFileSync(p,String(n+1))"',
          checkCommand: 'node -e "process.exit(require(\'fs\').existsSync(\'node_modules/ready\')?0:1)"',
        },
      },
    },
  });

  assert.equal(result.status, 'READY');
  assert.equal(fs.readFileSync(path.join(repo, 'node_modules', 'bootstrap-count'), 'utf8'), '1');
});

test('resuming an existing worktree honors configured auto bootstrap mode', (t) => {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-auto-resume-'));
  const repo = path.join(container, 'repo');
  fs.mkdirSync(repo);
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(
    path.join(repo, 'bootstrap.js'),
    "const fs=require('fs');fs.mkdirSync('node_modules',{recursive:true});const p='node_modules/count';const n=fs.existsSync(p)?Number(fs.readFileSync(p,'utf8')):0;fs.writeFileSync(p,String(n+1));fs.writeFileSync('node_modules/ready','ready');\n",
  );
  fs.writeFileSync(path.join(repo, 'agent.config.json'), JSON.stringify({
    baseBranch: 'main',
    containerDirs: { worktrees: '../worktrees' },
    worktree: {
      envSymlinks: [],
      sharedConfigSymlinks: [],
      sessionDir: '../tmp/sessions',
      lockDir: '../tmp/locks',
      bootstrap: {
        mode: 'auto',
        alwaysRun: true,
        command: 'node bootstrap.js',
        checkCommand: 'node -e "process.exit(require(\'fs\').existsSync(\'node_modules/ready\')?0:1)"',
      },
    },
  }, null, 2));
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', 'configure bootstrap']);
  t.after(() => {
    process.chdir(realTemporaryRoot);
    safeRemoveTreeNoFollow(container, { allowedRoot: realTemporaryRoot });
  });

  const cli = {
    'skip-fetch': true,
    phase: 'tdd',
    kind: 'fix',
    desc: 'resume dependencies',
  };
  const created = createOrResumeWorktree({ cwd: repo, cli });
  const resumed = createOrResumeWorktree({ cwd: repo, cli });

  assert.equal(created.resumed, false);
  assert.equal(resumed.resumed, true);
  assert.equal(created.bootstrap.mode, 'auto');
  assert.equal(resumed.bootstrap.mode, 'auto');
  assert.equal(fs.readFileSync(path.join(created.worktreePath, 'node_modules', 'count'), 'utf8'), '2');
});

test('later expert phase durably seals clean predecessor sessions for the same topic', (t) => {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-phase-lineage-'));
  const repo = path.join(container, 'repo');
  fs.mkdirSync(repo);
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'agent.config.json'), JSON.stringify({
    baseBranch: 'main',
    containerDirs: { worktrees: '../worktrees' },
    worktree: {
      sessionDir: '../tmp/sessions',
      lockDir: '../tmp/locks',
      envSymlinks: [],
      sharedConfigSymlinks: [],
      bootstrap: { mode: 'skip' },
    },
  }, null, 2));
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', 'init']);
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: realTemporaryRoot }));

  const prd = createOrResumeWorktree({
    cwd: repo,
    cli: { 'skip-fetch': true, phase: 'prd', desc: 'shared lifecycle' },
  });
  fs.writeFileSync(path.join(prd.worktreePath, 'prd.md'), 'confirmed\n');
  runGit(prd.worktreePath, ['add', 'prd.md']);
  runGit(prd.worktreePath, ['commit', '-m', 'prd']);

  const task = createOrResumeWorktree({
    cwd: repo,
    cli: { 'skip-fetch': true, phase: 'task', desc: 'shared lifecycle' },
  });
  assert.deepEqual(task.supersession.seals.map((item) => item.branch), [prd.branch]);
  assert.equal(task.supersession.seals[0].expectedHead, runGit(prd.worktreePath, ['rev-parse', 'HEAD']));

  const taskSession = readSessions(task.config, repo).find((session) => session.branch === task.branch);
  assert.deepEqual(taskSession.lifecycle.keys, ['topic:shared-lifecycle']);
  assert.deepEqual(taskSession.lifecycle.supersedes.map((item) => item.branch), [prd.branch]);
});

test('supersession planning never seals dirty or unrelated predecessor worktrees', (t) => {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-phase-lineage-safe-'));
  const repo = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  const sessionsRoot = path.join(container, 'tmp', 'sessions');
  fs.mkdirSync(repo);
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', 'init']);
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: realTemporaryRoot }));

  const dirtyPath = path.join(worktreesRoot, 'prd-shared-topic');
  const unrelatedPath = path.join(worktreesRoot, 'prd-other-topic');
  runGit(repo, ['worktree', 'add', '-b', 'docs/prd-shared-topic', dirtyPath]);
  runGit(repo, ['worktree', 'add', '-b', 'docs/prd-other-topic', unrelatedPath]);
  fs.writeFileSync(path.join(dirtyPath, 'uncommitted.md'), 'must survive\n');
  const config = {
    containerDirs: { tmp: path.join(container, 'tmp') },
    worktree: { sessionDir: sessionsRoot, lockDir: path.join(container, 'tmp', 'locks') },
  };
  writeSession(config, repo, {
    phase: 'prd', branch: 'docs/prd-shared-topic', worktree: dirtyPath, status: 'in_progress', step: 'created',
  });
  writeSession(config, repo, {
    phase: 'prd', branch: 'docs/prd-other-topic', worktree: unrelatedPath, status: 'in_progress', step: 'created',
  });

  const result = planSupersededSessions({
    config,
    mainRoot: repo,
    cli: { phase: 'task', desc: 'shared topic' },
    branch: 'docs/task-shared-topic',
  });
  assert.deepEqual(result.seals, []);
  assert.deepEqual(result.skipped, [{ branch: 'docs/prd-shared-topic', reason: 'dirty-worktree' }]);
});

test('lifecycle lock reclaims a stale owner but never steals a live owner', (t) => {
  const root = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-lifecycle-lock-'));
  t.after(() => safeRemoveTreeNoFollow(root, { allowedRoot: realTemporaryRoot }));
  const stalePath = path.join(root, 'cleanup.lock');
  fs.mkdirSync(stalePath);
  fs.writeFileSync(path.join(stalePath, 'owner'), '999999999\n2000-01-01T00:00:00.000Z\n');
  fs.utimesSync(stalePath, new Date('2000-01-01T00:00:00.000Z'), new Date('2000-01-01T00:00:00.000Z'));
  const release = acquireLock(root, 'cleanup', 100);
  assert.equal(fs.existsSync(stalePath), true);
  release();
  assert.equal(fs.existsSync(stalePath), false);

  const liveRelease = acquireLock(root, 'cleanup', 100);
  assert.throws(() => acquireLock(root, 'cleanup', 20), /lock timeout/i);
  liveRelease();
});

test('resuming refuses to overwrite cleanup or recovery lifecycle state', (t) => {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-lifecycle-resume-'));
  const repo = path.join(container, 'repo');
  fs.mkdirSync(repo);
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n');
  fs.writeFileSync(path.join(repo, 'agent.config.json'), JSON.stringify({
    baseBranch: 'main',
    containerDirs: { worktrees: '../worktrees' },
    worktree: { sessionDir: '../tmp/sessions', envSymlinks: [], sharedConfigSymlinks: [] },
  }, null, 2));
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', 'init']);
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: realTemporaryRoot }));

  const cli = {
    'skip-fetch': true,
    phase: 'tdd',
    kind: 'fix',
    task: 'sealed-lifecycle',
    desc: 'sealed lifecycle',
  };
  const created = createOrResumeWorktree({ cwd: repo, cli });
  const originalSession = readSessions(created.config, repo)
    .find((session) => session.branch === created.branch);
  writeSession(created.config, repo, {
    branch: created.branch,
    worktree: created.worktreePath,
    status: 'cleanup_pending',
    step: 'merged_cleanup_pending',
    cleanup: { expectedHead: runGit(created.worktreePath, ['rev-parse', 'HEAD']) },
  });

  assert.throws(
    () => createOrResumeWorktree({ cwd: repo, cli }),
    /cleanup_pending|recovery/i,
  );

  writeSession(created.config, repo, {
    branch: created.branch,
    worktree: created.worktreePath,
    status: 'recovery_required',
    step: 'post_merge_recovery_required',
  });
  const bindings = [];
  const recovered = recoverSessionAsBranch(
    created.config,
    repo,
    created.branch,
    'fix/sealed-lifecycle-recovered',
    { bindTaskLocation: (input) => bindings.push(input) },
  );
  assert.equal(recovered.branch, 'fix/sealed-lifecycle-recovered');
  assert.equal(runGit(created.worktreePath, ['branch', '--show-current']), recovered.branch);
  const sessions = readSessions(created.config, repo);
  assert.equal(sessions.some((session) => session.branch === created.branch), false);
  const recoveredSession = sessions.find((session) => session.branch === recovered.branch);
  assert.equal(recoveredSession.status, 'in_progress');
  assert.deepEqual(recoveredSession.lifecycle, originalSession.lifecycle);
  assert.deepEqual(bindings.map((item) => item.taskId), ['sealed-lifecycle']);
  assert.equal(bindings[0].worktree, created.worktreePath);
  assert.equal(bindings[0].branch, recovered.branch);
});

test('recovery branch rebind resumes from its persisted intent after task binding interruption', (t) => {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-rebind-retry-'));
  const repo = path.join(container, 'repo');
  fs.mkdirSync(repo);
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n');
  fs.writeFileSync(path.join(repo, 'agent.config.json'), JSON.stringify({
    baseBranch: 'main',
    containerDirs: { worktrees: '../worktrees', tmp: '../tmp' },
    worktree: { sessionDir: '../tmp/sessions', lockDir: '../tmp/locks', envSymlinks: [], sharedConfigSymlinks: [] },
  }, null, 2));
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', 'init']);
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: realTemporaryRoot }));

  const created = createOrResumeWorktree({
    cwd: repo,
    cli: {
      'skip-fetch': true,
      phase: 'tdd',
      kind: 'fix',
      task: 'retry-rebind',
      desc: 'retry rebind',
    },
  });
  writeSession(created.config, repo, {
    branch: created.branch,
    worktree: created.worktreePath,
    status: 'recovery_required',
    step: 'post_merge_recovery_required',
  });
  const recoveredBranch = 'recovery/retry-rebind';

  assert.throws(() => recoverSessionAsBranch(
    created.config,
    repo,
    created.branch,
    recoveredBranch,
    { bindTaskLocation: () => { throw new Error('simulated task state interruption'); } },
  ), /simulated task state interruption/u);

  const interruptedSessions = readSessions(created.config, repo);
  const oldSession = interruptedSessions.find((session) => session.branch === created.branch);
  assert.equal(oldSession.status, 'recovery_required');
  assert.equal(oldSession.step, 'recovery_rebind_pending');
  assert.equal(oldSession.rebind.toBranch, recoveredBranch);
  assert.equal(runGit(created.worktreePath, ['branch', '--show-current']), recoveredBranch);

  const bindings = [];
  const recovered = recoverSessionAsBranch(
    created.config,
    repo,
    created.branch,
    recoveredBranch,
    { bindTaskLocation: (input) => bindings.push(input) },
  );
  assert.equal(recovered.branch, recoveredBranch);
  assert.deepEqual(bindings.map((item) => item.taskId), ['retry-rebind']);
  assert.equal(readSessions(created.config, repo).some((session) => session.branch === created.branch), false);
  assert.equal(runGit(repo, ['branch', '--list', created.branch]), '');
});

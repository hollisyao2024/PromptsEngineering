'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  createOrResumeWorktree,
  isPathInside,
  materializeReusablePaths,
  removeWorktreeSafely,
  reclaimMergedManagedWorktrees,
  reclaimRemoteMergedSessionWorktrees,
  readSessions,
  safeRemoveTreeNoFollow,
  setupSharedLinks,
  writeManagedMarker,
  writeSession,
  MANAGED_MARKER,
} = require('../worktree-core');
const { retryWritable: retryRemoveOperation } = require('../worktree-safe-remove');

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

test('reclaims only a clean, merged worktree owned by this repository', (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-reclaim-'));
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
    process.chdir(os.tmpdir());
    if (fs.existsSync(container)) safeRemoveTreeNoFollow(container, { allowedRoot: os.tmpdir() });
  });

  const result = reclaimMergedManagedWorktrees({
    mainRoot: repo,
    config: { baseBranch: 'main' },
    worktreesRoot,
    baseRef: 'main',
  });

  assert.deepEqual(result.removed.map((item) => item.branch), ['fix/merged-cleanup']);
  assert.equal(fs.existsSync(worktreePath), false);
  assert.equal(runGit(repo, ['branch', '--list', 'fix/merged-cleanup']), '');
});

test('retains a freshly created worktree while its session is in progress', (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-active-session-'));
  const repo = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  const worktreePath = path.join(worktreesRoot, 'active');
  const config = {
    baseBranch: 'main',
    worktree: { sessionDir: path.join(container, 'sessions') },
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
    process.chdir(os.tmpdir());
    if (fs.existsSync(container)) safeRemoveTreeNoFollow(container, { allowedRoot: os.tmpdir() });
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
  assert.equal(result.retained[0].reason, 'active-session');
  assert.equal(path.resolve(result.retained[0].path), path.resolve(worktreePath));
});

test('reclaims a clean pushed session only after its matching remote PR is proven merged', (t) => {
  const realTmp = fs.realpathSync(os.tmpdir());
  const container = fs.mkdtempSync(path.join(realTmp, 'worktree-remote-merged-'));
  const repo = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  const worktreePath = path.join(worktreesRoot, 'remote-merged');
  const config = { baseBranch: 'main', worktree: { sessionDir: path.join(container, 'sessions') } };
  fs.mkdirSync(repo, { recursive: true });
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# test\n');
  runGit(repo, ['add', 'README.md']);
  runGit(repo, ['commit', '-m', 'init']);
  fs.mkdirSync(worktreesRoot, { recursive: true });
  runGit(repo, ['worktree', 'add', '-b', 'fix/remote-merged', worktreePath]);
  writeManagedMarker(repo, worktreePath, 'fix/remote-merged');
  writeSession(config, repo, {
    phase: 'tdd', branch: 'fix/remote-merged', worktree: worktreePath,
    status: 'in_progress', step: 'pushed', pr: '#42',
  });
  t.after(() => {
    process.chdir(realTmp);
    if (fs.existsSync(container)) safeRemoveTreeNoFollow(container, { allowedRoot: realTmp });
  });

  const result = reclaimRemoteMergedSessionWorktrees({
    mainRoot: repo, config, worktreesRoot,
    queryPullRequest: (_root, pr) => pr === 42 ? { state: 'MERGED', headRefName: 'fix/remote-merged' } : null,
  });

  assert.deepEqual(result.removed.map((item) => item.branch), ['fix/remote-merged']);
  assert.equal(fs.existsSync(worktreePath), false);
  assert.equal(readSessions(config, repo).length, 0);
});

test('retains a pushed session when remote PR proof is absent or the worktree is dirty', (t) => {
  const realTmp = fs.realpathSync(os.tmpdir());
  const container = fs.mkdtempSync(path.join(realTmp, 'worktree-remote-dirty-'));
  const repo = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  const worktreePath = path.join(worktreesRoot, 'remote-dirty');
  const config = { baseBranch: 'main', worktree: { sessionDir: path.join(container, 'sessions') } };
  fs.mkdirSync(repo, { recursive: true });
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# test\n');
  runGit(repo, ['add', 'README.md']);
  runGit(repo, ['commit', '-m', 'init']);
  fs.mkdirSync(worktreesRoot, { recursive: true });
  runGit(repo, ['worktree', 'add', '-b', 'fix/remote-dirty', worktreePath]);
  writeManagedMarker(repo, worktreePath, 'fix/remote-dirty');
  writeSession(config, repo, {
    phase: 'tdd', branch: 'fix/remote-dirty', worktree: worktreePath,
    status: 'in_progress', step: 'pushed', pr: '7',
  });
  fs.writeFileSync(path.join(worktreePath, 'uncommitted.txt'), 'keep\n');
  t.after(() => {
    process.chdir(realTmp);
    if (fs.existsSync(container)) safeRemoveTreeNoFollow(container, { allowedRoot: realTmp });
  });

  const result = reclaimRemoteMergedSessionWorktrees({
    mainRoot: repo, config, worktreesRoot,
    queryPullRequest: () => ({ state: 'MERGED', headRefName: 'fix/remote-dirty' }),
  });

  assert.deepEqual(result.removed, []);
  assert.equal(fs.existsSync(worktreePath), true);
  assert.equal(result.retained[0].reason, 'uncommitted-changes');
});

test('retains a dirty owned worktree even when its branch is merged', (t) => {
  const fixture = initLinkedWorktreeFixture();
  writeManagedMarker(fixture.repo, fixture.worktreePath, 'fix/junction-case');
  fs.writeFileSync(path.join(fixture.worktreePath, 'uncommitted.txt'), 'keep\n');
  t.after(() => {
    process.chdir(os.tmpdir());
    spawnSync('git', ['worktree', 'prune', '--expire', 'now'], { cwd: fixture.repo, stdio: 'pipe' });
    safeRemoveTreeNoFollow(fixture.container, { allowedRoot: os.tmpdir() });
  });

  const result = reclaimMergedManagedWorktrees({
    mainRoot: fixture.repo,
    config: { baseBranch: 'main' },
    worktreesRoot: fixture.worktreesRoot,
    baseRef: 'main',
  });

  assert.deepEqual(result.removed, []);
  assert.equal(fs.existsSync(fixture.worktreePath), true);
  assert.match(result.retained[0].reason, /uncommitted changes/i);
});

test('safe removal rescans a directory when a late file makes the final rmdir non-empty', (t) => {
  const tempRoot = fs.realpathSync(os.tmpdir());
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
  const tempRoot = fs.realpathSync(os.tmpdir());
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-reuse-runtime-'));
  const mainRoot = path.join(root, 'repo');
  const worktreePath = path.join(root, 'worktree');
  const relativePath = 'apps/desktop/resources/kb-model-runtime';
  fs.mkdirSync(path.join(mainRoot, relativePath), { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.writeFileSync(path.join(mainRoot, relativePath, 'runtime.js'), 'ready\n');
  t.after(() => safeRemoveTreeNoFollow(root, { allowedRoot: os.tmpdir() }));

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-reuse-link-'));
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
  t.after(() => safeRemoveTreeNoFollow(root, { allowedRoot: os.tmpdir() }));

  const result = materializeReusablePaths({ mainRoot, worktreePath, entries: [relativePath] });
  const copiedPackage = path.join(worktreePath, relativePath, 'node_modules', 'runtime-package');

  assert.deepEqual(result.reusedPaths, [relativePath]);
  assert.equal(fs.readFileSync(path.join(copiedPackage, 'index.js'), 'utf8'), 'runtime\n');
  assert.equal(fs.lstatSync(copiedPackage).isSymbolicLink(), false);
});

test('reusable generated resources reject links that escape main', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-reuse-escape-'));
  const mainRoot = path.join(root, 'repo');
  const worktreePath = path.join(root, 'worktree');
  const outside = path.join(root, 'outside');
  const relativePath = 'generated/runtime';
  const sourcePath = path.join(mainRoot, relativePath);
  fs.mkdirSync(sourcePath, { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.symlinkSync(outside, path.join(sourcePath, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => safeRemoveTreeNoFollow(root, { allowedRoot: os.tmpdir() }));

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
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-core-dry-run-'));
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# test\n');
  runGit(repo, ['add', 'README.md']);
  runGit(repo, ['commit', '-m', 'init']);
  return repo;
}

test('dry-run worktree creation does not fetch or create its requested worktree', (t) => {
  const repo = initRepo();
  t.after(() => safeRemoveTreeNoFollow(repo, { allowedRoot: os.tmpdir() }));

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

function initLinkedWorktreeFixture() {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-safe-remove-'));
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
    process.chdir(os.tmpdir());
    safeRemoveTreeNoFollow(fixture.container, { allowedRoot: os.tmpdir() });
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
    process.chdir(os.tmpdir());
    safeRemoveTreeNoFollow(fixture.container, { allowedRoot: os.tmpdir() });
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-broken-link-'));
  t.after(() => safeRemoveTreeNoFollow(root, { allowedRoot: os.tmpdir() }));
  const brokenTarget = path.join(root, 'missing-target');
  const brokenLink = path.join(root, 'broken-link');
  fs.symlinkSync(brokenTarget, brokenLink, process.platform === 'win32' ? 'junction' : 'dir');

  const result = safeRemoveTreeNoFollow(brokenLink, { allowedRoot: root });

  assert.equal(result.removedLinks, 1);
  assert.equal(fs.lstatSync(root).isDirectory(), true);
  assert.throws(() => fs.lstatSync(brokenLink), { code: 'ENOENT' });
});

test('safe removal rejects a symlinked container root before resolving descendants', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-linked-container-'));
  const externalRoot = path.join(root, 'external-worktrees');
  const linkedRoot = path.join(root, 'worktrees-link');
  const externalChild = path.join(externalRoot, 'must-survive');
  fs.mkdirSync(externalChild, { recursive: true });
  fs.writeFileSync(path.join(externalChild, 'sentinel.txt'), 'keep\n');
  fs.symlinkSync(externalRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  t.after(() => safeRemoveTreeNoFollow(root, { allowedRoot: os.tmpdir() }));

  assert.throws(() => safeRemoveTreeNoFollow(
    path.join(linkedRoot, 'must-survive'),
    { allowedRoot: linkedRoot },
  ), /container root.*link|real directory/i);
  assert.equal(fs.readFileSync(path.join(externalChild, 'sentinel.txt'), 'utf8'), 'keep\n');
});

test('safe removal rejects main, container root, and paths outside the worktrees container', (t) => {
  const fixture = initLinkedWorktreeFixture();
  t.after(() => {
    process.chdir(os.tmpdir());
    safeRemoveTreeNoFollow(fixture.container, { allowedRoot: os.tmpdir() });
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
    process.chdir(os.tmpdir());
    spawnSync('git', ['worktree', 'prune', '--expire', 'now'], { cwd: fixture.repo, stdio: 'pipe' });
    safeRemoveTreeNoFollow(fixture.container, { allowedRoot: os.tmpdir() });
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-shared-links-'));
  const mainRoot = path.join(root, 'repo');
  const worktreePath = path.join(root, 'worktree');
  fs.mkdirSync(path.join(mainRoot, 'node_modules'), { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });
  t.after(() => safeRemoveTreeNoFollow(root, { allowedRoot: os.tmpdir() }));

  assert.throws(() => setupSharedLinks(mainRoot, worktreePath, {
    worktree: { sharedConfigSymlinks: ['node_modules'] },
  }), /forbidden.*node_modules/i);
  assert.equal(fs.existsSync(path.join(worktreePath, 'node_modules')), false);

  assert.throws(() => setupSharedLinks(mainRoot, worktreePath, {
    worktree: { sharedConfigSymlinks: ['../outside'] },
  }), /relative.*inside/i);
});

test('invalid shared-link config is rejected before Git or filesystem mutation', (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-link-preflight-'));
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
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: os.tmpdir() }));

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
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-core-remote-'));
  runGit(remote, ['init', '--bare']);
  runGit(repo, ['remote', 'add', 'origin', remote]);
  runGit(repo, ['push', '-u', 'origin', 'main']);
  fs.rmSync(path.join(repo, '.git', 'FETCH_HEAD'), { force: true });

  const result = createOrResumeWorktree({
    cwd: repo,
    cli: {
      'skip-fetch': true,
      phase: 'tdd',
      kind: 'fix',
      desc: 'local fast path',
    },
  });

  assert.equal(result.fetchSkipped, true);
  assert.equal(result.branch, 'fix/local-fast-path');
  assert.equal(fs.existsSync(result.worktreePath), true);
  assert.equal(fs.existsSync(path.join(repo, '.git', 'FETCH_HEAD')), false);
});

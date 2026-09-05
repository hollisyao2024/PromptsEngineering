'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  createOrResumeWorktree,
  readSessions,
  safeRemoveTreeNoFollow,
} = require('../../worktree-tools/worktree-core');
const { captureQaVerificationIdentity } = require('../qa-verify');
const {
  buildQaVerificationReceipt,
  validateQaVerificationReceipt,
  writeQaVerificationReceipt,
  readQaVerificationReceipt,
} = require('../qa-verification-state');
const { buildBasePushArgs, localSquashMerge } = require('../qa-merge');

const temporaryRoot = fs.realpathSync(os.tmpdir());

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (!allowFailure) {
    assert.equal(
      result.status,
      0,
      `git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`,
    );
  }
  return allowFailure ? result : (result.stdout || '').trim();
}

function configureClone(repo, label) {
  git(repo, ['config', 'user.email', `${label}@example.com`]);
  git(repo, ['config', 'user.name', label]);
}

function initializeThreeComputerFixture() {
  const container = fs.mkdtempSync(path.join(temporaryRoot, 'three-computer-git-'));
  const origin = path.join(container, 'origin.git');
  const seed = path.join(container, 'seed');
  fs.mkdirSync(seed);
  git(container, ['init', '--bare', origin]);
  git(seed, ['init', '-b', 'stable']);
  configureClone(seed, 'seed');
  fs.mkdirSync(path.join(seed, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(seed, '.github', 'workflows', 'manual.yml'), 'name: project-owned\n');
  fs.writeFileSync(path.join(seed, 'README.md'), '# three computer simulation\n');
  fs.writeFileSync(path.join(seed, 'agent.config.json'), `${JSON.stringify({
    baseBranch: 'stable',
    containerDirs: { worktrees: '../worktrees', tmp: '../tmp' },
    worktree: {
      envSymlinks: [],
      sharedConfigSymlinks: [],
      sessionDir: '../tmp/sessions',
      lockDir: '../tmp/locks',
      bootstrap: { mode: 'skip' },
    },
  }, null, 2)}\n`);
  git(seed, ['add', '.']);
  git(seed, ['commit', '-m', 'seed']);
  git(seed, ['remote', 'add', 'origin', origin]);
  git(seed, ['push', '-u', 'origin', 'stable']);
  git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/stable']);

  const machines = {};
  for (const name of ['developer-a', 'developer-b', 'qa-c']) {
    const machineRoot = path.join(container, name);
    const repo = path.join(machineRoot, 'repo');
    fs.mkdirSync(machineRoot);
    git(machineRoot, ['clone', origin, repo]);
    configureClone(repo, name);
    machines[name] = { machineRoot, repo };
  }
  return { container, origin, machines };
}

test('three computers coordinate through remote refs, QA SHAs, and non-force base pushes', async (t) => {
  const fixture = initializeThreeComputerFixture();
  t.after(() => safeRemoveTreeNoFollow(fixture.container, { allowedRoot: temporaryRoot }));
  const devA = fixture.machines['developer-a'];
  const devB = fixture.machines['developer-b'];
  const qaC = fixture.machines['qa-c'];
  const branch = 'fix/shared-multi-host-task';

  const created = createOrResumeWorktree({
    cwd: devA.repo,
    cli: { phase: 'tdd', branch },
  });
  fs.writeFileSync(path.join(created.worktreePath, 'FEATURE.md'), 'verified feature\n');
  git(created.worktreePath, ['add', 'FEATURE.md']);
  git(created.worktreePath, ['commit', '-m', 'feature from developer A']);
  git(created.worktreePath, ['push', '-u', 'origin', branch]);
  const featureHead = git(created.worktreePath, ['rev-parse', 'HEAD']);

  assert.throws(() => createOrResumeWorktree({
    cwd: devB.repo,
    cli: { phase: 'tdd', branch },
  }), /remote branch origin\/fix\/shared-multi-host-task already exists/i);

  const resumedByB = createOrResumeWorktree({
    cwd: devB.repo,
    cli: { phase: 'tdd', branch, resumeRemote: true },
  });
  assert.equal(git(resumedByB.worktreePath, ['rev-parse', 'HEAD']), featureHead);
  assert.equal(resumedByB.resumedRemote, true);

  const resumedByQa = createOrResumeWorktree({
    cwd: qaC.repo,
    cli: { phase: 'qa', branch, resumeRemote: true },
  });
  const qaRunGit = (args) => git(resumedByQa.worktreePath, args);
  const receipt = captureQaVerificationIdentity({
    config: resumedByQa.config,
    runGit: qaRunGit,
    verifiedAt: '2026-09-05T00:00:00.000Z',
  });
  const receiptPath = writeQaVerificationReceipt(
    resumedByQa.config,
    qaC.repo,
    resumedByQa.worktreePath,
    receipt,
  );
  assert.equal(fs.existsSync(receiptPath), true);
  assert.deepEqual(
    readQaVerificationReceipt(resumedByQa.config, qaC.repo, resumedByQa.worktreePath),
    receipt,
  );
  validateQaVerificationReceipt(receipt, {
    baseBranch: 'stable',
    branch,
    baseSha: receipt.base_sha,
    headSha: featureHead,
    prBaseRef: 'stable',
    prBaseSha: receipt.base_sha,
    prHeadRef: branch,
    prHeadSha: featureHead,
  });

  await localSquashMerge(branch, {
    number: 1,
    title: 'fix: three-computer simulation',
    body: '',
  }, qaC.repo, {
    baseBranch: 'stable',
    expectedBaseSha: receipt.base_sha,
    expectedHeadSha: receipt.head_sha,
  });
  const acceptedBase = git(qaC.repo, ['rev-parse', 'HEAD']);
  assert.equal(git(fixture.origin, ['rev-parse', 'refs/heads/stable']), acceptedBase);

  fs.writeFileSync(path.join(devB.repo, 'STALE-CANDIDATE.md'), 'must be rejected\n');
  git(devB.repo, ['add', 'STALE-CANDIDATE.md']);
  git(devB.repo, ['commit', '-m', 'stale concurrent candidate']);
  const rejectedPush = git(devB.repo, buildBasePushArgs('stable'), { allowFailure: true });
  assert.notEqual(rejectedPush.status, 0);
  assert.match(`${rejectedPush.stderr}\n${rejectedPush.stdout}`, /non-fast-forward|fetch first|rejected/i);
  assert.equal(git(fixture.origin, ['rev-parse', 'refs/heads/stable']), acceptedBase);

  git(resumedByQa.worktreePath, [
    'fetch', 'origin', '+refs/heads/stable:refs/remotes/origin/stable',
  ]);
  const advancedBase = git(
    resumedByQa.worktreePath,
    ['rev-parse', 'refs/remotes/origin/stable'],
  );
  assert.throws(() => validateQaVerificationReceipt(receipt, {
    baseBranch: 'stable',
    branch,
    baseSha: advancedBase,
    headSha: featureHead,
    prBaseRef: 'stable',
    prBaseSha: advancedBase,
    prHeadRef: branch,
    prHeadSha: featureHead,
  }), (error) => error.code === 'STALE_QA_RECEIPT' && /BASE_SHA/u.test(error.message));

  assert.equal(readSessions(created.config, devA.repo).some((session) => session.branch === branch), true);
  assert.equal(readSessions(resumedByB.config, devB.repo).some((session) => session.branch === branch), true);
  assert.equal(readSessions(resumedByQa.config, qaC.repo).some((session) => session.branch === branch), true);
  assert.notEqual(path.dirname(receiptPath), path.join(devA.machineRoot, 'tmp', 'qa-verification-receipts'));
  assert.equal(
    fs.readFileSync(path.join(qaC.repo, '.github', 'workflows', 'manual.yml'), 'utf8').replace(/\r\n/gu, '\n'),
    'name: project-owned\n',
  );

  const rebuiltReceipt = buildQaVerificationReceipt({
    baseBranch: receipt.base_branch,
    branch: receipt.branch,
    baseSha: receipt.base_sha,
    headSha: receipt.head_sha,
    verifiedAt: receipt.verified_at,
  });
  assert.deepEqual(rebuiltReceipt, receipt);
});

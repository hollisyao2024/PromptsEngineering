const assert = require('node:assert/strict');
const test = require('node:test');

const {
  checkPrState,
  closePullRequest,
  createGitHubBackend,
  findOpenPR,
  getPrTitle,
  buildGhMergeArgs,
  buildBasePushArgs,
  buildFeatureDeleteArgs,
  closeAndCleanup,
  deleteRemoteFeatureBranch,
  parseGitHubRepoSlug,
  remoteBranchCleanupStatus,
  tryGhMerge,
} = require('./qa-merge');

test('createGitHubBackend prefers API when both gh and GH_TOKEN exist', () => {
  assert.deepEqual(parseGitHubRepoSlug('git@github.com:owner/repo.git'), {
    owner: 'owner',
    repo: 'repo',
  });

  const backend = createGitHubBackend({
    ghAvailable: true,
    token: 'token',
    remoteUrl: 'https://github.com/owner/repo.git',
    apiRequest: async () => ({}),
  });

  assert.equal(backend.mode, 'api');
  assert.equal(backend.owner, 'owner');
  assert.equal(backend.repo, 'repo');
  assert.throws(
    () => createGitHubBackend({ ghAvailable: false, token: '', remoteUrl: 'https://github.com/a/b.git' }),
    /GH_TOKEN/
  );
});

test('findOpenPR uses GitHub API and normalizes mergeability', async () => {
  const calls = [];
  const backend = {
    mode: 'api',
    token: 'token',
    owner: 'owner',
    repo: 'repo',
    apiRequest: async (method, apiPath, options) => {
      calls.push({ method, apiPath, options });
      if (apiPath.includes('/pulls?')) return [{ number: 12 }];
      return {
        number: 12,
        title: 'fix: merge',
        body: 'body',
        html_url: 'https://github.com/owner/repo/pull/12',
        mergeable: true,
        base: { ref: 'stable', sha: 'a'.repeat(40) },
        head: { ref: 'fix/branch', sha: 'b'.repeat(40) },
      };
    },
  };

  const pr = await findOpenPR('fix/branch', { backend });

  assert.equal(pr.number, 12);
  assert.equal(pr.mergeable, 'MERGEABLE');
  assert.equal(pr.baseRefName, 'stable');
  assert.equal(pr.baseRefOid, 'a'.repeat(40));
  assert.equal(pr.headRefName, 'fix/branch');
  assert.equal(pr.headRefOid, 'b'.repeat(40));
  assert.match(calls[0].apiPath, /head=owner%3Afix%2Fbranch/);
  assert.equal(calls[1].apiPath, '/repos/owner/repo/pulls/12');
});

test('tryGhMerge binds the exact verified head SHA without early branch cleanup', async () => {
  const calls = [];
  const backend = {
    mode: 'api',
    token: 'token',
    owner: 'owner',
    repo: 'repo',
    apiRequest: async (method, apiPath, options) => {
      calls.push({ method, apiPath, body: options && options.body });
      return {};
    },
  };

  assert.equal(await tryGhMerge(12, { backend, expectedHeadSha: 'b'.repeat(40) }), true);
  assert.deepEqual(calls.map((call) => call.method), ['PUT']);
  assert.equal(calls[0].apiPath, '/repos/owner/repo/pulls/12/merge');
  assert.deepEqual(calls[0].body, { merge_method: 'squash', sha: 'b'.repeat(40) });
});

test('gh CLI merge arguments carry match-head-commit', () => {
  assert.deepEqual(buildGhMergeArgs(12, 'b'.repeat(40)), [
    'pr', 'merge', '12', '--squash', '--match-head-commit', 'b'.repeat(40),
  ]);
});

test('base updates use an explicit non-force refspec for the configured branch', () => {
  assert.deepEqual(buildBasePushArgs('stable'), [
    'push', 'origin', 'HEAD:refs/heads/stable',
  ]);
});

test('feature cleanup uses an exact remote-head lease and cannot target the base branch', () => {
  const head = 'b'.repeat(40);
  assert.deepEqual(buildFeatureDeleteArgs('fix/verified', 'stable', head), [
    'push',
    `--force-with-lease=refs/heads/fix/verified:${head}`,
    'origin',
    ':refs/heads/fix/verified',
  ]);
  assert.throws(() => buildFeatureDeleteArgs('stable', 'stable', head), /configured base branch/u);
});

test('feature cleanup verifies a failed delete as already absent or head drift', () => {
  const expected = 'a'.repeat(40);
  const changed = 'b'.repeat(40);
  const attempted = [];
  const alreadyAbsent = deleteRemoteFeatureBranch('fix/example', 'stable', expected, {
    runGit(args) {
      attempted.push(args);
      if (args[0] === 'push') throw new Error('remote ref not found');
      assert.deepEqual(args, ['ls-remote', '--heads', 'origin', 'refs/heads/fix/example']);
      return '';
    },
  });
  assert.equal(alreadyAbsent.deleted, true);
  assert.equal(alreadyAbsent.alreadyAbsent, true);
  assert.equal(attempted.length, 2);

  const drifted = deleteRemoteFeatureBranch('fix/example', 'stable', expected, {
    runGit(args) {
      if (args[0] === 'push') throw new Error('stale lease');
      return `${changed}\trefs/heads/fix/example\n`;
    },
  });
  assert.equal(drifted.deleted, false);
  assert.equal(drifted.reason, 'head_drift');
  assert.equal(drifted.actualHeadSha, changed);
});

test('feature cleanup defers a proxy-rejected delete in Claude Code cloud sessions only', () => {
  const expected = 'a'.repeat(40);
  const rejectingGit = (args) => {
    if (args[0] === 'push') throw new Error('! [remote rejected] fix/example (permission denied: 403)');
    return `${expected}\trefs/heads/fix/example\n`;
  };
  const cloud = deleteRemoteFeatureBranch('fix/example', 'stable', expected, {
    runGit: rejectingGit,
    env: { CLAUDE_CODE_REMOTE: 'true', GH_TOKEN: 'proxy-injected' },
  });
  assert.equal(cloud.deleted, false);
  assert.equal(cloud.reason, 'deferred_by_proxy');
  assert.equal(cloud.actualHeadSha, expected);
  assert.equal(remoteBranchCleanupStatus(cloud), 'DEFERRED_BY_PROXY');

  const local = deleteRemoteFeatureBranch('fix/example', 'stable', expected, {
    runGit: rejectingGit,
    env: { GH_TOKEN: 'ghp_local' },
  });
  assert.equal(local.reason, 'delete_failed');
  assert.equal(remoteBranchCleanupStatus(local), 'FAILED');

  assert.equal(remoteBranchCleanupStatus({ deleted: true }), 'COMPLETE');
  assert.equal(remoteBranchCleanupStatus({ deleted: true, alreadyAbsent: true }), 'COMPLETE');
  assert.equal(remoteBranchCleanupStatus({ deleted: false, reason: 'head_drift' }), 'FAILED');
});

test('closeAndCleanup still closes the PR when the cloud proxy defers remote branch deletion', async () => {
  const expected = 'a'.repeat(40);
  const closed = [];
  const result = await closeAndCleanup('fix/example', { number: 7 }, 'fix: x', {
    baseBranch: 'stable',
    expectedHeadSha: expected,
    env: { CLAUDE_CODE_REMOTE: 'true' },
    runGit(args) {
      if (args[0] === 'push') throw new Error('remote rejected');
      return `${expected}\trefs/heads/fix/example\n`;
    },
    closePr: async (number) => { closed.push(number); return { status: 0 }; },
  });
  assert.deepEqual(closed, [7]);
  assert.equal(result.reason, 'deferred_by_proxy');

  await assert.rejects(
    closeAndCleanup('fix/example', { number: 8 }, 'fix: x', {
      baseBranch: 'stable',
      expectedHeadSha: expected,
      env: {},
      runGit(args) {
        if (args[0] === 'push') throw new Error('remote rejected');
        return `${expected}\trefs/heads/fix/example\n`;
      },
      closePr: async (number) => { closed.push(number); return { status: 0 }; },
    }),
    /preserved and the PR was not closed/u,
  );
  assert.deepEqual(closed, [7]);
});

test('closePullRequest and read helpers use API', async () => {
  const calls = [];
  const backend = {
    mode: 'api',
    token: 'token',
    owner: 'owner',
    repo: 'repo',
    apiRequest: async (method, apiPath, options) => {
      calls.push({ method, apiPath, body: options && options.body });
      if (apiPath.endsWith('/pulls/12')) {
        return { title: 'fix title', state: 'closed', merged: true };
      }
      return {};
    },
  };

  assert.equal(await getPrTitle(12, { backend }), 'fix title');
  assert.equal(await checkPrState(12, { backend }), 'MERGED');
  const result = await closePullRequest(12, 'merged locally', { backend });

  assert.equal(result.status, 0);
  assert.deepEqual(calls.slice(2).map((call) => [call.method, call.apiPath]), [
    ['POST', '/repos/owner/repo/issues/12/comments'],
    ['PATCH', '/repos/owner/repo/issues/12'],
  ]);
  assert.deepEqual(calls[2].body, { body: 'merged locally' });
  assert.deepEqual(calls[3].body, { state: 'closed' });
});

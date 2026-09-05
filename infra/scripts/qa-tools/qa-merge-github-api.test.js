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
  deleteRemoteFeatureBranch,
  parseGitHubRepoSlug,
  tryGhMerge,
} = require('./qa-merge');

test('createGitHubBackend falls back to API when gh is missing and GH_TOKEN exists', () => {
  assert.deepEqual(parseGitHubRepoSlug('git@github.com:owner/repo.git'), {
    owner: 'owner',
    repo: 'repo',
  });

  const backend = createGitHubBackend({
    ghAvailable: false,
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

test('findOpenPR uses GitHub API fallback and normalizes mergeability', async () => {
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

test('closePullRequest and read helpers use API fallback', async () => {
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

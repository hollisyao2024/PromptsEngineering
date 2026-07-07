const assert = require('node:assert/strict');
const test = require('node:test');

const {
  checkPrState,
  closePullRequest,
  createGitHubBackend,
  findOpenPR,
  getPrTitle,
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
      };
    },
  };

  const pr = await findOpenPR('fix/branch', { backend });

  assert.equal(pr.number, 12);
  assert.equal(pr.mergeable, 'MERGEABLE');
  assert.match(calls[0].apiPath, /head=owner%3Afix%2Fbranch/);
  assert.equal(calls[1].apiPath, '/repos/owner/repo/pulls/12');
});

test('tryGhMerge uses API merge endpoint and deletes same-repo branch', async () => {
  const calls = [];
  const backend = {
    mode: 'api',
    token: 'token',
    owner: 'owner',
    repo: 'repo',
    apiRequest: async (method, apiPath, options) => {
      calls.push({ method, apiPath, body: options && options.body });
      if (method === 'GET') {
        return {
          head: {
            ref: 'fix/branch',
            repo: { full_name: 'owner/repo' },
          },
        };
      }
      return {};
    },
  };

  assert.equal(await tryGhMerge(12, { backend }), true);
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'PUT', 'DELETE']);
  assert.equal(calls[1].apiPath, '/repos/owner/repo/pulls/12/merge');
  assert.deepEqual(calls[1].body, { merge_method: 'squash' });
  assert.equal(calls[2].apiPath, '/repos/owner/repo/git/refs/heads/fix/branch');
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

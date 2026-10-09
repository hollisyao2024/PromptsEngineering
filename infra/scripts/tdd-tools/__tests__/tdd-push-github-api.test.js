'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGitHubBackend } = require('../../shared/github-api');

const {
  buildAutoCommitMessage,
  buildPrTitle,
  ensurePullRequest,
} = require('../tdd-push');

const reviewDecision = { gateResult: 'skipped', reason: 'docs only', baseRef: 'origin/stable' };

function apiBackend(handler) {
  const calls = [];
  return {
    calls,
    backend: createGitHubBackend({
      ghAvailable: true,
      token: 'token',
      remoteUrl: 'https://github.com/owner/repo.git',
      apiRequest: async (method, apiPath, options) => {
        calls.push({ method, apiPath, body: options && options.body });
        return handler(method, apiPath, options);
      },
    }),
  };
}

test('auto-commit message follows conventional type from branch prefix and drops date suffix', () => {
  assert.equal(buildAutoCommitMessage('docs/prd-xirang-merge-evidence-20261004'), 'docs: prd xirang merge evidence');
  assert.equal(buildAutoCommitMessage('feature/REMOVE-CONVENTIONS-LINE-LIMIT-20261004'), 'feat: remove conventions line limit');
  assert.equal(buildAutoCommitMessage('fix/tdd-push-pr-api-fallback'), 'fix: tdd push pr api fallback');
  assert.equal(buildAutoCommitMessage('refactor/split-backend'), 'refactor: split backend');
  assert.equal(buildAutoCommitMessage('feature/TASK-QA-001-add-gate'), 'feat: add gate (TASK-QA-001)');
  const fallback = buildAutoCommitMessage('spike/try-things');
  assert.equal(fallback, 'chore: spike try things');
  assert.doesNotMatch(fallback, /auto-commit before/);
});

test('PR title uses the same conventional derivation', () => {
  assert.equal(buildPrTitle('docs/prd-xirang-merge-evidence-20261004'), 'docs: prd xirang merge evidence');
  assert.equal(buildPrTitle('feature/TASK-QA-001-add-gate'), 'feat(qa): add gate');
  assert.equal(buildPrTitle('spike/try-things'), 'chore: spike try things');
});

test('ensurePullRequest prefers API with configured base even when gh is available', async () => {
  const { backend, calls } = apiBackend((method) => {
    if (method === 'GET') return [];
    return { number: 7, html_url: 'https://github.com/owner/repo/pull/7' };
  });

  const result = await ensurePullRequest({
    branch: 'fix/api-pr',
    baseBranch: 'stable',
    reviewDecision,
    backend,
  });

  assert.equal(result.status, 'created');
  assert.deepEqual(result.pr, { number: 7, url: 'https://github.com/owner/repo/pull/7' });
  assert.match(calls[0].apiPath, /^\/repos\/owner\/repo\/pulls\?head=owner%3Afix%2Fapi-pr&state=open/);
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].apiPath, '/repos/owner/repo/pulls');
  assert.equal(calls[1].body.head, 'fix/api-pr');
  assert.equal(calls[1].body.base, 'stable');
  assert.equal(calls[1].body.title, 'fix: api pr');
  assert.match(calls[1].body.body, /Gate-Result: skipped/);
});

test('ensurePullRequest updates Review Gate of an existing PR through GitHub API', async () => {
  const { backend, calls } = apiBackend((method, apiPath) => {
    if (method === 'GET' && apiPath.includes('/pulls?')) {
      return [{ number: 9, html_url: 'https://github.com/owner/repo/pull/9', body: '### 概要\n- x\n\n### Review Gate\n- Gate-Result: old\n' }];
    }
    return {};
  });

  const result = await ensurePullRequest({ branch: 'fix/api-pr', baseBranch: 'stable', reviewDecision, backend });

  assert.equal(result.status, 'existing');
  assert.equal(result.pr.number, 9);
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].apiPath, '/repos/owner/repo/pulls/9');
  assert.match(calls[1].body.body, /Gate-Result: skipped/);
  assert.doesNotMatch(calls[1].body.body, /Gate-Result: old/);
});

test('ensurePullRequest propagates API creation failures instead of silently skipping', async () => {
  const { backend } = apiBackend((method) => {
    if (method === 'GET') return [];
    throw new Error('GitHub API POST failed (422): Validation Failed');
  });

  await assert.rejects(
    ensurePullRequest({
      branch: 'fix/api-pr', baseBranch: 'stable', reviewDecision, backend,
      runGh: () => assert.fail('API failure must not invoke gh'),
    }),
    /422/
  );
});

test('ensurePullRequest keeps gh CLI path with explicit base and head', async () => {
  const ghCalls = [];
  const runGh = (args) => {
    ghCalls.push(args);
    if (args[1] === 'list') return { status: 0, stdout: '[]', stderr: '' };
    return { status: 0, stdout: 'https://github.com/owner/repo/pull/3\n', stderr: '' };
  };

  const result = await ensurePullRequest({
    branch: 'fix/gh-pr',
    baseBranch: 'stable',
    reviewDecision,
    backend: { mode: 'gh' },
    runGh,
  });

  assert.equal(result.status, 'created');
  assert.equal(result.pr.url, 'https://github.com/owner/repo/pull/3');
  const create = ghCalls.find((args) => args[1] === 'create');
  assert.deepEqual(create.slice(-4), ['--head', 'fix/gh-pr', '--base', 'stable']);
});

test('ensurePullRequest fails when gh pr create fails', async () => {
  const runGh = (args) => (args[1] === 'list'
    ? { status: 0, stdout: '[]', stderr: '' }
    : { status: 1, stdout: '', stderr: 'denied' });

  await assert.rejects(
    ensurePullRequest({ branch: 'fix/gh-pr', baseBranch: 'stable', reviewDecision, backend: { mode: 'gh' }, runGh }),
    /denied/
  );
});

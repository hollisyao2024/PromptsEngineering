'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  fetchWithRetry,
  findMergedPullRequest,
  validateMergedPrReceipt,
} = require('../qa-merge');

const HEAD_SHA = 'b'.repeat(40);
const BASE_SHA = 'a'.repeat(40);
const MERGE_SHA = 'c'.repeat(40);

function receipt(overrides = {}) {
  return {
    schema_version: 1,
    verdict: 'passed',
    base_branch: 'main',
    branch: 'tdd/fix',
    base_sha: BASE_SHA,
    head_sha: HEAD_SHA,
    ...overrides,
  };
}

function apiBackend(pulls) {
  const calls = [];
  return {
    calls,
    backend: {
      mode: 'api',
      token: 'token',
      owner: 'owner',
      repo: 'repo',
      apiRequest: async (method, apiPath) => {
        calls.push({ method, apiPath });
        return pulls;
      },
    },
  };
}

test('findMergedPullRequest returns only the merged PR at the verified head SHA', async () => {
  const { backend, calls } = apiBackend([
    { number: 7, merged_at: null, base: { ref: 'main' }, head: { ref: 'tdd/fix', sha: HEAD_SHA } },
    { number: 8, merged_at: '2026-10-01T00:00:00Z', base: { ref: 'main' }, head: { ref: 'tdd/fix', sha: 'd'.repeat(40) } },
    {
      number: 9,
      title: 'fix: merged',
      merged_at: '2026-10-01T00:00:00Z',
      merge_commit_sha: MERGE_SHA,
      base: { ref: 'main', sha: BASE_SHA },
      head: { ref: 'tdd/fix', sha: HEAD_SHA },
    },
  ]);

  const pr = await findMergedPullRequest('tdd/fix', { backend, headSha: HEAD_SHA, baseBranch: 'main' });

  assert.equal(pr.number, 9);
  assert.equal(pr.mergeCommitSha, MERGE_SHA);
  assert.equal(pr.headRefOid, HEAD_SHA);
  assert.match(calls[0].apiPath, /state=closed/);
  assert.equal(
    await findMergedPullRequest('tdd/fix', { backend, headSha: 'e'.repeat(40), baseBranch: 'main' }),
    null,
  );
});

test('merged-PR resume requires a passed receipt bound to the same branch and head', () => {
  const pr = { number: 9, baseRefName: 'main', headRefName: 'tdd/fix', headRefOid: HEAD_SHA };
  const current = { baseBranch: 'main', branch: 'tdd/fix' };

  assert.equal(validateMergedPrReceipt(receipt(), pr, current).head_sha, HEAD_SHA);
  assert.throws(() => validateMergedPrReceipt(null, pr, current), /receipt is missing/);
  assert.throws(() => validateMergedPrReceipt(receipt({ verdict: 'failed' }), pr, current), /VERDICT/);
  assert.throws(() => validateMergedPrReceipt(receipt({ branch: 'other' }), pr, current), /BRANCH/);
  assert.throws(
    () => validateMergedPrReceipt(receipt(), { ...pr, headRefOid: 'd'.repeat(40) }, current),
    /PR_HEAD_SHA/,
  );
  assert.throws(
    () => validateMergedPrReceipt(receipt(), { ...pr, baseRefName: 'stable' }, current),
    /PR_BASE_BRANCH/,
  );
});

test('fetchWithRetry retries a transient local ref-lock failure', () => {
  let calls = 0;
  const sleeps = [];
  fetchWithRetry(['fetch', 'origin'], {
    cwd: '/repo',
    sleep: (ms) => sleeps.push(ms),
    runGit: () => {
      calls += 1;
      if (calls < 3) throw new Error('cannot lock ref refs/remotes/origin/main');
      return '';
    },
  });
  assert.equal(calls, 3);
  assert.equal(sleeps.length, 2);

  let failing = 0;
  assert.throws(() => fetchWithRetry(['fetch', 'origin'], {
    sleep: () => {},
    runGit: () => { failing += 1; throw new Error('network down'); },
  }), /network down/);
  assert.equal(failing, 3);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPrBody,
  collectBranchCommits,
  ensurePullRequest,
  resolvePrTitle,
} = require('../tdd-push');

const reviewDecision = { shouldReview: false, reasons: [], baseRef: 'origin/stable' };
const commits = [
  {
    sha: 'a'.repeat(40),
    subject: 'fix(qa): reuse PR summary',
    body: '- remote merges pass commit title\n- gh passes --subject\n\nCo-Authored-By: Bot <bot@example.com>',
  },
  { sha: 'b'.repeat(40), subject: 'test: cover summary', body: '' },
];

test('PR summary uses commit body bullets, falling back to subjects', () => {
  const body = buildPrBody('fix: branch title', reviewDecision, commits);
  assert.match(body, /### 概要\n- remote merges pass commit title\n- gh passes --subject\n- test: cover summary\n\n### 变更内容/);
  assert.match(body, /### 变更内容\n- aaaaaaa fix\(qa\): reuse PR summary\n- bbbbbbb test: cover summary\n/);
  assert.doesNotMatch(body, /Co-Authored-By/);
});

test('PR body without commits keeps the title summary fallback', () => {
  const body = buildPrBody('fix: branch title', reviewDecision, []);
  assert.match(body, /### 概要\n- fix: branch title\n\n### 变更内容\n_见 commit 历史_/);
});

test('single conventional commit subject becomes the PR title', () => {
  assert.equal(resolvePrTitle('fix/x', [commits[0]]), 'fix(qa): reuse PR summary');
  assert.equal(resolvePrTitle('fix/branch-title', commits), 'fix: branch title');
  assert.equal(resolvePrTitle('fix/branch-title', [{ sha: 'c', subject: 'wip', body: '' }]), 'fix: branch title');
});

test('collectBranchCommits parses oldest-first git log records against the base', () => {
  const calls = [];
  const out = collectBranchCommits('stable', {
    runGit(args) {
      calls.push(args);
      if (args[0] === 'rev-parse') return 'ok\n';
      return `${'a'.repeat(40)}\x1fsubj one\x1fline\n\x1e\n${'b'.repeat(40)}\x1fsubj two\x1f\x1e\n`;
    },
  });
  assert.deepEqual(calls[1].slice(0, 2), ['log', '--reverse']);
  assert.equal(calls[1][calls[1].length - 1], 'origin/stable..HEAD');
  assert.deepEqual(out, [
    { sha: 'a'.repeat(40), subject: 'subj one', body: 'line' },
    { sha: 'b'.repeat(40), subject: 'subj two', body: '' },
  ]);
});

test('ensurePullRequest builds title and body from branch commits', async () => {
  const calls = [];
  const backend = {
    mode: 'api', token: 't', owner: 'owner', repo: 'repo',
    apiRequest: async (method, apiPath, options) => {
      calls.push({ method, body: options && options.body });
      return method === 'GET' ? [] : { number: 9, html_url: 'u' };
    },
  };
  await ensurePullRequest({ branch: 'fix/x', baseBranch: 'stable', reviewDecision, backend, commits: [commits[0]] });
  assert.equal(calls[1].body.title, 'fix(qa): reuse PR summary');
  assert.match(calls[1].body.body, /### 概要\n- remote merges pass commit title/);
});

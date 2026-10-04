'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPrBody,
  collectBranchCommits,
  ensurePullRequest,
  resolvePrTitle,
} = require('../tdd-push');

const reviewDecision = { gateResult: 'skipped', reason: 'docs only', baseRef: 'origin/stable' };
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

const START = '<!-- xirang:auto-summary:start -->';
const END = '<!-- xirang:auto-summary:end -->';

test('new PR body wraps generated summary and changes in auto-summary markers', () => {
  const body = buildPrBody('fix: t', reviewDecision, commits);
  assert.ok(body.startsWith(`${START}\n### 概要\n`));
  assert.match(body, new RegExp(`- bbbbbbb test: cover summary\\n${END}\\n\\n### 文档回写`));
});

function existingPrBackend(body) {
  const calls = [];
  return {
    calls,
    backend: {
      mode: 'api', token: 't', owner: 'owner', repo: 'repo',
      apiRequest: async (method, apiPath, options) => {
        calls.push({ method, body: options && options.body });
        return method === 'GET' ? [{ number: 9, html_url: 'u', body }] : {};
      },
    },
  };
}

test('existing PR with markers gets summary refreshed from current commits; manual sections kept', async () => {
  const old = `${START}\n### 概要\n- stale\n\n### 变更内容\n- 1111111 old\n${END}\n\n### 文档回写\n- keep\n\n### Review Gate\n- Gate-Result: old\n\n### 语义审查\n- manual note\n`;
  const { backend, calls } = existingPrBackend(old);
  await ensurePullRequest({ branch: 'fix/x', baseBranch: 'stable', reviewDecision, backend, commits });
  const next = calls[1].body.body;
  assert.doesNotMatch(next, /stale|1111111|Gate-Result: old/);
  assert.match(next, new RegExp(`${START}\\n### 概要\\n- remote merges pass commit title`));
  assert.match(next, /- bbbbbbb test: cover summary/);
  assert.match(next, /### 文档回写\n- keep/);
  assert.match(next, /### 语义审查\n- manual note/);
  assert.match(next, /- Base-Ref: origin\/stable\n\n### 语义审查/);
  assert.match(next, /Gate-Result: skipped/);
});

test('existing PR without markers or without commits keeps its summary untouched', async () => {
  const manual = '### 概要\n- hand written\n\n### Review Gate\n- Gate-Result: old\n';
  const a = existingPrBackend(manual);
  await ensurePullRequest({ branch: 'fix/x', baseBranch: 'stable', reviewDecision, backend: a.backend, commits });
  assert.match(a.calls[1].body.body, /- hand written/);

  const marked = `${START}\n### 概要\n- keep me\n${END}\n`;
  const b = existingPrBackend(marked);
  await ensurePullRequest({ branch: 'fix/x', baseBranch: 'stable', reviewDecision, backend: b.backend, commits: [] });
  assert.match(b.calls[1].body.body, /- keep me/);
});

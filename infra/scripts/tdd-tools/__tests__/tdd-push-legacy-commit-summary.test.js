'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ensurePullRequest, refreshAutoSummaryInBody } = require('../tdd-push');

const reviewDecision = { gateResult: 'skipped', reason: 'docs only', baseRef: 'origin/stable' };
const commitA = { sha: 'a'.repeat(40), subject: 'fix: one', body: '- point one' };
const commitB = { sha: 'b'.repeat(40), subject: 'test: two', body: '' };

// 3.7.14 的 buildPrBody：无标记，概要取提交要点，变更内容列出 sha7 与提交标题
const legacyCommitBody = '### 概要\n- point one\n\n### 变更内容\n- aaaaaaa fix: one\n\n### 文档回写\n- keep\n';

test('untouched 3.7.14 commit-derived body is upgraded with current commits', () => {
  const next = refreshAutoSummaryInBody(legacyCommitBody, 'fix: one', [commitA, commitB]);
  assert.equal(next.status, 'upgraded');
  assert.match(next.body, /^<!-- xirang:auto-summary:start digest=[0-9a-f]{12} -->\n### 概要\n- point one\n- test: two\n\n### 变更内容\n- aaaaaaa fix: one\n- bbbbbbb test: two\n<!-- xirang:auto-summary:end -->\n\n### 文档回写\n- keep\n$/);
});

test('3.7.14 body with CRLF line endings is still recognised', () => {
  const next = refreshAutoSummaryInBody(legacyCommitBody.replace(/\n/g, '\r\n'), 'fix: one', [commitA, commitB]);
  assert.equal(next.status, 'upgraded');
});

test('edited 3.7.14 body or one listing commits no longer on the branch stays untouched', () => {
  const edited = legacyCommitBody.replace('- point one', '- my own words');
  const a = refreshAutoSummaryInBody(edited, 'fix: one', [commitA, commitB]);
  assert.equal(a.status, 'unmarked');
  assert.equal(a.body, edited);

  const rebased = refreshAutoSummaryInBody(legacyCommitBody, 'fix: one', [{ ...commitA, sha: 'c'.repeat(40) }]);
  assert.equal(rebased.status, 'unmarked');
  assert.equal(rebased.body, legacyCommitBody);
});

test('ensurePullRequest upgrades a PR opened by 3.7.14', async () => {
  const calls = [];
  const backend = {
    mode: 'api', token: 't', owner: 'owner', repo: 'repo',
    apiRequest: async (method, apiPath, options) => {
      calls.push({ method, body: options && options.body });
      return method === 'GET' ? [{ number: 9, html_url: 'u', title: 'fix: one', body: legacyCommitBody }] : {};
    },
  };
  const result = await ensurePullRequest({ branch: 'fix/x', baseBranch: 'stable', reviewDecision, backend, commits: [commitA, commitB] });
  assert.equal(result.summaryStatus, 'upgraded');
  assert.match(calls[1].body.body, /- bbbbbbb test: two\n<!-- xirang:auto-summary:end -->\n\n### 文档回写\n- keep/);
});

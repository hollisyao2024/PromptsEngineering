'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAutoCommitBody,
  buildPrBody,
  ensurePullRequest,
  parseWorkingTreeStatus,
  refreshAutoSummaryInBody,
} = require('../tdd-push');

const reviewDecision = { gateResult: 'skipped', reason: 'docs only', baseRef: 'origin/stable' };
const commitA = { sha: 'a'.repeat(40), subject: 'fix: one', body: '- point one' };
const commitB = { sha: 'b'.repeat(40), subject: 'test: two', body: '' };

test('start marker records a digest of the generated block', () => {
  const body = buildPrBody('fix: one', reviewDecision, [commitA]);
  assert.match(body, /^<!-- xirang:auto-summary:start digest=[0-9a-f]{12} -->\n### 概要\n- point one/);
});

test('untouched digest block refreshes; CRLF from web edits still counts as untouched', () => {
  const old = buildPrBody('fix: one', reviewDecision, [commitA]);
  const next = refreshAutoSummaryInBody(old, 'fix: one', [commitA, commitB]);
  assert.equal(next.status, 'refreshed');
  assert.match(next.body, /- bbbbbbb test: two/);

  const crlf = refreshAutoSummaryInBody(old.replace(/\n/g, '\r\n'), 'fix: one', [commitA, commitB]);
  assert.equal(crlf.status, 'refreshed');
});

test('manually edited block inside markers is preserved', () => {
  const old = buildPrBody('fix: one', reviewDecision, [commitA]).replace('- point one', '- hand tuned point');
  const next = refreshAutoSummaryInBody(old, 'fix: one', [commitA, commitB]);
  assert.equal(next.status, 'manual-edit');
  assert.equal(next.body, old);
});

test('legacy digest-less markers still refresh', () => {
  const old = '<!-- xirang:auto-summary:start -->\n### 概要\n- stale\n<!-- xirang:auto-summary:end -->\n';
  const next = refreshAutoSummaryInBody(old, 'fix: one', [commitA]);
  assert.equal(next.status, 'refreshed');
  assert.match(next.body, /- point one/);
});

test('legacy unmarked auto summary is upgraded; hand-written unmarked summary is kept', () => {
  const legacy = '### 概要\n- fix: one\n\n### 变更内容\n_见 commit 历史_\n\n### 文档回写\n- keep\n';
  const upgraded = refreshAutoSummaryInBody(legacy, 'fix: one', [commitA], { legacyTitles: ['fix: one'] });
  assert.equal(upgraded.status, 'upgraded');
  assert.match(upgraded.body, /^<!-- xirang:auto-summary:start digest=[0-9a-f]{12} -->\n### 概要\n- point one\n\n### 变更内容\n- aaaaaaa fix: one\n<!-- xirang:auto-summary:end -->\n\n### 文档回写\n- keep\n$/);

  const manual = '### 概要\n- my own words\n\n### 变更内容\n_见 commit 历史_\n';
  const kept = refreshAutoSummaryInBody(manual, 'fix: one', [commitA], { legacyTitles: ['fix: one'] });
  assert.equal(kept.status, 'unmarked');
  assert.equal(kept.body, manual);
});

test('no commits never rewrites the body', () => {
  const old = buildPrBody('fix: one', reviewDecision, [commitA]);
  assert.equal(refreshAutoSummaryInBody(old, 'fix: one', []).status, 'no-commits');
});

test('ensurePullRequest upgrades a legacy PR using its current title', async () => {
  const calls = [];
  const backend = {
    mode: 'api', token: 't', owner: 'owner', repo: 'repo',
    apiRequest: async (method, apiPath, options) => {
      calls.push({ method, body: options && options.body });
      return method === 'GET'
        ? [{ number: 9, html_url: 'u', title: 'fix: custom title', body: '### 概要\n- fix: custom title\n\n### 变更内容\n_见 commit 历史_\n' }]
        : {};
    },
  };
  const result = await ensurePullRequest({ branch: 'fix/x', baseBranch: 'stable', reviewDecision, backend, commits: [commitA] });
  assert.equal(result.summaryStatus, 'upgraded');
  assert.match(calls[1].body.body, /xirang:auto-summary:start digest=/);
});

test('working tree status keeps the leading status column and becomes commit body bullets', () => {
  const lines = parseWorkingTreeStatus(' M infra/a.js\n?? docs/new.md\nD  old.txt\nR  from.js -> to.js\nA  added.js\n');
  assert.deepEqual(lines, [' M infra/a.js', '?? docs/new.md', 'D  old.txt', 'R  from.js -> to.js', 'A  added.js']);
  assert.equal(
    buildAutoCommitBody(lines),
    '- 修改 infra/a.js\n- 新增 docs/new.md\n- 删除 old.txt\n- 重命名 from.js -> to.js\n- 新增 added.js'
  );
  const many = Array.from({ length: 23 }, (_, i) => ` M f${i}.js`);
  const body = buildAutoCommitBody(many).split('\n');
  assert.equal(body.length, 21);
  assert.equal(body[20], '- 另有 3 个文件改动');
});

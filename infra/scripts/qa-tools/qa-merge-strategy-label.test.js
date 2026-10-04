const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCommitMessage,
  formatMergeStrategyLabel,
  resolveRemoteMergeStrategy,
} = require('./qa-merge');

test('remote merge strategy reflects the GitHub backend actually used', () => {
  assert.equal(resolveRemoteMergeStrategy({ mode: 'api' }), 'api');
  assert.equal(resolveRemoteMergeStrategy({ mode: 'gh' }), 'gh');
});

test('summary label distinguishes gh CLI, GitHub API and local squash merges', () => {
  assert.equal(formatMergeStrategyLabel('gh'), 'gh pr merge --squash');
  assert.equal(formatMergeStrategyLabel('api'), 'GitHub API squash merge');
  assert.equal(formatMergeStrategyLabel('local'), '本地 git merge --squash');
});

test('local squash commit message carries no hardcoded model co-author', () => {
  const message = buildCommitMessage({
    number: 7,
    title: 'fix: example',
    body: '## 概要\n- first change\n\n## 测试\n- ok',
  });
  assert.equal(message, 'fix: example (#7)\n\n- first change');
  assert.doesNotMatch(message, /Co-Authored-By/i);
});

test('remote squash merges reuse the local commit title and summary body', async () => {
  const { buildGhMergeArgs, tryGhMerge } = require('./qa-merge');
  const pr = { number: 7, title: 'fix: example', body: '## 概要\n- first change\n\n## 测试\n- ok' };
  const head = 'b'.repeat(40);

  const calls = [];
  const backend = {
    mode: 'api', token: 't', owner: 'o', repo: 'r',
    apiRequest: async (method, apiPath, options) => { calls.push(options.body); return {}; },
  };
  assert.equal(await tryGhMerge(7, { backend, expectedHeadSha: head, pr }), true);
  assert.deepEqual(calls[0], {
    merge_method: 'squash',
    sha: head,
    commit_title: 'fix: example (#7)',
    commit_message: '- first change',
  });

  assert.deepEqual(buildGhMergeArgs(7, head, pr), [
    'pr', 'merge', '7', '--squash', '--match-head-commit', head,
    '--subject', 'fix: example (#7)', '--body', '- first change',
  ]);
  assert.deepEqual(buildGhMergeArgs(7, head), [
    'pr', 'merge', '7', '--squash', '--match-head-commit', head,
  ]);
});

test('squash commit summary ignores HTML comment marker lines', () => {
  const message = buildCommitMessage({
    number: 8,
    title: 'fix: marked',
    body: '<!-- xirang:auto-summary:start -->\n### 概要\n<!-- note -->\n- real point\n\n### 变更内容\n- abc\n<!-- xirang:auto-summary:end -->',
  });
  assert.equal(message, 'fix: marked (#8)\n\n- real point');
});

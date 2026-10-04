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

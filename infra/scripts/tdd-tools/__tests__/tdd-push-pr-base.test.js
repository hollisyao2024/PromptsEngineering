'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPrCreateArgs, parseCliArgs, autoCommitWorkingTreeIfNeeded } = require('../tdd-push');

test('committed-only push explicitly opts out of staging and automatic commits', () => {
  assert.equal(parseCliArgs(['--committed-only']).committedOnly, true);
  assert.equal(parseCliArgs([]).committedOnly, false);
  const result = autoCommitWorkingTreeIfNeeded('fix/dirty', {
    committedOnly: true,
    getWorkingTreeStatusLines() { assert.fail('must not enter automatic commit path'); },
  });
  assert.equal(result.committed, false);
  assert.equal(result.retainedWorkingTree, true);
});

test('tdd push creates a PR with explicit configured base and head branches', () => {
  const args = buildPrCreateArgs({
    title: 'fix: safe merge',
    body: 'body',
    branch: 'fix/safe-merge',
    baseBranch: 'stable',
  });

  assert.deepEqual(args, [
    'pr', 'create',
    '--title', 'fix: safe merge',
    '--body', 'body',
    '--head', 'fix/safe-merge',
    '--base', 'stable',
  ]);
});

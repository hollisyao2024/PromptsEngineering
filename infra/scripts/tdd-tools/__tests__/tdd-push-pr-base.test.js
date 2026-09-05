'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPrCreateArgs } = require('../tdd-push');

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

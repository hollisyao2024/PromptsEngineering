'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyBranch, parseArgs, summarize } = require('../branch-reconcile');

test('reconciler never marks protected or active unique branches as removable', () => {
  assert.equal(classifyBranch({ branch: 'main', attached: true, merged: true, hasUniquePatch: false }), 'protected');
  assert.equal(classifyBranch({ branch: 'fix/live', attached: true, merged: false, hasUniquePatch: true }), 'active-unique');
});

test('reconciler distinguishes merged, equivalent, and unique heads', () => {
  assert.equal(classifyBranch({ branch: 'fix/merged', attached: false, merged: true, hasUniquePatch: false }), 'merged');
  assert.equal(classifyBranch({ branch: 'fix/squashed', attached: false, merged: false, hasUniquePatch: false }), 'equivalent');
  assert.equal(classifyBranch({ branch: 'fix/active', attached: false, merged: false, hasUniquePatch: true }), 'unique');
});

test('reconciler requires an explicit opt-in for mutations', () => {
  assert.deepEqual(parseArgs([]), { apply: false, removeWorktrees: false, json: false });
  assert.deepEqual(parseArgs(['--apply', '--remove-worktrees', '--json']), { apply: true, removeWorktrees: true, json: true });
});

test('summary preserves every classification count', () => {
  assert.deepEqual(summarize([{ classification: 'merged' }, { classification: 'merged' }, { classification: 'unique' }]), { merged: 2, unique: 1 });
});

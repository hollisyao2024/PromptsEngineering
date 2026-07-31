'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateCompletionGuard,
  splitStatusLines,
} = require('../tdd-completion-guard');

test('completion guard passes on a clean main branch', () => {
  const result = evaluateCompletionGuard({
    branch: 'main',
    statusLines: [],
    pendingCleanupCount: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'OK');
});

test('completion guard blocks a clean main branch while durable worktree cleanup is pending', () => {
  const result = evaluateCompletionGuard({
    branch: 'main',
    statusLines: [],
    pendingCleanupCount: 1,
    pendingCleanupBranches: ['fix/deferred-cleanup'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED');
  assert.match(result.reason, /worktree 清理尚未收敛/);
  assert.deepEqual(result.nextCommands, [
    'node infra/scripts/tdd-tools/tdd-completion-guard.js',
  ]);
});

test('completion guard blocks dirty main before final response', () => {
  const result = evaluateCompletionGuard({
    branch: 'main',
    statusLines: [' M package.json'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED');
  assert.match(result.reason, /主分支存在未提交改动/);
  assert.ok(result.nextCommands.includes('node infra/scripts/tdd-tools/tdd-sync.js'));
});

test('completion guard blocks dirty task branches with the full TDD and QA chain', () => {
  const result = evaluateCompletionGuard({
    branch: 'fix/example',
    statusLines: [' M packages/core/file.ts'],
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /未提交改动/);
  assert.deepEqual(result.nextCommands, [
    'node infra/scripts/tdd-tools/tdd-sync.js',
    'node infra/scripts/tdd-tools/tdd-push.js',
    'node infra/scripts/qa-tools/generate-qa.js',
    'node infra/scripts/qa-tools/qa-verify.js',
    'node infra/scripts/qa-tools/qa-merge.js',
  ]);
});

test('completion guard blocks clean task branches that are not pushed', () => {
  const result = evaluateCompletionGuard({
    branch: 'fix/example',
    statusLines: [],
    hasUpstream: false,
    headMergedToBase: false,
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /尚未完整推送/);
  assert.equal(result.nextCommands[0], 'node infra/scripts/tdd-tools/tdd-push.js');
});

test('completion guard blocks pushed task branches that are not merged', () => {
  const result = evaluateCompletionGuard({
    branch: 'fix/example',
    statusLines: [],
    hasUpstream: true,
    aheadOfUpstream: 0,
    headMergedToBase: false,
    baseRef: 'origin/main',
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /尚未合入主分支/);
  assert.deepEqual(result.nextCommands, [
    'node infra/scripts/qa-tools/generate-qa.js',
    'node infra/scripts/qa-tools/qa-verify.js',
    'node infra/scripts/qa-tools/qa-merge.js',
  ]);
});

test('completion guard treats matching remote branch as pushed even without upstream', () => {
  const result = evaluateCompletionGuard({
    branch: 'fix/example',
    statusLines: [],
    hasUpstream: false,
    remoteHeadMatchesHead: true,
    headMergedToBase: false,
    baseRef: 'origin/main',
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /尚未合入主分支/);
  assert.equal(result.nextCommands[0], 'node infra/scripts/qa-tools/generate-qa.js');
});

test('completion guard passes task branches already merged to the base ref', () => {
  const result = evaluateCompletionGuard({
    branch: 'fix/example',
    statusLines: [],
    hasUpstream: true,
    aheadOfUpstream: 0,
    headMergedToBase: true,
    baseRef: 'origin/main',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'OK');
});

test('completion guard passes task branches whose patches were squash-merged', () => {
  const result = evaluateCompletionGuard({
    branch: 'fix/example',
    statusLines: [],
    hasUpstream: true,
    aheadOfUpstream: 0,
    headMergedToBase: false,
    headPatchEquivalentToBase: true,
    baseRef: 'origin/main',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'OK');
  assert.match(result.reason, /已合入主分支/);
});

test('completion guard blocks when squash comparison still contains unique patches', () => {
  const result = evaluateCompletionGuard({
    branch: 'fix/example',
    statusLines: [],
    hasUpstream: true,
    aheadOfUpstream: 0,
    headMergedToBase: false,
    headPatchEquivalentToBase: false,
    baseRef: 'origin/main',
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /尚未合入主分支/);
});

test('completion guard accepts an exact pushed head whose PR is merged', () => {
  const result = evaluateCompletionGuard({
    branch: 'fix/example',
    statusLines: [],
    hasUpstream: true,
    aheadOfUpstream: 0,
    headMergedToBase: false,
    headPatchEquivalentToBase: false,
    pullRequestMerged: true,
    baseRef: 'origin/main',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'OK');
});

test('splitStatusLines drops empty lines only', () => {
  assert.deepEqual(splitStatusLines(' M a.js\n?? b.js\n\n'), [' M a.js', '?? b.js']);
});

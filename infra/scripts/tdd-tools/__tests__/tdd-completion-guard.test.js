'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateCompletionGuard,
  parseArgs,
  splitStatusLines,
} = require('../tdd-completion-guard');

test('completion guard passes on a clean main branch', () => {
  const result = evaluateCompletionGuard({
    branch: 'main',
    statusLines: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'OK');
});

test('completion guard blocks clean main while durable cleanup is pending', () => {
  const result = evaluateCompletionGuard({
    branch: 'main',
    statusLines: [],
    lifecycleSessions: [{ branch: 'fix/pending', status: 'cleanup_pending' }],
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /cleanup_pending/);
  assert.deepEqual(result.lifecycleBranches, ['fix/pending']);
});

test('completion guard blocks clean main when post-merge work requires recovery', () => {
  const result = evaluateCompletionGuard({
    branch: 'main',
    statusLines: [],
    lifecycleSessions: [{ branch: 'fix/recovery', status: 'recovery_required' }],
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /recovery_required/);
  assert.deepEqual(result.lifecycleBranches, ['fix/recovery']);
});

test('task-scoped completion guard ignores recovery owned by another task', () => {
  const result = evaluateCompletionGuard({
    branch: 'main',
    statusLines: [],
    taskId: 'cloud-sync-implementation',
    lifecycleSessions: [{
      branch: 'docs/prd-cleanroom-one-click-publish',
      status: 'recovery_required',
      lifecycle: { keys: ['task:cleanroom-one-click-publish'] },
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'OK');
});

test('task-scoped completion guard blocks recovery owned by the finishing task', () => {
  const result = evaluateCompletionGuard({
    branch: 'main',
    statusLines: [],
    taskId: 'cloud-sync-implementation',
    lifecycleSessions: [
      {
        branch: 'docs/prd-cleanroom-one-click-publish',
        status: 'recovery_required',
        lifecycle: { keys: ['task:cleanroom-one-click-publish'] },
      },
      {
        branch: 'feature/cloud-sync-implementation',
        status: 'cleanup_pending',
        lifecycle: { keys: ['task:cloud-sync-implementation'] },
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /cleanup_pending/);
  assert.deepEqual(result.lifecycleBranches, ['feature/cloud-sync-implementation']);
});

test('task scope never bypasses repository state checks', async (t) => {
  await t.test('dirty main remains blocked', () => {
    const result = evaluateCompletionGuard({
      branch: 'main',
      statusLines: [' M package.json'],
      taskId: 'cloud-sync-implementation',
      lifecycleSessions: [{
        branch: 'fix/unrelated',
        status: 'recovery_required',
        lifecycle: { keys: ['task:unrelated'] },
      }],
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /未提交改动/);
  });

  await t.test('unpushed task branch remains blocked', () => {
    const result = evaluateCompletionGuard({
      branch: 'feature/cloud-sync-implementation',
      statusLines: [],
      taskId: 'cloud-sync-implementation',
      hasUpstream: false,
      remoteHeadMatchesHead: false,
      headMergedToBase: false,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /尚未完整推送/);
  });
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

test('splitStatusLines drops empty lines only', () => {
  assert.deepEqual(splitStatusLines(' M a.js\n?? b.js\n\n'), [' M a.js', '?? b.js']);
});

test('completion guard task scope parsing is explicit and fail-closed', () => {
  assert.equal(parseArgs(['--task', 'Cloud-Sync']).taskId, 'cloud-sync');
  assert.equal(parseArgs([]).taskId, '');
  assert.throws(() => parseArgs(['--task=']), /requires a task id/);
});

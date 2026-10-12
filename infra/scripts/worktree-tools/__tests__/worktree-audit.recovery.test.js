'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  auditManagedWorktrees,
  convergeCleanupCandidate,
} = require('../worktree-audit');
const { NOW, orchestrationFixture } = require('./worktree-audit.helpers');

test('persists cleanup intent before effect and retains recovery state when verification is unknown', () => {
  const calls = [];
  const result = convergeCleanupCandidate({
    branch: 'feature/TASK-DEMO-001',
    path: '/container/worktrees/demo',
    expectedHead: 'abc123',
    expectedRevision: 7,
  }, {
    writeIntent: () => calls.push('intent'),
    removeWorktree: () => calls.push('remove'),
    deleteBranch: () => calls.push('branch'),
    removeSession: () => calls.push('session'),
    verify: () => ({ complete: false, reason: 'result-unknown' }),
    writeRecovery: () => calls.push('recovery'),
  });

  assert.deepEqual(calls, ['intent', 'remove', 'branch', 'recovery']);
  assert.deepEqual(result, { state: 'recovery_required', reason: 'result-unknown' });
});

test('audit apply reports attention when a transient cleanup remains pending', () => {
  const fixture = orchestrationFixture({
    removeWorktree: () => {
      fixture.state.calls.push('remove-worktree');
      throw new Error('transient filesystem failure');
    },
  });
  const result = auditManagedWorktrees({
    mainRoot: '/container/repo',
    cwd: '/container/repo',
    config: {
      containerDirs: { worktrees: '/container/worktrees', tmp: '/container/tmp' },
      worktree: { lockDir: '/container/tmp/locks' },
    },
    baseRef: 'main',
    now: NOW,
    apply: true,
    dependencies: fixture.dependencies,
  });

  assert.equal(result.status, 'ATTENTION');
  assert.equal(result.records[0].state, 'cleanup_pending');
  assert.deepEqual(fixture.state.calls, [
    'write:cleanup_pending',
    'remove-worktree',
    'unlock',
  ]);
});

test('audit apply rebinds a legacy recovered session to its exact active task', () => {
  const fixture = orchestrationFixture();
  fixture.state.sessions = [{
    ...fixture.state.sessions[0],
    lifecycle: undefined,
    recovered_from: 'feature/DEMO',
  }];
  const bindings = [];
  fixture.dependencies.listTaskStates = () => [{
    task_id: 'demo',
    project_root: '/container/repo',
    status: 'running',
  }];
  fixture.dependencies.bindTaskLocation = (input) => {
    bindings.push(input);
    return { status: 'BOUND', taskId: input.taskId };
  };

  const result = auditManagedWorktrees({
    mainRoot: '/container/repo',
    cwd: '/container/repo',
    config: {
      containerDirs: { worktrees: '/container/worktrees', tmp: '/container/tmp' },
      worktree: { lockDir: '/container/tmp/locks' },
    },
    baseRef: 'main',
    now: NOW,
    apply: true,
    dependencies: fixture.dependencies,
  });

  assert.equal(result.records[0].state, 'active');
  assert.equal(result.records[0].reason, 'task-active');
  assert.deepEqual(result.records[0].evidence.activeTaskIds, ['demo']);
  assert.deepEqual(bindings.map((item) => item.taskId), ['demo']);
  assert.equal(fixture.state.calls.includes('remove-worktree'), false);
});

test('keeps a persisted cleanup pending after a transient effect failure so reconciliation can retry', () => {
  const calls = [];
  const result = convergeCleanupCandidate({
    branch: 'feature/TASK-DEMO-001',
    path: '/container/worktrees/demo',
    expectedHead: 'abc123',
    expectedRevision: 7,
  }, {
    writeIntent: () => calls.push('intent'),
    removeWorktree: () => {
      calls.push('remove');
      throw new Error('transient filesystem failure');
    },
    deleteBranch: () => calls.push('branch'),
    removeSession: () => calls.push('session'),
    verify: () => ({ complete: false }),
    writeRecovery: () => calls.push('recovery'),
  });

  assert.deepEqual(calls, ['intent', 'remove']);
  assert.deepEqual(result, {
    state: 'cleanup_pending',
    reason: 'cleanup-deferred:transient filesystem failure',
  });
});

test('finalizes the session only after physical and Git cleanup are verified', () => {
  const calls = [];
  const result = convergeCleanupCandidate({
    branch: 'feature/TASK-DEMO-001',
    path: '/container/worktrees/demo',
    expectedHead: 'abc123',
    expectedRevision: 7,
  }, {
    writeIntent: () => calls.push('intent'),
    removeWorktree: () => calls.push('remove'),
    deleteBranch: () => calls.push('branch'),
    removeSession: () => calls.push('session'),
    verify: () => {
      calls.push('verify');
      return { complete: true };
    },
    writeRecovery: () => calls.push('recovery'),
  });

  assert.deepEqual(calls, ['intent', 'remove', 'branch', 'verify', 'session']);
  assert.deepEqual(result, { state: 'cleaned', reason: 'cleanup-verified' });
});

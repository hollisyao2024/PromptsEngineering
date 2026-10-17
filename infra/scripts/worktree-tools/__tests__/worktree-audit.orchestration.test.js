'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  auditManagedWorktrees,
} = require('../worktree-audit');
const { NOW, orchestrationFixture } = require('./worktree-audit.helpers');

test('audit dry-run is read-only and reports a proven candidate', () => {
  const fixture = orchestrationFixture();
  const result = auditManagedWorktrees({
    mainRoot: '/container/repo',
    cwd: '/container/repo',
    config: { containerDirs: { worktrees: '/container/worktrees', tmp: '/container/tmp' } },
    baseRef: 'main',
    now: NOW,
    dependencies: fixture.dependencies,
  });
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.records[0].state, 'cleanup_candidate');
  assert.deepEqual(fixture.state.calls, []);
});

test('task-scoped audit inspects only explicitly owned worktrees and leaves unrelated evidence untouched', () => {
  const fixture = orchestrationFixture();
  const owned = fixture.state.sessions[0];
  const unrelated = {
    ...owned,
    branch: 'feature/OTHER',
    worktree: '/container/worktrees/other',
    lifecycle: { keys: ['task:other'] },
    status: 'recovery_required',
  };
  fixture.state.sessions.push(unrelated);
  fixture.state.entries.push({
    ...fixture.state.entries[0], branch: unrelated.branch, path: unrelated.worktree,
  });
  const before = JSON.stringify(fixture.state);
  const inspected = [];
  fixture.dependencies.inspectGitEvidence = (_root, _base, session) => {
    inspected.push(session.branch);
    assert.equal(session.branch, owned.branch, 'must filter before inspecting another task');
    return { dirty: true, uniqueCommits: 0 };
  };
  fixture.dependencies.collectUnregisteredDirectoryRecords = () => {
    assert.fail('an unregistered directory has no explicit task ownership');
  };
  fixture.dependencies.auditQaPlanSessionStates = () => {
    assert.fail('task finish must not sweep repository-wide QA state');
  };
  const result = auditManagedWorktrees({
    mainRoot: '/container/repo', cwd: '/container/repo',
    config: { containerDirs: { worktrees: '/container/worktrees', tmp: '/container/tmp' } },
    baseRef: 'main', now: NOW, taskId: 'DEMO', dependencies: fixture.dependencies,
  });
  assert.deepEqual(inspected, [owned.branch]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].state, 'recovery_required');
  assert.equal(JSON.stringify(fixture.state), before);
});

test('task-scoped audit cannot apply repository cleanup or silently accept an empty scope', () => {
  for (const options of [{ taskId: 'demo', apply: true }, { taskId: '  ' }]) {
    const fixture = orchestrationFixture();
    assert.throws(() => auditManagedWorktrees({
      mainRoot: '/container/repo', cwd: '/container/repo',
      config: { containerDirs: { worktrees: '/container/worktrees', tmp: '/container/tmp' } },
      baseRef: 'main', dependencies: fixture.dependencies, ...options,
    }), /task.*(?:read.only|requires.*id)/i);
    assert.deepEqual(fixture.state.calls, []);
  }
});

test('audit apply revalidates, persists intent, and verifies exact cleanup', () => {
  const fixture = orchestrationFixture();
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
  assert.equal(result.records[0].state, 'cleaned');
  assert.deepEqual(fixture.state.calls, [
    'write:cleanup_pending',
    'remove-worktree',
    'delete-branch',
    'remove-session',
    'unlock',
  ]);
});

test('audit apply persists dirty evidence as recovery without deletion', () => {
  const fixture = orchestrationFixture({
    inspectGitEvidence: () => ({ dirty: true, uniqueCommits: 0 }),
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
  assert.equal(result.records[0].state, 'recovery_required');
  assert.deepEqual(fixture.state.calls, ['write:recovery_required', 'unlock']);
});

test('audit apply rejects revision drift during immediate revalidation', () => {
  const fixture = orchestrationFixture();
  let reads = 0;
  fixture.dependencies.readSessions = () => {
    reads += 1;
    return [{ ...fixture.state.sessions[0], revision: reads > 1 ? 8 : 7 }];
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
  assert.equal(result.records[0].state, 'recovery_required');
  assert.match(result.records[0].reason, /revalidation/);
  assert.equal(fixture.state.calls.includes('remove-worktree'), false);
});

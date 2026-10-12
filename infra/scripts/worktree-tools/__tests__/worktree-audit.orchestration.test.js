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

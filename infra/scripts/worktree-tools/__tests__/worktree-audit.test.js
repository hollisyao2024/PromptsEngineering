'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  auditManagedWorktrees,
  classifyWorktreeEvidence,
  sessionTaskIds,
} = require('../worktree-audit');
const {
  safeRemoveTreeNoFollow,
} = require('../worktree-core');
const { safeEvidence } = require('./worktree-audit.helpers');

test('extracts stable task bindings from lifecycle keys', () => {
  assert.deepEqual(sessionTaskIds(safeEvidence().session), ['demo']);
});

test('recovers the task binding from a legacy recovered_from branch', () => {
  assert.deepEqual(sessionTaskIds({
    branch: 'recovery/demo-20260825',
    recovered_from: 'feature/DEMO',
  }), ['demo']);

  const recovered = safeEvidence({
    session: {
      ...safeEvidence().session,
      lifecycle: undefined,
      recovered_from: 'feature/DEMO',
    },
    activeTaskIds: ['demo'],
  });
  assert.deepEqual(classifyWorktreeEvidence(recovered), {
    state: 'active',
    reason: 'task-active',
  });
});

test('keeps a new or task-bound worktree active without trusting creator pid liveness', () => {
  const leased = safeEvidence({
    session: {
      ...safeEvidence().session,
      lease: { expires_at: '2026-08-22T13:00:00.000Z' },
      owner: { pid: 999999, token: 'diagnostic-only' },
    },
  });
  assert.deepEqual(classifyWorktreeEvidence(leased), {
    state: 'active',
    reason: 'lease-active',
  });

  const taskBound = safeEvidence({ activeTaskIds: ['demo'] });
  assert.deepEqual(classifyWorktreeEvidence(taskBound), {
    state: 'active',
    reason: 'task-active',
  });
});

test('selects only a fully proven clean orphan as a cleanup candidate', () => {
  assert.deepEqual(classifyWorktreeEvidence(safeEvidence()), {
    state: 'cleanup_candidate',
    reason: 'clean-orphan',
  });
});

test('re-evaluates persisted recovery state from current evidence', () => {
  const recovered = safeEvidence({
    session: {
      ...safeEvidence().session,
      status: 'recovery_required',
      audit: { reason: 'task-inspection-unavailable' },
    },
  });

  assert.deepEqual(classifyWorktreeEvidence(recovered), {
    state: 'cleanup_candidate',
    reason: 'clean-orphan',
  });
  assert.deepEqual(classifyWorktreeEvidence({ ...recovered, dirty: true }), {
    state: 'recovery_required',
    reason: 'dirty-worktree',
  });
});

test('does not clean an unregistered empty directory used by another process', (t) => {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const container = fs.mkdtempSync(path.join(temporaryRoot, 'worktree-audit-process-guard-'));
  const mainRoot = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  const residue = path.join(worktreesRoot, 'empty-but-active');
  fs.mkdirSync(mainRoot, { recursive: true });
  fs.mkdirSync(residue, { recursive: true });
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: temporaryRoot }));

  const result = auditManagedWorktrees({
    mainRoot,
    cwd: mainRoot,
    config: {
      containerDirs: { worktrees: worktreesRoot, tmp: path.join(container, 'tmp') },
    },
    baseRef: 'main',
    dependencies: {
      readSessions: () => [],
      listWorktrees: () => [],
      listTaskStates: () => [],
      inspectGitEvidence: () => ({ dirty: false, uniqueCommits: 0 }),
      inspectWorktreeUsers: () => ({ supported: true, users: [{ pid: 42 }] }),
      auditQaPlanSessionStates: () => ({ status: 'OK', counts: {}, records: [] }),
    },
  });

  assert.deepEqual(result.records.map((record) => [record.state, record.reason]), [
    ['active', 'active-process'],
  ]);
  assert.equal(fs.existsSync(residue), true);
});

test('fails safe for dirty, unique, occupied, uninspectable, drifted, or legacy worktrees', () => {
  const cases = [
    [{ dirty: true }, 'dirty-worktree'],
    [{ uniqueCommits: 1 }, 'unique-commits'],
    [{ processInspection: { supported: true, users: [{ pid: 42 }] } }, 'active-process'],
    [{ processInspection: { supported: false, users: [], reason: 'denied' } }, 'process-inspection-unavailable'],
    [{ taskInspectionSupported: false }, 'task-inspection-unavailable'],
    [{ entry: { ...safeEvidence().entry, head: 'different' } }, 'head-drift'],
    [{ session: { ...safeEvidence().session, schema_version: 1 } }, 'identity-incomplete'],
  ];

  for (const [override, reason] of cases) {
    assert.deepEqual(classifyWorktreeEvidence(safeEvidence(override)), {
      state: 'recovery_required',
      reason,
    });
  }
});

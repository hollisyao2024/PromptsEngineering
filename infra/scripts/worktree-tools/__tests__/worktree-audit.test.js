'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  auditManagedWorktrees,
  classifyWorktreeEvidence,
  convergeCleanupCandidate,
  sessionTaskIds,
} = require('../worktree-audit');
const {
  readSessions,
  safeRemoveTreeNoFollow,
  writeManagedMarker,
  writeSession,
} = require('../worktree-core');

const NOW = new Date('2026-08-22T12:00:00.000Z');

function safeEvidence(overrides = {}) {
  return {
    session: {
      schema_version: 2,
      branch: 'feature/TASK-DEMO-001',
      worktree: '/container/worktrees/demo',
      head: 'abc123',
      status: 'in_progress',
      revision: 7,
      owner: { pid: 123, ppid: 12, token: 'owner-token' },
      lease: { expires_at: '2026-08-22T11:00:00.000Z' },
      lifecycle: { keys: ['task:demo', 'topic:demo'] },
    },
    entry: {
      branch: 'feature/TASK-DEMO-001',
      path: '/container/worktrees/demo',
      head: 'abc123',
      locked: false,
    },
    markerOwned: true,
    current: false,
    dirty: false,
    uniqueCommits: 0,
    processInspection: { supported: true, users: [] },
    activeTaskIds: [],
    now: NOW,
    ...overrides,
  };
}

test('extracts stable task bindings from lifecycle keys', () => {
  assert.deepEqual(sessionTaskIds(safeEvidence().session), ['demo']);
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

function orchestrationFixture(overrides = {}) {
  const session = safeEvidence().session;
  const entry = safeEvidence().entry;
  const state = {
    sessions: [session],
    entries: [entry],
    branchExists: true,
    pathExists: true,
    calls: [],
  };
  const dependencies = {
    readSessions: () => state.sessions,
    listWorktrees: () => state.entries,
    listTaskStates: () => [],
    inspectWorktreeUsers: () => ({ supported: true, users: [] }),
    inspectGitEvidence: () => ({ dirty: false, uniqueCommits: 0 }),
    hasOwnedWorktreeMarker: () => true,
    acquireLock: () => () => state.calls.push('unlock'),
    reconcilePendingCleanups: () => ({ completed: [] }),
    writeSession: (_config, _root, payload) => {
      state.calls.push(`write:${payload.status}`);
      state.sessions = [{ ...state.sessions[0], ...payload }];
    },
    removeWorktree: () => {
      state.calls.push('remove-worktree');
      state.entries = [];
      state.pathExists = false;
    },
    deleteBranch: () => {
      state.calls.push('delete-branch');
      state.branchExists = false;
    },
    removeSession: () => {
      state.calls.push('remove-session');
      state.sessions = [];
    },
    pathExists: () => state.pathExists,
    branchExists: () => state.branchExists,
    ...overrides,
  };
  return { state, dependencies };
}

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

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || '').trim());
  return result.stdout.trim();
}

test('real Git audit removes a clean merged expired managed worktree and its session', (t) => {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const container = fs.mkdtempSync(path.join(temporaryRoot, 'worktree-audit-real-'));
  const mainRoot = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  const tmpRoot = path.join(container, 'tmp');
  const worktreePath = path.join(worktreesRoot, 'stale');
  const branch = 'feature/audit-real-stale';
  const config = {
    baseBranch: 'main',
    containerDirs: { worktrees: worktreesRoot, tmp: tmpRoot },
    worktree: {
      sessionDir: path.join(tmpRoot, 'worktree-sessions'),
      lockDir: path.join(tmpRoot, 'agent-locks'),
      leaseTtlMinutes: 60,
    },
  };
  fs.mkdirSync(mainRoot, { recursive: true });
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: temporaryRoot }));
  git(mainRoot, ['init', '-b', 'main']);
  git(mainRoot, ['config', 'user.email', 'audit@example.com']);
  git(mainRoot, ['config', 'user.name', 'Audit Test']);
  fs.writeFileSync(path.join(mainRoot, 'README.md'), 'base\n');
  git(mainRoot, ['add', '.']);
  git(mainRoot, ['commit', '-m', 'base']);
  git(mainRoot, ['worktree', 'add', '-b', branch, worktreePath]);
  const head = git(worktreePath, ['rev-parse', 'HEAD']);
  writeManagedMarker(mainRoot, worktreePath, branch);
  writeSession(config, mainRoot, {
    phase: 'tdd', branch, worktree: worktreePath, head,
    status: 'in_progress', step: 'created', lifecycle: { keys: ['task:audit-real-stale'] },
  });
  const sessionFile = fs.readdirSync(config.worktree.sessionDir)
    .map((name) => path.join(config.worktree.sessionDir, name))
    .find((file) => JSON.parse(fs.readFileSync(file, 'utf8')).branch === branch);
  const stale = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  stale.lease.expires_at = '2000-01-01T00:00:00.000Z';
  fs.writeFileSync(sessionFile, `${JSON.stringify(stale, null, 2)}\n`);

  const result = auditManagedWorktrees({
    mainRoot,
    cwd: mainRoot,
    config,
    baseRef: 'main',
    apply: true,
    dependencies: {
      listTaskStates: () => [],
      inspectWorktreeUsers: () => ({ supported: true, users: [] }),
    },
  });

  assert.equal(result.records.find((record) => record.branch === branch).state, 'cleaned');
  assert.equal(fs.existsSync(worktreePath), false);
  assert.equal(git(mainRoot, ['branch', '--list', branch]), '');
  assert.equal(readSessions(config, mainRoot).some((session) => session.branch === branch), false);
});

test('64-worktree dry-run audit stays under the two-second P95 target with one process snapshot', () => {
  const sessions = [];
  const entries = [];
  for (let index = 0; index < 64; index += 1) {
    const branch = `feature/perf-${index}`;
    const worktree = `/container/worktrees/perf-${index}`;
    const head = `head-${index}`;
    sessions.push({
      ...safeEvidence().session,
      branch,
      worktree,
      head,
      lifecycle: { keys: [`task:perf-${index}`] },
    });
    entries.push({ branch, path: worktree, head, locked: false });
  }
  let processSnapshots = 0;
  const durations = [];
  for (let sample = 0; sample < 20; sample += 1) {
    const started = performance.now();
    const result = auditManagedWorktrees({
      mainRoot: '/container/repo',
      cwd: '/container/repo',
      config: { containerDirs: { worktrees: '/container/worktrees', tmp: '/container/tmp' } },
      baseRef: 'main',
      now: NOW,
      dependencies: {
        readSessions: () => sessions,
        listWorktrees: () => entries,
        listTaskStates: () => [],
        inspectProcessSnapshot: () => {
          processSnapshots += 1;
          return { supported: true, records: [], excludePids: [] };
        },
        inspectGitEvidence: () => ({ dirty: false, uniqueCommits: 0 }),
        hasOwnedWorktreeMarker: () => true,
      },
    });
    durations.push(performance.now() - started);
    assert.equal(result.records.length, 64);
  }
  durations.sort((left, right) => left - right);
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
  assert.ok(p95 <= 2000, `expected P95 <= 2000ms, observed ${p95.toFixed(2)}ms`);
  assert.equal(processSnapshots, 20);
});

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

'use strict';

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

module.exports = { NOW, orchestrationFixture, safeEvidence };

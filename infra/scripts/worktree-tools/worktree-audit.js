'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig, resolveContainerPath, resolveRuntimePath } = require('../shared/config');
const {
  acquireLock,
  branchExists,
  getBaseRef,
  getMainRepoRoot,
  getWorktreeRoot,
  hasOwnedWorktreeMarker,
  isMainBranch,
  isPathInside,
  isSamePath,
  listWorktrees,
  readSessions,
  removeSession,
  removeWorktreeSafely,
  runGit,
  writeSession,
} = require('./worktree-core');
const { inspectProcessSnapshot, inspectWorktreeUsers } = require('./worktree-process-guard');
const { auditQaPlanSessionStates } = require('./qa-plan-state-audit');

function normalizeTaskId(value) {
  return String(value || '').trim().toLowerCase();
}

function sessionTaskIds(session) {
  const keys = session && session.lifecycle && Array.isArray(session.lifecycle.keys)
    ? session.lifecycle.keys
    : [];
  return [...new Set(keys
    .filter((key) => typeof key === 'string' && key.startsWith('task:'))
    .map((key) => normalizeTaskId(key.slice('task:'.length)))
    .filter(Boolean))]
    .sort();
}

function samePath(left, right) {
  if (!left || !right) return false;
  const normalize = (value) => {
    const resolved = path.resolve(String(value));
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function leaseIsActive(session, now = new Date()) {
  const expiresAt = session && session.lease && session.lease.expires_at;
  const timestamp = Date.parse(String(expiresAt || ''));
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

function classifyWorktreeEvidence(input = {}) {
  const session = input.session || {};
  const entry = input.entry || {};
  const activeTaskIds = new Set((input.activeTaskIds || []).map(normalizeTaskId));

  if (session.status === 'cleanup_pending') {
    return { state: 'cleanup_pending', reason: 'cleanup-intent-present' };
  }
  if (session.status === 'recovery_required') {
    return { state: 'recovery_required', reason: session.audit?.reason || 'recovery-state-present' };
  }
  if (!session.branch || !session.worktree || !entry.branch || !entry.path
      || session.branch !== entry.branch || !samePath(session.worktree, entry.path)
      || !input.markerOwned) {
    return { state: 'recovery_required', reason: 'identity-incomplete' };
  }
  if (input.current) return { state: 'active', reason: 'current-worktree' };
  if (entry.locked) return { state: 'active', reason: 'worktree-locked' };

  const taskActive = sessionTaskIds(session).some((taskId) => activeTaskIds.has(taskId));
  if (taskActive) return { state: 'active', reason: 'task-active' };
  if (Number(session.schema_version) >= 2 && leaseIsActive(session, input.now || new Date())) {
    return { state: 'active', reason: 'lease-active' };
  }
  if (input.taskInspectionSupported === false) {
    return { state: 'recovery_required', reason: 'task-inspection-unavailable' };
  }

  const processInspection = input.processInspection || { supported: false, users: [] };
  if (!processInspection.supported) {
    return { state: 'recovery_required', reason: 'process-inspection-unavailable' };
  }
  if (Array.isArray(processInspection.users) && processInspection.users.length > 0) {
    return { state: 'recovery_required', reason: 'active-process' };
  }
  if (input.dirty) return { state: 'recovery_required', reason: 'dirty-worktree' };
  if (!Number.isFinite(Number(input.uniqueCommits))) {
    return { state: 'recovery_required', reason: 'commit-inspection-failed' };
  }
  if (Number(input.uniqueCommits) > 0) {
    return { state: 'recovery_required', reason: 'unique-commits' };
  }
  if (!session.head || !entry.head || session.head !== entry.head) {
    return { state: 'recovery_required', reason: 'head-drift' };
  }
  if (Number(session.schema_version) < 2 || !session.owner || !session.owner.token
      || !session.lease || !session.lease.expires_at || !Number.isInteger(session.revision)) {
    return { state: 'recovery_required', reason: 'identity-incomplete' };
  }
  return { state: 'cleanup_candidate', reason: 'clean-orphan' };
}

function runGitResult(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout || '',
    reason: result.error?.message || (result.stderr || result.stdout || '').trim(),
  };
}

function inspectGitEvidence(mainRoot, baseRef, session, entry, options = {}) {
  if (!entry || !entry.path || !fs.existsSync(entry.path)) {
    return { dirty: null, uniqueCommits: null };
  }
  const status = runGitResult(entry.path, ['status', '--porcelain', '--untracked-files=all']);
  const branch = String((session && session.branch) || entry.branch || '');
  const merged = options.mergedBranches;
  const unique = merged && merged.supported && branch
    ? { ok: true, stdout: merged.branches.has(branch) ? '0' : '1', reason: '' }
    : (branch && baseRef
      ? runGitResult(mainRoot, ['rev-list', '--count', `${baseRef}..${branch}`])
      : { ok: false, stdout: '', reason: 'branch or base ref missing' });
  return {
    dirty: status.ok ? Boolean(status.stdout.trim()) : null,
    uniqueCommits: unique.ok ? Number(unique.stdout.trim()) : null,
    inspectionError: status.ok && unique.ok ? '' : (status.reason || unique.reason || 'git inspection failed'),
  };
}

function mergedBranchSnapshot(mainRoot, baseRef) {
  if (!baseRef) return { supported: false, branches: new Set(), reason: 'base ref missing' };
  const result = runGitResult(mainRoot, [
    'for-each-ref', `--merged=${baseRef}`, '--format=%(refname:short)', 'refs/heads',
  ]);
  return {
    supported: result.ok,
    branches: new Set(result.stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)),
    reason: result.reason,
  };
}

function activeTaskSnapshot(config, mainRoot, dependencies = {}) {
  const list = dependencies.listTaskStates
    || require('../agent-runner/agent-task').listTaskStates;
  const runsRoot = path.join(resolveContainerPath(config, mainRoot, 'tmp'), 'agent-task-runs');
  try {
    const states = list({ runsRoot });
    return {
      supported: true,
      ids: states
        .filter((state) => state && isSamePath(state.project_root, mainRoot))
        .filter((state) => !['completed', 'cleanup_pending'].includes(state.status))
        .map((state) => normalizeTaskId(state.task_id))
        .filter(Boolean),
    };
  } catch (error) {
    return { supported: false, ids: [], reason: error.message };
  }
}

function recordKey(value) {
  if (value && value.branch) return `branch:${value.branch}`;
  return `path:${path.resolve((value && (value.worktree || value.path)) || '.')}`;
}

function collectAuditRecords(options) {
  const {
    mainRoot,
    config,
    baseRef,
    cwd,
    now,
    dependencies = {},
  } = options;
  const read = dependencies.readSessions || readSessions;
  const list = dependencies.listWorktrees || listWorktrees;
  const inspectUsers = dependencies.inspectWorktreeUsers || inspectWorktreeUsers;
  const inspectGit = dependencies.inspectGitEvidence || inspectGitEvidence;
  const ownsMarker = dependencies.hasOwnedWorktreeMarker || hasOwnedWorktreeMarker;
  const sessions = read(config, mainRoot);
  const entries = list(mainRoot).filter((entry) => !isSamePath(entry.path, mainRoot));
  const tasks = activeTaskSnapshot(config, mainRoot, dependencies);
  const processes = dependencies.inspectWorktreeUsers
    ? null
    : (dependencies.inspectProcessSnapshot || inspectProcessSnapshot)({ excludePids: [process.pid] });
  const mergedBranches = dependencies.inspectGitEvidence
    ? null
    : (dependencies.mergedBranchSnapshot || mergedBranchSnapshot)(mainRoot, baseRef);
  const pairs = new Map();

  for (const session of sessions) {
    pairs.set(recordKey(session), { session, entry: null });
  }
  for (const entry of entries) {
    const key = recordKey(entry);
    const pair = pairs.get(key) || { session: null, entry: null };
    pair.entry = entry;
    pairs.set(key, pair);
  }

  return [...pairs.values()].map(({ session, entry }) => {
    const branch = String(session?.branch || entry?.branch || '');
    const worktreePath = String(session?.worktree || entry?.path || '');
    const markerOwned = Boolean(entry && branch && ownsMarker(mainRoot, entry.path, branch));
    if (!session && !markerOwned) {
      return { branch, path: worktreePath, state: 'ignored', reason: 'unmanaged-worktree', session, entry };
    }
    const git = inspectGit(mainRoot, baseRef, session, entry, { mergedBranches });
    const evidence = {
      session,
      entry,
      markerOwned,
      current: Boolean(entry && cwd && (isSamePath(cwd, entry.path) || isPathInside(entry.path, cwd))),
      dirty: git.dirty === null ? true : git.dirty,
      uniqueCommits: git.uniqueCommits,
      processInspection: entry
        ? inspectUsers(entry.path, { excludePids: [process.pid], snapshot: processes })
        : { supported: false, users: [], reason: 'worktree is not registered' },
      activeTaskIds: tasks.ids,
      taskInspectionSupported: tasks.supported,
      now,
    };
    const classification = classifyWorktreeEvidence(evidence);
    return {
      branch,
      path: worktreePath,
      head: String(entry?.head || session?.head || ''),
      revision: Number(session?.revision || 0),
      ...classification,
      session,
      entry,
      evidence: {
        markerOwned,
        dirty: git.dirty,
        uniqueCommits: git.uniqueCommits,
        processUsers: evidence.processInspection.users?.map((user) => user.pid) || [],
        activeTaskIds: tasks.ids,
        taskInspectionSupported: tasks.supported,
      },
    };
  });
}

function deleteLocalBranch(mainRoot, branch) {
  if (!branch || isMainBranch(branch)) throw new Error(`refusing to delete protected branch: ${branch || '(missing)'}`);
  if (branchExists(mainRoot, branch)) runGit(['branch', '-D', branch], { cwd: mainRoot });
}

function recoveryPayload(record, reason) {
  return {
    branch: record.branch,
    worktree: record.path,
    status: 'recovery_required',
    step: 'worktree_audit_recovery_required',
    audit: {
      reason,
      observed_at: new Date().toISOString(),
      expected_head: record.head || '',
      expected_revision: record.revision || 0,
      next_action: `Inspect and preserve ${record.path || record.branch}; recover it to a new branch before cleanup.`,
    },
  };
}

function applyCleanupCandidate(record, context) {
  const {
    mainRoot, config, worktreesRoot, dependencies = {},
  } = context;
  const write = dependencies.writeSession || writeSession;
  const remove = dependencies.removeWorktree || removeWorktreeSafely;
  const deleteBranch = dependencies.deleteBranch || deleteLocalBranch;
  const removeSess = dependencies.removeSession || removeSession;
  const list = dependencies.listWorktrees || listWorktrees;
  const exists = dependencies.pathExists || fs.existsSync;
  const branchPresent = dependencies.branchExists || branchExists;

  return convergeCleanupCandidate({
    branch: record.branch,
    path: record.path,
    expectedHead: record.head,
    expectedRevision: record.revision,
  }, {
    writeIntent: () => write(config, mainRoot, {
      branch: record.branch,
      worktree: record.path,
      status: 'cleanup_pending',
      step: 'worktree_audit_cleanup_pending',
      cleanup: {
        mainRoot,
        branch: record.branch,
        worktree: record.path,
        expectedHead: record.head,
        expectedRevision: record.revision,
        requestedAt: new Date().toISOString(),
      },
    }),
    removeWorktree: () => remove({
      mainRoot,
      worktreePath: record.path,
      worktreesRoot,
      force: false,
    }),
    deleteBranch: () => deleteBranch(mainRoot, record.branch),
    verify: () => {
      const registered = list(mainRoot).some((entry) => isSamePath(entry.path, record.path));
      const physical = exists(record.path);
      const branchStillExists = branchPresent(mainRoot, record.branch);
      return {
        complete: !registered && !physical && !branchStillExists,
        reason: registered || physical || branchStillExists ? 'cleanup-verification-failed' : '',
      };
    },
    removeSession: () => removeSess(config, mainRoot, record.branch),
    writeRecovery: (_candidate, reason) => write(config, mainRoot, recoveryPayload(record, reason)),
  });
}

function summarize(records, mode, reconciliation = null, qaPlanStates = null) {
  const counts = {};
  for (const record of records) counts[record.state] = (counts[record.state] || 0) + 1;
  return {
    status: records.some((record) => record.state === 'recovery_required')
      || qaPlanStates?.status === 'ATTENTION'
      ? 'ATTENTION'
      : 'OK',
    mode,
    counts,
    records,
    reconciliation,
    qaPlanStates,
  };
}

function auditManagedWorktrees(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const mainRoot = path.resolve(options.mainRoot || getMainRepoRoot(cwd));
  const config = options.config || loadConfig({ repoRoot: getWorktreeRoot(cwd) });
  const worktreesRoot = resolveContainerPath(config, mainRoot, 'worktrees');
  const baseRef = options.baseRef || getBaseRef(mainRoot, config);
  const dependencies = options.dependencies || {};
  const excluded = new Set((options.excludeBranches || []).filter(Boolean));
  if (options.excludeBranch) excluded.add(options.excludeBranch);
  const skipPath = options.skipWorktreePath ? path.resolve(options.skipWorktreePath) : '';
  const collect = () => collectAuditRecords({
    mainRoot, config, baseRef, cwd, now: options.now || new Date(), dependencies,
  }).map((record) => {
    if (excluded.has(record.branch)) return { ...record, state: 'active', reason: 'excluded-branch' };
    if (skipPath && record.path && (isSamePath(skipPath, record.path) || isPathInside(record.path, skipPath))) {
      return { ...record, state: 'active', reason: 'current-worktree' };
    }
    return record;
  });

  const auditQaStates = (apply) => {
    const list = dependencies.listWorktrees || listWorktrees;
    const entries = list(mainRoot);
    return (dependencies.auditQaPlanSessionStates || auditQaPlanSessionStates)({
      mainRoot,
      config,
      apply,
      worktreePaths: entries.map((entry) => entry.path).filter(Boolean),
      listWorktrees: list,
    });
  };

  if (!options.apply) return summarize(collect(), 'dry-run', null, auditQaStates(false));

  const lockDir = resolveRuntimePath(config, mainRoot, config.worktree && config.worktree.lockDir, 'agent-locks');
  const release = dependencies.acquireLock
    ? dependencies.acquireLock(lockDir, 'worktree-audit-lifecycle')
    : acquireLock(lockDir, 'worktree-audit-lifecycle', options.lockTimeoutMs || 30000);
  let reconciliation = null;
  try {
    reconciliation = (dependencies.reconcilePendingCleanups
      || require('./deferred-cleanup-state').reconcilePendingCleanups)({
      mainRoot,
      config,
      worktreesRoot,
      sweepStaleInProgress: false,
      skipWorktreePath: skipPath || cwd,
    });
    const initial = collect();
    const results = [];
    for (const record of initial) {
      if (record.state === 'recovery_required' && record.session && record.branch && record.path
          && record.session.status !== 'recovery_required') {
        (dependencies.writeSession || writeSession)(config, mainRoot, recoveryPayload(record, record.reason));
      }
      if (record.state !== 'cleanup_candidate') {
        results.push(record);
        continue;
      }
      const refreshed = collect().find((candidate) => candidate.branch === record.branch);
      if (!refreshed || refreshed.state !== 'cleanup_candidate'
          || refreshed.head !== record.head || refreshed.revision !== record.revision) {
        const reason = refreshed ? `revalidation-${refreshed.reason}` : 'revalidation-missing';
        if (refreshed?.session) {
          (dependencies.writeSession || writeSession)(config, mainRoot, recoveryPayload(refreshed, reason));
        }
        results.push({ ...(refreshed || record), state: 'recovery_required', reason });
        continue;
      }
      const outcome = applyCleanupCandidate(refreshed, {
        mainRoot, config, worktreesRoot, dependencies,
      });
      results.push({ ...refreshed, ...outcome });
    }
    return summarize(results, 'apply', reconciliation, auditQaStates(true));
  } finally {
    release();
  }
}

function convergeCleanupCandidate(candidate, operations = {}) {
  const required = [
    'writeIntent',
    'removeWorktree',
    'deleteBranch',
    'removeSession',
    'verify',
    'writeRecovery',
  ];
  for (const name of required) {
    if (typeof operations[name] !== 'function') throw new Error(`${name} operation is required`);
  }

  try {
    operations.writeIntent(candidate);
    operations.removeWorktree(candidate);
    operations.deleteBranch(candidate);
    const observed = operations.verify(candidate) || {};
    if (!observed.complete) {
      const reason = observed.reason || 'cleanup-verification-failed';
      operations.writeRecovery(candidate, reason);
      return { state: 'recovery_required', reason };
    }
    operations.removeSession(candidate);
    return { state: 'cleaned', reason: 'cleanup-verified' };
  } catch (error) {
    const reason = `cleanup-failed:${error.message}`;
    operations.writeRecovery(candidate, reason);
    return { state: 'recovery_required', reason };
  }
}

module.exports = {
  activeTaskSnapshot,
  auditManagedWorktrees,
  classifyWorktreeEvidence,
  collectAuditRecords,
  convergeCleanupCandidate,
  inspectGitEvidence,
  mergedBranchSnapshot,
  leaseIsActive,
  normalizeTaskId,
  sessionTaskIds,
};

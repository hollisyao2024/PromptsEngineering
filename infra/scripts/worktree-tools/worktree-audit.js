'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, resolveContainerPath, resolveRuntimePath } = require('../shared/config');
const {
  acquireLock,
  bindLifecycleTaskLocations,
  branchExists,
  getBaseRef,
  getMainRepoRoot,
  getWorktreeRoot,
  hasOwnedWorktreeMarker,
  isMainBranch,
  isPathInside,
  isSamePath,
  lifecycleTopicFromBranch,
  listWorktrees,
  readSessions,
  removeSession,
  removeWorktreeSafely,
  runGit,
  writeSession,
} = require('./worktree-core');
const { resolveSessionRemovalRoot } = require('./desktop-worktree');
const { inspectProcessSnapshot, inspectWorktreeUsers } = require('./worktree-process-guard');
const { auditQaPlanSessionStates } = require('./qa-plan-state-audit');
const {
  activeTaskSnapshot,
  classifyWorktreeEvidence,
  collectUnregisteredDirectoryRecords,
  inspectEmptyDirectoryTree,
  inspectGitEvidence,
  leaseIsActive,
  mergedBranchSnapshot,
  normalizeTaskId,
  recordKey,
  removeEmptyDirectoryTree,
  samePath,
  sessionTaskIds,
} = require('./worktree-audit-evidence');

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

  const managedRecords = [...pairs.values()].map(({ session, entry }) => {
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
    const matchedActiveTaskIds = sessionTaskIds(session)
      .filter((taskId) => tasks.ids.includes(taskId));
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
        activeTaskIds: matchedActiveTaskIds,
        taskInspectionSupported: tasks.supported,
      },
    };
  });
  const knownPaths = [
    ...sessions.map((session) => session && session.worktree),
    ...entries.map((entry) => entry && entry.path),
  ];
  const unregistered = (dependencies.collectUnregisteredDirectoryRecords
    || collectUnregisteredDirectoryRecords)(
    resolveContainerPath(config, mainRoot, 'worktrees'),
    knownPaths,
  ).map((record) => {
    if (record.state !== 'cleanup_candidate') return record;
    const processInspection = inspectUsers(record.path, {
      excludePids: [process.pid],
      snapshot: processes,
    });
    if (!processInspection.supported) {
      return {
        ...record,
        state: 'ignored',
        reason: 'unregistered-directory-process-inspection-unavailable',
        evidence: { ...record.evidence, processUsers: [] },
      };
    }
    const processUsers = processInspection.users?.map((user) => user.pid) || [];
    if (processUsers.length > 0) {
      return {
        ...record,
        state: 'active',
        reason: 'active-process',
        evidence: { ...record.evidence, processUsers },
      };
    }
    return { ...record, evidence: { ...record.evidence, processUsers } };
  });
  return [...managedRecords, ...unregistered];
}

function deleteLocalBranch(mainRoot, branch) {
  if (!branch || isMainBranch(branch)) throw new Error(`refusing to delete protected branch: ${branch || '(missing)'}`);
  if (branchExists(mainRoot, branch)) runGit(['branch', '-D', branch], { cwd: mainRoot });
}

function recoveryPayload(record, reason) {
  const rebind = record.session && record.session.rebind;
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
      next_action: rebind && rebind.toBranch
        ? `pnpm agent -- worktree resume --branch ${record.branch} --recover-as ${rebind.toBranch}`
        : `Inspect and preserve ${record.path || record.branch}; recover it to a new branch before cleanup.`,
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
      // Adopted Desktop worktrees carry provenance; anything else stays bound to the container root.
      worktreesRoot: resolveSessionRemovalRoot(mainRoot, worktreesRoot, {
        ...(record.session || {}),
        worktree: record.path,
      }) || worktreesRoot,
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

function applyUnregisteredDirectoryCandidate(record, context) {
  const remove = context.dependencies?.removeEmptyDirectoryTree || removeEmptyDirectoryTree;
  try {
    const removal = remove(record.path, context.worktreesRoot);
    if (fs.existsSync(record.path)) {
      return { state: 'recovery_required', reason: 'empty-directory-cleanup-verification-failed' };
    }
    return { state: 'cleaned', reason: 'empty-unregistered-directory', removal };
  } catch (error) {
    return { state: 'recovery_required', reason: `empty-directory-cleanup-failed:${error.message}` };
  }
}

function summarize(records, mode, reconciliation = null, qaPlanStates = null) {
  const counts = {};
  for (const record of records) counts[record.state] = (counts[record.state] || 0) + 1;
  return {
    status: records.some((record) => ['cleanup_pending', 'recovery_required'].includes(record.state))
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
      if (record.kind === 'unregistered-directory') {
        if (record.state !== 'cleanup_candidate') {
          results.push(record);
          continue;
        }
        const refreshed = collect().find((candidate) => (
          candidate.kind === record.kind && samePath(candidate.path, record.path)
        ));
        if (!refreshed || refreshed.state !== 'cleanup_candidate') {
          results.push({
            ...(refreshed || record),
            state: 'recovery_required',
            reason: refreshed
              ? `revalidation-${refreshed.reason}`
              : 'revalidation-missing-unregistered-directory',
          });
          continue;
        }
        results.push({
          ...refreshed,
          ...applyUnregisteredDirectoryCandidate(refreshed, {
            worktreesRoot,
            dependencies,
          }),
        });
        continue;
      }
      if (record.state === 'active' && record.reason === 'task-active' && record.session) {
        const lifecycleKeys = new Set(
          record.session.lifecycle && Array.isArray(record.session.lifecycle.keys)
            ? record.session.lifecycle.keys
            : [],
        );
        for (const taskId of record.evidence.activeTaskIds) lifecycleKeys.add(`task:${taskId}`);
        if (record.session.recovered_from) {
          lifecycleKeys.add(`topic:${lifecycleTopicFromBranch(record.session.recovered_from)}`);
        }
        const migratedSession = {
          ...record.session,
          lifecycle: {
            ...(record.session.lifecycle || {}),
            phase: record.session.lifecycle?.phase || record.session.phase,
            keys: [...lifecycleKeys].sort(),
          },
        };
        if (!record.session.lifecycle || record.evidence.activeTaskIds.some(
          (taskId) => !record.session.lifecycle.keys?.includes(`task:${taskId}`),
        )) {
          (dependencies.writeSession || writeSession)(config, mainRoot, migratedSession);
        }
        const taskBindings = bindLifecycleTaskLocations(
          config,
          mainRoot,
          migratedSession,
          record.path,
          record.branch,
          { ...dependencies, taskIds: record.evidence.activeTaskIds },
        );
        results.push({ ...record, taskBindings });
        continue;
      }
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

  let intentPersisted = false;
  try {
    operations.writeIntent(candidate);
    intentPersisted = true;
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
    if (intentPersisted) {
      return { state: 'cleanup_pending', reason: `cleanup-deferred:${error.message}` };
    }
    const reason = `cleanup-failed:${error.message}`;
    operations.writeRecovery(candidate, reason);
    return { state: 'recovery_required', reason };
  }
}

module.exports = {
  activeTaskSnapshot,
  applyUnregisteredDirectoryCandidate,
  auditManagedWorktrees,
  classifyWorktreeEvidence,
  collectUnregisteredDirectoryRecords,
  collectAuditRecords,
  convergeCleanupCandidate,
  inspectEmptyDirectoryTree,
  inspectGitEvidence,
  mergedBranchSnapshot,
  leaseIsActive,
  normalizeTaskId,
  removeEmptyDirectoryTree,
  sessionTaskIds,
};

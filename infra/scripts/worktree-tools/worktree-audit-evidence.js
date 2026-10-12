'use strict';

/**
 * worktree-audit 的证据采集：session 归属、Git 证据分类、已合并分支与活动任务快照、空目录树检查。
 * 由 worktree-audit.js 使用并重新导出；不依赖 worktree-audit.js。
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveContainerPath } = require('../shared/config');
const { isSamePath, lifecycleTopicFromBranch } = require('./worktree-core');

function normalizeTaskId(value) {
  return String(value || '').trim().toLowerCase();
}

function sessionTaskIds(session) {
  const keys = session && session.lifecycle && Array.isArray(session.lifecycle.keys)
    ? session.lifecycle.keys
    : [];
  const ids = keys
    .filter((key) => typeof key === 'string' && key.startsWith('task:'))
    .map((key) => normalizeTaskId(key.slice('task:'.length)))
    .filter(Boolean);
  if (session && session.recovered_from) {
    ids.push(normalizeTaskId(lifecycleTopicFromBranch(session.recovered_from)));
  }
  return [...new Set(ids.filter(Boolean))].sort();
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

function inspectEmptyDirectoryTree(rootPath) {
  let rootStat;
  try {
    rootStat = fs.lstatSync(rootPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return { empty: false, directories: [] };
    throw error;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return { empty: false, directories: [] };
  }

  const directories = [path.resolve(rootPath)];
  for (let index = 0; index < directories.length; index += 1) {
    const directory = directories[index];
    for (const name of fs.readdirSync(directory)) {
      const childPath = path.join(directory, name);
      const childStat = fs.lstatSync(childPath);
      if (childStat.isSymbolicLink() || !childStat.isDirectory()) {
        return { empty: false, directories: [] };
      }
      directories.push(childPath);
    }
  }
  return { empty: true, directories };
}

function collectUnregisteredDirectoryRecords(worktreesRoot, knownPaths = []) {
  if (!fs.existsSync(worktreesRoot)) return [];
  const rootStat = fs.lstatSync(worktreesRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`worktrees root must be a real directory: ${worktreesRoot}`);
  }
  const known = knownPaths.filter(Boolean).map((value) => path.resolve(value));
  const records = [];
  for (const dirent of fs.readdirSync(worktreesRoot, { withFileTypes: true })) {
    if (!dirent.isDirectory() || dirent.isSymbolicLink()) continue;
    const directoryPath = path.join(worktreesRoot, dirent.name);
    if (known.some((knownPath) => samePath(knownPath, directoryPath))) continue;
    const inspection = inspectEmptyDirectoryTree(directoryPath);
    records.push({
      kind: 'unregistered-directory',
      branch: '',
      path: directoryPath,
      head: '',
      revision: 0,
      state: inspection.empty ? 'cleanup_candidate' : 'ignored',
      reason: inspection.empty ? 'empty-unregistered-directory' : 'nonempty-unregistered-directory',
      session: null,
      entry: null,
      evidence: { emptyDirectoryTree: inspection.empty },
    });
  }
  return records;
}

function removeEmptyDirectoryTree(rootPath, worktreesRoot) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedWorktreesRoot = path.resolve(worktreesRoot);
  if (path.dirname(resolvedRoot) !== resolvedWorktreesRoot) {
    throw new Error(`empty residue must be a direct child of worktrees root: ${rootPath}`);
  }
  const inspection = inspectEmptyDirectoryTree(resolvedRoot);
  if (!inspection.empty) {
    throw new Error(`unregistered directory is no longer empty: ${rootPath}`);
  }
  const deepestFirst = [...inspection.directories]
    .sort((left, right) => right.split(path.sep).length - left.split(path.sep).length);
  for (const directory of deepestFirst) fs.rmdirSync(directory);
  return { removedDirectories: deepestFirst.length };
}

module.exports = {
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
};

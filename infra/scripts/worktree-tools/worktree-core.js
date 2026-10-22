#!/usr/bin/env node
/**
 * Shared worktree lifecycle helpers for all expert phases.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { randomUUID } = crypto;
const { spawnSync } = require('child_process');
const {
  ensureContainerDirectories,
  getMainRepoRoot,
  getWorktreeRoot,
  loadConfig,
  parseCliArgs,
  resolveContainerPath,
  resolveRuntimePath,
} = require('../shared/config');
const { buildGitHubGitEnv } = require('../shared/github-auth');
const {
  isPathInside,
  isSamePath,
  parseWorktreePorcelain,
  removeWorktreeSafely,
  safeRemoveTreeNoFollow,
} = require('./worktree-safe-remove');
const {
  buildDesktopProvenance,
  isDesktopWorktreePath,
} = require('./desktop-worktree');

const MAIN_BRANCHES = new Set(['main', 'master', 'develop']);
const MANAGED_MARKER = '.agent-worktree.json';
const PHASE_ORDER = new Map([
  ['prd', 1],
  ['arch', 2],
  ['task', 3],
  ['tdd', 4],
  ['qa', 5],
  ['devops', 6],
]);

function run(command, args, options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = command === 'git'
    ? buildGitHubGitEnv({ repoRoot: getMainRepoRoot(cwd), cwd, args, env: process.env })
    : process.env;
  // Executables are restricted to fixed internal Git/Node call sites and argv
  // is passed without shell interpretation.
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env,
    shell: false,
  });

  if (result.status !== 0 && !options.allowFailure) {
    const stderr = result.stderr ? `\n${result.stderr.trim()}` : '';
    throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status})${stderr}`);
  }
  return options.capture ? (result.stdout || '') : '';
}

function runGit(args, options = {}) {
  return run('git', args, options);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function slugify(input, fallback = 'task') {
  const slug = String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function shortHash(input) {
  let hash = 0;
  const text = String(input || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 6).padStart(4, '0');
}

function requestError(message) {
  const error = new Error(message);
  error.nextManualAction = 'Provide --branch <branch>, --task <TASK-ID>, or --desc <description> and rerun the command.';
  return error;
}

function readStringOption(options, names) {
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(options, name)) continue;
    const value = options[name];
    if (typeof value !== 'string' || !value.trim()) {
      throw requestError(`--${name} requires a non-empty value`);
    }
    return value.trim();
  }
  return '';
}

function validateWorktreeRequest(options = {}) {
  const phase = readStringOption(options, ['phase']);
  const branch = readStringOption(options, ['branch']);
  const task = readStringOption(options, ['task']);
  const desc = readStringOption(options, ['desc', 'description']);
  readStringOption(options, ['kind']);

  if (!branch && !task && !desc) {
    throw requestError('worktree identity is required; phase alone cannot name a branch or worktree');
  }

  return { phase, branch, task, desc };
}

function buildBranchName(options) {
  const request = validateWorktreeRequest(options);
  if (request.branch) return request.branch;

  const phase = slugify(request.phase || 'tdd');
  const desc = slugify(request.desc || request.task);
  const task = request.task.toUpperCase();
  const kind = options.kind || (options.fix ? 'fix' : '');

  if (phase === 'prd') return `docs/prd-${desc}`;
  if (phase === 'arch') return `docs/arch-${desc}`;
  if (phase === 'task') return `docs/task-${desc}`;
  if (phase === 'qa') return `qa/${desc}`;
  if (phase === 'devops') return `ops/${desc}`;
  if (kind === 'fix') return `fix/${desc}`;
  if (task) return `feature/${task}${desc && desc !== slugify(task) ? `-${desc}` : ''}`;
  return `feature/${desc}`;
}

function buildWorktreeName(options, branch) {
  const phase = slugify(options.phase || inferPhaseFromBranch(branch));
  let name = branch
    .replace(/^(feature|fix|qa|ops|ci|docs)\//, '')
    .replace(/\//g, '-');
  name = slugify(name, phase);
  const candidate = `${phase}-${name}`;
  return candidate.length > 70 ? candidate.slice(0, 63) + '-' + shortHash(candidate) : candidate;
}

function inferPhaseFromBranch(branch) {
  if (branch.startsWith('docs/prd-')) return 'prd';
  if (branch.startsWith('docs/arch-')) return 'arch';
  if (branch.startsWith('docs/task-')) return 'task';
  if (branch.startsWith('qa/')) return 'qa';
  if (branch.startsWith('ops/') || branch.startsWith('ci/')) return 'devops';
  return 'tdd';
}

function lifecycleTopicFromBranch(branch) {
  return slugify(String(branch || '')
    .replace(/^docs\/(?:prd|arch|task)-/u, '')
    .replace(/^(?:feature|fix|qa|ops|ci)\//u, ''));
}

function buildLifecycleIdentity(options = {}, branch = buildBranchName(options)) {
  const phase = slugify(options.phase || inferPhaseFromBranch(branch));
  const keys = new Set([`topic:${lifecycleTopicFromBranch(branch)}`]);
  const desc = readStringOption(options, ['desc', 'description']);
  const task = readStringOption(options, ['task']);
  if (desc) keys.add(`topic:${slugify(desc)}`);
  if (task) keys.add(`task:${slugify(task)}`);
  return { phase, keys: [...keys].sort() };
}

function sessionLifecycleKeys(session) {
  const keys = new Set(
    session && session.lifecycle && Array.isArray(session.lifecycle.keys)
      ? session.lifecycle.keys.filter((key) => typeof key === 'string' && key)
      : [],
  );
  if (session && session.branch) keys.add(`topic:${lifecycleTopicFromBranch(session.branch)}`);
  return keys;
}

function lifecycleTaskIds(session) {
  return [...new Set([...sessionLifecycleKeys(session)]
    .filter((key) => key.startsWith('task:'))
    .map((key) => slugify(key.slice('task:'.length)))
    .filter(Boolean))].sort();
}

function verifiedRecoveryTaskIds(config, mainRoot, session, options = {}) {
  const explicit = lifecycleTaskIds(session);
  if (!session || !session.recovered_from) return explicit;
  const candidate = lifecycleTopicFromBranch(session.recovered_from);
  const runsRoot = path.join(resolveContainerPath(config, mainRoot, 'tmp'), 'agent-task-runs');
  const list = options.listTaskStates
    || require('../agent-runner/agent-task').listTaskStates;
  const matching = list({ runsRoot })
    .filter((state) => state && isSamePath(state.project_root, mainRoot))
    .filter((state) => !['completed', 'cleanup_pending'].includes(state.status))
    .map((state) => slugify(state.task_id))
    .filter((taskId) => taskId === candidate);
  return [...new Set([...explicit, ...matching])].sort();
}

// resume 未显式传 --task 时沿用既有 session 已登记的 task 键，避免任务位置停留在旧目录或主 worktree。
function withSessionTaskKeys(lifecycle, session) {
  const keys = new Set(lifecycle.keys);
  for (const taskId of lifecycleTaskIds(session)) keys.add(`task:${taskId}`);
  return { ...lifecycle, keys: [...keys].sort() };
}

function bindLifecycleTaskLocations(config, mainRoot, session, worktree, branch, options = {}) {
  const taskIds = Array.isArray(options.taskIds)
    ? [...new Set(options.taskIds.map(slugify).filter(Boolean))].sort()
    : lifecycleTaskIds(session);
  if (taskIds.length === 0) return [];
  const runsRoot = path.join(resolveContainerPath(config, mainRoot, 'tmp'), 'agent-task-runs');
  const lockDir = resolveRuntimePath(
    config,
    mainRoot,
    config.worktree && config.worktree.lockDir,
    'agent-locks',
  );
  const bind = options.bindTaskLocation
    || require('../agent-runner/agent-task').bindTaskLocation;
  return taskIds.map((taskId) => bind({
    runsRoot,
    lockDir,
    taskId,
    projectRoot: mainRoot,
    worktree,
    branch,
  }));
}

function planSupersededSessions(options = {}) {
  const { config, mainRoot, cli = {}, branch } = options;
  const identity = buildLifecycleIdentity(cli, branch);
  const currentRank = PHASE_ORDER.get(identity.phase) || 0;
  const read = options.readSessions || readSessions;
  const list = options.listWorktrees || listWorktrees;
  const entries = list(mainRoot);
  const seals = [];
  const skipped = [];

  for (const session of read(config, mainRoot)) {
    if (!session || session.status !== 'in_progress' || session.branch === branch) continue;
    const previousPhase = slugify(session.phase || inferPhaseFromBranch(session.branch));
    const previousRank = PHASE_ORDER.get(previousPhase) || 0;
    if (!previousRank || !currentRank || previousRank >= currentRank) continue;
    const previousKeys = sessionLifecycleKeys(session);
    if (!identity.keys.some((key) => previousKeys.has(key))) continue;

    const entry = entries.find((candidate) => candidate.branch === session.branch
      && session.worktree && isSamePath(candidate.path, session.worktree));
    if (!entry || !session.worktree || !fs.existsSync(session.worktree)) {
      skipped.push({ branch: session.branch, reason: 'missing-registered-worktree' });
      continue;
    }
    const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: session.worktree,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (status.status !== 0) {
      skipped.push({ branch: session.branch, reason: 'inspection-failed' });
      continue;
    }
    if (status.stdout.trim()) {
      skipped.push({ branch: session.branch, reason: 'dirty-worktree' });
      continue;
    }
    const head = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: session.worktree,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    const expectedHead = head.status === 0 ? head.stdout.trim() : '';
    if (!expectedHead || (entry.head && entry.head !== expectedHead)) {
      skipped.push({ branch: session.branch, reason: 'head-mismatch' });
      continue;
    }
    seals.push({
      branch: session.branch,
      worktree: path.resolve(session.worktree),
      expectedHead,
      phase: previousPhase,
    });
  }

  seals.sort((left, right) => (PHASE_ORDER.get(left.phase) || 0) - (PHASE_ORDER.get(right.phase) || 0));
  return { identity, seals, skipped };
}

function assertNoConflictingRecovery(config, mainRoot, cli, branch, options = {}) {
  const identity = buildLifecycleIdentity(cli, branch);
  const read = options.readSessions || readSessions;
  const conflicts = read(config, mainRoot).filter((session) => {
    if (!session || session.branch === branch || session.status !== 'recovery_required') return false;
    const keys = sessionLifecycleKeys(session);
    return identity.keys.some((key) => keys.has(key));
  });
  if (conflicts.length === 0) return [];
  const error = new Error(
    `recovery_required worktree conflicts with this lifecycle: ${conflicts.map((item) => item.branch).join(', ')}`,
  );
  error.lifecycleStatus = 'recovery_required';
  error.worktreePath = conflicts[0].worktree;
  error.nextManualAction = 'Recover or resolve the conflicting worktree before creating another branch for the same task/topic.';
  throw error;
}

function lifecycleState(supersession) {
  return {
    phase: supersession.identity.phase,
    keys: supersession.identity.keys,
    supersedes: supersession.seals,
    skipped: supersession.skipped,
  };
}

function listWorktrees(mainRoot) {
  const output = runGit(['worktree', 'list', '--porcelain'], {
    cwd: mainRoot,
    capture: true,
    allowFailure: true,
  });
  const entries = [];
  let current = {};
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) entries.push(current);
      // git 在 Windows 输出正斜杠路径；统一成本平台原生写法，与 path.join/getMainRepoRoot 的结果可直接比较。
      current = { path: path.normalize(line.slice(9).trim()) };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5).trim();
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).trim().replace('refs/heads/', '');
    } else if (line === 'locked' || line.startsWith('locked ')) {
      current.locked = true;
      current.lockReason = line.slice('locked'.length).trim();
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      current.prunable = true;
      current.prunableReason = line.slice('prunable'.length).trim();
    }
  }
  if (current.path) entries.push(current);
  return entries;
}

function findWorktreeByBranch(mainRoot, branch) {
  return listWorktrees(mainRoot).find((entry) => entry.branch === branch) || null;
}

function branchExists(mainRoot, branch) {
  const result = spawnSync('git', ['show-ref', '--verify', `refs/heads/${branch}`], {
    cwd: mainRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return result.status === 0;
}

function remoteRefExists(mainRoot, ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', ref], {
    cwd: mainRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return result.status === 0;
}

function getRemoteBranch(mainRoot, branch) {
  const remoteRef = `refs/remotes/origin/${branch}`;
  const remoteHead = resolveCommit(mainRoot, remoteRef);
  if (!remoteHead) return null;
  return {
    remoteRef,
    remoteBranch: `origin/${branch}`,
    remoteHead,
  };
}

function remoteBranchConflictError(branch, remote) {
  const error = new Error(`remote branch origin/${branch} already exists`);
  error.remoteBranch = remote.remoteBranch;
  error.remoteHead = remote.remoteHead;
  error.fetchStatus = 'OK';
  error.baseFreshness = 'VERIFIED';
  error.nextManualAction = `Run worktree resume --branch ${branch} to continue that remote branch, or choose a different branch name.`;
  return error;
}

function getCurrentBranch(cwd) {
  return runGit(['branch', '--show-current'], {
    cwd,
    capture: true,
    allowFailure: true,
  }).trim();
}

function isMainBranch(branch) {
  return MAIN_BRANCHES.has(branch);
}

function hasUncommittedChanges(cwd) {
  const output = runGit(['status', '--porcelain'], {
    cwd,
    capture: true,
    allowFailure: true,
  });
  return output.trim().length > 0;
}

function getBaseRef(mainRoot, config) {
  const baseBranch = config.baseBranch || 'main';
  const originRef = `origin/${baseBranch}`;
  if (remoteRefExists(mainRoot, originRef)) return originRef;
  if (branchExists(mainRoot, baseBranch)) return baseBranch;
  return 'HEAD';
}

function resolveCommit(mainRoot, ref) {
  return runGit(['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: mainRoot,
    capture: true,
    allowFailure: true,
  }).trim();
}

function baseResolutionError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function getRequiredRemoteBase(mainRoot, config) {
  const baseBranch = config.baseBranch || 'main';
  const baseRef = `refs/remotes/origin/${baseBranch}`;
  const baseCommit = resolveCommit(mainRoot, baseRef);
  if (!baseCommit) {
    throw baseResolutionError(`remote base origin/${baseBranch} is unavailable after fetch`, {
      fetchStatus: 'FAILED',
      baseRef,
      baseFreshness: 'UNVERIFIED',
      nextManualAction: `Restore origin/${baseBranch} and rerun, or explicitly use --skip-fetch with a cached or local ${baseBranch}.`,
    });
  }
  return {
    baseRef,
    baseCommit,
    baseSource: 'remote',
    baseFreshness: 'VERIFIED',
    fetchStatus: 'OK',
  };
}

function getSkippedBase(mainRoot, config) {
  const baseBranch = config.baseBranch || 'main';
  const remoteRef = `refs/remotes/origin/${baseBranch}`;
  const remoteCommit = resolveCommit(mainRoot, remoteRef);
  if (remoteCommit) {
    return {
      baseRef: remoteRef,
      baseCommit: remoteCommit,
      baseSource: 'cached-remote',
      baseFreshness: 'UNVERIFIED',
      fetchStatus: 'SKIPPED',
    };
  }

  const localRef = `refs/heads/${baseBranch}`;
  const localCommit = resolveCommit(mainRoot, localRef);
  if (localCommit) {
    return {
      baseRef: localRef,
      baseCommit: localCommit,
      baseSource: 'local-base',
      baseFreshness: 'UNVERIFIED',
      fetchStatus: 'SKIPPED',
    };
  }

  throw baseResolutionError(`no cached origin/${baseBranch} or local ${baseBranch} exists`, {
    fetchStatus: 'SKIPPED',
    baseFreshness: 'UNVERIFIED',
    nextManualAction: `Fetch origin/${baseBranch} or create the local ${baseBranch} branch before retrying --skip-fetch.`,
  });
}

function shouldSkipFetch(cli = {}, env = process.env) {
  const envValue = String(env.AGENT_WORKTREE_SKIP_FETCH || '').trim().toLowerCase();
  return Boolean(
    cli['skip-fetch'] ||
    cli.skipFetch ||
    envValue === '1' ||
    envValue === 'true' ||
    envValue === 'yes'
  );
}

function uniqueWorktreePath(basePath) {
  if (!fs.existsSync(basePath)) return basePath;
  const suffix = shortHash(basePath);
  let candidate = `${basePath}-${suffix}`;
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = `${basePath}-${suffix}-${index}`;
    index += 1;
  }
  return candidate;
}

function setupSymlinkIfPresent(mainRoot, worktreePath, relativePath) {
  const source = path.join(mainRoot, relativePath);
  const target = path.join(worktreePath, relativePath);
  if (!fs.existsSync(source) || fs.existsSync(target)) return false;
  ensureDir(path.dirname(target));
  fs.symlinkSync(path.relative(path.dirname(target), source), target);
  return true;
}

function validateSharedLinkRelativePath(relativePath) {
  const value = String(relativePath || '').trim();
  const normalized = value.replace(/\\/gu, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (!value || path.isAbsolute(value) || segments.includes('..')) {
    throw new Error(`shared worktree link must be a relative path inside the repo: ${relativePath}`);
  }
  const forbidden = segments.find((segment) => (
    segment.toLowerCase() === 'node_modules'
    || segment.toLowerCase() === '.pnpm'
    || segment.toLowerCase() === '.git'
  ));
  if (forbidden) {
    throw new Error(`forbidden shared worktree link path '${forbidden}': ${relativePath}`);
  }
  return value;
}

function validateSharedLinkConfig(config) {
  const candidates = [
    ...((config.worktree && config.worktree.envSymlinks) || []),
    ...((config.worktree && config.worktree.sharedConfigSymlinks) || []),
  ];
  return candidates.map(validateSharedLinkRelativePath);
}

function setupSharedLinks(mainRoot, worktreePath, config) {
  const linked = [];
  const candidates = validateSharedLinkConfig(config);
  for (const safeRelativePath of candidates) {
    try {
      if (setupSymlinkIfPresent(mainRoot, worktreePath, safeRelativePath)) {
        linked.push(safeRelativePath);
      }
    } catch (error) {
      console.log(`WARN symlink skipped ${safeRelativePath}: ${error.message}`);
    }
  }
  return linked;
}

function sessionPath(config, mainRoot, branch) {
  const configured = config.worktree && config.worktree.sessionDir;
  const dir = resolveRuntimePath(config, mainRoot, configured, 'worktree-sessions');
  ensureDir(dir);
  return path.join(dir, `${slugify(branch)}.json`);
}

function writeSession(config, mainRoot, payload) {
  const filePath = sessionPath(config, mainRoot, payload.branch);
  const configuredLockDir = config.worktree && config.worktree.lockDir;
  const lockDir = resolveRuntimePath(config, mainRoot, configuredLockDir, 'agent-locks');
  const releaseLock = acquireLock(lockDir, `worktree-session-${payload.branch}`, 30000);
  try {
    const now = new Date().toISOString();
    const previous = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
    const protectedStatuses = new Set(['cleanup_pending', 'recovery_required']);
    if (protectedStatuses.has(previous.status) && payload.status === 'in_progress') {
      const error = new Error(
        `branch ${payload.branch} is ${previous.status}; resolve its post-merge lifecycle before resuming`,
      );
      error.lifecycleStatus = previous.status;
      error.nextManualAction = previous.status === 'recovery_required'
        ? `Inspect and preserve post-merge changes in ${previous.worktree || payload.worktree || payload.branch}.`
        : 'Run the completion guard from the main worktree so durable cleanup can converge.';
      throw error;
    }
    const leaseTtlMinutes = Number(config.worktree && config.worktree.leaseTtlMinutes) || 1440;
    const renewLease = payload.status === 'in_progress';
    const owner = renewLease
      ? {
        pid: process.pid,
        ppid: process.ppid,
        token: previous.owner && previous.owner.token ? previous.owner.token : randomUUID(),
        created_at: previous.owner && previous.owner.created_at ? previous.owner.created_at : now,
      }
      : previous.owner;
    const lease = renewLease
      ? {
        renewed_at: now,
        expires_at: new Date(Date.parse(now) + leaseTtlMinutes * 60 * 1000).toISOString(),
      }
      : previous.lease;
    const next = JSON.stringify({
      ...previous,
      ...payload,
      schema_version: 2,
      revision: Number(previous.revision || 0) + 1,
      ...(owner ? { owner } : {}),
      ...(lease ? { lease } : {}),
      updated_at: now,
      started_at: previous.started_at || payload.started_at || now,
    }, null, 2) + '\n';
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporaryPath, next);
    fs.renameSync(temporaryPath, filePath);
    return filePath;
  } finally {
    releaseLock();
  }
}

function assertSessionCanResume(config, mainRoot, branch) {
  const session = readSessions(config, mainRoot).find((item) => item.branch === branch);
  if (!session || !['cleanup_pending', 'recovery_required'].includes(session.status)) return session || null;
  const error = new Error(
    `branch ${branch} is ${session.status}; refusing to overwrite its post-merge lifecycle state`,
  );
  error.lifecycleStatus = session.status;
  error.worktreePath = session.worktree;
  error.nextManualAction = session.status === 'recovery_required'
    ? `Inspect ${session.worktree || branch}, then run worktree-resume.js --branch ${branch} --recover-as <new-branch>.`
    : 'Run the completion guard from the main worktree so durable cleanup can converge.';
  throw error;
}

function recoverSessionAsBranch(config, mainRoot, branch, newBranch, options = {}) {
  if (!newBranch || newBranch === branch || isMainBranch(newBranch)) {
    throw new Error('--recover-as requires a distinct non-main branch name');
  }
  const configuredLockDir = config.worktree && config.worktree.lockDir;
  const lockDir = resolveRuntimePath(config, mainRoot, configuredLockDir, 'agent-locks');
  const release = acquireLock(lockDir, 'worktree-recovery-rebind', options.lockTimeoutMs || 30000);
  try {
    const session = readSessions(config, mainRoot).find((item) => item.branch === branch);
    if (!session || session.status !== 'recovery_required' || !session.worktree) {
      throw new Error(`branch ${branch} has no recovery_required session`);
    }
    let entry = listWorktrees(mainRoot).find((item) => isSamePath(item.path, session.worktree));
    if (!entry) throw new Error(`recovery worktree is not registered: ${session.worktree}`);
    if (![branch, newBranch].includes(entry.branch)) {
      throw new Error(`recovery worktree branch mismatch: expected ${branch}, found ${entry.branch || '(detached)'}`);
    }
    const head = runGit(['rev-parse', 'HEAD'], { cwd: session.worktree, capture: true }).trim();
    const taskIds = verifiedRecoveryTaskIds(config, mainRoot, session, options);
    const lifecycleKeys = new Set(sessionLifecycleKeys(session));
    for (const taskId of taskIds) lifecycleKeys.add(`task:${taskId}`);
    const lifecycle = {
      ...(session.lifecycle || {}),
      phase: session.lifecycle?.phase || session.phase || inferPhaseFromBranch(newBranch),
      keys: [...lifecycleKeys].sort(),
    };
    const rebind = {
      fromBranch: branch,
      toBranch: newBranch,
      worktree: path.resolve(session.worktree),
      expectedHead: head,
      requestedAt: session.rebind?.requestedAt || new Date().toISOString(),
    };
    writeSession(config, mainRoot, {
      branch,
      worktree: session.worktree,
      status: 'recovery_required',
      step: 'recovery_rebind_pending',
      rebind,
    });

    if (entry.branch === branch) {
      if (branchExists(mainRoot, newBranch)) throw new Error(`recovery branch already exists: ${newBranch}`);
      runGit(['branch', '-m', newBranch], { cwd: session.worktree });
      entry = listWorktrees(mainRoot).find((item) => isSamePath(item.path, session.worktree));
    }
    if (!entry || entry.branch !== newBranch) {
      throw new Error(`recovery branch rename is incomplete: expected ${newBranch}`);
    }
    const observedHead = runGit(['rev-parse', 'HEAD'], { cwd: session.worktree, capture: true }).trim();
    if (observedHead !== head) {
      throw new Error(`recovery HEAD drift: expected ${head}, found ${observedHead}`);
    }

    writeManagedMarker(mainRoot, session.worktree, newBranch);
    writeSession(config, mainRoot, {
      phase: session.phase || inferPhaseFromBranch(newBranch),
      branch: newBranch,
      worktree: session.worktree,
      status: 'in_progress',
      step: 'recovered_post_merge_work',
      recovered_from: session.recovered_from || branch,
      head,
      lifecycle,
    });
    const taskBindings = bindLifecycleTaskLocations(
      config,
      mainRoot,
      { ...session, lifecycle },
      session.worktree,
      newBranch,
      options,
    );
    if (branchExists(mainRoot, branch)) {
      const previousHead = runGit(['rev-parse', branch], { cwd: mainRoot, capture: true }).trim();
      if (previousHead !== head) {
        throw new Error(`previous recovery branch drift: expected ${head}, found ${previousHead}`);
      }
      runGit(['branch', '-D', branch], { cwd: mainRoot });
    }
    removeSession(config, mainRoot, branch);
    return {
      branch: newBranch,
      previousBranch: branch,
      worktreePath: session.worktree,
      head,
      taskBindings,
    };
  } finally {
    release();
  }
}

function writeManagedMarker(mainRoot, worktreePath, branch) {
  fs.writeFileSync(path.join(worktreePath, MANAGED_MARKER), JSON.stringify({
    version: 1,
    mainRoot: path.resolve(mainRoot),
    branch,
  }) + '\n');
  const excludePath = path.join(mainRoot, '.git', 'info', 'exclude');
  const rule = `/${MANAGED_MARKER}`;
  const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
  if (!existing.split(/\r?\n/).includes(rule)) fs.appendFileSync(excludePath, `${existing.endsWith('\n') || !existing ? '' : '\n'}${rule}\n`);
}

function readSessions(config, mainRoot) {
  const configured = config.worktree && config.worktree.sessionDir;
  const dir = resolveRuntimePath(config, mainRoot, configured, 'worktree-sessions');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function removeSession(config, mainRoot, branch) {
  const filePath = sessionPath(config, mainRoot, branch);
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
}

function hasOwnedWorktreeMarker(mainRoot, worktreePath, branch) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(worktreePath, MANAGED_MARKER), 'utf8'));
    return marker
      && marker.version === 1
      && marker.branch === branch
      && typeof marker.mainRoot === 'string'
      && isSamePath(marker.mainRoot, mainRoot);
  } catch {
    return false;
  }
}

/**
 * Compatibility facade for callers of the legacy reclaimer.  The old
 * implementation deleted merged worktrees without a versioned session lease,
 * task binding, process snapshot, or cleanup intent.  It is intentionally
 * observe-only now; destructive convergence is owned exclusively by
 * worktree-audit.js.
 */
function reclaimMergedManagedWorktrees(options = {}) {
  const mainRoot = options.mainRoot || getMainRepoRoot(process.cwd());
  const config = options.config || loadConfig({ repoRoot: mainRoot });
  const baseRef = options.baseRef || getBaseRef(mainRoot, config);
  const audit = require('./worktree-audit').auditManagedWorktrees({
    mainRoot,
    config,
    baseRef,
    cwd: options.cwd || process.cwd(),
    apply: false,
  });
  return {
    removed: [],
    retained: audit.records.map((record) => ({
      branch: record.branch,
      path: record.path,
      reason: `legacy-reclaimer-disabled:${record.state}:${record.reason}`,
    })),
  };
}

function normalizeBootstrapMode(value, fallback = 'skip') {
  const mode = String(value || fallback).trim().toLowerCase();
  if (mode === 'auto' || mode === 'check' || mode === 'skip') return mode;
  return fallback;
}

function bootstrapConfig(config) {
  return (config.worktree && config.worktree.bootstrap) || {};
}

function normalizeReusablePath(entry) {
  const value = typeof entry === 'string' ? entry : entry && entry.path;
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`reusable path must be relative and stay inside the repo: ${value || '(empty)'}`);
  }
  const segments = normalized.toLowerCase().split('/');
  if (segments.includes('.git') || segments.includes('node_modules') || segments.includes('.pnpm')) {
    throw new Error(`forbidden reusable dependency or Git path: ${normalized}`);
  }
  return normalized;
}

function assertReusableLinksStayInsideRoot(rootPath, allowedRoot) {
  const realAllowedRoot = fs.realpathSync(allowedRoot);

  function visit(currentPath, ancestorDirectories) {
    const linkStat = fs.lstatSync(currentPath);
    const resolvedPath = fs.realpathSync(currentPath);
    if (linkStat.isSymbolicLink() && !isPathInside(realAllowedRoot, resolvedPath)) {
      throw new Error(`reusable source link escapes the main repo: ${currentPath} -> ${resolvedPath}`);
    }

    const stat = linkStat.isSymbolicLink() ? fs.statSync(currentPath) : linkStat;
    if (!stat.isDirectory()) return;

    const realDirectory = fs.realpathSync(resolvedPath);
    if (ancestorDirectories.has(realDirectory)) {
      throw new Error(`reusable source contains a directory link cycle: ${currentPath}`);
    }
    const nextAncestors = new Set(ancestorDirectories);
    nextAncestors.add(realDirectory);
    for (const entry of fs.readdirSync(resolvedPath)) {
      visit(path.join(resolvedPath, entry), nextAncestors);
    }
  }

  visit(rootPath, new Set());
}

function copyReusableTreeDereferenced(sourcePath, targetPath) {
  const linkStat = fs.lstatSync(sourcePath);
  const resolvedSource = linkStat.isSymbolicLink() ? fs.realpathSync(sourcePath) : sourcePath;
  const stat = linkStat.isSymbolicLink() ? fs.statSync(sourcePath) : linkStat;
  if (stat.isDirectory()) {
    fs.mkdirSync(targetPath, { recursive: true, mode: stat.mode });
    for (const entry of fs.readdirSync(resolvedSource)) {
      copyReusableTreeDereferenced(path.join(resolvedSource, entry), path.join(targetPath, entry));
    }
    fs.chmodSync(targetPath, stat.mode);
    return;
  }
  if (!stat.isFile()) {
    throw new Error(`reusable source contains an unsupported filesystem entry: ${sourcePath}`);
  }
  fs.copyFileSync(resolvedSource, targetPath);
  fs.chmodSync(targetPath, stat.mode);
}

function materializeReusablePaths(options = {}) {
  const mainRoot = path.resolve(options.mainRoot || '');
  const worktreePath = path.resolve(options.worktreePath || '');
  const entries = Array.isArray(options.entries) ? options.entries : [];
  const reusedPaths = [];
  const existingPaths = [];
  const missingPaths = [];
  if (!options.mainRoot || !options.worktreePath || isSamePath(mainRoot, worktreePath)) {
    return { reusedPaths, existingPaths, missingPaths };
  }

  for (const entry of entries) {
    const relativePath = normalizeReusablePath(entry);
    const sourcePath = path.resolve(mainRoot, relativePath);
    const targetPath = path.resolve(worktreePath, relativePath);
    if (!isPathInside(mainRoot, sourcePath) || !isPathInside(worktreePath, targetPath)) {
      throw new Error(`reusable path must be relative and stay inside the repo: ${relativePath}`);
    }
    if (fs.existsSync(targetPath)) {
      existingPaths.push(relativePath);
      continue;
    }
    if (!fs.existsSync(sourcePath)) {
      missingPaths.push(relativePath);
      continue;
    }

    assertReusableLinksStayInsideRoot(sourcePath, mainRoot);
    ensureDir(path.dirname(targetPath));
    const temporaryPath = `${targetPath}.reuse-${process.pid}-${Date.now()}`;
    try {
      copyReusableTreeDereferenced(sourcePath, temporaryPath);
      fs.renameSync(temporaryPath, targetPath);
    } catch (error) {
      fs.rmSync(temporaryPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      throw error;
    }
    reusedPaths.push(relativePath);
  }

  return { reusedPaths, existingPaths, missingPaths };
}

function bootstrapMode(config, cli = {}, defaultMode = '') {
  if (cli['skip-bootstrap'] || cli.skipBootstrap) return 'skip';
  if (cli.bootstrap) return normalizeBootstrapMode(cli.bootstrap, 'skip');
  return normalizeBootstrapMode(defaultMode || bootstrapConfig(config).mode || 'skip', 'skip');
}

function bootstrapError(message, meta = {}) {
  const error = new Error(message);
  Object.assign(error, meta);
  return error;
}

function runShell(command, options = {}) {
  // Bootstrap commands are reviewed, tracked repository configuration. This
  // is the one intentional shell boundary because the contract permits a
  // command pipeline; no request or environment value can select it.
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const result = spawnSync(command, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    env: process.env,
    shell: true,
    stdio: options.capture ? 'pipe' : 'inherit',
    timeout: options.timeoutMs || 600000,
  });
  return result;
}

function getStatusLines(cwd) {
  const output = runGit(['status', '--porcelain', '--untracked-files=all'], {
    cwd,
    capture: true,
    allowFailure: true,
  });
  return output.trim() ? output.trim().split('\n').filter(Boolean) : [];
}

function acquireLock(lockDir, lockName, timeoutMs = 600000) {
  ensureDir(lockDir);
  const safeName = slugify(lockName || 'worktree-bootstrap', 'worktree-bootstrap');
  const lockPath = path.join(lockDir, `${safeName}.lock`);
  const started = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(path.join(lockPath, 'owner'), `${process.pid}\n${new Date().toISOString()}\n`);
      return () => fs.rmSync(lockPath, { recursive: true, force: true });
    } catch (error) {
      if (error && error.code !== 'EEXIST') throw error;
      try {
        const ownerPath = path.join(lockPath, 'owner');
        const stat = fs.statSync(lockPath);
        const owner = fs.existsSync(ownerPath)
          ? Number(fs.readFileSync(ownerPath, 'utf8').split(/\r?\n/)[0])
          : 0;
        let ownerAlive = false;
        if (owner > 0) {
          try {
            process.kill(owner, 0);
            ownerAlive = true;
          } catch (ownerError) {
            ownerAlive = ownerError && ownerError.code === 'EPERM';
          }
        }
        if (!ownerAlive && Date.now() - stat.mtimeMs > 1000) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        // Another process may be creating or releasing the lock; retry normally.
      }
      if (Date.now() - started > timeoutMs) {
        throw bootstrapError(`bootstrap lock timeout: ${lockPath}`, {
          bootstrapStatus: 'BLOCKED',
          nextManualAction: `Remove stale lock if safe: ${lockPath}`,
        });
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }
}

function runBootstrapCheck(worktreePath, command, timeoutMs) {
  if (!command) {
    return { configured: false, ok: false, status: null };
  }
  const result = runShell(command, {
    cwd: worktreePath,
    capture: true,
    timeoutMs,
  });
  return {
    configured: true,
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

// ── 依赖输入戳 ───────────────────────────────────────────────────────────────
// worktree.bootstrap.inputs 列出决定依赖内容的文件（如 pnpm-lock.yaml）。bootstrap 成功后把输入与命令的
// 哈希写入当前 worktree 私有 git 目录；之后输入变化（例如 tdd sync 合并主干带来新 lockfile）即使
// readiness check 通过也视为依赖过期。未配置 inputs 时行为与以前一致。
const BOOTSTRAP_STAMP_FILE = 'agent-bootstrap-stamp.json';
const BOOTSTRAP_STAMP_VERSION = 1;

function normalizeBootstrapInputs(entries) {
  if (entries == null) return [];
  if (!Array.isArray(entries)) {
    throw bootstrapError('worktree.bootstrap.inputs must be an array of repo-relative file paths', {
      bootstrapStatus: 'BLOCKED',
      nextManualAction: 'Fix worktree.bootstrap.inputs in agent.config.json.',
    });
  }
  return [...new Set(entries.map((entry) => {
    const normalized = String(entry == null ? '' : entry).trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..')) {
      throw bootstrapError(`bootstrap input must be a relative path inside the repo: ${entry || '(empty)'}`, {
        bootstrapStatus: 'BLOCKED',
        nextManualAction: 'Fix worktree.bootstrap.inputs in agent.config.json.',
      });
    }
    return normalized;
  }))].sort();
}

function computeBootstrapInputsHash(worktreePath, inputs, command) {
  const digest = crypto.createHash('sha256');
  digest.update(`v${BOOTSTRAP_STAMP_VERSION}\0${command}\0`);
  for (const relativePath of inputs) {
    const filePath = path.resolve(worktreePath, relativePath);
    let fileHash = 'missing';
    try {
      if (fs.statSync(filePath).isFile()) {
        fileHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
    digest.update(`${relativePath}\0${fileHash}\n`);
  }
  return digest.digest('hex');
}

function bootstrapStampPath(worktreePath) {
  // --git-path 解析到当前 worktree 的私有 git 目录：不进入工作区状态，worktree 删除时一并清除。
  const output = runGit(['rev-parse', '--git-path', BOOTSTRAP_STAMP_FILE], { cwd: worktreePath, capture: true });
  return path.resolve(worktreePath, output.trim());
}

function readBootstrapStamp(stampPath) {
  try {
    const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
    return stamp && stamp.version === BOOTSTRAP_STAMP_VERSION && typeof stamp.inputsHash === 'string' ? stamp : null;
  } catch {
    // 缺失或损坏的戳都按“未知”处理，由调用方重新执行 bootstrap。
    return null;
  }
}

function evaluateBootstrapInputs(worktreePath, settings, command) {
  const inputs = normalizeBootstrapInputs(settings.inputs);
  if (inputs.length === 0) return { configured: false, fresh: true };
  const stampPath = bootstrapStampPath(worktreePath);
  const inputsHash = computeBootstrapInputsHash(worktreePath, inputs, command);
  const stamp = readBootstrapStamp(stampPath);
  if (!stamp) {
    return { configured: true, fresh: false, inputs, inputsHash, stampPath, reason: 'no bootstrap stamp recorded for dependency inputs' };
  }
  if (stamp.inputsHash !== inputsHash) {
    return { configured: true, fresh: false, inputs, inputsHash, stampPath, reason: `dependency inputs changed since last bootstrap (${inputs.join(', ')})` };
  }
  return { configured: true, fresh: true, inputs, inputsHash, stampPath };
}

function writeBootstrapStamp(evaluation) {
  if (!evaluation.configured) return;
  ensureDir(path.dirname(evaluation.stampPath));
  const temporaryPath = `${evaluation.stampPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify({
    version: BOOTSTRAP_STAMP_VERSION,
    inputs: evaluation.inputs,
    inputsHash: evaluation.inputsHash,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
  fs.renameSync(temporaryPath, evaluation.stampPath);
}

// 未配置 bootstrap 命令时，只有能证明项目零依赖才允许跳过；任何依赖迹象或无法判定都返回 none=false，
// 由调用方继续 fail closed，避免把“有依赖但漏配命令”误报为 SKIPPED。
const PACKAGE_DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies'];
const DEPENDENCY_EVIDENCE_FILES = [
  'pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py', 'go.mod', 'Cargo.toml', 'Gemfile',
  'composer.json', 'pom.xml', 'build.gradle', 'build.gradle.kts',
];

function readPackageManifest(filePath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest : null;
  } catch {
    return null;
  }
}

function manifestDeclaresDependencies(manifest) {
  return PACKAGE_DEPENDENCY_FIELDS.some((field) => {
    const value = manifest[field];
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    return typeof value !== 'object' || Object.keys(value).length > 0;
  });
}

// 只解析块列表形式的 pnpm-workspace.yaml packages；其他写法返回 null（无法判定）。
function readPnpmWorkspacePatterns(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const patterns = [];
  let inPackages = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\S/.test(line)) {
      if (/^packages\s*:\s*$/.test(line)) {
        inPackages = true;
        continue;
      }
      if (/^packages\s*:/.test(line)) return null;
      inPackages = false;
      continue;
    }
    if (!inPackages) continue;
    const match = line.match(/^\s+-\s+(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/);
    if (!match) return null;
    patterns.push(match[1] ?? match[2] ?? match[3]);
  }
  return patterns;
}

// 支持字面目录与单层 `<dir>/*`；排除模式（!）只会缩小范围，忽略后检查更多目录仍偏保守。
function resolveWorkspaceMembers(worktreePath, patterns) {
  const members = [];
  for (const rawPattern of patterns) {
    const pattern = String(rawPattern || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!pattern || pattern.startsWith('!')) continue;
    if (path.posix.isAbsolute(pattern) || pattern.split('/').includes('..')) return null;
    const wildcard = pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern;
    if (/[*?[\]{}]/.test(wildcard)) return null;
    const base = path.join(worktreePath, ...wildcard.split('/').filter(Boolean));
    if (!pattern.endsWith('/*')) {
      members.push(base);
      continue;
    }
    if (!fs.existsSync(base)) continue;
    if (!fs.statSync(base).isDirectory()) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) members.push(path.join(base, entry.name));
    }
  }
  return members;
}

function detectNoDeclaredDependencies(worktreePath) {
  const undetermined = (reason) => ({ none: false, reason });
  const evidence = DEPENDENCY_EVIDENCE_FILES.find((name) => fs.existsSync(path.join(worktreePath, name)));
  if (evidence) return undetermined(`dependency evidence found: ${evidence}`);

  const rootManifestPath = path.join(worktreePath, 'package.json');
  if (!fs.existsSync(rootManifestPath)) return undetermined('package.json not found');
  const rootManifest = readPackageManifest(rootManifestPath);
  if (!rootManifest) return undetermined('package.json is not a valid JSON object');
  if (manifestDeclaresDependencies(rootManifest)) return undetermined('package.json declares dependencies');

  const patterns = [];
  const workspaces = rootManifest.workspaces;
  if (workspaces != null) {
    const list = Array.isArray(workspaces) ? workspaces : workspaces && workspaces.packages;
    if (!Array.isArray(list)) return undetermined('package.json workspaces cannot be resolved');
    patterns.push(...list);
  }
  const pnpmWorkspacePath = path.join(worktreePath, 'pnpm-workspace.yaml');
  if (fs.existsSync(pnpmWorkspacePath)) {
    const pnpmPatterns = readPnpmWorkspacePatterns(pnpmWorkspacePath);
    if (!pnpmPatterns) return undetermined('pnpm-workspace.yaml packages cannot be resolved');
    patterns.push(...pnpmPatterns);
  }
  const members = resolveWorkspaceMembers(worktreePath, patterns);
  if (!members) return undetermined('workspace patterns cannot be resolved');
  for (const member of members) {
    const memberManifestPath = path.join(member, 'package.json');
    if (!fs.existsSync(memberManifestPath)) continue;
    const memberManifest = readPackageManifest(memberManifestPath);
    const relative = path.relative(worktreePath, memberManifestPath).replace(/\\/g, '/');
    if (!memberManifest) return undetermined(`${relative} is not a valid JSON object`);
    if (manifestDeclaresDependencies(memberManifest)) return undetermined(`${relative} declares dependencies`);
  }
  return { none: true, reason: 'no dependencies declared in package.json or workspace members' };
}

function nextBootstrapAction(command, worktreePath) {
  return command
    ? `cd "${worktreePath}" && ${command}`
    : 'Configure worktree.bootstrap.command, then rerun with --bootstrap=auto.';
}

function runWorktreeBootstrap(options = {}) {
  // allowDirty：tdd sync 等开发中途调用时允许已有未提交改动，改为校验命令前后工作区状态不变。
  const { worktreePath, config, cli = {}, mainRoot, defaultMode = '', allowDirty = false } = options;
  const settings = bootstrapConfig(config);
  const mode = bootstrapMode(config, cli, defaultMode);
  const command = settings.command || '';
  const checkCommand = settings.checkCommand || '';
  const alwaysRun = settings.alwaysRun === true;
  const timeoutMs = Number(settings.timeoutMs || 600000);
  const lockName = settings.lockName || `${config.projectName || 'project'}-worktree-bootstrap`;

  if (!worktreePath) {
    return { status: 'SKIPPED', mode, reason: 'missing worktree path' };
  }
  const reuse = materializeReusablePaths({
    mainRoot: mainRoot || getMainRepoRoot(worktreePath),
    worktreePath,
    entries: settings.reuseFromMain,
  });
  if (mode === 'skip') {
    return {
      status: reuse.reusedPaths.length > 0 ? 'REUSED' : 'SKIPPED',
      mode,
      reason: 'dependency bootstrap disabled',
      ...reuse,
    };
  }

  const check = runBootstrapCheck(worktreePath, checkCommand, timeoutMs);
  const inputs = evaluateBootstrapInputs(worktreePath, settings, command);
  if ((mode !== 'auto' || !alwaysRun) && check.configured && check.ok && inputs.fresh) {
    return { status: 'READY', mode, checkCommand, refreshed: false, ...reuse };
  }
  const staleReason = check.configured && !check.ok
    ? `check command exited ${check.status}`
    : inputs.reason || (check.configured ? 'alwaysRun is enabled' : 'no checkCommand configured');

  if (mode === 'check') {
    return {
      status: check.configured || inputs.configured ? 'MISSING' : 'SKIPPED',
      mode,
      reason: staleReason,
      checkCommand,
      nextManualAction: nextBootstrapAction(command, worktreePath),
      ...reuse,
    };
  }

  if (!command) {
    // 零依赖项目无需安装；有依赖迹象或无法判定时仍阻断，提示配置命令或显式跳过。
    const dependencies = detectNoDeclaredDependencies(worktreePath);
    if (dependencies.none) {
      return { status: 'SKIPPED', mode, reason: dependencies.reason, ...reuse };
    }
    throw bootstrapError(`worktree bootstrap mode is auto but command is not configured (${dependencies.reason})`, {
      worktreePath,
      bootstrapStatus: 'BLOCKED',
      nextManualAction: 'Set worktree.bootstrap.command or rerun with --skip-bootstrap.',
    });
  }

  const beforeStatus = getStatusLines(worktreePath);
  if (beforeStatus.length > 0 && !allowDirty) {
    throw bootstrapError('worktree has existing non-ignored changes before bootstrap', {
      worktreePath,
      bootstrapStatus: 'BLOCKED',
      dirtyFiles: beforeStatus.join(','),
      nextManualAction: 'Commit, stash, or clean existing changes before running bootstrap auto mode.',
    });
  }

  const lockDir = resolveRuntimePath(
    config,
    mainRoot || getMainRepoRoot(worktreePath),
    config.worktree && config.worktree.lockDir,
    'agent-locks',
  );
  const release = acquireLock(lockDir, lockName, timeoutMs);
  try {
    const result = runShell(command, { cwd: worktreePath, timeoutMs });
    if (result.error || result.status !== 0) {
      throw bootstrapError(`worktree bootstrap command failed${result.status == null ? '' : ` (exit ${result.status})`}`, {
        worktreePath,
        bootstrapStatus: 'FAILED',
        command,
        nextManualAction: nextBootstrapAction(command, worktreePath),
      });
    }
  } finally {
    release();
  }

  const afterStatus = getStatusLines(worktreePath);
  if (afterStatus.join('\n') !== beforeStatus.join('\n')) {
    throw bootstrapError('worktree bootstrap produced non-ignored changes', {
      worktreePath,
      bootstrapStatus: 'BLOCKED',
      dirtyFiles: afterStatus.join(','),
      nextManualAction: 'Inspect the dirty files, commit intended config changes separately, or fix the bootstrap command.',
    });
  }

  const postCheck = runBootstrapCheck(worktreePath, checkCommand, timeoutMs);
  if (postCheck.configured && !postCheck.ok) {
    throw bootstrapError(`worktree bootstrap check still fails (exit ${postCheck.status})`, {
      worktreePath,
      bootstrapStatus: 'FAILED',
      command,
      checkCommand,
      nextManualAction: nextBootstrapAction(command, worktreePath),
    });
  }

  // 重新计算输入哈希再写戳，记录命令实际面对的输入。
  writeBootstrapStamp(evaluateBootstrapInputs(worktreePath, settings, command));
  return { status: 'READY', mode, command, checkCommand, refreshed: true, reason: staleReason, ...reuse };
}

function adoptionError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

/**
 * Returns the registered Claude Desktop worktree containing cwd when it has
 * neither a session nor an ownership marker; managed or foreign paths return null.
 */
function detectDesktopAdoption(config, mainRoot, cwd) {
  const worktreeRoot = getWorktreeRoot(cwd);
  if (!worktreeRoot || isSamePath(worktreeRoot, mainRoot)) return null;
  if (!isDesktopWorktreePath(mainRoot, worktreeRoot)) return null;
  const entry = listWorktrees(mainRoot).find((item) => isSamePath(item.path, worktreeRoot));
  if (!entry) return null;
  const managed = readSessions(config, mainRoot)
    .some((session) => session.worktree && isSamePath(session.worktree, entry.path));
  if (managed) return null;
  if (entry.branch && hasOwnedWorktreeMarker(mainRoot, entry.path, entry.branch)) return null;
  return entry;
}

function rollbackDesktopAdoption(worktreePath, state, error) {
  const rollback = [];
  try {
    if (state.renamed) {
      runGit(['branch', '-m', state.originalBranch], { cwd: worktreePath, capture: true });
      rollback.push(`branch restored to ${state.originalBranch}`);
    }
    if (state.adoptionReset) {
      runGit(['reset', '--hard', state.previousHead], { cwd: worktreePath, capture: true });
      rollback.push(`HEAD restored to ${state.previousHead}`);
    }
  } catch (rollbackError) {
    rollback.push(`rollback failed: ${rollbackError.message}`);
    error.nextManualAction = `Inspect ${worktreePath}: restore branch ${state.originalBranch} at ${state.previousHead} manually before rerunning worktree new.`;
  }
  if (rollback.length > 0) error.adoptionRollback = rollback.join('; ');
}

function adoptDesktopWorktree(context) {
  const {
    cli, branch, cwd, mainRoot, config, entry, options,
  } = context;
  const worktreePath = path.resolve(entry.path);
  const originalBranch = entry.branch || '';
  const details = { worktreePath, originalBranch };
  if (!originalBranch) {
    throw adoptionError('Desktop worktree has a detached HEAD; refusing to adopt it', {
      ...details,
      nextManualAction: `Check out a branch in ${worktreePath} or leave it and run worktree new from the main worktree.`,
    });
  }
  if (isMainBranch(originalBranch)) {
    throw adoptionError(`Desktop worktree is on base branch ${originalBranch}; refusing to adopt it`, details);
  }
  if (entry.locked || entry.prunable) {
    throw adoptionError(`Desktop worktree is ${entry.locked ? 'locked' : 'prunable'}; refusing to adopt it`, details);
  }
  const occupied = findWorktreeByBranch(mainRoot, branch);
  if (occupied && !isSamePath(occupied.path, worktreePath)) {
    throw adoptionError(`branch ${branch} is already checked out at ${occupied.path}`, {
      ...details,
      nextManualAction: `Continue in ${occupied.path}, or choose a different --task/--branch for this Desktop worktree.`,
    });
  }
  if (originalBranch !== branch && branchExists(mainRoot, branch)) {
    throw adoptionError(`local branch ${branch} already exists; refusing to rename ${originalBranch} over it`, details);
  }
  const dirty = getStatusLines(worktreePath);
  if (dirty.length > 0) {
    throw adoptionError(`Desktop worktree has uncommitted changes: ${worktreePath}`, {
      ...details,
      dirtyFiles: dirty.map((line) => line.slice(3)).join(','),
      nextManualAction: `Commit or discard the changes in ${worktreePath}, then rerun worktree new.`,
    });
  }
  const previousHead = runGit(['rev-parse', 'HEAD'], { cwd: worktreePath, capture: true }).trim();

  if (cli.dryRun) {
    return {
      branch,
      worktreePath,
      config,
      mainRoot,
      baseRef: getBaseRef(mainRoot, config),
      dryRun: true,
      adopted: true,
      originalBranch,
      previousHead,
    };
  }

  const fetchSkipped = shouldSkipFetch(cli);
  let base;
  if (fetchSkipped) {
    base = getSkippedBase(mainRoot, config);
  } else {
    try {
      runGit(['fetch', '--prune', 'origin'], { cwd: mainRoot });
    } catch (error) {
      error.fetchStatus = 'FAILED';
      error.baseFreshness = 'UNVERIFIED';
      error.worktreePath = worktreePath;
      error.nextManualAction = 'Fix origin access and rerun, or explicitly use --skip-fetch with a cached or local base.';
      throw error;
    }
    base = getRequiredRemoteBase(mainRoot, config);
  }
  const baseLabel = base.baseRef.replace(/^refs\/remotes\//u, '').replace(/^refs\/heads\//u, '');
  const remote = getRemoteBranch(mainRoot, branch);
  if (remote) throw Object.assign(remoteBranchConflictError(branch, remote), details);
  assertNoConflictingRecovery(config, mainRoot, cli, branch);

  const uniqueCommits = Number(runGit(['rev-list', '--count', `${base.baseCommit}..HEAD`], {
    cwd: worktreePath,
    capture: true,
  }).trim());
  const containsBase = spawnSync('git', ['merge-base', '--is-ancestor', base.baseCommit, 'HEAD'], {
    cwd: worktreePath,
    stdio: 'pipe',
  }).status === 0;
  if (uniqueCommits > 0 && !containsBase) {
    throw adoptionError(`Desktop branch ${originalBranch} has ${uniqueCommits} own commit(s) and is behind ${baseLabel}`, {
      ...details,
      fetchStatus: base.fetchStatus,
      baseRef: base.baseRef,
      baseFreshness: base.baseFreshness,
      nextManualAction: `In ${worktreePath}, rebase or merge ${baseLabel} into ${originalBranch} yourself, then rerun worktree new.`,
    });
  }

  const audit = require('./worktree-audit').auditManagedWorktrees({
    mainRoot,
    config,
    baseRef: base.baseCommit,
    cwd,
    apply: true,
    excludeBranch: originalBranch,
    skipWorktreePath: worktreePath,
  });

  const lockDir = resolveRuntimePath(config, mainRoot, config.worktree && config.worktree.lockDir, 'agent-locks');
  const release = acquireLock(lockDir, 'worktree-desktop-adoption', 30000);
  let adoptionReset = false;
  let renamed = false;
  let sessionWritten = false;
  let head;
  let linked;
  let supersession;
  let lifecycle;
  let sessionPayload;
  try {
    // Another run may have adopted or touched this worktree since detection.
    const current = detectDesktopAdoption(config, mainRoot, worktreePath);
    if (!current || current.branch !== originalBranch) {
      throw adoptionError('Desktop worktree was adopted or switched branches during adoption; rerun worktree new', details);
    }
    const observedHead = runGit(['rev-parse', 'HEAD'], { cwd: worktreePath, capture: true }).trim();
    if (observedHead !== previousHead || getStatusLines(worktreePath).length > 0) {
      throw adoptionError('Desktop worktree changed during adoption; rerun worktree new', details);
    }
    if (uniqueCommits === 0 && previousHead !== base.baseCommit) {
      runGit(['reset', '--hard', base.baseCommit], { cwd: worktreePath, capture: true });
      adoptionReset = true;
    }
    if (originalBranch !== branch) {
      runGit(['branch', '-m', branch], { cwd: worktreePath, capture: true });
      renamed = true;
    }
    const afterRename = listWorktrees(mainRoot).find((item) => isSamePath(item.path, worktreePath));
    if (!afterRename || afterRename.branch !== branch) {
      throw adoptionError(`Desktop branch rename is incomplete: expected ${branch}`, details);
    }

    head = runGit(['rev-parse', 'HEAD'], { cwd: worktreePath, capture: true }).trim();
    supersession = planSupersededSessions({ config, mainRoot, cli, branch });
    lifecycle = lifecycleState(supersession);
    const provenance = buildDesktopProvenance(worktreePath, originalBranch, {
      previous_head: previousHead,
      reset_to: adoptionReset ? base.baseCommit : '',
    });
    // Persist provenance first so a later failure resumes a managed session instead of losing it.
    sessionPayload = {
      phase: cli.phase || inferPhaseFromBranch(branch),
      branch,
      worktree: worktreePath,
      status: 'in_progress',
      step: 'adopted',
      head,
      linked: [],
      lifecycle,
      provenance,
    };
    writeSession(config, mainRoot, sessionPayload);
    sessionWritten = true;
    writeManagedMarker(mainRoot, worktreePath, branch);
    linked = setupSharedLinks(mainRoot, worktreePath, config);
    sessionPayload = { ...sessionPayload, linked };
  } catch (error) {
    if (!sessionWritten) rollbackDesktopAdoption(worktreePath, { renamed, originalBranch, adoptionReset, previousHead }, error);
    throw error;
  } finally {
    release();
  }

  const bootstrap = runWorktreeBootstrap({
    worktreePath,
    config,
    cli,
    mainRoot,
    defaultMode: bootstrapConfig(config).mode || 'skip',
  });
  const { lifecycle: _initialLifecycle, ...resumePayload } = sessionPayload;
  writeSession(config, mainRoot, { ...resumePayload, bootstrap });
  const taskBindings = bindLifecycleTaskLocations(
    config,
    mainRoot,
    { branch, lifecycle },
    worktreePath,
    branch,
    options,
  );
  return {
    branch,
    worktreePath,
    config,
    mainRoot,
    baseRef: base.baseRef,
    baseCommit: base.baseCommit,
    baseSource: base.baseSource,
    baseFreshness: base.baseFreshness,
    fetchStatus: base.fetchStatus,
    fetchSkipped,
    linked,
    bootstrap,
    audit,
    supersession,
    taskBindings,
    adopted: true,
    originalBranch,
    previousHead,
    adoptionReset,
  };
}

function createOrResumeWorktree(options = {}) {
  const cli = options.cli || {};
  const branch = buildBranchName(cli);
  const cwd = options.cwd || process.cwd();
  const mainRoot = getMainRepoRoot(cwd);
  const configRoot = getWorktreeRoot(cwd);
  const config = loadConfig({ repoRoot: configRoot, cli });
  // Validate before fetch, branch creation, worktree registration, session writes, or links.
  validateSharedLinkConfig(config);
  const previousSession = assertSessionCanResume(config, mainRoot, branch);
  const desktopEntry = detectDesktopAdoption(config, mainRoot, cwd);
  if (desktopEntry) {
    return adoptDesktopWorktree({
      cli, branch, cwd, mainRoot, config, entry: desktopEntry, options,
    });
  }
  const existing = findWorktreeByBranch(mainRoot, branch);
  if (existing && existing.path) {
    const audit = require('./worktree-audit').auditManagedWorktrees({
      mainRoot,
      config,
      cwd,
      apply: true,
      excludeBranch: branch,
      skipWorktreePath: cwd,
    });
    assertNoConflictingRecovery(config, mainRoot, cli, branch);
    const head = runGit(['rev-parse', 'HEAD'], { cwd: existing.path, capture: true }).trim();
    const supersession = planSupersededSessions({ config, mainRoot, cli, branch });
    const lifecycle = lifecycleState(supersession);
    writeManagedMarker(mainRoot, existing.path, branch);
    writeSession(config, mainRoot, {
      phase: cli.phase || inferPhaseFromBranch(branch),
      branch,
      worktree: existing.path,
      status: 'in_progress',
      step: 'resumed',
      head,
      lifecycle,
    });
    const bootstrap = runWorktreeBootstrap({
      worktreePath: existing.path,
      config,
      cli,
      mainRoot,
    });
    writeSession(config, mainRoot, {
      phase: cli.phase || inferPhaseFromBranch(branch),
      branch,
      worktree: existing.path,
      status: 'in_progress',
      step: 'resumed',
      head,
      bootstrap,
    });
    const taskBindings = bindLifecycleTaskLocations(
      config,
      mainRoot,
      { branch, lifecycle: withSessionTaskKeys(lifecycle, previousSession) },
      existing.path,
      branch,
      options,
    );
    return {
      branch,
      worktreePath: existing.path,
      config,
      mainRoot,
      audit,
      bootstrap,
      supersession,
      taskBindings,
      resumed: true,
    };
  }

  const worktreesDir = resolveContainerPath(config, mainRoot, 'worktrees');
  const worktreeName = buildWorktreeName(cli, branch);
  const requestedPath = path.join(worktreesDir, worktreeName);
  const worktreePath = uniqueWorktreePath(requestedPath);
  let baseRef = getBaseRef(mainRoot, config);

  if (cli.dryRun) {
    return { branch, worktreePath, config, mainRoot, baseRef, dryRun: true };
  }

  // A remote-only resume must refresh origin so it never mounts a stale
  // remote-tracking ref. Existing local worktree resumes return above and
  // retain their intentional no-network fast path.
  const fetchSkipped = shouldSkipFetch(cli) && !cli.resumeRemote;
  let base;
  if (fetchSkipped) {
    base = getSkippedBase(mainRoot, config);
  } else {
    try {
      runGit(['fetch', '--prune', 'origin'], { cwd: mainRoot });
    } catch (error) {
      error.fetchStatus = 'FAILED';
      error.baseFreshness = 'UNVERIFIED';
      error.nextManualAction = 'Fix origin access and rerun, or explicitly use --skip-fetch with a cached or local base.';
      throw error;
    }
    base = getRequiredRemoteBase(mainRoot, config);
  }
  ({ baseRef } = base);
  const remote = getRemoteBranch(mainRoot, branch);
  const localBranchExists = branchExists(mainRoot, branch);
  if (remote && !localBranchExists && !cli.resumeRemote) {
    throw remoteBranchConflictError(branch, remote);
  }
  const audit = require('./worktree-audit').auditManagedWorktrees({
    mainRoot,
    config,
    baseRef: base.baseCommit,
    cwd,
    apply: true,
    excludeBranch: branch,
    skipWorktreePath: cwd,
  });
  assertNoConflictingRecovery(config, mainRoot, cli, branch);
  ensureContainerDirectories(config, mainRoot, ['worktrees', 'tmp']);

  if (localBranchExists) {
    runGit(['worktree', 'add', worktreePath, branch], { cwd: mainRoot });
  } else if (remote && cli.resumeRemote) {
    runGit(['worktree', 'add', '-b', branch, '--no-track', worktreePath, remote.remoteHead], { cwd: mainRoot });
    runGit(['branch', '--set-upstream-to', remote.remoteBranch, branch], { cwd: worktreePath });
  } else {
    // --no-track 防止 upstream 被设成 origin/main 导致裸 git push silent no-op
    runGit(['worktree', 'add', '-b', branch, '--no-track', worktreePath, base.baseCommit], { cwd: mainRoot });
  }

  const linked = setupSharedLinks(mainRoot, worktreePath, config);
  const head = runGit(['rev-parse', 'HEAD'], { cwd: worktreePath, capture: true }).trim();
  const supersession = planSupersededSessions({ config, mainRoot, cli, branch });
  const lifecycle = lifecycleState(supersession);
  writeManagedMarker(mainRoot, worktreePath, branch);
  writeSession(config, mainRoot, {
    phase: cli.phase || inferPhaseFromBranch(branch),
    branch,
    worktree: worktreePath,
    status: 'in_progress',
    step: remote && cli.resumeRemote ? 'remote_resumed' : 'created',
    head,
    linked,
    lifecycle,
  });
  const bootstrap = runWorktreeBootstrap({
    worktreePath,
    config,
    cli,
    mainRoot,
    defaultMode: bootstrapConfig(config).mode || 'skip',
  });
  writeSession(config, mainRoot, {
    phase: cli.phase || inferPhaseFromBranch(branch),
    branch,
    worktree: worktreePath,
    status: 'in_progress',
    step: remote && cli.resumeRemote ? 'remote_resumed' : 'created',
    head,
    linked,
    bootstrap,
  });
  const taskBindings = bindLifecycleTaskLocations(
    config,
    mainRoot,
    { branch, lifecycle },
    worktreePath,
    branch,
    options,
  );
  return {
    branch,
    worktreePath,
    config,
    mainRoot,
    baseRef,
    baseCommit: base.baseCommit,
    baseSource: base.baseSource,
    baseFreshness: base.baseFreshness,
    fetchStatus: base.fetchStatus,
    linked,
    bootstrap,
    audit,
    supersession,
    taskBindings,
    resumed: Boolean(remote && cli.resumeRemote),
    resumedRemote: Boolean(remote && cli.resumeRemote),
    remoteBranch: remote ? remote.remoteBranch : '',
    remoteHead: remote ? remote.remoteHead : '',
    fetchSkipped,
  };
}

module.exports = {
  adoptDesktopWorktree,
  detectDesktopAdoption,
  acquireLock,
  assertNoConflictingRecovery,
  assertSessionCanResume,
  branchExists,
  buildBranchName,
  buildLifecycleIdentity,
  buildWorktreeName,
  bindLifecycleTaskLocations,
  createOrResumeWorktree,
  findWorktreeByBranch,
  getBaseRef,
  getRequiredRemoteBase,
  getSkippedBase,
  getCurrentBranch,
  getRemoteBranch,
  getMainRepoRoot,
  getWorktreeRoot,
  hasUncommittedChanges,
  hasOwnedWorktreeMarker,
  inferPhaseFromBranch,
  isPathInside,
  isSamePath,
  isMainBranch,
  listWorktrees,
  lifecycleTopicFromBranch,
  lifecycleTaskIds,
  verifiedRecoveryTaskIds,
  materializeReusablePaths,
  parseCliArgs,
  planSupersededSessions,
  reclaimMergedManagedWorktrees,
  parseWorktreePorcelain,
  readSessions,
  recoverSessionAsBranch,
  removeWorktreeSafely,
  removeSession,
  resolveContainerPath,
  run,
  runGit,
  runWorktreeBootstrap,
  safeRemoveTreeNoFollow,
  shouldSkipFetch,
  setupSharedLinks,
  slugify,
  validateWorktreeRequest,
  validateSharedLinkConfig,
  writeSession,
  writeManagedMarker,
  MANAGED_MARKER,
};

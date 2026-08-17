#!/usr/bin/env node
/**
 * Shared worktree lifecycle helpers for all expert phases.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  getMainRepoRoot,
  getWorktreeRoot,
  loadConfig,
  parseCliArgs,
  resolveContainerPath,
  resolveFromRepo,
} = require('../shared/config');
const { buildGitHubGitEnv } = require('../shared/github-auth');
const {
  isPathInside,
  isSamePath,
  parseWorktreePorcelain,
  removeWorktreeSafely,
  safeRemoveTreeNoFollow,
} = require('./worktree-safe-remove');

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
      current = { path: line.slice(9).trim() };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5).trim();
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).trim().replace('refs/heads/', '');
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
  const dir = resolveFromRepo(mainRoot, configured || '../tmp/worktree-sessions');
  ensureDir(dir);
  return path.join(dir, `${slugify(branch)}.json`);
}

function writeSession(config, mainRoot, payload) {
  const filePath = sessionPath(config, mainRoot, payload.branch);
  const configuredLockDir = config.worktree && config.worktree.lockDir;
  const lockDir = resolveFromRepo(mainRoot, configuredLockDir || '../tmp/agent-locks');
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
    const next = JSON.stringify({
      ...previous,
      ...payload,
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

function recoverSessionAsBranch(config, mainRoot, branch, newBranch) {
  if (!newBranch || newBranch === branch || isMainBranch(newBranch)) {
    throw new Error('--recover-as requires a distinct non-main branch name');
  }
  const session = readSessions(config, mainRoot).find((item) => item.branch === branch);
  if (!session || session.status !== 'recovery_required' || !session.worktree) {
    throw new Error(`branch ${branch} has no recovery_required session`);
  }
  const entry = listWorktrees(mainRoot).find((item) => isSamePath(item.path, session.worktree));
  if (!entry) throw new Error(`recovery worktree is not registered: ${session.worktree}`);
  if (![branch, newBranch].includes(entry.branch)) {
    throw new Error(`recovery worktree branch mismatch: expected ${branch}, found ${entry.branch || '(detached)'}`);
  }
  if (entry.branch === branch) {
    if (branchExists(mainRoot, newBranch)) throw new Error(`recovery branch already exists: ${newBranch}`);
    runGit(['switch', '-c', newBranch], { cwd: session.worktree });
  }
  const head = runGit(['rev-parse', 'HEAD'], { cwd: session.worktree, capture: true }).trim();
  writeSession(config, mainRoot, {
    phase: session.phase || inferPhaseFromBranch(newBranch),
    branch: newBranch,
    worktree: session.worktree,
    status: 'in_progress',
    step: 'recovered_post_merge_work',
    recovered_from: branch,
    head,
  });
  runGit(['branch', '-D', branch], { cwd: mainRoot });
  removeSession(config, mainRoot, branch);
  writeManagedMarker(mainRoot, session.worktree, newBranch);
  return { branch: newBranch, previousBranch: branch, worktreePath: session.worktree, head };
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
  const dir = resolveFromRepo(mainRoot, configured || '../tmp/worktree-sessions');
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
 * Reclaim only worktrees that are provably complete: they must be owned by this
 * repository, clean, and already reachable from the configured base branch.
 *
 * This is deliberately best-effort. A failed proof or cleanup is reported and
 * retained rather than blocking a new task or deleting potentially useful work.
 */
function reclaimMergedManagedWorktrees(options = {}) {
  const mainRoot = options.mainRoot || getMainRepoRoot(process.cwd());
  const config = options.config || loadConfig({ repoRoot: mainRoot });
  const worktreesRoot = options.worktreesRoot
    || resolveContainerPath(config, mainRoot, 'worktrees');
  const baseRef = options.baseRef || getBaseRef(mainRoot, config);
  const result = { removed: [], retained: [] };
  // A linked worktree starts at baseRef, so Git alone reports a freshly
  // created, still-active worktree as "merged" until its first commit.  In
  // concurrent task creation that made one task reclaim another before the
  // latter had a chance to do any work.  A durable in-progress session is the
  // explicit ownership signal; completion flows remove that session before
  // this best-effort reclaimer is allowed to delete the worktree.
  const activeSessions = new Set(
    readSessions(config, mainRoot)
      .filter((session) => session && session.status === 'in_progress' && session.branch)
      .map((session) => session.branch)
  );

  const listing = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: mainRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (listing.error || listing.status !== 0) {
    result.retained.push({ reason: 'worktree-list-failed' });
    return result;
  }

  for (const entry of parseWorktreePorcelain(listing.stdout || '')) {
    if (!entry.path || !entry.branch || !isPathInside(worktreesRoot, entry.path)) continue;
    if (activeSessions.has(entry.branch)) {
      result.retained.push({ branch: entry.branch, path: entry.path, reason: 'active-session' });
      continue;
    }
    if (entry.locked) {
      result.retained.push({ branch: entry.branch, path: entry.path, reason: 'locked' });
      continue;
    }
    if (!hasOwnedWorktreeMarker(mainRoot, entry.path, entry.branch)) {
      result.retained.push({ branch: entry.branch, path: entry.path, reason: 'unmanaged' });
      continue;
    }
    if (isSamePath(process.cwd(), entry.path) || isPathInside(entry.path, process.cwd())) {
      result.retained.push({ branch: entry.branch, path: entry.path, reason: 'current-working-directory' });
      continue;
    }

    const merged = spawnSync('git', ['merge-base', '--is-ancestor', entry.branch, baseRef], {
      cwd: mainRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (merged.error || merged.status !== 0) {
      result.retained.push({ branch: entry.branch, path: entry.path, reason: 'not-merged' });
      continue;
    }

    try {
      removeWorktreeSafely({
        mainRoot,
        worktreePath: entry.path,
        worktreesRoot,
        force: false,
      });
      removeSession(config, mainRoot, entry.branch);
      const branchDelete = spawnSync('git', ['branch', '-D', entry.branch], {
        cwd: mainRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      result.removed.push({
        branch: entry.branch,
        path: entry.path,
        branchDeleted: branchDelete.status === 0,
      });
    } catch (error) {
      result.retained.push({ branch: entry.branch, path: entry.path, reason: error.message });
    }
  }

  return result;
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

function nextBootstrapAction(command, worktreePath) {
  return command
    ? `cd "${worktreePath}" && ${command}`
    : 'Configure worktree.bootstrap.command, then rerun with --bootstrap=auto.';
}

function runWorktreeBootstrap(options = {}) {
  const { worktreePath, config, cli = {}, mainRoot, defaultMode = '' } = options;
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
  if ((mode !== 'auto' || !alwaysRun) && check.configured && check.ok) {
    return { status: 'READY', mode, checkCommand, ...reuse };
  }

  if (mode === 'check') {
    return {
      status: check.configured ? 'MISSING' : 'SKIPPED',
      mode,
      reason: check.configured ? `check command exited ${check.status}` : 'no checkCommand configured',
      checkCommand,
      nextManualAction: nextBootstrapAction(command, worktreePath),
      ...reuse,
    };
  }

  if (!command) {
    throw bootstrapError('worktree bootstrap mode is auto but command is not configured', {
      worktreePath,
      bootstrapStatus: 'BLOCKED',
      nextManualAction: 'Set worktree.bootstrap.command or rerun with --skip-bootstrap.',
    });
  }

  const beforeStatus = getStatusLines(worktreePath);
  if (beforeStatus.length > 0) {
    throw bootstrapError('worktree has existing non-ignored changes before bootstrap', {
      worktreePath,
      bootstrapStatus: 'BLOCKED',
      dirtyFiles: beforeStatus.join(','),
      nextManualAction: 'Commit, stash, or clean existing changes before running bootstrap auto mode.',
    });
  }

  const lockDir = resolveFromRepo(mainRoot || getMainRepoRoot(worktreePath), (config.worktree && config.worktree.lockDir) || '../tmp/agent-locks');
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
  if (afterStatus.length > 0) {
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

  return { status: 'READY', mode, command, checkCommand, ...reuse };
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
  assertSessionCanResume(config, mainRoot, branch);
  // A new lifecycle entrypoint also acts as crash recovery for unrelated
  // post-merge cleanups. Never reconcile the branch currently being requested.
  require('./deferred-cleanup-state').reconcilePendingCleanups({
    mainRoot,
    config,
    baseRef: getBaseRef(mainRoot, config),
    excludeBranch: branch,
    skipWorktreePath: cwd,
  });
  const existing = findWorktreeByBranch(mainRoot, branch);
  if (existing && existing.path) {
    const supersession = planSupersededSessions({ config, mainRoot, cli, branch });
    writeManagedMarker(mainRoot, existing.path, branch);
    writeSession(config, mainRoot, {
      phase: cli.phase || inferPhaseFromBranch(branch),
      branch,
      worktree: existing.path,
      status: 'in_progress',
      step: 'resumed',
      lifecycle: lifecycleState(supersession),
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
      bootstrap,
    });
    return { branch, worktreePath: existing.path, config, mainRoot, bootstrap, supersession, resumed: true };
  }

  const worktreesDir = resolveContainerPath(config, mainRoot, 'worktrees');
  const worktreeName = buildWorktreeName(cli, branch);
  const requestedPath = path.join(worktreesDir, worktreeName);
  const worktreePath = uniqueWorktreePath(requestedPath);
  let baseRef = getBaseRef(mainRoot, config);

  if (cli.dryRun) {
    return { branch, worktreePath, config, mainRoot, baseRef, dryRun: true };
  }

  const fetchSkipped = shouldSkipFetch(cli);
  if (!fetchSkipped) {
    runGit(['fetch', '--prune', 'origin'], { cwd: mainRoot, allowFailure: true });
  }
  baseRef = getBaseRef(mainRoot, config);
  const remoteReconciliation = require('./deferred-cleanup-state').reconcilePendingCleanups({
    mainRoot,
    config,
    baseRef,
    excludeBranch: branch,
    skipWorktreePath: cwd,
  });
  const reclaimed = reclaimMergedManagedWorktrees({ mainRoot, config, baseRef });
  ensureDir(worktreesDir);

  if (branchExists(mainRoot, branch)) {
    runGit(['worktree', 'add', worktreePath, branch], { cwd: mainRoot });
  } else {
    // --no-track 防止 upstream 被设成 origin/main 导致裸 git push silent no-op
    runGit(['worktree', 'add', '-b', branch, '--no-track', worktreePath, baseRef], { cwd: mainRoot });
  }

  const linked = setupSharedLinks(mainRoot, worktreePath, config);
  const supersession = planSupersededSessions({ config, mainRoot, cli, branch });
  writeManagedMarker(mainRoot, worktreePath, branch);
  writeSession(config, mainRoot, {
    phase: cli.phase || inferPhaseFromBranch(branch),
    branch,
    worktree: worktreePath,
    status: 'in_progress',
    step: 'created',
    linked,
    lifecycle: lifecycleState(supersession),
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
    step: 'created',
    linked,
    bootstrap,
  });
  return {
    branch,
    worktreePath,
    config,
    mainRoot,
    baseRef,
    linked,
    bootstrap,
    reclaimed,
    remoteReconciliation,
    supersession,
    resumed: false,
    fetchSkipped,
  };
}

module.exports = {
  acquireLock,
  assertSessionCanResume,
  branchExists,
  buildBranchName,
  buildLifecycleIdentity,
  buildWorktreeName,
  createOrResumeWorktree,
  findWorktreeByBranch,
  getBaseRef,
  getCurrentBranch,
  getMainRepoRoot,
  getWorktreeRoot,
  hasUncommittedChanges,
  inferPhaseFromBranch,
  isPathInside,
  isSamePath,
  isMainBranch,
  listWorktrees,
  lifecycleTopicFromBranch,
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

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

const MAIN_BRANCHES = new Set(['main', 'master', 'develop']);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: process.env,
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

function buildBranchName(options) {
  const phase = slugify(options.phase || 'tdd');
  const desc = slugify(options.desc || options.description || options.task || phase);
  const task = options.task ? String(options.task).trim().toUpperCase() : '';
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

function setupSharedLinks(mainRoot, worktreePath, config) {
  const linked = [];
  const candidates = [
    ...((config.worktree && config.worktree.envSymlinks) || []),
    ...((config.worktree && config.worktree.sharedConfigSymlinks) || []),
  ];
  for (const relativePath of candidates) {
    try {
      if (setupSymlinkIfPresent(mainRoot, worktreePath, relativePath)) {
        linked.push(relativePath);
      }
    } catch (error) {
      console.log(`WARN symlink skipped ${relativePath}: ${error.message}`);
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
  const now = new Date().toISOString();
  const previous = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
  fs.writeFileSync(filePath, JSON.stringify({
    ...previous,
    ...payload,
    updated_at: now,
    started_at: previous.started_at || payload.started_at || now,
  }, null, 2) + '\n');
  return filePath;
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

function createOrResumeWorktree(options = {}) {
  const cli = options.cli || {};
  const cwd = options.cwd || process.cwd();
  const mainRoot = getMainRepoRoot(cwd);
  const configRoot = getWorktreeRoot(cwd);
  const config = loadConfig({ repoRoot: configRoot, cli });
  const branch = cli.branch || buildBranchName(cli);
  const existing = findWorktreeByBranch(mainRoot, branch);
  if (existing && existing.path) {
    writeSession(config, mainRoot, {
      phase: cli.phase || inferPhaseFromBranch(branch),
      branch,
      worktree: existing.path,
      status: 'in_progress',
      step: 'resumed',
    });
    return { branch, worktreePath: existing.path, config, mainRoot, resumed: true };
  }

  runGit(['fetch', '--prune', 'origin'], { cwd: mainRoot, allowFailure: true });

  const worktreesDir = resolveContainerPath(config, mainRoot, 'worktrees');
  ensureDir(worktreesDir);
  const worktreeName = buildWorktreeName(cli, branch);
  const requestedPath = path.join(worktreesDir, worktreeName);
  const worktreePath = uniqueWorktreePath(requestedPath);
  const baseRef = getBaseRef(mainRoot, config);

  if (cli.dryRun) {
    return { branch, worktreePath, config, mainRoot, baseRef, dryRun: true };
  }

  if (branchExists(mainRoot, branch)) {
    runGit(['worktree', 'add', worktreePath, branch], { cwd: mainRoot });
  } else {
    // --no-track 防止 upstream 被设成 origin/main 导致裸 git push silent no-op
    runGit(['worktree', 'add', '-b', branch, '--no-track', worktreePath, baseRef], { cwd: mainRoot });
  }

  const linked = setupSharedLinks(mainRoot, worktreePath, config);
  writeSession(config, mainRoot, {
    phase: cli.phase || inferPhaseFromBranch(branch),
    branch,
    worktree: worktreePath,
    status: 'in_progress',
    step: 'created',
    linked,
  });
  return { branch, worktreePath, config, mainRoot, baseRef, linked, resumed: false };
}

module.exports = {
  branchExists,
  buildBranchName,
  buildWorktreeName,
  createOrResumeWorktree,
  findWorktreeByBranch,
  getBaseRef,
  getCurrentBranch,
  getMainRepoRoot,
  getWorktreeRoot,
  hasUncommittedChanges,
  inferPhaseFromBranch,
  isMainBranch,
  listWorktrees,
  parseCliArgs,
  readSessions,
  removeSession,
  resolveContainerPath,
  run,
  runGit,
  setupSharedLinks,
  slugify,
  writeSession,
};

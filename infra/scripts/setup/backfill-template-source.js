'use strict';

/**
 * Official-source side of 回灌息壤模板: the rebuildable clone of the official
 * Xirang repository in the project cache, the official source's own credential
 * file, and the clone's own agent CLI runner.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readEnvFile, usableGitHubToken } = require('../shared/github-auth');
const {
  EXPECTED_UPSTREAM,
  buildAnonymousGitEnvironment,
  repositoryForOutput,
  validateFetchedSource,
} = require('./template-sync');

const OFFICIAL_UPSTREAM = EXPECTED_UPSTREAM;
const DEFAULT_TIMEOUT_MS = 120000;
const SOURCE_CLI_TIMEOUT_MS = 300000;
const SOURCE_CLONE_SEGMENTS = Object.freeze(['xirang', 'backfill-source']);
const SOURCE_ENV_KEY = 'XIRANG_SOURCE_ENV_FILE';
const SOURCE_ENV_HINT = `set ${SOURCE_ENV_KEY}=<official Xirang source main worktree>/.env.local in the project .env.local `
  + '(or the environment), or pass --source-env <path>; the file must hold the official source\'s own GH_TOKEN';

class BackfillError extends Error {
  constructor(message, nextAction = '') {
    super(message);
    this.name = 'BackfillError';
    this.nextAction = nextAction;
  }
}

function singleLine(value) {
  return String(value || '').replace(/[\r\n]+/gu, ' ').trim();
}

function run(command, args, options = {}) {
  // Executable and argv are fixed call sites; shell=false keeps paths out of shell parsing.
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || (result.error ? result.error.message : ''),
  };
}

function git(cwd, args, options = {}) {
  const result = run('git', args, { cwd, ...options });
  if (result.status !== 0) {
    const detail = singleLine(result.stderr || result.stdout);
    throw new BackfillError(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.trim();
}

function fetchEnvironment(repository) {
  if (repository === OFFICIAL_UPSTREAM.repository) {
    return { authMode: 'ANONYMOUS', env: buildAnonymousGitEnvironment() };
  }
  return { authMode: 'PROJECT_DEFAULT', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } };
}

// The anonymous environment disables init.templateDir, so `git init` creates no
// .git/info; create it and keep the entry idempotent for reused clones.
function ensureLocalExclude(sourceRoot, entry) {
  const excludePath = path.join(sourceRoot, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  const current = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
  if (current.split(/\r?\n/u).includes(entry)) return;
  const separator = current && !current.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(excludePath, `${separator}${entry}\n`);
}

/**
 * Prepare (or fast-forward) the rebuildable clone of the official repository in
 * the project's cache container. Its base branch is never edited by hand.
 */
function prepareSourceClone({ audit, cacheRoot, repository, timeoutMs }) {
  const sourceContainer = path.join(cacheRoot, ...SOURCE_CLONE_SEGMENTS);
  const sourceRoot = path.join(sourceContainer, 'repo');
  const { authMode, env } = fetchEnvironment(repository);
  audit.authMode = authMode;
  const branch = OFFICIAL_UPSTREAM.branch;
  const fresh = !fs.existsSync(path.join(sourceRoot, '.git'));

  if (fresh) {
    fs.mkdirSync(sourceRoot, { recursive: true });
    git(sourceRoot, ['init', '--quiet'], { env });
    git(sourceRoot, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { env });
    git(sourceRoot, ['remote', 'add', 'origin', repository], { env });
  } else {
    const top = run('git', ['rev-parse', '--show-toplevel'], { cwd: sourceRoot, env }).stdout.trim();
    if (!top || fs.realpathSync(top) !== fs.realpathSync(sourceRoot)) {
      throw new BackfillError(
        `official clone is not a standalone Git repository: ${sourceRoot}`,
        `remove the rebuildable cache directory ${sourceContainer} and retry`,
      );
    }
    const origin = run('git', ['remote', 'get-url', 'origin'], { cwd: sourceRoot, env }).stdout.trim();
    if (origin !== repository) {
      throw new BackfillError(
        `official clone origin does not match the official repository: ${repositoryForOutput(origin)}`,
        `remove the rebuildable cache directory ${sourceContainer} and retry`,
      );
    }
    const current = run('git', ['branch', '--show-current'], { cwd: sourceRoot, env }).stdout.trim();
    const dirty = run('git', ['status', '--porcelain'], { cwd: sourceRoot, env }).stdout.trim();
    if (current !== branch || dirty) {
      throw new BackfillError(
        `official clone must stay clean on ${branch}; found drift (branch=${current || 'detached'}, dirty=${Boolean(dirty)})`,
        `inspect or remove the rebuildable cache directory ${sourceContainer} and retry`,
      );
    }
  }

  ensureLocalExclude(sourceRoot, '.env.local');

  const fetched = run('git', ['fetch', '--quiet', '--no-tags', 'origin', `refs/heads/${branch}`], {
    cwd: sourceRoot,
    env,
    timeoutMs,
  });
  if (fetched.status !== 0) {
    audit.fetchStatus = 'BLOCKED';
    throw new BackfillError(
      'required fetch of the official Xirang main failed; no local snapshot fallback was used',
      'restore network access to the official repository and retry',
    );
  }
  const commit = run('git', ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], { cwd: sourceRoot, env }).stdout.trim();
  if (!/^[0-9a-f]{40,64}$/u.test(commit)) {
    audit.fetchStatus = 'BLOCKED';
    throw new BackfillError('fetched official commit could not be resolved');
  }

  if (fresh) {
    git(sourceRoot, ['checkout', '--quiet', '-B', branch, commit], { env });
    git(sourceRoot, ['config', `branch.${branch}.remote`, 'origin'], { env });
    git(sourceRoot, ['config', `branch.${branch}.merge`, `refs/heads/${branch}`], { env });
  } else {
    const contains = run('git', ['merge-base', '--is-ancestor', 'HEAD', commit], { cwd: sourceRoot, env });
    if (contains.status !== 0) {
      throw new BackfillError(
        `official clone ${branch} diverged from the fetched official main`,
        `remove the rebuildable cache directory ${sourceContainer} and retry`,
      );
    }
    git(sourceRoot, ['merge', '--ff-only', '--quiet', commit], { env });
  }
  if (git(sourceRoot, ['rev-parse', 'HEAD'], { env }) !== commit) {
    audit.fetchStatus = 'BLOCKED';
    throw new BackfillError('official clone could not be pinned to the fetched commit');
  }
  audit.commit = commit;
  audit.fetchStatus = 'OK';
  return { sourceRoot, sourceContainer };
}

function readSourceManifest(sourceRoot) {
  try {
    return validateFetchedSource(sourceRoot).manifest;
  } catch (error) {
    throw new BackfillError(`fetched official source is not a valid Xirang template: ${error.message}`);
  }
}

function sameRealPath(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

/**
 * Locate the official source's own credential file. Writes to the official repository
 * need its own GH_TOKEN; the project's token is never a fallback. Precedence:
 * --source-env > XIRANG_SOURCE_ENV_FILE environment > the same key in the project .env.local.
 */
function resolveSourceCredentials({ args = {}, env = process.env, cwd = process.cwd(), projectMainRoot }) {
  const projectEnvPath = path.join(projectMainRoot, '.env.local');
  let file = '';
  let source = '';
  if (args.sourceEnv) {
    file = path.resolve(cwd, args.sourceEnv);
    source = 'flag';
  } else if (String(env[SOURCE_ENV_KEY] || '').trim()) {
    file = path.resolve(cwd, String(env[SOURCE_ENV_KEY]).trim());
    source = 'env';
  } else {
    const configured = String(readEnvFile(projectEnvPath)[SOURCE_ENV_KEY] || '').trim();
    if (configured) {
      file = path.resolve(projectMainRoot, configured);
      source = 'project-env-local';
    }
  }
  if (!file) return { status: 'NOT_CONFIGURED', file: '', source: '', reason: 'no official-source credential file configured' };
  let reason = '';
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) reason = 'configured file does not exist';
  else if (sameRealPath(file, projectEnvPath)) reason = 'configured file is the project .env.local, not the official source\'s own';
  else if (!usableGitHubToken(readEnvFile(file).GH_TOKEN)) reason = 'configured file has no usable GH_TOKEN';
  return { status: reason ? 'INVALID' : 'CONFIGURED', file, source, reason };
}

function assertSourceCredentials(credentials) {
  if (credentials.status === 'CONFIGURED') return;
  const where = credentials.file ? ` (${credentials.source}: ${credentials.file})` : '';
  throw new BackfillError(`official source credential unavailable: ${credentials.reason}${where}`, SOURCE_ENV_HINT);
}

// The clone resolves GH_TOKEN from its own main worktree; point it at the configured
// official-source credential file by symlink so the secret is never copied or printed.
function linkCredentials({ sourceRoot, credentialFile }) {
  const sourceEnv = path.join(sourceRoot, '.env.local');
  let existing = null;
  try {
    existing = fs.lstatSync(sourceEnv);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  const target = fs.realpathSync(credentialFile);
  if (!existing) {
    fs.symlinkSync(target, sourceEnv);
    return 'LINKED';
  }
  if (!existing.isSymbolicLink()) {
    throw new BackfillError(
      `official clone holds an unmanaged credential file: ${sourceEnv}`,
      `remove ${sourceEnv}; backfill links it to the configured official-source credential file`,
    );
  }
  if (sameRealPath(sourceEnv, target)) return 'LINKED';
  fs.unlinkSync(sourceEnv);
  fs.symlinkSync(target, sourceEnv);
  return 'RELINKED';
}

// Project container overrides must not redirect the official clone's own containers,
// and the project's token must not stand in for the official source's credentials.
function sourceCliEnvironment(baseEnv = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (/^AGENT_/u.test(key) || key === 'GH_TOKEN' || key === 'GITHUB_TOKEN' || key === SOURCE_ENV_KEY) continue;
    env[key] = value;
  }
  return env;
}

function defaultRunSourceCli(sourceRoot, argv) {
  return run(process.execPath, [path.join('infra', 'scripts', 'agent-runner', 'agent-cli.js'), ...argv], {
    cwd: sourceRoot,
    env: sourceCliEnvironment(),
    timeoutMs: SOURCE_CLI_TIMEOUT_MS,
  });
}

function runSourceStep(runSourceCli, sourceRoot, argv, label) {
  const result = runSourceCli(sourceRoot, argv);
  if (result.status !== 0) {
    const detail = singleLine(`${result.stderr || ''} ${result.stdout || ''}`).slice(-400);
    throw new BackfillError(`official source ${label} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout || '';
}

module.exports = {
  BackfillError,
  DEFAULT_TIMEOUT_MS,
  OFFICIAL_UPSTREAM,
  SOURCE_ENV_HINT,
  SOURCE_ENV_KEY,
  assertSourceCredentials,
  defaultRunSourceCli,
  git,
  linkCredentials,
  prepareSourceClone,
  readSourceManifest,
  resolveSourceCredentials,
  run,
  runSourceStep,
  singleLine,
  sourceCliEnvironment,
};

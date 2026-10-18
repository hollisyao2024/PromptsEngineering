#!/usr/bin/env node
'use strict';

/**
 * Claude Code cloud session support.
 *
 *   pnpm agent -- cloud bootstrap     SessionStart hook: idempotent per-session environment preparation
 *   pnpm agent -- cloud setup-script  Print the Cloud Environment setup script (snapshot cache layer)
 *   pnpm agent -- cloud doctor        Read-only diagnostics for runtime, Docker and GitHub access
 *
 * bootstrap is gated by CLAUDE_CODE_REMOTE=true and cloud.enabled=true, so local sessions only pay for a
 * no-op check. It never fails the session start: failures are reported as STATUS=FAILED with exit 0.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');

const GITHUB_TOKEN_KEYS = new Set(['GH_TOKEN', 'GITHUB_TOKEN']);
const PROXY_TOKEN_PLACEHOLDER = 'proxy-injected';
const ENV_LINE_PATTERN = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u;
const DOCKER_WAIT_SECONDS = 60;
const STATE_VERSION = 1;

function isCloudSession(env = process.env) {
  return env.CLAUDE_CODE_REMOTE === 'true';
}

function shellQuote(value) {
  return `'${String(value).replace(/'/gu, `'\\''`)}'`;
}

// Single quotes are literal for both dotenv and `bash . .env.local`; fall back to escaped double quotes.
function envQuote(value) {
  const text = String(value);
  if (!text.includes("'") && !/[\r\n]/u.test(text)) return `'${text}'`;
  return `"${text.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"').replace(/\$/gu, '\\$').replace(/`/gu, '\\`').replace(/\r?\n/gu, '\\n')}"`;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function listFiles(target) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return [target];
  return fs
    .readdirSync(target)
    .sort()
    .flatMap((name) => listFiles(path.join(target, name)));
}

/** Content hash of the given repo-relative files/directories; missing inputs are part of the hash. */
function hashInputs(repoRoot, inputs = [], extra = []) {
  const hash = crypto.createHash('sha256');
  for (const value of extra) hash.update(`extra:${value}\0`);
  for (const input of [...inputs].sort()) {
    const absolute = path.resolve(repoRoot, input);
    if (!fs.existsSync(absolute)) {
      hash.update(`missing:${input}\0`);
      continue;
    }
    for (const file of listFiles(absolute)) {
      hash.update(`file:${path.relative(repoRoot, file)}\0`);
      hash.update(fs.readFileSync(file));
      hash.update('\0');
    }
  }
  return hash.digest('hex');
}

function renderEnvFile({
  templateText = '',
  overrides = {},
  generateSecrets = [],
  env = {},
  randomBytes = crypto.randomBytes,
} = {}) {
  const values = new Map();
  for (const key of generateSecrets) {
    if (!GITHUB_TOKEN_KEYS.has(key)) values.set(key, randomBytes(32).toString('hex'));
  }
  for (const [key, value] of Object.entries(overrides || {})) {
    if (!GITHUB_TOKEN_KEYS.has(key)) values.set(key, String(value));
  }

  const seen = new Set();
  const lines = String(templateText).split(/\r?\n/u);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const output = lines.map((line) => {
    const match = line.match(ENV_LINE_PATTERN);
    if (!match) return line;
    const key = match[1];
    seen.add(key);
    if (GITHUB_TOKEN_KEYS.has(key)) {
      return `# ${key} omitted: cloud sessions use the GitHub proxy credential (configure it in the Cloud Environment only if needed)`;
    }
    if (values.has(key)) return `${key}=${envQuote(values.get(key))}`;
    // A value configured in the Cloud Environment must not be shadowed by the template placeholder,
    // because the app loads .env.local over process variables.
    if (env[key]) return `${key}=${envQuote(env[key])}`;
    return line;
  });

  const appended = [...values.keys()].filter((key) => !seen.has(key));
  if (appended.length) {
    output.push('', '# Added by pnpm agent -- cloud bootstrap');
    for (const key of appended) output.push(`${key}=${envQuote(values.get(key))}`);
  }
  return `${output.join('\n')}\n`;
}

/** Minimal dotenv reader for step environments: KEY=value, '...', "..." (\n escapes); GitHub tokens dropped. */
function parseEnvFile(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/u)) {
    const match = line.match(ENV_LINE_PATTERN);
    if (!match || GITHUB_TOKEN_KEYS.has(match[1])) continue;
    const raw = line.slice(match[0].length).trim();
    let value;
    if (raw.startsWith("'")) {
      value = raw.slice(1, raw.indexOf("'", 1) === -1 ? undefined : raw.indexOf("'", 1));
    } else if (raw.startsWith('"')) {
      const body = raw.slice(1).match(/^((?:[^"\\]|\\.)*)"?/u)[1];
      value = body.replace(/\\n/gu, '\n').replace(/\\(.)/gu, '$1');
    } else {
      value = raw.replace(/\s+#.*$/u, '').trim();
    }
    values[match[1]] = value;
  }
  return values;
}

function ghTokenMode(env = process.env) {
  const token = String(env.GH_TOKEN || env.GITHUB_TOKEN || '').trim();
  if (token === PROXY_TOKEN_PLACEHOLDER) return 'proxy';
  if (token) return 'token';
  return isCloudSession(env) ? 'proxy' : 'missing';
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, filePath);
}

function createRunner({ repoRoot, env, logFile }) {
  return (command, { capture = false, timeoutMs = 0, env: commandEnv } = {}) => {
    const options = { cwd: repoRoot, env: commandEnv || env, encoding: 'utf8', timeout: timeoutMs || undefined };
    if (capture) {
      const result = spawnSync('bash', ['-c', command], { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
      return { status: result.error ? 1 : result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
    }
    fs.appendFileSync(logFile, `\n$ ${command}\n`);
    const fd = fs.openSync(logFile, 'a');
    try {
      const result = spawnSync('bash', ['-c', command], { ...options, stdio: ['ignore', fd, fd] });
      return { status: result.error ? 1 : result.status, stdout: '', stderr: '' };
    } finally {
      fs.closeSync(fd);
    }
  };
}

function composeBase(compose) {
  return `docker compose -f ${shellQuote(compose.file)} -p ${shellQuote(compose.project)}`;
}

function ensureDocker(run, { startDaemon }) {
  if (run('docker info', { capture: true, timeoutMs: 15000 }).status === 0) return 'RUNNING';
  if (run('service docker start', { capture: true, timeoutMs: 60000 }).status !== 0) startDaemon();
  for (let second = 0; second < DOCKER_WAIT_SECONDS; second += 1) {
    if (run('docker info', { capture: true, timeoutMs: 15000 }).status === 0) return 'STARTED';
    sleepMs(1000);
  }
  return '';
}

function defaultStartDaemon(logFile) {
  return () => {
    const fd = fs.openSync(logFile, 'a');
    const child = spawn('dockerd', [], { detached: true, stdio: ['ignore', fd, fd] });
    child.on('error', () => {});
    child.unref();
    fs.closeSync(fd);
  };
}

function resolveStateDir(config, repoRoot) {
  const { ensureContainerDirectories, getMainRepoRoot } = require('../shared/config');
  try {
    const { tmp } = ensureContainerDirectories(config, getMainRepoRoot(repoRoot), ['tmp']);
    return path.join(tmp, 'cloud');
  } catch {
    // Cloud clones may live under a read-only parent; fall back to the system temp directory.
    const digest = crypto.createHash('sha256').update(repoRoot).digest('hex').slice(0, 12);
    return path.join(os.tmpdir(), 'xirang-cloud', digest);
  }
}

function defaultLock(config, repoRoot, stateDir) {
  try {
    const { getMainRepoRoot, resolveRuntimePath } = require('../shared/config');
    const { acquireLock } = require('../worktree-tools/worktree-core');
    const mainRoot = getMainRepoRoot(repoRoot);
    let lockDir;
    try {
      lockDir = resolveRuntimePath(config, mainRoot, config.worktree && config.worktree.lockDir, 'agent-locks');
    } catch {
      lockDir = path.join(stateDir, 'locks');
    }
    return acquireLock(lockDir, 'cloud-bootstrap');
  } catch (error) {
    throw new Error(`cloud bootstrap lock unavailable: ${error.message}`);
  }
}

function skipped(summary) {
  return { status: 'SKIPPED', summary, nextAction: 'none', steps: [] };
}

function bootstrap({
  repoRoot = process.cwd(),
  env = process.env,
  config,
  run,
  stateDir,
  lock,
  startDaemon,
} = {}) {
  if (!isCloudSession(env)) return skipped('not a Claude Code cloud session (CLAUDE_CODE_REMOTE!=true)');
  const effectiveConfig = config || require('../shared/config').loadConfig({ repoRoot, env, cli: {} });
  const cloud = effectiveConfig.cloud || {};
  if (cloud.enabled !== true) return skipped('cloud.enabled is not true in agent.config.json');

  const session = cloud.session || {};
  const dir = stateDir || resolveStateDir(effectiveConfig, repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  const logFile = path.join(dir, 'bootstrap.log');
  const statePath = path.join(dir, 'state.json');
  const runCommand = run || createRunner({ repoRoot, env, logFile });
  const release = lock ? lock() : stateDir ? () => {} : defaultLock(effectiveConfig, repoRoot, dir);

  const state = readJson(statePath, {});
  const hashes = state.version === STATE_VERSION && state.hashes && state.hashes[repoRoot] ? state.hashes[repoRoot] : {};
  const steps = [];
  let failure = null;
  const record = (name, status, detail = '') => steps.push({ name, status, detail });
  const fail = (name, command) => {
    failure = { name, command };
    record(name, 'FAILED', command);
  };

  try {
    // 1. Env file: generated once from the template; an existing file always wins.
    const envFile = session.envFile || {};
    if (envFile.target) {
      const target = path.resolve(repoRoot, envFile.target);
      if (fs.existsSync(target)) {
        record('env-file', 'KEPT', envFile.target);
      } else {
        const templatePath = envFile.template ? path.resolve(repoRoot, envFile.template) : '';
        const templateText = templatePath && fs.existsSync(templatePath) ? fs.readFileSync(templatePath, 'utf8') : '';
        const text = renderEnvFile({
          templateText,
          overrides: envFile.overrides,
          generateSecrets: envFile.generateSecrets,
          env,
        });
        fs.writeFileSync(target, text, { mode: 0o600, flag: 'wx' });
        record('env-file', 'CREATED', envFile.target);
      }
    }

    // 2. Dependencies: rerun only when the lockfile inputs change or node_modules is missing.
    if (session.install) {
      const installHash = hashInputs(repoRoot, session.installHashFiles || [], [session.install]);
      if (hashes.install === installHash && fs.existsSync(path.join(repoRoot, 'node_modules'))) {
        record('install', 'SKIPPED', 'inputs unchanged');
      } else if (runCommand(session.install).status === 0) {
        hashes.install = installHash;
        record('install', 'DONE');
      } else {
        fail('install', session.install);
      }
    }

    // 3. Docker services.
    const compose = session.compose || {};
    let serviceFingerprint = '';
    if (!failure && compose.file) {
      const dockerState = ensureDocker(runCommand, { startDaemon: startDaemon || defaultStartDaemon(logFile) });
      if (!dockerState) {
        fail('docker', 'service docker start || dockerd');
      } else {
        record('docker', dockerState);
        const services = (compose.services || []).map(shellQuote).join(' ');
        const waitTimeout = Number(compose.waitTimeoutSec) > 0 ? Number(compose.waitTimeoutSec) : 120;
        const upCommand = `${composeBase(compose)} up -d --wait --wait-timeout ${waitTimeout}${services ? ` ${services}` : ''}`;
        if (runCommand(upCommand).status !== 0) {
          fail('compose', upCommand);
        } else {
          const ps = runCommand(`${composeBase(compose)} ps -q`, { capture: true });
          serviceFingerprint = ps.stdout.split(/\s+/u).filter(Boolean).sort().join(',');
          record('compose', 'UP', serviceFingerprint ? `${serviceFingerprint.split(',').length} container(s)` : '');
        }
      }
    }

    // 4. Project steps (migrations, seed, ...). A hashed step reruns when its inputs or the containers change.
    // Steps see the env file (tools such as the Prisma CLI do not read .env.local) plus exportEnv;
    // process variables such as the proxy GH_TOKEN placeholder stay authoritative for GitHub keys.
    const envTarget = envFile.target ? path.resolve(repoRoot, envFile.target) : '';
    const fileEnv = envTarget && fs.existsSync(envTarget) ? parseEnvFile(fs.readFileSync(envTarget, 'utf8')) : {};
    const exportValues = Object.fromEntries(
      Object.entries(session.exportEnv || {}).filter(([key]) => !GITHUB_TOKEN_KEYS.has(key)).map(([k, v]) => [k, String(v)])
    );
    const stepEnv = { ...env, ...fileEnv, ...exportValues };
    for (const step of session.steps || []) {
      if (failure) break;
      const name = step.name || step.command;
      const key = `step:${name}`;
      const stepHash = Array.isArray(step.hashFiles)
        ? hashInputs(repoRoot, step.hashFiles, [step.command, serviceFingerprint])
        : '';
      if (stepHash && hashes[key] === stepHash) {
        record(name, 'SKIPPED', 'inputs unchanged');
        continue;
      }
      delete hashes[key];
      if (runCommand(step.command, { env: stepEnv }).status !== 0) {
        fail(name, step.command);
        break;
      }
      if (stepHash) hashes[key] = stepHash;
      record(name, 'DONE');
    }

    // 5. Session environment for later Bash tool calls.
    const exportEnv = Object.entries(session.exportEnv || {}).filter(([key]) => !GITHUB_TOKEN_KEYS.has(key));
    if (exportEnv.length && env.CLAUDE_ENV_FILE) {
      // Other SessionStart hooks share this file, so append only lines it does not hold yet (resume reruns).
      const current = fs.existsSync(env.CLAUDE_ENV_FILE) ? fs.readFileSync(env.CLAUDE_ENV_FILE, 'utf8') : '';
      const existing = new Set(current.split('\n'));
      const missing = exportEnv
        .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
        .filter((line) => !existing.has(line));
      if (missing.length) {
        const separator = current && !current.endsWith('\n') ? '\n' : '';
        fs.appendFileSync(env.CLAUDE_ENV_FILE, separator + missing.map((line) => `${line}\n`).join(''));
      }
      record('export-env', 'DONE', exportEnv.map(([key]) => key).join(','));
    } else if (exportEnv.length) {
      record('export-env', 'SKIPPED', 'CLAUDE_ENV_FILE not set');
    }
  } catch (error) {
    fail('bootstrap', error.message);
  } finally {
    try {
      writeJsonAtomic(statePath, {
        version: STATE_VERSION,
        hashes: { ...(state.version === STATE_VERSION ? state.hashes : {}), [repoRoot]: hashes },
      });
    } finally {
      release();
    }
  }

  if (failure) {
    return {
      status: 'FAILED',
      summary: `cloud bootstrap failed at ${failure.name}`,
      nextAction: `inspect ${logFile}, fix, then rerun: ${failure.command} && pnpm agent -- cloud bootstrap`,
      steps,
      logFile,
    };
  }
  return {
    status: 'OK',
    summary: `cloud session ready (${steps.map((step) => `${step.name}=${step.status}`).join(', ')})`,
    nextAction: 'none',
    steps,
    logFile,
  };
}

function renderSetupScript(config) {
  const cloud = (config && config.cloud) || {};
  const setup = cloud.setup || {};
  const lines = [
    '#!/bin/bash',
    '# Claude Code Cloud Environment setup script, generated by: pnpm agent -- cloud setup-script',
    '# Runs as root before the session starts; the resulting files are snapshotted (~7 days).',
    '# Keep it under 5 minutes. Every command tolerates failure: cloud bootstrap repairs anything missing.',
    'set +e',
    'if ! docker info >/dev/null 2>&1; then',
    '  service docker start >/dev/null 2>&1 || (nohup dockerd >/tmp/dockerd.log 2>&1 &)',
    'fi',
    'for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done',
  ];
  for (const image of setup.images || []) lines.push(`docker pull ${shellQuote(image)} || true`);
  lines.push('REPO_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"', 'cd "$REPO_DIR" 2>/dev/null || true');
  if (setup.prefetch) {
    lines.push(
      'if [ -f package.json ]; then',
      '  corepack enable >/dev/null 2>&1 || true',
      `  ${setup.prefetch} || true`,
      'fi'
    );
  }
  for (const command of setup.extra || []) lines.push(`${command} || true`);
  lines.push('exit 0');
  return `${lines.join('\n')}\n`;
}

function readNodeRequirement(repoRoot) {
  const npmrc = path.join(repoRoot, '.npmrc');
  if (fs.existsSync(npmrc)) {
    const match = fs.readFileSync(npmrc, 'utf8').match(/^\s*use-node-version\s*=\s*(\S+)/mu);
    if (match) return `${match[1]} (.npmrc use-node-version, provisioned by pnpm)`;
  }
  const nvmrc = path.join(repoRoot, '.nvmrc');
  return fs.existsSync(nvmrc) ? `${fs.readFileSync(nvmrc, 'utf8').trim()} (.nvmrc)` : 'unspecified';
}

function writableState(target) {
  let current = target;
  while (current && !fs.existsSync(current)) current = path.dirname(current);
  try {
    fs.accessSync(current, fs.constants.W_OK);
    return current === target ? 'WRITABLE' : `CREATABLE(${current})`;
  } catch {
    return 'NOT_WRITABLE';
  }
}

async function doctor({ repoRoot = process.cwd(), env = process.env, run } = {}) {
  const runCommand = run || createRunner({ repoRoot, env, logFile: path.join(os.tmpdir(), 'xirang-cloud-doctor.log') });
  const lines = [];
  let warnings = 0;
  const check = (key, value, ok = true) => {
    lines.push(`${key}=${value}`);
    if (!ok) warnings += 1;
  };

  check('CLOUD_SESSION', isCloudSession(env));
  check('NODE_VERSION', process.version);
  check('NODE_REQUIRED', readNodeRequirement(repoRoot));
  const pnpm = runCommand('pnpm --version', { capture: true, timeoutMs: 60000 });
  check('PNPM_VERSION', pnpm.status === 0 ? pnpm.stdout.trim() : 'UNAVAILABLE', pnpm.status === 0);
  const docker = runCommand('docker info --format "{{.ServerVersion}}"', { capture: true, timeoutMs: 15000 });
  check('DOCKER', docker.status === 0 ? `OK ${docker.stdout.trim()}` : 'UNAVAILABLE', docker.status === 0);
  const compose = runCommand('docker compose version --short', { capture: true, timeoutMs: 15000 });
  check('DOCKER_COMPOSE', compose.status === 0 ? compose.stdout.trim() : 'UNAVAILABLE', compose.status === 0);

  const { loadConfig, getMainRepoRoot, resolveContainerPath } = require('../shared/config');
  const config = loadConfig({ repoRoot, env, cli: {} });
  check('CLOUD_ENABLED', Boolean(config.cloud && config.cloud.enabled));
  for (const key of ['worktrees', 'tmp', 'cache', 'artifacts']) {
    try {
      const target = resolveContainerPath(config, getMainRepoRoot(repoRoot), key);
      const state = writableState(target);
      check(`CONTAINER_${key.toUpperCase()}`, `${state} ${target}`, state !== 'NOT_WRITABLE');
    } catch (error) {
      check(`CONTAINER_${key.toUpperCase()}`, `INVALID ${error.message}`, false);
    }
  }

  const mode = ghTokenMode(env);
  check('GH_TOKEN_MODE', mode, mode !== 'missing');
  check('PROXY_ENV', ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'].filter((key) => env[key] || env[key.toLowerCase()]).join(',') || 'none');

  const remote = runCommand('git remote get-url origin', { capture: true });
  const { parseGitHubRepoSlug, githubApiRequest } = require('../shared/github-api');
  const slug = remote.status === 0 ? parseGitHubRepoSlug(remote.stdout.trim()) : null;
  if (!slug) {
    check('GITHUB_REST', 'SKIPPED origin is not a GitHub remote');
  } else {
    const token = String(env.GH_TOKEN || env.GITHUB_TOKEN || '').trim() || PROXY_TOKEN_PLACEHOLDER;
    try {
      await githubApiRequest('GET', `/repos/${encodeURIComponent(slug.owner)}/${encodeURIComponent(slug.repo)}`, { token, env });
      check('GITHUB_REST', 'OK');
    } catch (error) {
      check('GITHUB_REST', `FAILED ${error.statusCode || error.code || ''} ${error.message}`.trim(), false);
    }
  }
  const baseBranch = config.baseBranch || 'main';
  const lsRemote = runCommand(
    `node infra/scripts/shared/github-auth-run.js -- git ls-remote --heads origin ${shellQuote(baseBranch)}`,
    { capture: true, timeoutMs: 60000 }
  );
  check('GIT_LS_REMOTE', lsRemote.status === 0 && lsRemote.stdout.trim() ? 'OK' : 'FAILED', lsRemote.status === 0);

  lines.push(`STATUS=${warnings ? 'WARN' : 'OK'}`);
  lines.push(`SUMMARY=cloud doctor finished with ${warnings} warning(s)`);
  lines.push(`NEXT_ACTION=${warnings ? 'fix the reported items; see docs/CONVENTIONS.md §11' : 'none'}`);
  return { status: warnings ? 'WARN' : 'OK', lines };
}

function printBootstrap(result) {
  console.log(`STATUS=${result.status}`);
  console.log(`SUMMARY=${result.summary}`);
  for (const step of result.steps) console.log(`STEP=${step.name}|${step.status}${step.detail ? `|${step.detail}` : ''}`);
  if (result.logFile) console.log(`LOG_FILE=${result.logFile}`);
  console.log(`NEXT_ACTION=${result.nextAction}`);
}

async function main(argv = process.argv.slice(2)) {
  const [action] = argv;
  const repoRoot = process.cwd();
  if (action === 'bootstrap') {
    // Never block the session start: report failures and exit 0.
    try {
      printBootstrap(bootstrap({ repoRoot }));
    } catch (error) {
      printBootstrap({ status: 'FAILED', summary: error.message, nextAction: 'pnpm agent -- cloud doctor', steps: [] });
    }
    return 0;
  }
  if (action === 'setup-script') {
    const { loadConfig } = require('../shared/config');
    process.stdout.write(renderSetupScript(loadConfig({ repoRoot, cli: {} })));
    return 0;
  }
  if (action === 'doctor') {
    const result = await doctor({ repoRoot });
    for (const line of result.lines) console.log(line);
    return 0;
  }
  console.error('STATUS=BLOCKED');
  console.error('REASON=cloud requires bootstrap, setup-script, or doctor');
  return 1;
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error('STATUS=BLOCKED');
      console.error(`REASON=${error.message}`);
      process.exitCode = 1;
    }
  );
}

module.exports = {
  bootstrap,
  doctor,
  ghTokenMode,
  parseEnvFile,
  hashInputs,
  isCloudSession,
  main,
  renderEnvFile,
  renderSetupScript,
  shellQuote,
};

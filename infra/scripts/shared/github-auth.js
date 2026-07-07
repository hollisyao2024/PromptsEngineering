#!/usr/bin/env node
/**
 * GitHub authentication helpers for template scripts.
 *
 * The scripts in this template intentionally avoid embedding tokens in remote
 * URLs or command-line arguments. For GitHub HTTPS remotes, inject the token as
 * a per-process git extraheader through GIT_CONFIG_* environment variables.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getMainRepoRoot, resolveRepoRoot } = require('./config');

const REMOTE_GIT_COMMANDS = new Set(['fetch', 'pull', 'push', 'ls-remote']);
const GIT_OPTIONS_WITH_VALUES = new Set([
  '--depth',
  '--deepen',
  '--shallow-since',
  '--shallow-exclude',
  '--jobs',
  '--upload-pack',
  '--receive-pack',
  '--exec',
  '--server-option',
  '--recurse-submodules',
]);

function stripOptionalQuotes(value) {
  let trimmed = String(value || '').trim();
  const commentIndex = trimmed.search(/\s#/);
  if (commentIndex >= 0) {
    trimmed = trimmed.slice(0, commentIndex).trim();
  }
  if (trimmed.length >= 2) {
    const quote = trimmed[0];
    if ((quote === '"' || quote === "'") && trimmed[trimmed.length - 1] === quote) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseEnvContent(content) {
  const output = {};
  for (const line of String(content || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eqIndex = normalized.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = normalized.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    output[key] = stripOptionalQuotes(normalized.slice(eqIndex + 1));
  }
  return output;
}

function readEnvFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return {};
    return parseEnvContent(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function tokenFromRepoEnv(repoRoot, cwd = process.cwd()) {
  for (const candidate of getProjectEnvLocalCandidates({ repoRoot, cwd })) {
    const envLocal = readEnvFile(candidate);
    if (envLocal.GH_TOKEN) return envLocal.GH_TOKEN;
  }
  return '';
}

function getProjectEnvLocalCandidates({
  repoRoot = resolveRepoRoot({ cwd: process.cwd(), warn: false }),
  cwd = process.cwd(),
} = {}) {
  const roots = [repoRoot];
  for (const candidate of [cwd, repoRoot]) {
    try {
      roots.push(getMainRepoRoot(candidate));
    } catch {
      // ignore non-worktree paths
    }
  }
  return [...new Set(roots.filter(Boolean).map((root) => path.join(root, '.env.local')))];
}

function getProjectGitHubToken({ repoRoot = '', cwd = process.cwd(), env = process.env } = {}) {
  return tokenFromRepoEnv(repoRoot || cwd, cwd) || env.GH_TOKEN || '';
}

function withProjectGitHubToken(env, token) {
  if (!token) return env;
  return {
    ...env,
    GH_TOKEN: token,
  };
}

function loadProjectGitHubToken({ repoRoot = '', cwd = process.cwd(), env = process.env } = {}) {
  const token = getProjectGitHubToken({ repoRoot, cwd, env });
  if (token) {
    env.GH_TOKEN = token;
  }
  return token;
}

function isGitHubRemoteUrl(url) {
  const text = String(url || '').trim();
  return (
    /^https:\/\/(?:[^/@]+(?::[^@]*)?@)?github\.com\//i.test(text) ||
    /^ssh:\/\/git@github\.com\//i.test(text) ||
    /^git@github\.com:/i.test(text)
  );
}

function sanitizeGitHubRemoteUrl(url) {
  const text = String(url || '').trim();
  const httpsMatch = text.match(/^https:\/\/(?:[^/@]+(?::[^@]*)?@)?github\.com\/(.+)$/i);
  if (httpsMatch) return `https://github.com/${httpsMatch[1].replace(/\.git$/, '')}`;

  const sshUrlMatch = text.match(/^ssh:\/\/git@github\.com\/(.+)$/i);
  if (sshUrlMatch) return `https://github.com/${sshUrlMatch[1].replace(/\.git$/, '')}`;

  const scpMatch = text.match(/^git@github\.com:(.+)$/i);
  if (scpMatch) return `https://github.com/${scpMatch[1].replace(/\.git$/, '')}`;

  return text.replace(/\.git$/, '');
}

function firstRemoteTarget(args = []) {
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === '--') return args[i + 1] || '';
    if (arg.startsWith('-')) {
      const optionName = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
      if (!arg.includes('=') && GIT_OPTIONS_WITH_VALUES.has(optionName)) i += 1;
      continue;
    }
    return arg;
  }
  return '';
}

function remoteUrlForTarget(cwd, target, env = process.env) {
  const remote = target || 'origin';
  if (isGitHubRemoteUrl(remote)) return remote;
  const result = spawnSync('git', ['remote', 'get-url', remote], {
    cwd,
    encoding: 'utf8',
    env,
    stdio: 'pipe',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function shouldInjectGitHubAuth({ cwd = process.cwd(), args = [], env = process.env } = {}) {
  const command = args[0];
  if (!REMOTE_GIT_COMMANDS.has(command)) return false;
  const remoteUrl = remoteUrlForTarget(cwd, firstRemoteTarget(args), env);
  return isGitHubRemoteUrl(remoteUrl);
}

function appendGitConfigEnv(env, key, value) {
  const baseCount = Number.parseInt(env.GIT_CONFIG_COUNT || '0', 10);
  const count = Number.isFinite(baseCount) && baseCount >= 0 ? baseCount : 0;
  return {
    ...env,
    GIT_CONFIG_COUNT: String(count + 1),
    [`GIT_CONFIG_KEY_${count}`]: key,
    [`GIT_CONFIG_VALUE_${count}`]: value,
  };
}

function buildGitHubExtraHeader(token) {
  const encoded = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  return `AUTHORIZATION: basic ${encoded}`;
}

function buildGitHubGitEnv({
  repoRoot = '',
  cwd = process.cwd(),
  args = [],
  env = process.env,
} = {}) {
  const token = getProjectGitHubToken({ repoRoot, cwd, env });
  if (!token) return env;
  if (!shouldInjectGitHubAuth({ cwd, args, env })) return env;
  return appendGitConfigEnv(
    withProjectGitHubToken(env, token),
    'http.https://github.com/.extraheader',
    buildGitHubExtraHeader(token)
  );
}

function buildGitHubShellEnv({
  repoRoot = '',
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const token = getProjectGitHubToken({ repoRoot, cwd, env });
  if (!token) return env;
  const tokenEnv = withProjectGitHubToken(env, token);
  if (!shouldInjectGitHubAuth({ cwd, args: ['fetch', 'origin'], env: tokenEnv })) return tokenEnv;
  return appendGitConfigEnv(
    tokenEnv,
    'http.https://github.com/.extraheader',
    buildGitHubExtraHeader(token)
  );
}

module.exports = {
  buildGitHubExtraHeader,
  buildGitHubGitEnv,
  buildGitHubShellEnv,
  firstRemoteTarget,
  getProjectEnvLocalCandidates,
  getProjectGitHubToken,
  isGitHubRemoteUrl,
  loadProjectGitHubToken,
  parseEnvContent,
  sanitizeGitHubRemoteUrl,
  shouldInjectGitHubAuth,
};

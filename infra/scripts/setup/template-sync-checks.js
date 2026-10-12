'use strict';

/**
 * Validation helpers for official template sync: the expected Xirang identity
 * and upstream, the required shape of a fetched source snapshot, and the
 * eligibility checks for the target actual-project linked worktree.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sanitizeGitHubRemoteUrl } = require('../shared/github-auth');

const EXPECTED_IDENTITY = Object.freeze({
  id: 'xirang',
  name: '息壤',
  englishName: 'Xirang',
});
const EXPECTED_UPSTREAM = Object.freeze({
  repository: 'https://github.com/hollisyao2024/PromptsEngineering.git',
  branch: 'main',
});
const REQUIRED_SOURCE_FILES = Object.freeze([
  'infra/templates/agent/config.example.json',
  'infra/templates/agent/template.manifest.json',
  'infra/scripts/setup/update-template.js',
  'infra/scripts/setup/update-template-git.js',
  'infra/scripts/setup/update-template-local-config.js',
  'infra/scripts/setup/template-apply-engine.js',
  'infra/scripts/shared/config.js',
]);

function run(command, args, options = {}) {
  // Commands and argv are fixed call sites; shell parsing stays disabled.
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env || process.env,
    stdio: 'pipe',
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
    timeout: options.timeout,
  });
  return {
    error: result.error,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function runGit(cwd, args, env = process.env) {
  return run('git', args, { cwd, env });
}

function gitValue(cwd, args) {
  const result = runGit(cwd, args);
  return result.status === 0 ? result.stdout.trim() : '';
}

function isSamePath(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function singleLine(value) {
  return String(value || '').replace(/[\r\n]+/gu, ' ').trim();
}

function repositoryForOutput(repository) {
  const value = singleLine(repository);
  if (/^https:\/\/(?:[^/@]+(?::[^@]*)?@)github\.com\//iu.test(value)) {
    return sanitizeGitHubRemoteUrl(value);
  }
  return value;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

function assertRealFile(root, relativePath) {
  const candidate = path.resolve(root, relativePath);
  const relative = path.relative(path.resolve(root), candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`fetched template source path escapes snapshot: ${relativePath}`);
  }
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`fetched template source missing required file: ${relativePath}`);
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`fetched template source required file must be a regular file: ${relativePath}`);
  }
  return candidate;
}

function validateIdentity(identity, label) {
  for (const [key, expected] of Object.entries(EXPECTED_IDENTITY)) {
    if (!identity || identity[key] !== expected) {
      throw new Error(`${label} must declare ${key}=${expected}`);
    }
  }
}

function validateTargetConfig(config) {
  const template = config && config.template;
  validateIdentity(template && template.identity, 'target template identity');
  if (!template.upstream || !singleLine(template.upstream.repository)) {
    throw new Error('target template upstream repository is missing');
  }
  if (!singleLine(template.upstream.branch)) {
    throw new Error('target template upstream branch is missing');
  }
  if (template.upstream.fetchRequired !== true) {
    throw new Error('target template upstream must require fetch');
  }
  if (template.upstream.repository !== EXPECTED_UPSTREAM.repository) {
    throw new Error(`target template upstream repository must remain ${EXPECTED_UPSTREAM.repository}`);
  }
  if (template.upstream.branch !== EXPECTED_UPSTREAM.branch) {
    throw new Error(`target template upstream branch must remain ${EXPECTED_UPSTREAM.branch}`);
  }
}

function validateFetchedSource(sourceRoot) {
  for (const relativePath of REQUIRED_SOURCE_FILES) assertRealFile(sourceRoot, relativePath);
  const defaults = readJson(
    path.join(sourceRoot, 'infra/templates/agent/config.example.json'),
    'fetched template source config',
  );
  const manifest = readJson(
    path.join(sourceRoot, 'infra/templates/agent/template.manifest.json'),
    'fetched template source manifest',
  );
  validateIdentity(defaults.template && defaults.template.identity, 'fetched template source config identity');
  validateIdentity(manifest.template, 'fetched template source manifest identity');
  if (!Array.isArray(manifest.rules)) {
    throw new Error('fetched template source manifest rules must be an array');
  }
  if (
    !manifest.capabilities
    || !manifest.capabilities.officialSync
    || manifest.capabilities.officialSync.schemaVersion !== 1
    || manifest.capabilities.officialSync.convergenceRequired !== true
  ) {
    throw new Error('fetched template source does not advertise official sync convergence capability');
  }
  return {
    manifest,
    updater: path.join(sourceRoot, 'infra/scripts/setup/update-template.js'),
  };
}

function assertEligibleTarget(targetRoot, config) {
  const topLevel = gitValue(targetRoot, ['rev-parse', '--show-toplevel']);
  const gitDir = gitValue(targetRoot, ['rev-parse', '--path-format=absolute', '--git-dir']);
  const commonDir = gitValue(targetRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!topLevel || !gitDir || !commonDir) {
    throw new Error('template sync requires an actual-project Git linked worktree');
  }
  if (!isSamePath(topLevel, targetRoot)) {
    throw new Error('template sync must run from the actual-project linked worktree root');
  }
  if (isSamePath(gitDir, commonDir)) {
    throw new Error('template sync requires an actual-project linked worktree, not the main worktree');
  }
  if (config.template && config.template.role === 'source') {
    throw new Error('template sync is forbidden for the template source role');
  }
  const status = runGit(targetRoot, ['status', '--porcelain']);
  if (status.status !== 0) throw new Error('unable to inspect target linked worktree status');
  if (status.stdout.trim()) {
    throw new Error('template sync requires a clean target linked worktree before applying updates');
  }
}

function validateBranchName(targetRoot, branch) {
  const value = singleLine(branch);
  if (!value || value !== String(branch).trim()) throw new Error('template upstream branch is invalid');
  const result = runGit(targetRoot, ['check-ref-format', '--branch', value]);
  if (result.status !== 0 || result.stdout.trim() !== value) {
    throw new Error('template upstream branch is invalid');
  }
  return value;
}

function ensureRealDirectory(directoryPath, label) {
  fs.mkdirSync(directoryPath, { recursive: true });
  const stat = fs.lstatSync(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory`);
  }
}

module.exports = {
  EXPECTED_IDENTITY,
  EXPECTED_UPSTREAM,
  REQUIRED_SOURCE_FILES,
  assertEligibleTarget,
  ensureRealDirectory,
  repositoryForOutput,
  run,
  runGit,
  singleLine,
  validateBranchName,
  validateFetchedSource,
  validateTargetConfig,
};

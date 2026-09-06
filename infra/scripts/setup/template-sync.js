#!/usr/bin/env node
'use strict';

/**
 * Fetch the configured Xirang upstream branch, pin FETCH_HEAD to an immutable
 * commit, and run the updater contained in that exact snapshot against the
 * current actual-project linked worktree.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  ensureContainerDirectories,
  getMainRepoRoot,
  loadConfig,
  resolveRepoRoot,
  resolveRuntimePath,
} = require('../shared/config');
const { buildGitHubGitEnv, sanitizeGitHubRemoteUrl } = require('../shared/github-auth');
const { safeRemoveTreeNoFollow } = require('../worktree-tools/worktree-safe-remove');

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
  'infra/scripts/setup/template-apply-engine.js',
  'infra/scripts/shared/config.js',
]);

class TemplateSyncError extends Error {
  constructor(message, stage, audit, meta = {}) {
    super(message);
    this.name = 'TemplateSyncError';
    this.stage = stage;
    this.audit = audit;
    this.meta = meta;
  }
}

function parseArgs(argv) {
  const args = { include: [] };
  const valueFlags = new Map([
    ['source-repo', 'sourceRepo'],
    ['source-branch', 'sourceBranch'],
    ['include', 'include'],
  ]);
  const booleanFlags = new Map([
    ['dry-run', 'dryRun'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (raw === '--') continue;
    if (!raw.startsWith('--')) throw new Error(`unexpected positional argument: ${raw}`);

    const eq = raw.indexOf('=');
    const rawName = raw.slice(2, eq === -1 ? undefined : eq);
    if (booleanFlags.has(rawName)) {
      if (eq !== -1) throw new Error(`--${rawName} does not accept a value`);
      args[booleanFlags.get(rawName)] = true;
      continue;
    }
    if (!valueFlags.has(rawName)) throw new Error(`unknown option: --${rawName}`);

    const value = eq === -1 ? argv[index + 1] : raw.slice(eq + 1);
    if (!value || (eq === -1 && value.startsWith('--'))) {
      throw new Error(`--${rawName} requires a value`);
    }
    if (eq === -1) index += 1;
    const key = valueFlags.get(rawName);
    if (key === 'include') args.include.push(...value.split(',').filter(Boolean));
    else args[key] = value;
  }
  return args;
}

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

function fetchTemplateSnapshot({ audit, repository, branch, runDirectory, targetRoot }) {
  const sourceRoot = path.join(runDirectory, 'source');
  const init = runGit(runDirectory, ['init', '--quiet', sourceRoot]);
  if (init.status !== 0) {
    audit.fetchStatus = 'BLOCKED';
    throw new TemplateSyncError('unable to initialize isolated template snapshot', 'fetch', audit);
  }

  const fetchArgs = [
    'fetch',
    '--quiet',
    '--no-tags',
    '--depth=1',
    repository,
    `refs/heads/${branch}`,
  ];
  const baseEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
  };
  const fetchEnv = buildGitHubGitEnv({
    repoRoot: targetRoot,
    cwd: sourceRoot,
    args: fetchArgs,
    env: baseEnv,
  });
  const fetched = runGit(sourceRoot, fetchArgs, fetchEnv);
  if (fetched.status !== 0) {
    audit.fetchStatus = 'BLOCKED';
    throw new TemplateSyncError(
      'required fetch of the configured template branch failed; no local snapshot fallback was used',
      'fetch',
      audit,
      { fetchExitCode: fetched.status === null ? 'spawn-error' : fetched.status },
    );
  }

  const resolved = runGit(sourceRoot, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}']);
  const commit = resolved.stdout.trim();
  if (resolved.status !== 0 || !/^[0-9a-f]{40,64}$/u.test(commit)) {
    audit.fetchStatus = 'BLOCKED';
    throw new TemplateSyncError('fetched template commit could not be resolved', 'fetch', audit);
  }

  const checkout = runGit(sourceRoot, ['checkout', '--quiet', '--detach', commit]);
  const checkedOut = gitValue(sourceRoot, ['rev-parse', 'HEAD']);
  if (checkout.status !== 0 || checkedOut !== commit) {
    audit.fetchStatus = 'BLOCKED';
    throw new TemplateSyncError('fetched template commit could not be checked out exactly', 'fetch', audit);
  }
  audit.commit = commit;
  audit.fetchStatus = 'OK';
  return { commit, sourceRoot };
}

function buildUpdaterEnvironment(env = process.env) {
  const output = { ...env };
  for (const key of Object.keys(output)) {
    if (
      key === 'GH_TOKEN'
      || key === 'GITHUB_TOKEN'
      || key === 'GIT_ASKPASS'
      || key === 'SSH_ASKPASS'
      || key === 'GIT_HTTP_EXTRA_HEADER'
      || /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u.test(key)
    ) {
      delete output[key];
    }
  }
  output.GIT_TERMINAL_PROMPT = '0';
  return output;
}

function runFetchedUpdater({ args, sourceRoot, targetRoot }) {
  const updater = path.join(sourceRoot, 'infra/scripts/setup/update-template.js');
  const updaterArgs = [updater, targetRoot, '--source', sourceRoot];
  for (const include of args.include || []) updaterArgs.push('--include', include);
  if (args.dryRun) updaterArgs.push('--dry-run');
  return run(process.execPath, updaterArgs, {
    cwd: targetRoot,
    env: buildUpdaterEnvironment(process.env),
  });
}

function createAudit(repository = '', branch = '') {
  return {
    id: EXPECTED_IDENTITY.id,
    name: EXPECTED_IDENTITY.name,
    repository: repositoryForOutput(repository),
    branch: singleLine(branch),
    commit: '',
    fetchStatus: 'NOT_STARTED',
    applyStatus: 'NOT_STARTED',
    convergenceStatus: 'NOT_STARTED',
    cleanupStatus: 'NOT_STARTED',
  };
}

function executeTemplateSync(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  const cwd = options.cwd || process.cwd();
  const targetRoot = resolveRepoRoot({ scriptDir: __dirname, cwd });
  const config = loadConfig({ repoRoot: targetRoot });
  const configuredUpstream = (config.template && config.template.upstream) || {};
  const repository = args.sourceRepo || configuredUpstream.repository || '';
  const configuredBranch = args.sourceBranch || configuredUpstream.branch || '';
  const audit = createAudit(repository, configuredBranch);
  let runsRoot = '';
  let runDirectory = '';
  let result;
  let failure;

  try {
    validateTargetConfig(config);
    assertEligibleTarget(targetRoot, config);
    const branch = validateBranchName(targetRoot, configuredBranch);
    audit.branch = branch;
    if (
      !singleLine(repository)
      || repository !== String(repository).trim()
      || String(repository).startsWith('-')
    ) {
      throw new TemplateSyncError('template upstream repository is invalid', 'fetch', audit);
    }

    const mainRoot = getMainRepoRoot(targetRoot);
    ensureContainerDirectories(config, mainRoot, ['tmp']);
    runsRoot = resolveRuntimePath(config, mainRoot, '', 'template-sync-runs');
    ensureRealDirectory(runsRoot, 'template sync runs root');
    runDirectory = fs.mkdtempSync(path.join(runsRoot, 'xirang-'));

    const snapshot = fetchTemplateSnapshot({
      audit,
      repository,
      branch,
      runDirectory,
      targetRoot,
    });
    try {
      validateFetchedSource(snapshot.sourceRoot);
    } catch (error) {
      throw new TemplateSyncError(error.message, 'source', audit);
    }

    audit.applyStatus = 'RUNNING';
    const updater = runFetchedUpdater({ args, sourceRoot: snapshot.sourceRoot, targetRoot });
    process.stdout.write('TEMPLATE_UPDATER_OUTPUT_START\n');
    process.stdout.write(updater.output);
    if (updater.output && !updater.output.endsWith('\n')) process.stdout.write('\n');
    process.stdout.write('TEMPLATE_UPDATER_OUTPUT_END\n');
    if (updater.status !== 0) {
      audit.applyStatus = 'BLOCKED';
      if (/^CONVERGENCE_STATUS=OK$/mu.test(updater.output)) audit.convergenceStatus = 'OK';
      else if (/convergence/iu.test(updater.output)) audit.convergenceStatus = 'BLOCKED';
      throw new TemplateSyncError('fetched template updater failed', 'apply', audit, {
        updaterExitCode: updater.status === null ? 'spawn-error' : updater.status,
      });
    }

    if (args.dryRun) {
      if (!/^STATUS=DRY_RUN_ONLY$/mu.test(updater.output)) {
        audit.applyStatus = 'BLOCKED';
        throw new TemplateSyncError('fetched updater did not return the dry-run contract', 'apply', audit);
      }
      audit.applyStatus = 'DRY_RUN_ONLY';
      audit.convergenceStatus = 'SKIPPED';
    } else {
      if (!/^CONVERGENCE_STATUS=OK$/mu.test(updater.output)) {
        audit.applyStatus = 'BLOCKED';
        audit.convergenceStatus = 'BLOCKED';
        throw new TemplateSyncError('fetched updater did not prove template convergence', 'apply', audit);
      }
      audit.applyStatus = 'UPDATED';
      audit.convergenceStatus = 'OK';
    }
    result = { args, audit, targetRoot };
  } catch (error) {
    if (error instanceof TemplateSyncError) failure = error;
    else failure = new TemplateSyncError(error.message, 'preflight', audit);
  }

  if (runDirectory) {
    try {
      safeRemoveTreeNoFollow(runDirectory, { allowedRoot: runsRoot });
      audit.cleanupStatus = 'OK';
    } catch (error) {
      audit.cleanupStatus = 'BLOCKED';
      if (!failure) {
        failure = new TemplateSyncError('isolated template snapshot cleanup failed', 'cleanup', audit);
      }
    }
  } else {
    audit.cleanupStatus = 'SKIPPED';
  }

  if (failure) throw failure;
  return result;
}

function printAudit(audit) {
  console.log(`TEMPLATE_ID=${singleLine(audit.id)}`);
  console.log(`TEMPLATE_NAME=${singleLine(audit.name)}`);
  console.log(`TEMPLATE_REPO=${repositoryForOutput(audit.repository)}`);
  console.log(`TEMPLATE_BRANCH=${singleLine(audit.branch)}`);
  console.log(`TEMPLATE_COMMIT=${singleLine(audit.commit)}`);
  console.log(`TEMPLATE_FETCH_STATUS=${singleLine(audit.fetchStatus)}`);
  console.log(`TEMPLATE_APPLY_STATUS=${singleLine(audit.applyStatus)}`);
  console.log(`TEMPLATE_CONVERGENCE_STATUS=${singleLine(audit.convergenceStatus)}`);
  console.log(`TEMPLATE_CLEANUP_STATUS=${singleLine(audit.cleanupStatus)}`);
}

function main(argv = process.argv.slice(2)) {
  const result = executeTemplateSync(argv);
  printAudit(result.audit);
  console.log(result.args.dryRun ? 'STATUS=DRY_RUN_ONLY' : 'STATUS=UPDATED');
  console.log(`TARGET=${result.targetRoot}`);
  console.log('NEXT_ACTION=review the template diff, then run the project TDD and QA delivery gates');
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    const audit = error.audit || createAudit();
    printAudit(audit);
    console.error('STATUS=BLOCKED');
    if (error.meta && error.meta.fetchExitCode !== undefined) {
      console.error(`FETCH_EXIT_CODE=${singleLine(error.meta.fetchExitCode)}`);
    }
    if (error.meta && error.meta.updaterExitCode !== undefined) {
      console.error(`UPDATER_EXIT_CODE=${singleLine(error.meta.updaterExitCode)}`);
    }
    console.error(`REASON=${singleLine(error.message)}`);
    console.error('NEXT_ACTION=fix the reported precondition or upstream failure; do not use a stale local template snapshot');
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_IDENTITY,
  EXPECTED_UPSTREAM,
  assertEligibleTarget,
  buildUpdaterEnvironment,
  executeTemplateSync,
  fetchTemplateSnapshot,
  parseArgs,
  repositoryForOutput,
  validateFetchedSource,
  validateTargetConfig,
};

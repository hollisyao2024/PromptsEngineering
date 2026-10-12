#!/usr/bin/env node
'use strict';

/**
 * 回灌息壤模板: copy template-owned changes of an actual project into a fresh
 * task worktree of the official Xirang repository (hollisyao2024/PromptsEngineering,
 * branch main). The destination is fixed; the task then lands on official main
 * through the template source's own TDD/QA delivery chain.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  ensureContainerDirectories,
  getMainRepoRoot,
  loadConfig,
  resolveContainerPath,
  resolveRepoRoot,
} = require('../shared/config');
const { exitOnHelp } = require('../shared/cli-help');
const { repositoryForOutput } = require('./template-sync');
const {
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
} = require('./backfill-template-source');

const BASELINE_REF = 'refs/agent/backfill-baseline';
const BLOCKED_PREFIXES = [
  'agent.config.json',
  '.npmrc',
  'infra/scripts/server/',
  'infra/scripts/cron/',
  'README.md',
  'CHANGELOG.md',
  'docs/PRD.md',
  'docs/ARCH.md',
  'docs/TASK.md',
  'docs/QA.md',
  'docs/data/CODEBASE_MAP.md',
];

function parseArgs(argv) {
  const args = { include: [] };
  const valueFlags = new Set(['base', 'include', 'timeout-ms', 'task', 'source-env']);
  const booleanFlags = new Map([['dry-run', 'dryRun']]);

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (raw === '--') continue;
    if (!raw.startsWith('--')) {
      throw new BackfillError(
        `unexpected positional argument: ${raw}; template backfill always targets the official Xirang repository main`,
      );
    }
    const eq = raw.indexOf('=');
    const name = raw.slice(2, eq === -1 ? undefined : eq);
    if (booleanFlags.has(name)) {
      if (eq !== -1) throw new BackfillError(`--${name} does not accept a value`);
      args[booleanFlags.get(name)] = true;
      continue;
    }
    if (!valueFlags.has(name)) {
      throw new BackfillError(
        `unknown option: --${name}; template backfill always targets the official Xirang repository main`,
      );
    }
    const value = eq === -1 ? argv[index + 1] : raw.slice(eq + 1);
    if (!value || (eq === -1 && value.startsWith('--'))) {
      throw new BackfillError(`--${name} requires a value`);
    }
    if (eq === -1) index += 1;
    if (name === 'include') args.include.push(...value.split(',').filter(Boolean));
    else if (name === 'timeout-ms') args.timeoutMs = value;
    else if (name === 'source-env') args.sourceEnv = value;
    else args[name] = value;
  }
  return args;
}

function normalizeRel(filePath) {
  return filePath.split(path.sep).join('/');
}

function assertEligibleProject(config) {
  if (config.template && config.template.role === 'source') {
    throw new BackfillError(
      'template backfill must run from an actual project; the template source cannot backfill into itself',
      'run the command from a project that applied the Xirang template',
    );
  }
}

function resolveBaseRef(projectRoot, args) {
  if (args.base) return args.base;
  const result = run('git', ['rev-parse', '--verify', BASELINE_REF], { cwd: projectRoot });
  if (result.status !== 0) {
    throw new BackfillError(
      'backfill baseline ref not found',
      `Create ${BASELINE_REF} after syncing the template baseline, or pass --base=<ref>.`,
    );
  }
  return BASELINE_REF;
}

function collectChangedFiles(projectRoot, baseRef) {
  const files = new Set();
  const commands = [
    ['diff', '--name-only', `${baseRef}..HEAD`],
    ['diff', '--cached', '--name-only'],
    ['diff', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
  ];
  for (const command of commands) {
    const result = run('git', command, { cwd: projectRoot });
    if (result.status !== 0) continue;
    for (const line of result.stdout.split('\n')) {
      const rel = line.trim();
      if (rel) files.add(normalizeRel(rel));
    }
  }
  return [...files].sort();
}

function matchesRule(filePath, rule) {
  const rulePath = normalizeRel(rule.path);
  return filePath === rulePath || filePath.startsWith(`${rulePath}/`);
}

function blockedPath(filePath) {
  return BLOCKED_PREFIXES.some((prefix) => filePath === prefix || filePath.startsWith(prefix));
}

function filterCandidates(files, manifest, includes) {
  const includeList = includes.map(normalizeRel);
  const rules = (manifest.rules || []).filter((rule) => rule.strategy === 'overwrite');
  const candidates = [];
  const skipped = [];
  for (const file of files) {
    if (includeList.length > 0 && !includeList.some((item) => file === item || file.startsWith(`${item}/`))) {
      skipped.push({ file, reason: 'outside include filter' });
      continue;
    }
    if (blockedPath(file)) {
      skipped.push({ file, reason: 'blocked project-owned path' });
      continue;
    }
    const rule = rules.find((item) => matchesRule(file, item));
    if (!rule) {
      skipped.push({ file, reason: 'not in overwrite allowlist' });
      continue;
    }
    candidates.push({ file, rule });
  }
  return { candidates, skipped };
}

function sameFile(a, b) {
  if (!fs.existsSync(a) || !fs.existsSync(b)) return false;
  return Buffer.compare(fs.readFileSync(a), fs.readFileSync(b)) === 0;
}

function planCandidates(projectRoot, sourceRoot, candidates) {
  return candidates.map((candidate) => {
    const sourcePath = path.join(projectRoot, candidate.file);
    const targetPath = path.join(sourceRoot, candidate.file);
    if (!fs.existsSync(sourcePath) || fs.statSync(sourcePath).isDirectory()) {
      return { ...candidate, status: 'skipped', reason: 'source file missing or directory' };
    }
    if (sameFile(sourcePath, targetPath)) return { ...candidate, status: 'unchanged' };
    return { ...candidate, status: fs.existsSync(targetPath) ? 'updated' : 'created' };
  });
}

function copyCandidate(projectRoot, targetRoot, item) {
  const targetPath = path.join(targetRoot, item.file);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, item.file), targetPath);
}

function validateJsonFiles(root, files) {
  for (const file of files) {
    const target = path.join(root, file);
    if (path.extname(target) !== '.json' || !fs.existsSync(target)) continue;
    try {
      JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch (error) {
      throw new BackfillError(`backfilled JSON file is invalid: ${file}: ${error.message}`);
    }
  }
}

function outputValue(output, key) {
  const match = new RegExp(`^${key}=(.*)$`, 'mu').exec(output);
  return match ? match[1].trim() : '';
}

function defaultTaskId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:T]/gu, '').slice(0, 14);
  return `backfill-${stamp}`;
}

function validateTaskId(taskId) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(taskId)) {
    throw new BackfillError('--task must be a lowercase kebab-case identifier');
  }
  return taskId;
}

function createAudit(repository) {
  return {
    repository,
    branch: OFFICIAL_UPSTREAM.branch,
    commit: '',
    authMode: repository === OFFICIAL_UPSTREAM.repository ? 'ANONYMOUS' : 'PROJECT_DEFAULT',
    fetchStatus: 'NOT_STARTED',
  };
}

function executeBackfill(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  const repository = options.upstreamRepository || OFFICIAL_UPSTREAM.repository;
  const audit = createAudit(repository);
  const timeoutMs = Number(args.timeoutMs || DEFAULT_TIMEOUT_MS);
  const projectRoot = resolveRepoRoot({ scriptDir: __dirname, cwd: options.cwd || process.cwd(), warn: false });
  const config = loadConfig({ repoRoot: projectRoot });
  assertEligibleProject(config);

  const baseRef = resolveBaseRef(projectRoot, args);
  const changedFiles = collectChangedFiles(projectRoot, baseRef);
  const projectMainRoot = getMainRepoRoot(projectRoot);
  ensureContainerDirectories(config, projectMainRoot, ['cache']);
  const cacheRoot = resolveContainerPath(config, projectMainRoot, 'cache');

  const sourceAuth = resolveSourceCredentials({
    args,
    env: options.env || process.env,
    cwd: options.cwd || process.cwd(),
    projectMainRoot,
  });
  const { sourceRoot } = prepareSourceClone({ audit, cacheRoot, repository, timeoutMs });
  const manifest = readSourceManifest(sourceRoot);
  const { candidates, skipped } = filterCandidates(changedFiles, manifest, args.include);
  const items = planCandidates(projectRoot, sourceRoot, candidates);
  const changed = items.filter((item) => item.status === 'updated' || item.status === 'created');
  const base = {
    dryRun: Boolean(args.dryRun),
    audit,
    baseRef,
    projectRoot,
    sourceRoot,
    items,
    skipped,
    worktree: null,
    taskId: '',
    authStatus: 'NOT_CHECKED',
    sourceAuth,
    modified: [],
  };
  if (args.dryRun || changed.length === 0) return base;

  assertSourceCredentials(sourceAuth);
  const authStatus = linkCredentials({ sourceRoot, credentialFile: sourceAuth.file });
  const taskId = validateTaskId(options.taskId || args.task || defaultTaskId());
  const runSourceCli = options.runSourceCli || defaultRunSourceCli;
  const projectName = singleLine(config.projectName || path.basename(path.dirname(projectMainRoot)));
  runSourceStep(runSourceCli, sourceRoot, [
    'task', 'start',
    '--task', taskId,
    '--phase', 'tdd',
    '--type', 'mutation',
    '--desc', `回灌息壤模板：把项目 ${projectName} 的 template-owned 变更合入官方 main`,
    '--acceptance', '回灌差异只含 manifest overwrite 范围内的 template-owned 文件，并通过模板源 TDD/QA 合入官方 main',
    '--step', '审查回灌差异并补充测试与文档',
    '--verify-step', '执行 tdd sync、tdd push、qa plan、qa verify、qa merge 合入官方 main',
  ], 'task start');
  const created = runSourceStep(runSourceCli, sourceRoot, [
    'worktree', 'new', '--phase', 'tdd', '--task', taskId,
  ], 'worktree creation');
  const worktreePath = outputValue(created, 'NEXT_CWD');
  if (!worktreePath || !fs.existsSync(worktreePath)) {
    throw new BackfillError('official source worktree creation did not report a usable NEXT_CWD');
  }

  for (const item of changed) copyCandidate(projectRoot, worktreePath, item);
  validateJsonFiles(worktreePath, changed.map((item) => item.file));
  return {
    ...base,
    authStatus,
    taskId,
    worktree: {
      path: worktreePath,
      branch: outputValue(created, 'BRANCH_NAME'),
      baseCommit: outputValue(created, 'BASE_COMMIT'),
    },
    modified: changed,
  };
}

function printAudit(audit) {
  console.log('TEMPLATE_ID=xirang');
  console.log(`TEMPLATE_REPO=${repositoryForOutput(audit.repository)}`);
  console.log(`TEMPLATE_BRANCH=${singleLine(audit.branch)}`);
  console.log(`TEMPLATE_COMMIT=${singleLine(audit.commit)}`);
  console.log(`TEMPLATE_AUTH_MODE=${singleLine(audit.authMode)}`);
  console.log(`TEMPLATE_FETCH_STATUS=${singleLine(audit.fetchStatus)}`);
}

function printPlan(result) {
  console.log(`CURRENT_REPO=${result.projectRoot}`);
  console.log(`TEMPLATE_SOURCE_CLONE=${result.sourceRoot}`);
  console.log(`BASE_REF=${result.baseRef}`);
  console.log(`TEMPLATE_SOURCE_AUTH=${result.sourceAuth.status}`);
  if (result.sourceAuth.status !== 'CONFIGURED') {
    console.log(`AUTH_WARNING=${singleLine(result.sourceAuth.reason)}; ${SOURCE_ENV_HINT}`);
  }
  console.log('BACKFILL_FILES_START');
  if (result.items.length === 0) console.log('none');
  for (const item of result.items) console.log(`${item.status}\t${item.file}`);
  console.log('BACKFILL_FILES_END');
  console.log('SKIPPED_FILES_START');
  if (result.skipped.length === 0) console.log('none');
  for (const item of result.skipped) console.log(`${item.reason}\t${item.file}`);
  console.log('SKIPPED_FILES_END');
}

function main(argv = process.argv.slice(2)) {
  const result = executeBackfill(argv);
  printAudit(result.audit);
  printPlan(result);

  if (result.dryRun) {
    console.log('STATUS=DRY_RUN_ONLY');
    console.log('NEXT_ACTION=review the plan, then run template backfill without --dry-run');
    return;
  }
  if (!result.worktree) {
    console.log('STATUS=NO_CHANGES');
    console.log('NEXT_ACTION=no template-owned changes differ from official main; nothing to backfill');
    return;
  }
  console.log('STATUS=UPDATED');
  console.log(`TASK_ID=${result.taskId}`);
  console.log(`NEXT_CWD=${result.worktree.path}`);
  console.log(`BACKFILL_BRANCH=${result.worktree.branch}`);
  console.log(`TEMPLATE_AUTH_STATUS=${result.authStatus}`);
  console.log('MODIFIED_FILES_START');
  for (const item of result.modified) console.log(`${item.status}\t${item.file}`);
  console.log('MODIFIED_FILES_END');
  console.log(
    `NEXT_ACTION=cd "${result.worktree.path}", review the diff, then run pnpm agent -- tdd sync, tdd push, qa plan, qa verify, qa merge there to land on official ${OFFICIAL_UPSTREAM.branch}`,
  );
}

if (require.main === module) {
  exitOnHelp([
    'Usage: pnpm agent -- template backfill [--dry-run] [--base <ref>] [--include <path>] [--task <id>] [--source-env <path>]',
    '',
    '回灌息壤模板：把本项目的 template-owned 变更回灌到官方息壤仓库 main。',
    'Backfill template-owned changes into the official Xirang repository (main) through a task worktree',
    'of its own clone; the destination is fixed and cannot be redirected.',
    '',
    'Credentials: the official clone uses the official source\'s own GH_TOKEN, never this project\'s.',
    `Configure its .env.local with --source-env <path>, or ${SOURCE_ENV_KEY}=<path> in the environment`,
    'or in this project\'s .env.local (precedence in that order). A real backfill blocks when unset.',
  ].join('\n'));
  try {
    main();
  } catch (error) {
    console.error('STATUS=BLOCKED');
    console.error(`REASON=${singleLine(error.message)}`);
    console.error(`NEXT_ACTION=${singleLine((error instanceof BackfillError && error.nextAction)
      || 'fix the reported precondition and retry; backfill never falls back to a local template path')}`);
    process.exitCode = 1;
  }
}

module.exports = {
  BackfillError,
  OFFICIAL_UPSTREAM,
  executeBackfill,
  filterCandidates,
  parseArgs,
  resolveSourceCredentials,
  sourceCliEnvironment,
};

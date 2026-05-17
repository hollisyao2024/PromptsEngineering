#!/usr/bin/env node
/**
 * Backfill template-owned changes from a template-applied project into the
 * template source repository. Defaults to dry-run + write; use --dry-run for
 * preview-only.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  getMainRepoRoot,
  loadConfig,
  resolveRepoRoot,
} = require('../shared/config');

const MAIN_BRANCHES = new Set(['main', 'master', 'develop']);
const DEFAULT_TIMEOUT_MS = 120000;
const BACKFILL_BRANCH = 'ops/backfill-template';
const BACKFILL_SCRIPT = 'agent:backfill-template';
const BACKFILL_COMMAND = 'node infra/scripts/setup/backfill-template.js';
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
  const positionals = [];
  const valueFlags = new Set(['target', 'template', 'source', 'base', 'include', 'timeout-ms']);

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '--') continue;
    if (!raw.startsWith('--')) {
      positionals.push(raw);
      continue;
    }
    const eq = raw.indexOf('=');
    if (eq !== -1) {
      const key = raw.slice(2, eq);
      const value = raw.slice(eq + 1);
      if (key === 'include') args.include.push(...value.split(',').filter(Boolean));
      else args[key] = value;
      continue;
    }
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (valueFlags.has(key) && next && !next.startsWith('--')) {
      if (key === 'include') args.include.push(...next.split(',').filter(Boolean));
      else args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }

  if (positionals[0] === 'template') positionals.shift();
  args.target = args.target || args.template || args.source || positionals[0] || '';
  return args;
}

function block(reason, meta = {}) {
  console.error('STATUS=BLOCKED');
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined && value !== '') console.error(`${key.toUpperCase()}=${value}`);
  }
  console.error(`REASON=${reason}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
  });
  if (result.error) {
    return {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout || '',
      stderr: result.stderr || result.error.message,
      error: result.error,
    };
  }
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runGit(cwd, args, options = {}) {
  const result = run('git', args, { cwd, timeoutMs: options.timeoutMs });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error && result.error.message || '').trim();
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeRel(filePath) {
  return filePath.split(path.sep).join('/');
}

function isSamePath(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function isGitWorktree(dir) {
  const result = run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir });
  return result.status === 0 && result.stdout.trim() === 'true';
}

function currentBranch(dir) {
  return runGit(dir, ['branch', '--show-current']);
}

function validateTemplateSource(templateRoot, currentRoot, allowSelf) {
  if (!templateRoot) block('missing template source path', {
    usage: 'pnpm agent:backfill-template -- <template-repo-path>',
  });
  if (!fs.existsSync(templateRoot)) block('template source path does not exist', { template_source: templateRoot });
  if (!isGitWorktree(templateRoot)) block('template source is not a git worktree', { template_source: templateRoot });
  if (!allowSelf && isSamePath(templateRoot, currentRoot)) {
    block('template source cannot be the current project without --allow-self', { template_source: templateRoot });
  }

  const manifestPath = path.join(templateRoot, 'infra/templates/agent/template.manifest.json');
  const enginePath = path.join(templateRoot, 'infra/scripts/setup/template-apply-engine.js');
  if (!fs.existsSync(manifestPath)) block('template manifest not found', { manifest: manifestPath });
  if (!fs.existsSync(enginePath)) block('template apply engine not found', { engine: enginePath });

  const manifest = readJson(manifestPath);
  if (!manifest.schemaVersion || !Array.isArray(manifest.rules)) {
    block('template manifest has invalid shape', { manifest: manifestPath });
  }
  return { manifest, manifestPath };
}

function resolveTemplateSource(args, config, currentRoot) {
  const configured = args.target || process.env.AGENT_TEMPLATE_SOURCE_REPO ||
    (config.template && config.template.sourceRepo) || '';
  return configured ? path.resolve(currentRoot, configured) : '';
}

function collectChangedFiles(currentRoot, baseRef) {
  const files = new Set();
  const commands = [
    ['diff', '--name-only', `${baseRef}..HEAD`],
    ['diff', '--cached', '--name-only'],
    ['diff', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
  ];
  for (const args of commands) {
    const result = run('git', args, { cwd: currentRoot, timeoutMs: DEFAULT_TIMEOUT_MS });
    if (result.status !== 0) continue;
    for (const line of result.stdout.split('\n')) {
      const rel = line.trim();
      if (rel) files.add(normalizeRel(rel));
    }
  }
  return [...files].sort();
}

function resolveBaseRef(currentRoot, args) {
  if (args.base) return args.base;
  const result = run('git', ['rev-parse', '--verify', 'refs/agent/backfill-baseline'], {
    cwd: currentRoot,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (result.status !== 0) {
    block('backfill baseline ref not found', {
      next_manual_action: 'Create refs/agent/backfill-baseline after syncing the template baseline, or pass --base=<ref>.',
    });
  }
  return 'refs/agent/backfill-baseline';
}

function overwriteRules(manifest) {
  return (manifest.rules || []).filter((rule) => rule.strategy === 'overwrite');
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
  const rules = overwriteRules(manifest);
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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listTemplateWorktrees(templateMainRoot) {
  const output = runGit(templateMainRoot, ['worktree', 'list', '--porcelain']);
  const entries = [];
  let current = {};
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) entries.push(current);
      current = { path: line.slice(9).trim() };
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).trim().replace('refs/heads/', '');
    }
  }
  if (current.path) entries.push(current);
  return entries;
}

function branchExists(repoRoot, branch) {
  const result = run('git', ['show-ref', '--verify', `refs/heads/${branch}`], { cwd: repoRoot });
  return result.status === 0;
}

function prepareTemplateWriteRoot(templateRoot, dryRun) {
  const branch = currentBranch(templateRoot);
  if (!MAIN_BRANCHES.has(branch)) {
    return { writeRoot: templateRoot, branch, created: false, dryRunPath: templateRoot };
  }

  const mainRoot = getMainRepoRoot(templateRoot);
  const existing = listTemplateWorktrees(mainRoot).find((entry) => entry.branch === BACKFILL_BRANCH);
  if (existing && existing.path) {
    return { writeRoot: existing.path, branch: BACKFILL_BRANCH, created: false, dryRunPath: existing.path };
  }

  const worktreesDir = path.resolve(mainRoot, '..', 'worktrees');
  const targetPath = path.join(worktreesDir, 'ops-backfill-template');
  if (dryRun) {
    return { writeRoot: mainRoot, branch: BACKFILL_BRANCH, created: false, dryRunPath: targetPath };
  }

  ensureDir(worktreesDir);
  if (branchExists(mainRoot, BACKFILL_BRANCH)) {
    runGit(mainRoot, ['worktree', 'add', targetPath, BACKFILL_BRANCH]);
  } else {
    runGit(mainRoot, ['worktree', 'add', '-b', BACKFILL_BRANCH, '--no-track', targetPath, 'HEAD']);
  }
  return { writeRoot: targetPath, branch: BACKFILL_BRANCH, created: true, dryRunPath: targetPath };
}

function materializeCandidates(currentRoot, templateRoot, candidates) {
  const output = [];
  for (const candidate of candidates) {
    const sourcePath = path.join(currentRoot, candidate.file);
    const targetPath = path.join(templateRoot, candidate.file);
    if (!fs.existsSync(sourcePath) || fs.statSync(sourcePath).isDirectory()) {
      output.push({ ...candidate, status: 'skipped', reason: 'source file missing or directory' });
      continue;
    }
    if (sameFile(sourcePath, targetPath)) {
      output.push({ ...candidate, status: 'unchanged' });
      continue;
    }
    output.push({ ...candidate, status: fs.existsSync(targetPath) ? 'updated' : 'created' });
  }
  return output;
}

function copyCandidate(currentRoot, templateRoot, item) {
  const sourcePath = path.join(currentRoot, item.file);
  const targetPath = path.join(templateRoot, item.file);
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function packageScriptStatus(templateRoot) {
  const pkgPath = path.join(templateRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return { status: 'skipped', reason: 'package.json missing' };
  const pkg = readJson(pkgPath);
  const scripts = pkg.scripts || {};
  if (scripts[BACKFILL_SCRIPT] === BACKFILL_COMMAND) return { status: 'unchanged' };
  if (scripts[BACKFILL_SCRIPT] && scripts[BACKFILL_SCRIPT] !== BACKFILL_COMMAND) {
    return { status: 'blocked', reason: `${BACKFILL_SCRIPT} conflict` };
  }
  return { status: 'added' };
}

function addPackageScript(templateRoot) {
  const pkgPath = path.join(templateRoot, 'package.json');
  const pkg = readJson(pkgPath);
  pkg.scripts = pkg.scripts || {};
  pkg.scripts[BACKFILL_SCRIPT] = BACKFILL_COMMAND;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function validateJsonFiles(root, files) {
  for (const file of files) {
    const target = path.join(root, file);
    if (!fs.existsSync(target) || path.extname(target) !== '.json') continue;
    JSON.parse(fs.readFileSync(target, 'utf8'));
  }
}

function printPlan(items, skipped, packageStatus) {
  console.log('BACKFILL_FILES_START');
  if (items.length === 0) {
    console.log('none');
  } else {
    for (const item of items) console.log(`${item.status}\t${item.file}`);
  }
  console.log('BACKFILL_FILES_END');
  console.log('SKIPPED_FILES_START');
  if (skipped.length === 0) {
    console.log('none');
  } else {
    for (const item of skipped) console.log(`${item.reason}\t${item.file}`);
  }
  console.log('SKIPPED_FILES_END');
  console.log(`ROOT_PACKAGE_SCRIPT=${packageStatus.status}${packageStatus.reason ? `:${packageStatus.reason}` : ''}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const currentRoot = resolveRepoRoot({ scriptDir: __dirname });
  const config = loadConfig({ repoRoot: currentRoot, cli: args });
  const templateSource = resolveTemplateSource(args, config, currentRoot);
  const timeoutMs = Number(args['timeout-ms'] || DEFAULT_TIMEOUT_MS);
  const dryRunOnly = Boolean(args.dryRun || args['dry-run']);

  const { manifest } = validateTemplateSource(templateSource, currentRoot, Boolean(args['allow-self'] || args.allowSelf));
  const baseRef = resolveBaseRef(currentRoot, args);
  const changedFiles = collectChangedFiles(currentRoot, baseRef);
  const { candidates, skipped } = filterCandidates(changedFiles, manifest, args.include || []);
  const preparedPreview = prepareTemplateWriteRoot(templateSource, true);
  const previewRoot = fs.existsSync(preparedPreview.dryRunPath) ? preparedPreview.dryRunPath : templateSource;
  const previewItems = materializeCandidates(currentRoot, previewRoot, candidates);
  const packageStatus = packageScriptStatus(previewRoot);

  console.log(dryRunOnly ? 'STATUS=DRY_RUN' : 'STATUS=DRY_RUN_OK');
  console.log(`CURRENT_REPO=${currentRoot}`);
  console.log(`TEMPLATE_SOURCE_REPO=${templateSource}`);
  console.log(`TEMPLATE_WRITE_PATH=${preparedPreview.dryRunPath}`);
  console.log(`BASE_REF=${baseRef}`);
  printPlan(previewItems, skipped, packageStatus);

  if (packageStatus.status === 'blocked') {
    block('template source package.json has conflicting backfill script', { detail: packageStatus.reason });
  }
  if (dryRunOnly) return;

  const prepared = prepareTemplateWriteRoot(templateSource, false);
  const writeItems = materializeCandidates(currentRoot, prepared.writeRoot, candidates)
    .filter((item) => item.status === 'updated' || item.status === 'created');
  for (const item of writeItems) copyCandidate(currentRoot, prepared.writeRoot, item);

  const writePackageStatus = packageScriptStatus(prepared.writeRoot);
  if (writePackageStatus.status === 'blocked') {
    block('template worktree package.json has conflicting backfill script', { detail: writePackageStatus.reason });
  }
  if (writePackageStatus.status === 'added') addPackageScript(prepared.writeRoot);

  validateJsonFiles(prepared.writeRoot, [
    'package.json',
    'infra/templates/agent/config.example.json',
    'infra/templates/agent/package-scripts.example.json',
    'infra/templates/agent/template.manifest.json',
  ]);

  console.log('STATUS=UPDATED');
  console.log(`TEMPLATE_WORKTREE=${prepared.writeRoot}`);
  console.log(`TEMPLATE_BRANCH=${prepared.branch}`);
  console.log(`TEMPLATE_WORKTREE_CREATED=${prepared.created ? 'true' : 'false'}`);
  console.log('MODIFIED_FILES_START');
  for (const item of writeItems) console.log(`${item.status}\t${item.file}`);
  if (writePackageStatus.status === 'added') console.log(`updated\tpackage.json\tadded=${BACKFILL_SCRIPT}`);
  if (writeItems.length === 0 && writePackageStatus.status !== 'added') console.log('none');
  console.log('MODIFIED_FILES_END');
  console.log('VALIDATION_JSON=OK');
}

try {
  main();
} catch (error) {
  block(error.message);
}

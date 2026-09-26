#!/usr/bin/env node
/**
 * One-command wrapper for applying this template to a target project.
 *
 * It runs a dry-run first, blocks on package script conflicts, writes the
 * template update, validates critical JSON files, records a local backfill
 * baseline snapshot for Git targets, verifies a convergence dry-run, and
 * prints git diff status.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  getMainRepoRoot,
  loadConfig,
  resolveFromRepo,
} = require('../shared/config');

function parseArgs(argv) {
  const cli = { include: [] };
  const positionals = [];
  const valueFlags = new Set(['target', 'source', 'include', 'scope', 'legacy-baseline']);

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
      if (valueFlags.has(key) && !value.trim()) throw new Error(`--${key} requires a value`);
      if (key === 'include') cli.include.push(...value.split(','));
      else cli[key] = value;
      continue;
    }

    const key = raw.slice(2);
    const next = argv[i + 1];
    if (valueFlags.has(key) && (!next || next.startsWith('--'))) throw new Error(`--${key} requires a value`);
    if (valueFlags.has(key) && next && !next.startsWith('--')) {
      if (key === 'include') cli.include.push(...next.split(','));
      else cli[key] = next;
      i += 1;
    } else {
      cli[key] = true;
    }
  }

  return {
    ...cli,
    target: cli.target || positionals[0],
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sanitize(value) {
  return String(value || 'target')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'target';
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function run(command, args, options = {}) {
  // Executable and argv come from fixed Git/Node call sites below. Keep shell
  // parsing disabled so target paths cannot become command syntax.
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, ...(options.env || {}) },
    shell: false,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function parseApplyCounts(output) {
  const lines = String(output || '').match(/^COUNTS=(.+)$/gmu) || [];
  if (lines.length === 0) throw new Error('template apply output is missing COUNTS');
  const value = lines.at(-1).slice('COUNTS='.length);
  let counts;
  try {
    counts = JSON.parse(value);
  } catch (error) {
    throw new Error(`template apply COUNTS is invalid JSON: ${error.message}`);
  }
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
    throw new Error('template apply COUNTS must be an object');
  }
  return counts;
}

function hasConvergenceDrift(counts) {
  const noDriftStatuses = new Set(['unchanged', 'skipped']);
  return Object.entries(counts || {}).some(([status, count]) => (
    !noDriftStatuses.has(status) && Number(count) > 0
  ));
}

function writeLog(filePath, content) {
  fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`);
}

function block(reason, meta = {}) {
  console.error('STATUS=BLOCKED');
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined && value !== '') console.error(`${key.toUpperCase()}=${value}`);
  }
  console.error(`REASON=${reason}`);
  process.exit(1);
}

function validateJsonFiles(targetRoot, files) {
  for (const file of files) {
    const filePath = path.join(targetRoot, file);
    if (!fs.existsSync(filePath)) continue;
    try {
      JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      block(`Invalid JSON in ${file}: ${error.message}`, { file: filePath });
    }
  }
}

const ENVIRONMENT_FILE_PAIRS = Object.freeze([
  Object.freeze({ example: '.env.example', runtime: '.env.local' }),
  Object.freeze({ example: '.env.staging.example', runtime: '.env.staging' }),
  Object.freeze({ example: '.env.production.example', runtime: '.env.production' }),
]);

function initializeEnvironmentFiles(targetRoot, write) {
  if (write) {
    for (const { example, runtime } of ENVIRONMENT_FILE_PAIRS) {
      if (fs.existsSync(path.join(targetRoot, runtime))) continue;
      if (!fs.existsSync(path.join(targetRoot, example))) {
        throw new Error(`environment example missing: ${example}`);
      }
    }
  }

  return ENVIRONMENT_FILE_PAIRS.map(({ example, runtime }) => {
    const runtimePath = path.join(targetRoot, runtime);
    if (fs.existsSync(runtimePath)) {
      return { status: 'unchanged', path: runtime, reason: 'target exists' };
    }
    if (!write) {
      return { status: 'created', path: runtime, reason: 'initialized from corresponding example' };
    }

    const content = fs.readFileSync(path.join(targetRoot, example));
    try {
      fs.writeFileSync(runtimePath, content, { flag: 'wx', mode: 0o600 });
      return { status: 'created', path: runtime, reason: 'initialized from corresponding example' };
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        return { status: 'unchanged', path: runtime, reason: 'target exists' };
      }
      throw error;
    }
  });
}

function reportEnvironmentFiles(results) {
  for (const result of results) {
    const key = result.path.replace(/^\./u, '').replace(/[^a-zA-Z0-9]+/gu, '_').toUpperCase();
    console.log(`ENV_FILE_${key}=${result.status}`);
    if (result.reason) console.log(`ENV_FILE_${key}_REASON=${result.reason}`);
  }
}

const CODEX_CONFIG_RELATIVE = '.codex/config.toml';
const CODEX_COMPACTION_DEFAULTS = Object.freeze({
  model_auto_compact_token_limit: '180000',
  model_auto_compact_token_limit_scope: '"total"',
});

function lstatIfPresent(filePath) {
  try { return fs.lstatSync(filePath); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function readUtf8Exactly(filePath) {
  const bytes = fs.readFileSync(filePath);
  const content = bytes.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(bytes)) {
    throw new Error(`${CODEX_CONFIG_RELATIVE} is not valid UTF-8`);
  }
  return content;
}

function configuredCodexCompactionKeys(content) {
  const found = new Set();
  const keys = Object.keys(CODEX_COMPACTION_DEFAULTS);
  for (const line of content.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    const text = line.trimStart();
    if (!text || text.startsWith('#')) continue;
    // A tiny, conservative top-level scanner is enough for these two keys.
    // Refuse ambiguous multiline strings rather than misreading their contents.
    if (text.includes('"""') || text.includes("'''")) {
      throw new Error(`Cannot safely inspect multiline TOML in ${CODEX_CONFIG_RELATIVE}`);
    }
    if (text.startsWith('[')) {
      if (!/^\[\[?[^\]]+\]\]?\s*(?:#.*)?$/u.test(text)) {
        throw new Error(`Cannot safely inspect table header in ${CODEX_CONFIG_RELATIVE}`);
      }
      break;
    }
    for (const key of keys) {
      if (new RegExp(`^(?:${key}|"${key}"|'${key}')\\s*=`, 'u').test(text)) found.add(key);
      else if (new RegExp(`^(?:${key}|"${key}"|'${key}')\\s*\\.`, 'u').test(text)) {
        throw new Error(`Cannot safely update dotted ${key} in ${CODEX_CONFIG_RELATIVE}`);
      }
    }
  }
  return found;
}

function writePrivateConfigAtomically(filePath, content, mode, previous) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = path.join(path.dirname(filePath), `.config.toml.xirang-${process.pid}-${Date.now()}`);
  try {
    const handle = fs.openSync(temporary, 'wx', mode);
    try {
      fs.writeFileSync(handle, content, 'utf8');
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    const current = lstatIfPresent(filePath);
    if (previous === null ? current !== null : !current || !current.isFile() || readUtf8Exactly(filePath) !== previous) {
      throw new Error(`${CODEX_CONFIG_RELATIVE} changed during template sync`);
    }
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function initializeCodexConfig(targetRoot, write) {
  const mainRoot = isGitWorktree(targetRoot) ? getMainRepoRoot(targetRoot) : targetRoot;
  const mainConfig = path.join(mainRoot, CODEX_CONFIG_RELATIVE);
  const linkedConfig = path.join(targetRoot, CODEX_CONFIG_RELATIVE);
  const mainStat = lstatIfPresent(mainConfig);
  const linkedStat = linkedConfig === mainConfig ? mainStat : lstatIfPresent(linkedConfig);
  if (mainStat && !mainStat.isFile()) {
    throw new Error(`${CODEX_CONFIG_RELATIVE} in the main project must be a regular file`);
  }
  if (linkedConfig !== mainConfig && linkedStat) {
    if (!linkedStat.isSymbolicLink()) {
      throw new Error(`${CODEX_CONFIG_RELATIVE} in the linked worktree conflicts with the main project config`);
    }
    if (!mainStat || fs.realpathSync(linkedConfig) !== fs.realpathSync(mainConfig)) {
      throw new Error(`${CODEX_CONFIG_RELATIVE} worktree symlink does not point to the main project config`);
    }
  }

  const oldContent = mainStat ? readUtf8Exactly(mainConfig) : '';
  const present = configuredCodexCompactionKeys(oldContent);
  const missing = Object.keys(CODEX_COMPACTION_DEFAULTS).filter(key => !present.has(key));
  const status = !mainStat ? 'created' : missing.length ? 'updated' : 'unchanged';
  const linkStatus = linkedConfig !== mainConfig && !linkedStat ? 'created' : 'unchanged';
  if (missing.length && isGitWorktree(mainRoot)) {
    const tracked = run('git', ['ls-files', '--error-unmatch', '--', CODEX_CONFIG_RELATIVE], { cwd: mainRoot });
    if (tracked.status === 0) throw new Error(`${CODEX_CONFIG_RELATIVE} is tracked; refusing to change a project-owned file`);
    const ignored = run('git', ['check-ignore', '--quiet', '--', CODEX_CONFIG_RELATIVE], { cwd: mainRoot });
    if (ignored.status !== 0) throw new Error(`${CODEX_CONFIG_RELATIVE} must be ignored by the main project before initialization`);
  }
  if (!write) return { status, linkStatus, missing };

  if (missing.length) {
    const newline = oldContent.includes('\r\n') ? '\r\n' : '\n';
    const bom = oldContent.startsWith('\uFEFF') ? '\uFEFF' : '';
    const body = bom ? oldContent.slice(1) : oldContent;
    const additions = missing.map(key => `${key} = ${CODEX_COMPACTION_DEFAULTS[key]}`).join(newline);
    const next = bom + additions + newline + (body ? newline + body : '');
    writePrivateConfigAtomically(mainConfig, next, mainStat ? mainStat.mode & 0o777 : 0o600,
      mainStat ? oldContent : null);
  }
  if (linkStatus === 'created') {
    fs.mkdirSync(path.dirname(linkedConfig), { recursive: true });
    fs.symlinkSync(mainConfig, linkedConfig);
  }
  return { status, linkStatus, missing };
}

function reportCodexConfig(result) {
  console.log(`CODEX_CONFIG_STATUS=${result.status}`);
  console.log(`CODEX_CONFIG_LINK_STATUS=${result.linkStatus}`);
  console.log(`CODEX_CONFIG_MISSING_KEYS=${result.missing.join(',') || '(none)'}`);
}

function isGitWorktree(targetRoot) {
  const result = run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: targetRoot });
  return result.status === 0 && result.stdout.trim() === 'true';
}

function createBackfillBaseline(targetRoot) {
  if (!isGitWorktree(targetRoot)) {
    return { status: 'skipped', reason: 'target is not a git worktree' };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-backfill-baseline-'));
  const env = { GIT_INDEX_FILE: path.join(tempDir, 'index') };
  try {
    const head = run('git', ['rev-parse', '--verify', 'HEAD'], { cwd: targetRoot });
    const readTreeArgs = head.status === 0 ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'];
    const readTree = run('git', readTreeArgs, { cwd: targetRoot, env });
    if (readTree.status !== 0) throw new Error(`git ${readTreeArgs.join(' ')} failed: ${readTree.output.trim()}`);

    const add = run('git', ['add', '--all'], { cwd: targetRoot, env });
    if (add.status !== 0) throw new Error(`git add --all failed: ${add.output.trim()}`);

    const tree = run('git', ['write-tree'], { cwd: targetRoot, env });
    if (tree.status !== 0) throw new Error(`git write-tree failed: ${tree.output.trim()}`);

    const commitArgs = ['commit-tree', tree.stdout.trim(), '-m', 'agent: backfill baseline'];
    if (head.status === 0) commitArgs.push('-p', head.stdout.trim());
    const commit = run('git', commitArgs, {
      cwd: targetRoot,
      env: {
        ...env,
        GIT_AUTHOR_NAME: 'Agent Template',
        GIT_AUTHOR_EMAIL: 'agent-template@local.invalid',
        GIT_COMMITTER_NAME: 'Agent Template',
        GIT_COMMITTER_EMAIL: 'agent-template@local.invalid',
      },
    });
    if (commit.status !== 0) throw new Error(`git commit-tree failed: ${commit.output.trim()}`);

    const baseline = commit.stdout.trim();
    const updateRef = run('git', ['update-ref', 'refs/agent/backfill-baseline', baseline], { cwd: targetRoot });
    if (updateRef.status !== 0) throw new Error(`git update-ref failed: ${updateRef.output.trim()}`);
    return { status: 'created', ref: 'refs/agent/backfill-baseline', commit: baseline };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function collectGitNameStatus(targetRoot) {
  const output = [];
  const diff = run('git', ['diff', '--name-status'], { cwd: targetRoot });
  if (diff.status === 0 && diff.stdout.trim()) {
    output.push(...diff.stdout.trimEnd().split('\n'));
  }

  const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: targetRoot });
  if (untracked.status === 0 && untracked.stdout.trim()) {
    for (const file of untracked.stdout.trimEnd().split('\n')) {
      output.push(`A\t${file}`);
    }
  }

  return output;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRoot = path.resolve(args.source || path.join(__dirname, '..', '..', '..'));
  const targetRoot = path.resolve(process.cwd(), args.target || '');
  const applyEngine = path.join(sourceRoot, 'infra/scripts/setup/template-apply-engine.js');
  const dryRunOnly = Boolean(args.dryRun || args['dry-run']);
  const allowConflicts = Boolean(args.allowConflicts || args['allow-conflicts']);

  if (!args.target) {
    block('missing target path', {
      usage: 'pnpm agent:update-template -- <target-repo-path>',
    });
  }
  if (!fs.existsSync(targetRoot)) {
    block('target path does not exist', { target: targetRoot });
  }
  if (!fs.existsSync(applyEngine)) {
    block('template apply engine not found', { source: sourceRoot });
  }
  const { assertMutationTarget, assertPlanOutput } = require('../../../tooling/xirang/target');
  if (!dryRunOnly) assertMutationTarget(targetRoot);
  const unified = fs.existsSync(path.join(sourceRoot, 'tooling/xirang/template.js'));
  if (unified) require(path.join(sourceRoot, 'tooling/xirang/template.js')).validateSelectionOptions?.(args.scope, args.include);

  const targetIsGitWorktree = isGitWorktree(targetRoot);
  const reportRoot = targetIsGitWorktree ? getMainRepoRoot(targetRoot) : getMainRepoRoot(sourceRoot);
  const configRoot = targetIsGitWorktree ? targetRoot : sourceRoot;
  const config = loadConfig({ repoRoot: configRoot, cli: args });
  const reportDir = resolveFromRepo(
    reportRoot,
    (config.template && config.template.applyReportDir) || '../tmp/template-apply-reports'
  );
  const runId = `${timestamp()}__${sanitize(path.basename(targetRoot))}`;
  const planPath = assertPlanOutput(targetRoot, path.join(reportDir, `${runId}__plan.json`));
  ensureDir(reportDir);
  const dryRunLog = path.join(reportDir, `${runId}__dry-run.log`);
  const writeLogPath = path.join(reportDir, `${runId}__write.log`);
  const convergenceLog = path.join(reportDir, `${runId}__convergence.log`);

  const includeArgs = [];
  const includes = Array.isArray(args.include)
    ? args.include
    : args.include
      ? [args.include]
      : [];
  for (const include of includes) includeArgs.push('--include', include);

  const baseArgs = [applyEngine, '--source', sourceRoot, '--target', targetRoot, ...includeArgs];
  if (args.scope) baseArgs.push('--scope', args.scope);
  if (args.adopt) baseArgs.push('--adopt');
  if (args['legacy-baseline']) baseArgs.push('--legacy-baseline', args['legacy-baseline']);
  const codexConfigPlan = initializeCodexConfig(targetRoot, false);
  const dryRun = run(process.execPath, unified ? [...baseArgs, '--plan-out', planPath] : baseArgs, { cwd: sourceRoot });
  writeLog(dryRunLog, dryRun.output);
  process.stdout.write(dryRun.output);
  reportEnvironmentFiles(initializeEnvironmentFiles(targetRoot, false));
  reportCodexConfig(codexConfigPlan);

  if (dryRun.status !== 0) {
    block('dry-run failed', { dry_run_log: dryRunLog });
  }
  let dryRunCounts;
  try {
    dryRunCounts = parseApplyCounts(dryRun.output);
  } catch (error) {
    block(error.message, { dry_run_log: dryRunLog });
  }
  if (Number(dryRunCounts.blocked || 0) > 0) {
    block('dry-run reported blocked template rules; target was not modified', {
      dry_run_log: dryRunLog,
      counts: JSON.stringify(dryRunCounts),
    });
  }
  if (!allowConflicts && /\bconflicts=/.test(dryRun.output)) {
    block('package.json script conflicts found; existing target scripts were not overwritten', {
      dry_run_log: dryRunLog,
      next_manual_action: 'Resolve or accept conflicts, then rerun with --allow-conflicts if appropriate.',
    });
  }
  if (dryRunOnly) {
    console.log('CONVERGENCE_STATUS=SKIPPED');
    console.log('STATUS=DRY_RUN_ONLY');
    console.log(`REPORT_DIR=${reportDir}`);
    console.log(`DRY_RUN_LOG=${dryRunLog}`);
    return;
  }

  const writeRun = run(process.execPath, [...baseArgs, '--write', ...(unified ? ['--plan', planPath] : [])], { cwd: sourceRoot });
  writeLog(writeLogPath, writeRun.output);
  process.stdout.write(writeRun.output);
  if (writeRun.status !== 0) {
    block('write failed', { write_log: writeLogPath });
  }
  reportEnvironmentFiles(initializeEnvironmentFiles(targetRoot, true));
  reportCodexConfig(initializeCodexConfig(targetRoot, true));

  validateJsonFiles(targetRoot, [
    'agent.config.json',
    'infra/templates/agent/config.example.json',
    'infra/templates/agent/package-scripts.example.json',
    'infra/templates/agent/template.manifest.json',
    'package.json',
  ]);

  console.log('VALIDATION_JSON=OK');
  if (isGitWorktree(targetRoot)) {
    const diffCheck = run('git', ['diff', '--check'], { cwd: targetRoot });
    process.stdout.write(diffCheck.output);
    if (diffCheck.status !== 0) {
      block('git diff --check failed', { target: targetRoot });
    }
    console.log('VALIDATION_DIFF_CHECK=OK');
    const nameStatus = collectGitNameStatus(targetRoot);
    console.log('MODIFIED_FILES_START');
    process.stdout.write(nameStatus.length ? `${nameStatus.join('\n')}\n` : 'none\n');
    console.log('MODIFIED_FILES_END');
    const baseline = createBackfillBaseline(targetRoot);
    console.log(`BACKFILL_BASELINE=${baseline.status}`);
    if (baseline.ref) console.log(`BACKFILL_BASELINE_REF=${baseline.ref}`);
    if (baseline.commit) console.log(`BACKFILL_BASELINE_COMMIT=${baseline.commit}`);
    if (baseline.reason) console.log(`BACKFILL_BASELINE_REASON=${baseline.reason}`);
  } else {
    console.log('VALIDATION_DIFF_CHECK=SKIPPED');
    console.log('REASON=target is not a git worktree');
  }

  const convergenceRun = run(process.execPath, baseArgs, { cwd: sourceRoot });
  writeLog(convergenceLog, convergenceRun.output);
  process.stdout.write(convergenceRun.output);
  if (convergenceRun.status !== 0) {
    block('convergence dry-run failed', { convergence_log: convergenceLog });
  }
  let convergenceCounts;
  try {
    convergenceCounts = parseApplyCounts(convergenceRun.output);
  } catch (error) {
    block(error.message, { convergence_log: convergenceLog });
  }
  if (
    hasConvergenceDrift(convergenceCounts)
    || /\bconflicts=|\bmanual-sync=/u.test(convergenceRun.output)
  ) {
    block('convergence dry-run found remaining template drift', {
      convergence_log: convergenceLog,
      counts: JSON.stringify(convergenceCounts),
    });
  }
  const codexConfigConvergence = initializeCodexConfig(targetRoot, false);
  if (codexConfigConvergence.status !== 'unchanged' || codexConfigConvergence.linkStatus !== 'unchanged') {
    block('Codex config did not converge', { config: CODEX_CONFIG_RELATIVE });
  }
  console.log('CODEX_CONFIG_CONVERGENCE_STATUS=OK');
  console.log('CONVERGENCE_STATUS=OK');

  console.log('STATUS=UPDATED');
  console.log(`SOURCE=${sourceRoot}`);
  console.log(`TARGET=${targetRoot}`);
  console.log(`REPORT_DIR=${reportDir}`);
  console.log(`DRY_RUN_LOG=${dryRunLog}`);
  console.log(`WRITE_LOG=${writeLogPath}`);
  console.log(`CONVERGENCE_LOG=${convergenceLog}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    block(error.message);
  }
}

module.exports = {
  createBackfillBaseline,
  ENVIRONMENT_FILE_PAIRS,
  hasConvergenceDrift,
  initializeCodexConfig,
  initializeEnvironmentFiles,
  parseApplyCounts,
  parseArgs,
};

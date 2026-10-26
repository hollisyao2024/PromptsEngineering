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
const path = require('path');
const { exitOnHelp } = require('../shared/cli-help');
const {
  getMainRepoRoot,
  loadConfig,
  resolveFromRepo,
} = require('../shared/config');
const {
  collectGitNameStatus,
  createBackfillBaseline,
  isGitWorktree,
  run,
} = require('./update-template-git');
const {
  CODEX_CONFIG_RELATIVE,
  ENVIRONMENT_FILE_PAIRS,
  initializeCodexConfig,
  initializeEnvironmentFiles,
  initializeProjectEnvironmentFiles,
  migrateLegacyAgentConfig,
  reportAgentConfigMigration,
  reportCodexConfig,
  reportProjectEnvironmentFiles,
} = require('./update-template-local-config');

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
  // Fail before any write when the legacy config cannot be migrated safely.
  const agentConfigPlan = migrateLegacyAgentConfig(targetRoot, false);
  const dryRun = run(process.execPath, unified ? [...baseArgs, '--plan-out', planPath] : baseArgs, { cwd: sourceRoot });
  writeLog(dryRunLog, dryRun.output);
  process.stdout.write(dryRun.output);
  reportProjectEnvironmentFiles(initializeProjectEnvironmentFiles(sourceRoot, targetRoot, false));
  reportCodexConfig(codexConfigPlan);
  reportAgentConfigMigration(agentConfigPlan);

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
  reportProjectEnvironmentFiles(initializeProjectEnvironmentFiles(sourceRoot, targetRoot, true));
  reportCodexConfig(initializeCodexConfig(targetRoot, true));
  reportAgentConfigMigration(migrateLegacyAgentConfig(targetRoot, true));

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
  if (migrateLegacyAgentConfig(targetRoot, false).status !== 'unchanged') {
    block('agent.config.json legacy migration did not converge');
  }
  console.log('AGENT_CONFIG_CONVERGENCE_STATUS=OK');
  if (initializeProjectEnvironmentFiles(sourceRoot, targetRoot, false).files.some(file => file.status !== 'unchanged')) {
    block('Environment files did not converge');
  }
  console.log('ENVIRONMENT_CONVERGENCE_STATUS=OK');
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
  exitOnHelp('Usage: pnpm agent -- template update <target> [--plan | --write] [--legacy-baseline <ref>]\n\nApply this template to a target project (dry-run first).');
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
  initializeProjectEnvironmentFiles,
  parseApplyCounts,
  parseArgs,
};

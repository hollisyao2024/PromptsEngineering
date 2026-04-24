#!/usr/bin/env node
/**
 * One-command wrapper for applying this template to a target project.
 *
 * It runs a dry-run first, blocks on package script conflicts, writes the
 * template update, validates critical JSON files, and prints git diff status.
 */

const fs = require('fs');
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
  const valueFlags = new Set(['target', 'source', 'include']);

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
      if (key === 'include') cli.include.push(...value.split(',').filter(Boolean));
      else cli[key] = value;
      continue;
    }

    const key = raw.slice(2);
    const next = argv[i + 1];
    if (valueFlags.has(key) && next && !next.startsWith('--')) {
      if (key === 'include') cli.include.push(...next.split(',').filter(Boolean));
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
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
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

function isGitWorktree(targetRoot) {
  const result = run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: targetRoot });
  return result.status === 0 && result.stdout.trim() === 'true';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRoot = path.resolve(args.source || path.join(__dirname, '..', '..', '..'));
  const targetRoot = path.resolve(process.cwd(), args.target || '');
  const applyScript = path.join(sourceRoot, 'infra/scripts/setup/apply-template.js');
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
  if (!fs.existsSync(applyScript)) {
    block('apply-template.js not found', { source: sourceRoot });
  }

  const config = loadConfig({ repoRoot: sourceRoot, cli: args });
  const mainRoot = getMainRepoRoot(sourceRoot);
  const reportDir = resolveFromRepo(
    mainRoot,
    (config.template && config.template.applyReportDir) || '../tmp/template-apply-reports'
  );
  ensureDir(reportDir);

  const runId = `${timestamp()}__${sanitize(path.basename(targetRoot))}`;
  const dryRunLog = path.join(reportDir, `${runId}__dry-run.log`);
  const writeLogPath = path.join(reportDir, `${runId}__write.log`);

  const includeArgs = [];
  const includes = Array.isArray(args.include)
    ? args.include
    : args.include
      ? [args.include]
      : [];
  for (const include of includes) includeArgs.push('--include', include);

  const baseArgs = [applyScript, '--source', sourceRoot, '--target', targetRoot, ...includeArgs];
  const dryRun = run(process.execPath, baseArgs, { cwd: sourceRoot });
  writeLog(dryRunLog, dryRun.output);
  process.stdout.write(dryRun.output);

  if (dryRun.status !== 0) {
    block('dry-run failed', { dry_run_log: dryRunLog });
  }
  if (!allowConflicts && /\bconflicts=/.test(dryRun.output)) {
    block('package.json script conflicts found; existing target scripts were not overwritten', {
      dry_run_log: dryRunLog,
      next_manual_action: 'Resolve or accept conflicts, then rerun with --allow-conflicts if appropriate.',
    });
  }
  if (dryRunOnly) {
    console.log('STATUS=DRY_RUN_ONLY');
    console.log(`DRY_RUN_LOG=${dryRunLog}`);
    return;
  }

  const writeRun = run(process.execPath, [...baseArgs, '--write'], { cwd: sourceRoot });
  writeLog(writeLogPath, writeRun.output);
  process.stdout.write(writeRun.output);
  if (writeRun.status !== 0) {
    block('write failed', { write_log: writeLogPath });
  }

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
    const nameStatus = run('git', ['diff', '--name-status'], { cwd: targetRoot });
    console.log('MODIFIED_FILES_START');
    process.stdout.write(nameStatus.output || 'none\n');
    console.log('MODIFIED_FILES_END');
  } else {
    console.log('VALIDATION_DIFF_CHECK=SKIPPED');
    console.log('REASON=target is not a git worktree');
  }

  console.log('STATUS=UPDATED');
  console.log(`SOURCE=${sourceRoot}`);
  console.log(`TARGET=${targetRoot}`);
  console.log(`DRY_RUN_LOG=${dryRunLog}`);
  console.log(`WRITE_LOG=${writeLogPath}`);
}

try {
  main();
} catch (error) {
  block(error.message);
}

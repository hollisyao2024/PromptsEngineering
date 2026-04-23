#!/usr/bin/env node
/**
 * Explicit opt-in single-worktree branch helper.
 *
 * Worktree-First remains the default. This command exists only for small,
 * user-confirmed edits where single-worktree mode is acceptable.
 */

const { spawnSync } = require('child_process');
const { getWorktreeRoot, loadConfig } = require('../shared/config');

function parseArgs(argv) {
  const cli = { _: [] };
  const valueFlags = new Set(['branch', 'base', 'desc', 'task', 'kind']);

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '--') continue;
    if (!raw.startsWith('--')) {
      cli._.push(raw);
      continue;
    }

    const eq = raw.indexOf('=');
    if (eq !== -1) {
      cli[raw.slice(2, eq)] = raw.slice(eq + 1);
      continue;
    }

    const key = raw.slice(2);
    const next = argv[i + 1];
    if (valueFlags.has(key) && next && !next.startsWith('--')) {
      cli[key] = next;
      i += 1;
    } else {
      cli[key] = true;
    }
  }
  return cli;
}

function runGit(args, cwd, capture = true) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
}

function gitText(args, cwd) {
  const result = runGit(args, cwd, true);
  return result.status === 0 ? result.stdout.trim() : '';
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function block(reason, nextAction, meta = {}) {
  console.error('STATUS=BLOCKED');
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined && value !== '') console.error(`${key.toUpperCase()}=${value}`);
  }
  console.error(`REASON=${reason}`);
  console.error(`NEXT_MANUAL_ACTION=${nextAction}`);
  process.exit(1);
}

function branchExists(repoRoot, branch) {
  return runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repoRoot, true).status === 0;
}

function refExists(repoRoot, ref) {
  return runGit(['rev-parse', '--verify', '--quiet', ref], repoRoot, true).status === 0;
}

function currentBranch(repoRoot) {
  return gitText(['branch', '--show-current'], repoRoot);
}

function statusPorcelain(repoRoot) {
  return gitText(['status', '--porcelain'], repoRoot);
}

function inferBranchName(cli) {
  if (cli.branch) return String(cli.branch).trim();

  const positional = cli._ || [];
  const first = positional[0] || '';
  const second = positional[1] || '';
  const task = (cli.task || (first.toUpperCase().startsWith('TASK-') ? first : '') || '').toUpperCase();
  const desc = cli.desc || (task ? second : first) || second;
  const slug = slugify(desc);
  const kind = cli.fix ? 'fix' : slugify(cli.kind || 'feature') || 'feature';

  if (task) return `${kind}/${task}${slug ? `-${slug}` : ''}`;
  if (slug) return `${kind}/${slug}`;
  return '';
}

function printDefaultGuidance() {
  console.error('STATUS=BLOCKED');
  console.error('REASON=/tdd new-branch is opt-in only; Worktree-First remains the default.');
  console.error('NEXT_MANUAL_ACTION=Use /worktree new, or rerun with --explicit for single-worktree mode.');
  console.error('');
  console.error('Preferred:');
  console.error('  node infra/scripts/worktree-tools/worktree-new.js --phase=tdd --task TASK-USER-001 --desc "login"');
  console.error('');
  console.error('Explicit single-worktree mode:');
  console.error('  node infra/scripts/tdd-tools/tdd-new-branch.js --explicit --task TASK-USER-001 --desc "login"');
  console.error('  node infra/scripts/tdd-tools/tdd-new-branch.js --explicit --kind=fix --desc "login bug"');
  process.exit(1);
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (!cli.explicit) printDefaultGuidance();

  const repoRoot = getWorktreeRoot(process.cwd());
  const config = loadConfig({ repoRoot, cli });
  const base = String(cli.base || config.baseBranch || 'main');
  const branch = inferBranchName(cli);

  if (!branch) {
    block(
      'missing branch name or description',
      'Pass --branch <name>, --task TASK-XXX --desc "<desc>", or --desc "<desc>".'
    );
  }

  if (branchExists(repoRoot, branch)) {
    block('branch already exists', 'Switch to it manually or choose another --branch name.', { branch });
  }

  if (!refExists(repoRoot, base)) {
    block('base ref not found', 'Fetch/update refs or pass --base <existing-ref>.', { base });
  }

  const dirty = statusPorcelain(repoRoot);
  if (dirty && !cli['allow-dirty']) {
    block('working tree is not clean', 'Commit/stash changes first, or use --allow-dirty intentionally.', {
      current_branch: currentBranch(repoRoot),
    });
  }

  const command = ['checkout', '-b', branch, base];
  console.log(cli['dry-run'] || cli.dryRun ? 'STATUS=DRY_RUN' : 'STATUS=RUNNING');
  console.log('MODE=single-worktree-new-branch');
  console.log(`BASE_BRANCH=${base}`);
  console.log(`BRANCH_NAME=${branch}`);
  console.log(`CURRENT_BRANCH=${currentBranch(repoRoot)}`);
  console.log(`NEXT_CWD=${repoRoot}`);
  console.log(`COMMAND=git ${command.join(' ')}`);
  console.log('WARNING=single-worktree mode does not provide parallel isolation');

  if (cli['dry-run'] || cli.dryRun) return;

  const result = runGit(command, repoRoot, false);
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  console.log('STATUS=OK');
  console.log(`BRANCH_NAME=${branch}`);
  console.log(`NEXT_CWD=${repoRoot}`);
  console.log('NEXT_ACTION=Continue in this directory; commit, merge, or switch back to the base branch when done.');
}

main();

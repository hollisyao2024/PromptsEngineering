#!/usr/bin/env node

const {
  findWorktreeByBranch,
  getMainRepoRoot,
  getWorktreeRoot,
  isSamePath,
  listWorktrees,
  parseCliArgs,
  removeWorktreeSafely,
  readSessions,
  removeSession,
  resolveContainerPath,
} = require('./worktree-core');
const { removalRootForWorktree } = require('./desktop-worktree');
const { printDryRunPlan } = require('./worktree-safe-remove');
const { loadConfig } = require('../shared/config');
const { exitOnHelp } = require('../shared/cli-help');

function main() {
  try {
    const argv = process.argv.slice(2);
    const cli = parseCliArgs(argv);
    const target = cli.branch || argv.find((arg) => arg !== '--' && !arg.startsWith('--'));
    const force = Boolean(cli.force);
    if (!target) {
      throw new Error('target branch or worktree path is required');
    }

    const mainRoot = getMainRepoRoot(process.cwd());
    const config = loadConfig({ repoRoot: getWorktreeRoot(process.cwd()), cli });
    const entries = listWorktrees(mainRoot);
    const found = findWorktreeByBranch(mainRoot, target)
      || entries.find((entry) => isSamePath(entry.path, target));
    if (!found || !found.path) {
      throw new Error(`target is not a registered worktree branch or path: ${target}`);
    }

    const sessions = readSessions(config, mainRoot);
    const worktreesRoot = removalRootForWorktree(
      mainRoot,
      resolveContainerPath(config, mainRoot, 'worktrees'),
      found.path,
      sessions,
    );
    if (cli.dryRun) {
      printDryRunPlan({
        action: 'remove',
        found,
        sessions,
        planned: ['remove_worktree_directory', 'prune_worktree_metadata', 'remove_session'],
        preflight: () => removeWorktreeSafely({
          mainRoot,
          worktreePath: found.path,
          worktreesRoot,
          force,
          dryRun: true,
        }),
      });
      return;
    }

    const result = removeWorktreeSafely({
      mainRoot,
      worktreePath: found.path,
      worktreesRoot,
      force,
    });
    if (found && found.branch) removeSession(config, mainRoot, found.branch);

    console.log('STATUS=REMOVED');
    console.log(`WORKTREE_PATH=${result.path}`);
    if (found && found.branch) console.log(`BRANCH_NAME=${found.branch}`);
    console.log(`REMOVED_FILES=${result.removedFiles}`);
    console.log(`REMOVED_DIRECTORIES=${result.removedDirectories}`);
    console.log(`REMOVED_LINKS=${result.removedLinks}`);
  } catch (error) {
    console.error('STATUS=BLOCKED');
    console.error(`REASON=${error.message}`);
    process.exit(1);
  }
}

exitOnHelp('Usage: pnpm agent -- worktree remove <branch|path> [--force] [--dry-run]\n\nSafely remove a managed worktree after lifecycle checks.\n--dry-run runs the preflight checks and prints the plan without removing anything.');
main();

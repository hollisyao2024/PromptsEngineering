#!/usr/bin/env node

const path = require('path');
const {
  findWorktreeByBranch,
  getMainRepoRoot,
  getWorktreeRoot,
  hasUncommittedChanges,
  parseCliArgs,
  removeSession,
  runGit,
} = require('./worktree-core');
const { loadConfig } = require('../shared/config');

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
    const found = findWorktreeByBranch(mainRoot, target);
    const worktreePath = found
      ? found.path
      : path.isAbsolute(target)
        ? target
        : path.resolve(mainRoot, target);

    if (!force && hasUncommittedChanges(worktreePath)) {
      throw new Error(`worktree has uncommitted changes: ${worktreePath}`);
    }

    runGit(['worktree', 'remove', ...(force ? ['--force'] : []), worktreePath], { cwd: mainRoot });
    runGit(['worktree', 'prune'], { cwd: mainRoot, allowFailure: true });
    if (found && found.branch) removeSession(config, mainRoot, found.branch);

    console.log('STATUS=REMOVED');
    console.log(`WORKTREE_PATH=${worktreePath}`);
    if (found && found.branch) console.log(`BRANCH_NAME=${found.branch}`);
  } catch (error) {
    console.error('STATUS=BLOCKED');
    console.error(`REASON=${error.message}`);
    process.exit(1);
  }
}

main();

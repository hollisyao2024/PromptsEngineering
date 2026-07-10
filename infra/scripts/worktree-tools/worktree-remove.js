#!/usr/bin/env node

const {
  findWorktreeByBranch,
  getMainRepoRoot,
  getWorktreeRoot,
  isSamePath,
  listWorktrees,
  parseCliArgs,
  removeWorktreeSafely,
  removeSession,
  resolveContainerPath,
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
    const entries = listWorktrees(mainRoot);
    const found = findWorktreeByBranch(mainRoot, target)
      || entries.find((entry) => isSamePath(entry.path, target));
    if (!found || !found.path) {
      throw new Error(`target is not a registered worktree branch or path: ${target}`);
    }

    const worktreesRoot = resolveContainerPath(config, mainRoot, 'worktrees');
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

main();

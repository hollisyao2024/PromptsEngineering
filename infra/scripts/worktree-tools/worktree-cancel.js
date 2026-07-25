#!/usr/bin/env node

const { spawnSync } = require('child_process');
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
    if (!target) throw new Error('target branch or worktree path is required');
    if (!cli.force) {
      throw new Error('cancelling a task discards uncommitted work; pass --force after explicit user approval');
    }

    const mainRoot = getMainRepoRoot(process.cwd());
    const config = loadConfig({ repoRoot: getWorktreeRoot(process.cwd()), cli });
    const entries = listWorktrees(mainRoot);
    const found = findWorktreeByBranch(mainRoot, target)
      || entries.find((entry) => isSamePath(entry.path, target));
    if (!found || !found.path || !found.branch) {
      throw new Error(`target is not a managed branch worktree: ${target}`);
    }

    const result = removeWorktreeSafely({
      mainRoot,
      worktreePath: found.path,
      worktreesRoot: resolveContainerPath(config, mainRoot, 'worktrees'),
      force: true,
    });
    removeSession(config, mainRoot, found.branch);
    const deleted = spawnSync('git', ['branch', '-D', found.branch], {
      cwd: mainRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (deleted.error || deleted.status !== 0) {
      throw new Error(`worktree was removed but local branch deletion failed: ${(deleted.stderr || deleted.stdout || '').trim()}`);
    }

    console.log('STATUS=CANCELLED');
    console.log(`WORKTREE_PATH=${result.path}`);
    console.log(`BRANCH_NAME=${found.branch}`);
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

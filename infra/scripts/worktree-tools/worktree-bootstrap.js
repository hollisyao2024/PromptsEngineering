#!/usr/bin/env node

const {
  getMainRepoRoot,
  getWorktreeRoot,
  parseCliArgs,
  runWorktreeBootstrap,
} = require('./worktree-core');
const { loadConfig } = require('../shared/config');

function main() {
  try {
    const cli = parseCliArgs(process.argv.slice(2));
    const worktreePath = getWorktreeRoot(process.cwd());
    const mainRoot = getMainRepoRoot(process.cwd());
    const config = loadConfig({ repoRoot: worktreePath, cli });
    const bootstrap = runWorktreeBootstrap({
      worktreePath,
      config,
      cli: { ...cli, bootstrap: cli.bootstrap || 'auto' },
      mainRoot,
      defaultMode: 'auto',
    });

    console.log('STATUS=OK');
    console.log(`WORKTREE_PATH=${worktreePath}`);
    console.log(`BOOTSTRAP_STATUS=${bootstrap.status}`);
    if (bootstrap.mode) console.log(`BOOTSTRAP_MODE=${bootstrap.mode}`);
    if (bootstrap.reason) console.log(`BOOTSTRAP_REASON=${bootstrap.reason}`);
    if (bootstrap.nextManualAction) console.log(`NEXT_MANUAL_ACTION=${bootstrap.nextManualAction}`);
  } catch (error) {
    console.error('STATUS=BLOCKED');
    if (error.worktreePath) console.error(`WORKTREE_PATH=${error.worktreePath}`);
    if (error.bootstrapStatus) console.error(`BOOTSTRAP_STATUS=${error.bootstrapStatus}`);
    if (error.command) console.error(`BOOTSTRAP_COMMAND=${error.command}`);
    if (error.checkCommand) console.error(`BOOTSTRAP_CHECK_COMMAND=${error.checkCommand}`);
    if (error.dirtyFiles) console.error(`DIRTY_FILES=${error.dirtyFiles}`);
    if (error.nextManualAction) console.error(`NEXT_MANUAL_ACTION=${error.nextManualAction}`);
    console.error(`REASON=${error.message}`);
    process.exit(1);
  }
}

main();

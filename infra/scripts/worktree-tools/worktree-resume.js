#!/usr/bin/env node

const {
  createOrResumeWorktree,
  findWorktreeByBranch,
  getMainRepoRoot,
  getWorktreeRoot,
  listWorktrees,
  parseCliArgs,
  readSessions,
  runWorktreeBootstrap,
} = require('./worktree-core');
const { loadConfig } = require('../shared/config');

function main() {
  try {
    const cli = parseCliArgs(process.argv.slice(2));
    const mainRoot = getMainRepoRoot(process.cwd());
    const config = loadConfig({ repoRoot: getWorktreeRoot(process.cwd()), cli });
    const target = cli.branch || cli._ || process.argv.slice(2).find((arg) => !arg.startsWith('--'));

    if (!target) {
      const sessions = readSessions(config, mainRoot);
      const entries = listWorktrees(mainRoot).filter((entry) => entry.path !== mainRoot);
      if (sessions.length === 0 && entries.length === 0) {
        console.log('STATUS=EMPTY');
        console.log('No resumable worktree sessions.');
        return;
      }
      console.log('STATUS=OK');
      for (const session of sessions) {
        console.log(`SESSION\tBRANCH=${session.branch}\tPATH=${session.worktree}\tSTEP=${session.step || ''}\tSTATUS=${session.status || ''}`);
      }
      for (const entry of entries) {
        console.log(`WORKTREE\tBRANCH=${entry.branch || '(detached)'}\tPATH=${entry.path}`);
      }
      return;
    }

    const existing = findWorktreeByBranch(mainRoot, target);
    if (existing) {
      const bootstrap = runWorktreeBootstrap({
        worktreePath: existing.path,
        config,
        cli,
        mainRoot,
        defaultMode: cli.bootstrap || cli['skip-bootstrap'] || cli.skipBootstrap ? '' : 'check',
      });
      console.log('STATUS=RESUMED');
      console.log(`BRANCH_NAME=${target}`);
      console.log(`WORKTREE_PATH=${existing.path}`);
      console.log(`NEXT_CWD=${existing.path}`);
      console.log(`BOOTSTRAP_STATUS=${bootstrap.status}`);
      if (bootstrap.mode) console.log(`BOOTSTRAP_MODE=${bootstrap.mode}`);
      if (bootstrap.reason) console.log(`BOOTSTRAP_REASON=${bootstrap.reason}`);
      if (bootstrap.nextManualAction) console.log(`NEXT_MANUAL_ACTION=${bootstrap.nextManualAction}`);
      return;
    }

    const result = createOrResumeWorktree({ cli: { ...cli, branch: target }, cwd: mainRoot });
    console.log(result.dryRun ? 'STATUS=DRY_RUN' : 'STATUS=REMOUNTED');
    console.log(`BRANCH_NAME=${result.branch}`);
    console.log(`WORKTREE_PATH=${result.worktreePath}`);
    console.log(`NEXT_CWD=${result.worktreePath}`);
    if (result.bootstrap) {
      console.log(`BOOTSTRAP_STATUS=${result.bootstrap.status}`);
      if (result.bootstrap.mode) console.log(`BOOTSTRAP_MODE=${result.bootstrap.mode}`);
      if (result.bootstrap.reason) console.log(`BOOTSTRAP_REASON=${result.bootstrap.reason}`);
      if (result.bootstrap.nextManualAction) console.log(`NEXT_MANUAL_ACTION=${result.bootstrap.nextManualAction}`);
    }
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

#!/usr/bin/env node

const {
  createOrResumeWorktree,
  findWorktreeByBranch,
  getMainRepoRoot,
  getWorktreeRoot,
  listWorktrees,
  parseCliArgs,
  readSessions,
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
      console.log('STATUS=RESUMED');
      console.log(`BRANCH_NAME=${target}`);
      console.log(`WORKTREE_PATH=${existing.path}`);
      console.log(`NEXT_CWD=${existing.path}`);
      return;
    }

    const result = createOrResumeWorktree({ cli: { ...cli, branch: target }, cwd: mainRoot });
    console.log(result.dryRun ? 'STATUS=DRY_RUN' : 'STATUS=REMOUNTED');
    console.log(`BRANCH_NAME=${result.branch}`);
    console.log(`WORKTREE_PATH=${result.worktreePath}`);
    console.log(`NEXT_CWD=${result.worktreePath}`);
  } catch (error) {
    console.error('STATUS=BLOCKED');
    console.error(`REASON=${error.message}`);
    process.exit(1);
  }
}

main();

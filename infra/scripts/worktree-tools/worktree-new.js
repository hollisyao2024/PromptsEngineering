#!/usr/bin/env node

const { createOrResumeWorktree, parseCliArgs } = require('./worktree-core');

function printHelp() {
  console.log(`Usage:
  node infra/scripts/worktree-tools/worktree-new.js --phase <phase> --desc <description>
  node infra/scripts/worktree-tools/worktree-new.js --phase tdd --task <TASK-ID> [--desc <description>]
  node infra/scripts/worktree-tools/worktree-new.js --branch <branch>

Required identity:
  Supply at least one of --branch, --task, or --desc. --phase alone is rejected.

Options:
  --phase <phase>       Expert phase (prd, arch, task, tdd, qa, devops; default: tdd)
  --kind fix            Create a fix/<description> branch
  --dry-run             Print the planned branch and path without creating them
  --skip-fetch          Do not contact origin before creation
  --skip-bootstrap      Skip configured worktree dependency bootstrap
  -h, --help            Show this help without changing Git or the filesystem`);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  try {
    const cli = parseCliArgs(argv);
    const result = createOrResumeWorktree({ cli });

    if (result.dryRun) {
      console.log('STATUS=DRY_RUN');
      console.log(`BRANCH_NAME=${result.branch}`);
      console.log(`WORKTREE_PATH=${result.worktreePath}`);
      console.log(`NEXT_CWD=${result.worktreePath}`);
      console.log(`BASE_REF=${result.baseRef}`);
      return;
    }

    console.log(result.resumed ? 'STATUS=RESUMED' : 'STATUS=CREATED');
    console.log(`BRANCH_NAME=${result.branch}`);
    console.log(`WORKTREE_PATH=${result.worktreePath}`);
    console.log(`NEXT_CWD=${result.worktreePath}`);
    if (result.linked && result.linked.length > 0) {
      console.log(`LINKED=${result.linked.join(',')}`);
    }
    if (result.fetchSkipped) {
      console.log('FETCH_SKIPPED=true');
    }
    if (result.reclaimed && result.reclaimed.removed.length > 0) {
      console.log(`RECLAIMED_MERGED_WORKTREES=${result.reclaimed.removed.map((item) => item.branch).join(',')}`);
    }
    if (result.bootstrap) {
      console.log(`BOOTSTRAP_STATUS=${result.bootstrap.status}`);
      if (result.bootstrap.mode) console.log(`BOOTSTRAP_MODE=${result.bootstrap.mode}`);
      if (result.bootstrap.reason) console.log(`BOOTSTRAP_REASON=${result.bootstrap.reason}`);
      if (result.bootstrap.reusedPaths && result.bootstrap.reusedPaths.length > 0) {
        console.log(`REUSED_PATHS=${result.bootstrap.reusedPaths.join(',')}`);
      }
      if (result.bootstrap.nextManualAction) console.log(`NEXT_MANUAL_ACTION=${result.bootstrap.nextManualAction}`);
    }
    console.log('');
    console.log('Next steps:');
    console.log(`  cd "${result.worktreePath}"`);
    console.log(`  code "${result.worktreePath}"`);
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

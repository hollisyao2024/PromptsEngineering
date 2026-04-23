#!/usr/bin/env node

const { createOrResumeWorktree, parseCliArgs } = require('./worktree-core');

function main() {
  try {
    const cli = parseCliArgs(process.argv.slice(2));
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
    console.log('');
    console.log('Next steps:');
    console.log(`  cd "${result.worktreePath}"`);
    console.log(`  code "${result.worktreePath}"`);
  } catch (error) {
    console.error('STATUS=BLOCKED');
    console.error(`REASON=${error.message}`);
    process.exit(1);
  }
}

main();

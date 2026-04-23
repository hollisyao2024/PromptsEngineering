#!/usr/bin/env node
/**
 * Deprecated compatibility shim for the old /tdd new-branch workflow.
 *
 * Worktree-First mode still uses Git branches internally, but users should
 * create or resume worktrees through the shared worktree tools.
 */

console.error('STATUS=DEPRECATED');
console.error('/tdd new-branch is deprecated in Worktree-First mode.');
console.error('No branch was created.');
console.error('');
console.error('Use one of:');
console.error('  node infra/scripts/worktree-tools/worktree-new.js --phase=tdd --task TASK-USER-001 --desc "login"');
console.error('  node infra/scripts/worktree-tools/worktree-new.js --phase=tdd --kind=fix --desc "login bug"');
console.error('');
console.error('After creation, continue all work in WORKTREE_PATH / NEXT_CWD.');
process.exit(1);

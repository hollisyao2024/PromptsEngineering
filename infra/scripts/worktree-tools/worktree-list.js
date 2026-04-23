#!/usr/bin/env node

const { getMainRepoRoot, getWorktreeRoot, listWorktrees, readSessions } = require('./worktree-core');
const { loadConfig } = require('../shared/config');

function main() {
  const mainRoot = getMainRepoRoot(process.cwd());
  const config = loadConfig({ repoRoot: getWorktreeRoot(process.cwd()) });
  const sessions = readSessions(config, mainRoot);
  const sessionByBranch = new Map(sessions.map((session) => [session.branch, session]));
  const entries = listWorktrees(mainRoot).filter((entry) => entry.path !== mainRoot);

  if (entries.length === 0) {
    console.log('STATUS=EMPTY');
    console.log('No active linked worktrees.');
    return;
  }

  console.log('STATUS=OK');
  for (const entry of entries) {
    const session = sessionByBranch.get(entry.branch) || {};
    console.log([
      `BRANCH=${entry.branch || '(detached)'}`,
      `PATH=${entry.path}`,
      `HEAD=${(entry.head || '').slice(0, 7)}`,
      `PHASE=${session.phase || ''}`,
      `STEP=${session.step || ''}`,
      `STATUS=${session.status || ''}`,
    ].join('\t'));
  }
}

main();

#!/usr/bin/env node
/**
 * Run a command with project-scoped GitHub authentication loaded from .env.local.
 *
 * Usage:
 *   node infra/scripts/shared/github-auth-run.js -- gh pr list --state open
 *   node infra/scripts/shared/github-auth-run.js -- git pull
 */

const { spawnSync } = require('child_process');
const { resolveRepoRoot } = require('./config');
const { buildGitHubShellEnv } = require('./github-auth');

function parseCommand(argv) {
  const separatorIndex = argv.indexOf('--');
  const command = separatorIndex === -1 ? argv : argv.slice(separatorIndex + 1);
  return command.filter(Boolean);
}

function main() {
  const command = parseCommand(process.argv.slice(2));
  if (!command.length) {
    console.error('STATUS=BLOCKED');
    console.error('REASON=missing command');
    console.error('NEXT_MANUAL_ACTION=node infra/scripts/shared/github-auth-run.js -- gh pr list --state open');
    process.exit(1);
  }

  const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
  const result = spawnSync(command[0], command.slice(1), {
    cwd: repoRoot,
    env: buildGitHubShellEnv({ repoRoot, cwd: repoRoot, env: process.env }),
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`STATUS=BLOCKED\nREASON=${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status || 0);
}

main();

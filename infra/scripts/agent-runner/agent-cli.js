#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');

const ROUTES = new Map([
  ['run', 'infra/scripts/agent-runner/agent-run.js'],
  ['finish', 'infra/scripts/tdd-tools/tdd-finish.js'],
  ['tdd:sync', 'infra/scripts/tdd-tools/tdd-sync.js'],
  ['tdd:push', 'infra/scripts/tdd-tools/tdd-push.js'],
  ['tdd:finish', 'infra/scripts/tdd-tools/tdd-finish.js'],
  ['tdd:guard', 'infra/scripts/tdd-tools/tdd-completion-guard.js'],
  ['qa:plan', 'infra/scripts/qa-tools/generate-qa.js'],
  ['qa:verify', 'infra/scripts/qa-tools/qa-verify.js'],
  ['qa:merge', 'infra/scripts/qa-tools/qa-merge.js'],
  ['worktree:new', 'infra/scripts/worktree-tools/worktree-new.js'],
  ['worktree:list', 'infra/scripts/worktree-tools/worktree-list.js'],
  ['worktree:resume', 'infra/scripts/worktree-tools/worktree-resume.js'],
  ['worktree:bootstrap', 'infra/scripts/worktree-tools/worktree-bootstrap.js'],
  ['worktree:remove', 'infra/scripts/worktree-tools/worktree-remove.js'],
  ['worktree:cancel', 'infra/scripts/worktree-tools/worktree-cancel.js'],
  ['worktree:audit', 'infra/scripts/worktree-tools/worktree-audit-cli.js'],
  ['template:update', 'infra/scripts/setup/update-template.js'],
  ['template:backfill', 'infra/scripts/setup/backfill-template.js'],
]);

function normalizeArgv(argv) {
  return argv[0] === '--' ? argv.slice(1) : argv;
}

function resolveCommand(argv) {
  const args = normalizeArgv(argv);
  const [domain = '', action = '', ...rest] = args;
  if (domain === 'task') {
    if (!action) throw new Error('task requires an action');
    return { script: 'infra/scripts/agent-runner/agent-task.js', args: [action, ...rest] };
  }
  if (domain === 'dev') {
    if (!action) throw new Error('dev requires start, restart, stop, status, or logs');
    return { script: 'infra/scripts/devops-tools/devops-run.js', args: [`--action=dev-${action}`, ...rest] };
  }
  if (domain === 'ship') {
    if (!action) throw new Error('ship requires dev, staging, or production');
    return { script: 'infra/scripts/devops-tools/devops-run.js', args: ['--action=ship', `--env=${action}`, ...rest] };
  }
  const compound = action ? `${domain}:${action}` : domain;
  const script = ROUTES.get(compound) || ROUTES.get(domain);
  if (!script) throw new Error(`unknown agent command: ${args.join(' ') || '(missing)'}`);
  return { script, args: ROUTES.has(compound) ? rest : args.slice(1) };
}

function printHelp() {
  console.log(`Usage: pnpm agent -- <command> [args]

Core commands:
  task <start|checkpoint|resume|extend|transition|finish|cancel>
  worktree <new|list|resume|bootstrap|remove|cancel|audit>
  tdd <sync|push|finish|guard>
  qa <plan|verify|merge>
  template <update|backfill>
  dev <start|restart|stop|status|logs>
  ship <dev|staging|production>
  finish

Existing package aliases remain compatible for migrated projects.`);
}

function main(argv = process.argv.slice(2)) {
  const args = normalizeArgv(argv);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }
  const resolved = resolveCommand(args);
  const result = spawnSync(process.execPath, [resolved.script, ...resolved.args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status || 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error('STATUS=BLOCKED');
    console.error(`REASON=${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main, resolveCommand };

#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isHelpRequest: isOwnHelpRequest } = require('../shared/cli-help');
const { spawnExitCode } = require('../shared/spawn-exit');

const ROUTES = new Map([
  ['run', 'infra/scripts/agent-runner/agent-run.js'],
  ['test', 'infra/scripts/agent-runner/targeted-test.js'],
  ['finish', 'infra/scripts/tdd-tools/tdd-finish.js'],
  ['tdd:sync', 'infra/scripts/tdd-tools/tdd-sync.js'],
  ['tdd:push', 'infra/scripts/tdd-tools/tdd-push.js'],
  ['tdd:commit', 'infra/scripts/tdd-tools/tdd-commit.js'],
  ['tdd:review-gate', 'infra/scripts/tdd-tools/tdd-review-gate.js'],
  ['tdd:finish', 'infra/scripts/tdd-tools/tdd-finish.js'],
  ['tdd:guard', 'infra/scripts/tdd-tools/tdd-completion-guard.js'],
  ['qa:plan', 'infra/scripts/qa-tools/generate-qa.js'],
  ['qa:automate', 'infra/scripts/qa-tools/qa-automate.js'],
  ['qa:paths', 'infra/scripts/qa-tools/qa-paths.js'],
  ['qa:run', 'infra/scripts/qa-tools/qa-run.js'],
  ['qa:verify', 'infra/scripts/qa-tools/qa-verify.js'],
  ['qa:merge', 'infra/scripts/qa-tools/qa-merge.js'],
  ['worktree:new', 'infra/scripts/worktree-tools/worktree-new.js'],
  ['worktree:list', 'infra/scripts/worktree-tools/worktree-list.js'],
  ['worktree:resume', 'infra/scripts/worktree-tools/worktree-resume.js'],
  ['worktree:bootstrap', 'infra/scripts/worktree-tools/worktree-bootstrap.js'],
  ['worktree:remove', 'infra/scripts/worktree-tools/worktree-remove.js'],
  ['worktree:cancel', 'infra/scripts/worktree-tools/worktree-cancel.js'],
  ['worktree:audit', 'infra/scripts/worktree-tools/worktree-audit-cli.js'],
  ['template:sync', 'infra/scripts/setup/template-sync.js'],
  ['template:update', 'infra/scripts/setup/update-template.js'],
  ['template:backfill', 'infra/scripts/setup/backfill-template.js'],
]);

const DEV_SERVICE_ACTIONS = new Set(['start', 'restart', 'stop', 'status', 'logs']);
const APP_ACTIONS = new Set(['dev', 'build']);
const DEVOPS_RUNNER = 'infra/scripts/devops-tools/devops-run.js';

function normalizeArgv(argv) {
  return argv[0] === '--' ? argv.slice(1) : argv;
}

// Flags after the forwarded-command separator belong to the wrapped command, not this CLI.
function isHelpRequest(args) {
  return args.length === 0 || isOwnHelpRequest(args);
}

function exitCodeFor(result) {
  return spawnExitCode(result);
}

function appRoute(action, rest, target = '') {
  if (!APP_ACTIONS.has(action)) throw new Error('app requires dev or build');
  const args = [`--action=app-${action}`, ...rest];
  if (target) args.push(`--target=${target}`);
  return { script: DEVOPS_RUNNER, args };
}

function slashAppRoute(action, rest, target = '') {
  const [platform = '', ...extra] = rest;
  if (!platform) throw new Error(`${action} app requires a platform`);
  return appRoute(action, [`--platform=${platform}`, ...extra], target);
}

function resolveCommand(argv) {
  const args = normalizeArgv(argv);
  const [domain = '', action = '', ...rest] = args;
  if (domain === 'architecture') {
    return { script: 'architecture/scripts/cli.js', args: [action || 'help', ...rest] };
  }
  if (domain === 'task') {
    if (!action) throw new Error('task requires an action');
    return { script: 'infra/scripts/agent-runner/agent-task.js', args: [action, ...rest] };
  }
  if (domain === 'dev') {
    if (action === 'app') return slashAppRoute('dev', rest);
    if (!action) throw new Error('dev requires start, restart, stop, status, or logs');
    if (!DEV_SERVICE_ACTIONS.has(action)) throw new Error('dev requires app or start, restart, stop, status, or logs');
    return { script: DEVOPS_RUNNER, args: [`--action=dev-${action}`, ...rest] };
  }
  if (domain === 'app') {
    return appRoute(action, rest);
  }
  if (domain === 'build') {
    if (action === 'app') return slashAppRoute('build', rest);
    if (action === 'server') return { script: DEVOPS_RUNNER, args: ['--action=build', ...rest] };
    if (!action) throw new Error('build requires app <platform>, server --env=<env>, or <env>');
    return { script: DEVOPS_RUNNER, args: ['--action=build', `--env=${action}`, ...rest] };
  }
  if (domain === 'ship') {
    if (!action) throw new Error('ship requires dev, staging, or production');
    return { script: DEVOPS_RUNNER, args: ['--action=ship', `--env=${action}`, ...rest] };
  }
  if (domain === 'private') {
    if (DEV_SERVICE_ACTIONS.has(action)) {
      return { script: DEVOPS_RUNNER, args: [`--action=dev-${action}`, '--target=private', ...rest] };
    }
    if (action === 'dev' && rest[0] === 'app') return slashAppRoute('dev', rest.slice(1), 'private');
    if (action === 'build' && rest[0] === 'app') return slashAppRoute('build', rest.slice(1), 'private');
    if (action === 'build' && rest[0] === 'server') {
      return { script: DEVOPS_RUNNER, args: ['--action=build', ...rest.slice(1), '--target=private'] };
    }
    if (action === 'build' && rest[0]) {
      return { script: DEVOPS_RUNNER, args: ['--action=build', `--env=${rest[0]}`, ...rest.slice(1), '--target=private'] };
    }
    if (action === 'ship' && rest[0]) {
      return { script: DEVOPS_RUNNER, args: ['--action=ship', `--env=${rest[0]}`, ...rest.slice(1), '--target=private'] };
    }
    throw new Error('private requires start, restart, stop, status, logs, dev app <platform>, build app <platform>, build <env>, or ship <env>');
  }
  const compound = action ? `${domain}:${action}` : domain;
  const script = ROUTES.get(compound) || ROUTES.get(domain);
  if (!script) throw new Error(`unknown agent command: ${args.join(' ') || '(missing)'}`);
  return { script, args: ROUTES.has(compound) ? rest : args.slice(1) };
}

function printHelp() {
  console.log(`Usage: pnpm agent -- <command> [args]

Core commands:
  test --file <test-file> -- <runner> [args]
  task <paths|context|start|checkpoint|exec|resume|extend|transition|finish|cancel>
  worktree <new|list|resume|bootstrap|remove|cancel|audit>
  tdd <sync|push|commit|review-gate|finish|guard>
  qa <plan|automate|paths|run|verify|merge>
  template <sync|update|backfill>
  architecture <catalog|detect|validate|plan|init|update|adopt|apply|resume|check|install-deps>
  dev <start|restart|stop|status|logs>
  dev app <platform>
  app <dev|build> --platform=<platform>
  build app <platform> | build <env>
  ship <dev|staging|production>
  private <start|restart|stop|status|logs>
  private dev app <platform> | private build app <platform>
  private build <env> | private ship <env>
  finish

Existing package aliases remain compatible for migrated projects.`);
}

const MISSING_SCRIPT_NEXT_ACTION = [
  ['architecture/', 'pnpm agent -- template sync --include architecture'],
  ['', 'pnpm agent -- template sync'],
];

// Routed scripts live in the project; a project that never pulled a package (for example `architecture check`
// before `template sync --include architecture`) must get STATUS=BLOCKED with the installing command, not a
// MODULE_NOT_FOUND stack from the spawned node process.
function assertScriptInstalled(script, cwd) {
  if (fs.existsSync(path.resolve(cwd, script))) return;
  const error = new Error(`routed script ${script} is not installed in ${cwd}`);
  error.code = 'SCRIPT_NOT_INSTALLED';
  error.nextAction = MISSING_SCRIPT_NEXT_ACTION.find(([prefix]) => script.startsWith(prefix))[1];
  throw error;
}

function main(argv = process.argv.slice(2)) {
  const args = normalizeArgv(argv);
  if (isHelpRequest(args)) {
    printHelp();
    return 0;
  }
  const resolved = resolveCommand(args);
  assertScriptInstalled(resolved.script, process.cwd());
  const result = spawnSync(process.execPath, [resolved.script, ...resolved.args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return exitCodeFor(result);
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error('STATUS=BLOCKED');
    console.error(`REASON=${error.message}`);
    if (error.nextAction) console.error(`NEXT_ACTION=${error.nextAction}`);
    process.exitCode = 1;
  }
}

module.exports = { exitCodeFor, isHelpRequest, main, resolveCommand };

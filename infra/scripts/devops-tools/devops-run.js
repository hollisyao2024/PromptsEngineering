#!/usr/bin/env node
/**
 * Portable DevOps shortcut dispatcher.
 *
 * This file owns the template-level semantics for /ship, /cd, /ci, /env and
 * /restart. Real deployment, CI and service commands stay in agent.config.json
 * or environment variables; legacy project-coupled server scripts are not used
 * as a fallback.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  getMainRepoRoot,
  getWorktreeRoot,
  loadConfig,
  parseCliArgs,
  resolveContainerPath,
} = require('../shared/config');

const ENV_ALIASES = {
  dev: 'dev',
  development: 'dev',
  staging: 'staging',
  stage: 'staging',
  prod: 'production',
  production: 'production',
};

const DEV_ACTIONS = {
  'dev-start': 'start',
  'dev-restart': 'restart',
  restart: 'restart',
  'dev-stop': 'stop',
  'dev-status': 'status',
  'dev-logs': 'logs',
};

function normalizeEnv(env) {
  if (!env) return '';
  return ENV_ALIASES[String(env).toLowerCase()] || String(env).toLowerCase();
}

function envLabel(env) {
  return env === 'production' ? 'prod' : env;
}

function readCommand(value, env) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (env && typeof value === 'object') return value[env] || value[envLabel(env)] || '';
  return '';
}

function templateCommand(command, vars) {
  return command.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : '';
  });
}

function ensureRunDir(config, mainRoot) {
  const tmpDir = resolveContainerPath(config, mainRoot, 'tmp');
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const runDir = path.join(tmpDir, 'devops-runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

function block(reason, nextManualAction, meta = {}) {
  console.error('STATUS=BLOCKED');
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined && value !== '') console.error(`${key.toUpperCase()}=${value}`);
  }
  console.error(`REASON=${reason}`);
  console.error(`NEXT_MANUAL_ACTION=${nextManualAction}`);
  process.exit(1);
}

function commandForAction(config, cli, action, env) {
  const commands = (config.devops && config.devops.commands) || {};
  const workflows = (config.devops && config.devops.workflows) || {};
  const healthCheck = (config.devops && config.devops.healthCheck) || {};
  const devServerCommands = (config.devServer && config.devServer.commands) || {};

  if (action === 'ship') return readCommand(commands.ship, env);
  if (action === 'cd') return readCommand(commands.cd, env);
  if (action === 'ci-run') return readCommand(commands.ciRun || workflows.ci, env);
  if (action === 'ci-status') return readCommand(commands.ciStatus, env);
  if (action === 'env-check') return readCommand(commands.envCheck || healthCheck, env);
  if (action === 'env-status') return readCommand(commands.envStatus);

  if (Object.prototype.hasOwnProperty.call(DEV_ACTIONS, action)) {
    const devCommand = DEV_ACTIONS[action];
    return (
      readCommand(devServerCommands[devCommand]) ||
      (devCommand === 'restart' ? config.devServer && config.devServer.command : '') ||
      ''
    );
  }

  if (cli.command) return cli.command;
  return '';
}

function actionRequiresEnv(action) {
  return ['ship', 'cd', 'env-check'].includes(action);
}

function actionRequiresDeployEnabled(action) {
  return ['ship', 'cd'].includes(action);
}

function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const action = String(cli.action || '').toLowerCase();
  const env = normalizeEnv(cli.env || cli.environment || cli.target);
  const quick = Boolean(cli.quick || cli['quick']);
  const mainRoot = getMainRepoRoot(process.cwd());
  const repoRoot = getWorktreeRoot(process.cwd());
  const config = loadConfig({ repoRoot, cli });
  const runDir = ensureRunDir(config, mainRoot);

  if (!action) {
    block(
      'missing --action',
      'Run with --action=ship|cd|ci-run|ci-status|env-check|env-status|dev-restart',
      { run_dir: runDir }
    );
  }

  if (actionRequiresEnv(action) && !env) {
    block('missing --env', 'Pass --env=dev|staging|production.', {
      action,
      run_dir: runDir,
    });
  }

  if (actionRequiresDeployEnabled(action) && !config.devops.deployEnabled) {
    block(
      'devops.deployEnabled=false',
      'Set devops.deployEnabled=true and devops.commands in agent.config.json before running deployment shortcuts.',
      { action, env, run_dir: runDir }
    );
  }

  const rawCommand = commandForAction(config, cli, action, env);
  if (!rawCommand) {
    block(
      `no command configured for ${action}${env ? `:${env}` : ''}`,
      'Add the command under agent.config.json devops.commands or devServer.commands.',
      { action, env, run_dir: runDir }
    );
  }

  const command = templateCommand(rawCommand, {
    action,
    env,
    env_short: envLabel(env),
    repo: repoRoot,
    main_repo: mainRoot,
    artifacts: resolveContainerPath(config, mainRoot, 'artifacts'),
    tmp: resolveContainerPath(config, mainRoot, 'tmp'),
  });

  const result = {
    action,
    env,
    command,
    cwd: repoRoot,
    run_dir: runDir,
    dry_run: Boolean(cli.dryRun || cli['dry-run']),
    quick,
  };
  fs.writeFileSync(path.join(runDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);

  console.log(result.dry_run ? 'STATUS=DRY_RUN' : 'STATUS=RUNNING');
  console.log(`ACTION=${action}`);
  if (env) console.log(`ENV=${env}`);
  console.log(`RUN_DIR=${runDir}`);
  console.log(`CWD=${repoRoot}`);
  console.log(`COMMAND=${command}`);
  if (quick) console.log('QUICK=1');

  if (result.dry_run) return;

  const spawned = spawnSync(command, {
    cwd: repoRoot,
    env: {
      ...process.env,
      AGENT_DEVOPS_ACTION: action,
      AGENT_ENV: env,
      AGENT_QUICK: quick ? '1' : '0',
      SKIP_CI: quick ? 'true' : process.env.SKIP_CI,
      AGENT_RUN_DIR: runDir,
      AGENT_ARTIFACTS_DIR: resolveContainerPath(config, mainRoot, 'artifacts'),
      AGENT_TMP_DIR: resolveContainerPath(config, mainRoot, 'tmp'),
    },
    shell: true,
    stdio: 'inherit',
  });

  if (spawned.status !== 0) {
    block(`command exited with ${spawned.status}`, 'Inspect RUN_DIR and the command output, then fix configuration or target environment.', {
      action,
      env,
      run_dir: runDir,
    });
  }

  console.log('STATUS=OK');
}

main();

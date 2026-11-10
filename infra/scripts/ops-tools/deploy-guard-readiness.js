#!/usr/bin/env node
/**
 * Read-only readiness report for ops.rollbackGuard.
 *
 * The template never switches the guard on by itself: a project whose deploy
 * commands cannot pin a commit would be blocked on every deploy. This check
 * lists what is still missing so the project can retrofit its deploy scripts
 * and enable the guard deliberately.
 *
 *   NOT_APPLICABLE  no ship/cd command is configured for a guarded environment
 *   READY           every prerequisite is met (guard on, or ready to be enabled)
 *   NOT_READY       guard is off and prerequisites are missing
 *   BLOCKED         guard is on but prerequisites are missing (deploys will fail)
 *   UNKNOWN         the check itself failed; never affects the caller
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveGuardConfig } = require('./deploy-guard');

const ENV_NAMES = { prod: 'production', production: 'production', stage: 'staging', staging: 'staging', dev: 'dev', development: 'dev' };
const DEFAULT_ENVIRONMENTS = ['staging', 'production'];
const ENABLE_HINT = 'Set ops.rollbackGuard.enabled=true in agent.config.json, then run a real staging deploy and confirm DEPLOY_REF_ADVANCE=OK and DEPLOY_LOCK_RELEASE=OK.';
const RETROFIT_HINT = 'Fix each DEPLOY_GUARD_GAP: deploy scripts accept --sha=<40-hex> and deploy exactly that commit, add {source_args} to ops.commands.ship/cd, use a full (non-shallow) clone and a GH_TOKEN with contents write access; see the OPS playbook section on rollback guard.';

function normalizeEnv(name) {
  const key = String(name).toLowerCase();
  return ENV_NAMES[key] || key;
}

// Mirrors ops-run readCommand: an env may be keyed by its full name or the prod label.
function readEnvCommand(value, env) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return '';
  const command = value[env] || (env === 'production' ? value.prod : '') || '';
  return typeof command === 'string' ? command : '';
}

// Ship profiles are object-valued keys of ops.commands.ship (e.g. private);
// "default" holds the default profile when the project nests it.
function shipProfiles(ship) {
  if (!ship || typeof ship !== 'object') return [];
  return Object.keys(ship).filter((key) => key !== 'default' && ship[key] && typeof ship[key] === 'object');
}

function collectTargets(config, environments) {
  const commands = (config.ops && config.ops.commands) || {};
  const ship = commands.ship;
  const defaultShip = ship && typeof ship === 'object' && ship.default && typeof ship.default === 'object' ? ship.default : ship;
  const targets = [];
  for (const env of environments) {
    const command = readEnvCommand(defaultShip, env);
    if (command) targets.push({ action: 'ship', env, profile: '', command });
  }
  for (const profile of shipProfiles(ship)) {
    for (const env of environments) {
      const command = readEnvCommand(ship[profile], env);
      if (command) targets.push({ action: 'ship', env, profile, command });
    }
  }
  for (const env of environments) {
    const command = readEnvCommand(commands.cd, env);
    if (command) targets.push({ action: 'cd', env, profile: '', command });
  }
  return targets;
}

function targetLabel(target) {
  return `${target.action}:${target.profile ? `${target.profile}-${target.env}` : target.env}`;
}

/**
 * Pure assessment. isShallow / hasToken are booleans, or null when they could
 * not be evaluated (reported as warnings so the verdict does not guess).
 */
function assessGuardReadiness({ config = {}, isShallow = null, hasToken = null } = {}) {
  const raw = (config.ops && config.ops.rollbackGuard) || {};
  const guardEnabled = raw.enabled === true;
  const environments = (Array.isArray(raw.environments) ? raw.environments : DEFAULT_ENVIRONMENTS).map(normalizeEnv);
  const targets = collectTargets(config, environments);
  const result = { guardEnabled, targets: targets.map(targetLabel), gaps: [], warnings: [], readiness: 'NOT_APPLICABLE', next: '' };
  if (targets.length === 0) {
    result.next = 'No ship/cd command is configured for a guarded environment; nothing to do.';
    return result;
  }

  // Validate shape through the real guard resolver so readiness matches deploy-time checks.
  const probe = { ...config, ops: { ...config.ops, rollbackGuard: { ...raw, enabled: true } } };
  const warnedScopes = new Set();
  for (const target of targets) {
    const guard = resolveGuardConfig(probe, target.env, target.profile, target.action);
    const label = targetLabel(target);
    if (guard.error) {
      if (!result.gaps.some((gap) => gap.code === 'CONFIG_INVALID')) {
        result.gaps.push({ code: 'CONFIG_INVALID', subject: 'ops.rollbackGuard', detail: guard.error });
      }
      continue;
    }
    if (!String(target.command).includes('{source_args}')) {
      result.gaps.push({
        code: 'MISSING_SOURCE_ARGS',
        subject: label,
        detail: `ops.commands.${target.action} must pass {source_args} so the pinned --sha is what gets deployed`,
      });
    }
    if (!guard.readDeployedCommand && !warnedScopes.has(guard.scope)) {
      warnedScopes.add(guard.scope);
      result.warnings.push({
        code: 'NO_READ_DEPLOYED_COMMAND',
        subject: guard.scope,
        detail: 'without ops.rollbackGuard.readDeployedCommand only the deploy ref is compared; out-of-band deploys go unnoticed',
      });
    }
  }

  if (isShallow === true) {
    result.gaps.push({ code: 'SHALLOW_CLONE', subject: 'repository', detail: 'ancestry checks need full history; run git fetch --unshallow on every deploying machine' });
  } else if (isShallow === null) {
    result.warnings.push({ code: 'SHALLOW_NOT_EVALUATED', subject: 'repository', detail: 'could not determine whether the clone is shallow' });
  }
  if (hasToken === false) {
    result.gaps.push({ code: 'GH_TOKEN_MISSING', subject: '.env.local', detail: 'GH_TOKEN with contents write access is required to push refs/xirang/*' });
  } else if (hasToken === null) {
    result.warnings.push({ code: 'GH_TOKEN_NOT_EVALUATED', subject: '.env.local', detail: 'GH_TOKEN presence was not checked' });
  }

  if (result.gaps.length === 0) {
    result.readiness = 'READY';
    result.next = guardEnabled ? 'Rollback guard is enabled and its prerequisites are met.' : ENABLE_HINT;
  } else {
    result.readiness = guardEnabled ? 'BLOCKED' : 'NOT_READY';
    result.next = RETROFIT_HINT;
  }
  return result;
}

function formatReadiness(result) {
  const lines = [`DEPLOY_GUARD_READINESS=${result.readiness}`];
  if (result.readiness === 'SKIPPED' || result.readiness === 'UNKNOWN') return lines;
  lines.push(`ROLLBACK_GUARD=${result.guardEnabled ? 'ENABLED' : 'DISABLED'}`);
  lines.push(`DEPLOY_GUARD_TARGETS=${result.targets.join(',') || 'none'}`);
  for (const gap of result.gaps) lines.push(`DEPLOY_GUARD_GAP=${gap.code}|${gap.subject}|${gap.detail}`);
  for (const warning of result.warnings) lines.push(`DEPLOY_GUARD_WARN=${warning.code}|${warning.subject}|${warning.detail}`);
  if (result.next) lines.push(`DEPLOY_GUARD_NEXT=${result.next}`);
  return lines;
}

function detectShallow(repoRoot) {
  const run = spawnSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });
  if (run.error || run.status !== 0) return null;
  const value = run.stdout.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

// Only presence is checked; the token value is never printed or returned.
function detectToken(repoRoot, env) {
  try {
    const { getProjectGitHubToken } = require('../shared/github-auth');
    return Boolean(getProjectGitHubToken({ repoRoot, cwd: repoRoot, env }));
  } catch {
    return null;
  }
}

function defaultLoadConfig(repoRoot) {
  const { loadConfig } = require('../shared/config');
  return loadConfig({ repoRoot, cli: {} });
}

/**
 * Report-only entry used by the template updater: prints lines through log
 * and never throws, so a failing check cannot fail a template sync.
 */
function reportGuardReadiness({ repoRoot, log = console.log, env = process.env, loadConfig = defaultLoadConfig } = {}) {
  let result;
  try {
    const config = loadConfig(repoRoot);
    if (config && config.template && config.template.role === 'source') {
      result = { readiness: 'SKIPPED' };
    } else {
      result = assessGuardReadiness({ config, isShallow: detectShallow(repoRoot), hasToken: detectToken(repoRoot, env) });
    }
  } catch (error) {
    result = { readiness: 'UNKNOWN', error: String((error && error.message) || error).split('\n')[0] };
  }
  for (const line of formatReadiness(result)) log(line);
  if (result.error) log(`DEPLOY_GUARD_READINESS_ERROR=${result.error}`);
  return result;
}

function main() {
  const { resolveRepoRoot } = require('../shared/config');
  const repoRoot = resolveRepoRoot({ cwd: process.cwd(), warn: false });
  if (!repoRoot || !fs.existsSync(path.join(repoRoot, '.git'))) {
    console.log('STATUS=BLOCKED');
    console.log('SUMMARY=not inside a git repository');
    console.log('NEXT_ACTION=Run from the project repository.');
    return 1;
  }
  const result = reportGuardReadiness({ repoRoot });
  const blocked = result.readiness === 'BLOCKED' || result.readiness === 'UNKNOWN';
  console.log(`STATUS=${blocked ? 'BLOCKED' : 'OK'}`);
  console.log(`SUMMARY=deploy guard readiness ${result.readiness}`);
  console.log(`NEXT_ACTION=${result.next || (result.readiness === 'UNKNOWN' ? 'Fix the readiness check error and rerun.' : 'None.')}`);
  return blocked ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { assessGuardReadiness, formatReadiness, reportGuardReadiness };

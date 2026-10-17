/**
 * Wires the deploy guard (deploy-guard.js) into the /ship stable entry so
 * devops-run.js only maps the outcome onto its STATUS/block protocol.
 */

const {
  createGitRunner,
  executeGuardedShip,
  prepareGuardedShip,
  releaseLockManually,
  resolveGuardConfig,
  runReadDeployedCommand,
} = require('./deploy-guard');

function fail(result) {
  return { reason: result.reason, next: result.next, code: result.code };
}

// Returns { lines, failure?, released?, guarded?, summary?, execute(run) }.
// `execute(run)` runs the deploy under the lease when guarded and returns
// { lines, failure? }; it returns null when the guard does not apply.
function prepareShipGuard({ config, cli, action, env, target, rawCommand, repoRoot, dryRun, commandEnvFor, now = Date.now }) {
  const none = { lines: [], execute: () => null };
  const guard = action === 'ship' ? resolveGuardConfig(config, env, target) : { enabled: false };
  if (guard.error) return { ...none, failure: { reason: guard.error, next: 'Fix devops.rollbackGuard in agent.config.json.' } };
  if (cli.releaseLock !== undefined && !guard.enabled) {
    return {
      ...none,
      failure: {
        reason: '--release-lock requires devops.rollbackGuard to be enabled for this environment',
        next: 'Enable devops.rollbackGuard or drop --release-lock.',
      },
    };
  }
  if (!guard.enabled) return none;

  const git = createGitRunner({ repoRoot, cwd: repoRoot });
  if (cli.releaseLock !== undefined) {
    const released = releaseLockManually({ git, guard, lockSha: cli.releaseLock });
    return { ...none, lines: released.lines, released: released.ok, failure: released.ok ? undefined : fail(released) };
  }
  if (!String(rawCommand).includes('{source_args}')) {
    return {
      ...none,
      failure: {
        reason: 'devops.rollbackGuard requires the ship command to declare {source_args} so the pinned commit is what gets deployed',
        next: 'Add {source_args} to devops.commands.ship and accept --sha=<40-hex> in the deploy script, or disable devops.rollbackGuard.',
      },
    };
  }
  const readDeployed = guard.readDeployedCommand
    ? () => runReadDeployedCommand(guard.readDeployedCommand, { cwd: repoRoot, env: commandEnvFor() })
    : undefined;
  const guarded = prepareGuardedShip({
    git,
    guard,
    baseBranch: config.baseBranch || 'main',
    sha: cli.sha,
    source: cli.source,
    allowRollback: process.env.DEPLOY_ALLOW_ROLLBACK === '1',
    dryRun,
    readDeployed,
    now: now(),
  });
  if (!guarded.ok) return { ...none, lines: guarded.lines, failure: fail(guarded) };
  return {
    lines: guarded.lines,
    guarded,
    summary: {
      scope: guard.scope,
      target_sha: guarded.targetSha,
      deployed_sha: guarded.deployedSha,
      verdict: guarded.verdict,
      rollback_override: guarded.override,
    },
    execute: (run) => {
      if (dryRun) return null;
      const executed = executeGuardedShip({ git, guard, prepared: guarded, readDeployed, now: now(), execute: run });
      return { lines: executed.lines, failure: executed.ok ? undefined : fail(executed) };
    },
  };
}

module.exports = { prepareShipGuard };

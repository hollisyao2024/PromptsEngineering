/**
 * Wires the deploy guard (deploy-guard.js) into the /ship and /cd stable
 * entries so ops-run.js only maps the outcome onto its STATUS/block protocol.
 */

const {
  createGitRunner,
  executeGuardedShip,
  prepareGuardedShip,
  releaseLockManually,
  resolveGuardConfig,
  runReadDeployedCommand,
} = require('./deploy-guard');

const GUARDED_ACTIONS = new Set(['ship', 'cd']);
// Termination signals a terminal or supervisor sends while the lease is held.
// SIGKILL and power loss cannot be caught; those still need --release-lock.
const DEFERRED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

// Keeps a termination signal from killing the process while it holds the
// deploy lease. The deploy runs synchronously, so the listener only fires once
// the guarded run has finished: the deploy child (which gets the terminal's
// SIGINT itself) decides the outcome, the lock is released on every path, and
// the deferred signal is reported without overriding that outcome.
function deferTerminationSignals(proc = process, write = (line) => console.error(line)) {
  const listeners = DEFERRED_SIGNALS.map((signal) => {
    const listener = () => write(`DEPLOY_SIGNAL_DEFERRED=${signal}`);
    proc.on(signal, listener);
    return [signal, listener];
  });
  return () => {
    for (const [signal, listener] of listeners) proc.removeListener(signal, listener);
  };
}

function fail(result) {
  return { reason: result.reason, next: result.next, code: result.code };
}

// Returns { lines, failure?, released?, guarded?, summary?, execute(run) }.
// `execute(run)` runs the deploy under the lease when guarded and returns
// { lines, failure? }; it returns null when the guard does not apply.
function prepareShipGuard({ config, cli, action, env, target, rawCommand, repoRoot, dryRun, commandEnvFor, now = Date.now }) {
  const none = { lines: [], execute: () => null };
  const guard = GUARDED_ACTIONS.has(action) ? resolveGuardConfig(config, env, target, action) : { enabled: false };
  if (guard.error) return { ...none, failure: { reason: guard.error, next: 'Fix ops.rollbackGuard in agent.config.json.' } };
  if (cli.releaseLock !== undefined && !guard.enabled) {
    return {
      ...none,
      failure: {
        reason: '--release-lock requires ops.rollbackGuard to be enabled for this environment',
        next: 'Enable ops.rollbackGuard or drop --release-lock.',
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
        reason: `ops.rollbackGuard requires the ${action} command to declare {source_args} so the pinned commit is what gets deployed`,
        next: `Add {source_args} to ops.commands.${action} and accept --sha=<40-hex> in the deploy script, or disable ops.rollbackGuard.`,
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
      // Listeners stay installed for the rest of the process: removing them
      // before a pending signal is dispatched would restore the default
      // action and kill the process after the lock was handled.
      deferTerminationSignals();
      const executed = executeGuardedShip({ git, guard, prepared: guarded, readDeployed, now: now(), execute: run });
      // Signal handles are unref'd, so without a pending callback the event
      // loop would exit before dispatching a signal caught during the deploy.
      setImmediate(() => {});
      return { lines: executed.lines, failure: executed.ok ? undefined : fail(executed) };
    },
  };
}

module.exports = { deferTerminationSignals, prepareShipGuard };

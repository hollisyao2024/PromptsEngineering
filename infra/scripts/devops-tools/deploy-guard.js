/**
 * Cross-machine rollback guard and deploy lease for the /ship stable entry.
 *
 * Coordination lives in custom refs on the project remote, independent of the
 * project's deployment implementation:
 *   refs/xirang/deploy/<scope>       last commit successfully deployed
 *   refs/xirang/deploy-lock/<scope>  lease: a parentless commit whose message
 *                                    is JSON holder metadata
 * Every write is a `git push --force-with-lease=<ref>:<expected>`, so the
 * remote performs an atomic compare-and-swap. Remote reads and lease pushes
 * retry with bounded backoff (remoteRetryDelaysMs); a push is re-sent only
 * while ls-remote shows the ref unchanged or unreadable, so the lease keeps a
 * retry from applying twice. Unreadable state fails closed.
 */

const { spawnSync } = require('child_process');
const {
  DEFAULT_RETRY_DELAYS_MS,
  FULL_SHA,
  classifyDeployment,
  createGitRunner,
  createLockCommit,
  fetchSnapshot,
  lastLine,
  parsePushPorcelain,
  pushWithLease,
  resolveTarget,
} = require('./deploy-guard-git');

const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SCOPE_TOKEN = /^[a-z0-9]+$/;
const ENV_NAMES = { prod: 'production', production: 'production', stage: 'staging', staging: 'staging', dev: 'dev', development: 'dev' };
const DEFAULT_ENVIRONMENTS = ['staging', 'production'];
const DEFAULT_TTL_SECONDS = 3600;
const MAX_RETRY_ATTEMPTS = 10;
const MAX_RETRY_DELAY_MS = 60_000;
const VERDICT_SEVERITY = { NO_BASELINE: 0, PASS: 1, ROLLBACK: 2, DIVERGED: 3, UNKNOWN: 4, UNREADABLE: 5 };

function resolveGuardConfig(config, env, target = '') {
  const raw = (config && config.devops && config.devops.rollbackGuard) || {};
  if (raw.enabled !== true) return { enabled: false };
  const environments = (Array.isArray(raw.environments) ? raw.environments : DEFAULT_ENVIRONMENTS)
    .map((name) => ENV_NAMES[String(name).toLowerCase()] || String(name).toLowerCase());
  if (!environments.includes(env)) return { enabled: false };

  const remote = raw.remote === undefined || raw.remote === '' ? 'origin' : raw.remote;
  if (typeof remote !== 'string' || !REMOTE_NAME.test(remote)) {
    return { enabled: true, error: `devops.rollbackGuard.remote must be a plain git remote name, got ${JSON.stringify(remote)}` };
  }
  const lockTtlSeconds = raw.lockTtlSeconds === undefined ? DEFAULT_TTL_SECONDS : raw.lockTtlSeconds;
  if (!Number.isInteger(lockTtlSeconds) || lockTtlSeconds <= 0) {
    return { enabled: true, error: 'devops.rollbackGuard.lockTtlSeconds must be a positive integer' };
  }
  const delaysMs = raw.remoteRetryDelaysMs === undefined ? DEFAULT_RETRY_DELAYS_MS : raw.remoteRetryDelaysMs;
  if (
    !Array.isArray(delaysMs)
    || delaysMs.length > MAX_RETRY_ATTEMPTS
    || !delaysMs.every((ms) => Number.isInteger(ms) && ms >= 0 && ms <= MAX_RETRY_DELAY_MS)
  ) {
    return { enabled: true, error: `devops.rollbackGuard.remoteRetryDelaysMs must be at most ${MAX_RETRY_ATTEMPTS} integers between 0 and ${MAX_RETRY_DELAY_MS}` };
  }
  const profile = target && target !== 'default' ? target : '';
  if (!SCOPE_TOKEN.test(env) || (profile && !SCOPE_TOKEN.test(profile))) {
    return { enabled: true, error: `deploy scope must match [a-z0-9]+, got env=${env} target=${profile}` };
  }
  const scope = profile ? `${profile}-${env}` : env;
  let readDeployedCommand = raw.readDeployedCommand || '';
  if (readDeployedCommand && typeof readDeployedCommand === 'object') {
    readDeployedCommand = readDeployedCommand[scope] || readDeployedCommand[env] || '';
  }
  if (typeof readDeployedCommand !== 'string') {
    return { enabled: true, error: 'devops.rollbackGuard.readDeployedCommand must be a string or an object keyed by env' };
  }
  return {
    enabled: true,
    env,
    scope,
    remote,
    lockTtlSeconds,
    readDeployedCommand,
    retry: { delaysMs: [...delaysMs] },
    deployRef: `refs/xirang/deploy/${scope}`,
    lockRef: `refs/xirang/deploy-lock/${scope}`,
    releaseCommand: profile ? `pnpm agent -- ${profile} ship ${env}` : `pnpm agent -- ship ${env}`,
  };
}

// The ref and the optional live reading are both judged; the more severe wins.
function evaluate(git, refSha, live, targetSha, lines) {
  let verdict = classifyDeployment(git, refSha, targetSha);
  if (live) {
    if (!live.ok) return { verdict: 'UNREADABLE', error: `readDeployedCommand failed: ${live.error}` };
    lines.push(`DEPLOYED_LIVE_SHA=${live.sha || 'none'}`);
    if (live.sha && live.sha !== refSha) lines.push(`DEPLOYED_STATE_DRIFT=ref:${refSha || 'none'}|live:${live.sha}`);
    const liveVerdict = classifyDeployment(git, live.sha, targetSha);
    if (VERDICT_SEVERITY[liveVerdict] > VERDICT_SEVERITY[verdict]) verdict = liveVerdict;
  }
  return { verdict };
}

function verdictFailure(verdict, guard, targetSha, error) {
  if (verdict === 'ROLLBACK') {
    return {
      overridable: true,
      code: 'DEPLOY_ROLLBACK_BLOCKED',
      reason: `target ${targetSha} is older than the deployed ${guard.scope} commit`,
      next: 'Deploy a commit that contains the deployed one, or rerun with DEPLOY_ALLOW_ROLLBACK=1 for an intentional rollback.',
    };
  }
  if (verdict === 'DIVERGED') {
    return {
      overridable: true,
      code: 'DEPLOY_DIVERGED',
      reason: `target ${targetSha} has diverged from the deployed ${guard.scope} commit`,
      next: 'Merge the deployed commit into the target first, or rerun with DEPLOY_ALLOW_ROLLBACK=1 to replace it deliberately.',
    };
  }
  if (verdict === 'UNKNOWN') {
    return {
      overridable: false,
      code: 'DEPLOY_STATE_UNKNOWN',
      reason: 'the deployed commit is not available locally, so ancestry cannot be checked',
      next: `Fetch the deployed commit from ${guard.remote} and retry; DEPLOY_ALLOW_ROLLBACK does not apply.`,
    };
  }
  if (verdict === 'UNREADABLE') {
    return {
      overridable: false,
      code: 'DEPLOY_STATE_UNREADABLE',
      reason: error || 'deployment state cannot be read',
      next: `Restore access to ${guard.remote} and the deployed-state reader, then retry; the guard fails closed.`,
    };
  }
  return null;
}

function failure(code, reason, next, lines, extra = {}) {
  return { ok: false, code, reason, next, lines, ...extra };
}

function manualReleaseLine(guard, lockSha) {
  return `MANUAL_RELEASE_COMMAND=${guard.releaseCommand} --release-lock=${lockSha}`;
}

function describeLock(git, guard, lockSha, now) {
  const lines = ['DEPLOY_LOCK=HELD', `DEPLOY_LOCK_SHA=${lockSha}`];
  let meta = null;
  try {
    meta = JSON.parse(git(['log', '-1', '--format=%B', lockSha]).stdout.trim());
  } catch {
    meta = null;
  }
  if (meta && typeof meta === 'object') {
    lines.push(`DEPLOY_LOCK_HOLDER=${meta.user || '?'}@${meta.host || '?'} pid=${meta.pid || '?'} since=${meta.createdAt || '?'} target=${meta.targetSha || '?'}`);
    const created = Date.parse(meta.createdAt);
    const ttl = Number.isInteger(meta.ttlSeconds) && meta.ttlSeconds > 0 ? meta.ttlSeconds : guard.lockTtlSeconds;
    if (Number.isFinite(created) && now - created > ttl * 1000) lines.push('LOCK_STALE=1');
  } else {
    lines.push('DEPLOY_LOCK_HOLDER=unknown');
  }
  lines.push(manualReleaseLine(guard, lockSha));
  return lines;
}

function releaseLock(git, guard, lockSha) {
  const released = pushWithLease(git, { remote: guard.remote, ref: guard.lockRef, newSha: '', expected: lockSha, retry: guard.retry });
  if (released.result === 'ok') return { ok: true, lines: ['DEPLOY_LOCK_RELEASE=OK'] };
  return {
    ok: false,
    lines: ['DEPLOY_LOCK_RELEASE=FAILED', `DEPLOY_LOCK_RELEASE_DETAIL=${released.detail || released.result}`, manualReleaseLine(guard, lockSha)],
  };
}

/**
 * Preflight: one snapshot, pin the target commit, judge it, refuse a held lock.
 * Read-only on the remote; dry-run stops here.
 */
function prepareGuardedShip({ git, guard, baseBranch, sha, source, allowRollback = false, dryRun = false, readDeployed, now = Date.now() }) {
  const lines = ['DEPLOY_GUARD=ENABLED', `DEPLOY_SCOPE=${guard.scope}`];
  const snapshot = fetchSnapshot(git, guard);
  if (!snapshot.ok) {
    lines.push('DEPLOY_VERDICT=UNREADABLE');
    const fail = verdictFailure('UNREADABLE', guard, '', snapshot.error);
    return failure(fail.code, fail.reason, fail.next, lines);
  }
  const target = resolveTarget(git, guard, { sha, source, baseBranch });
  if (target.error) {
    return failure('DEPLOY_TARGET_UNKNOWN', target.error, `Push or fetch the target commit so it exists locally (git fetch ${guard.remote}), then retry.`, lines);
  }
  lines.push(`DEPLOY_TARGET_SHA=${target.sha}`, `DEPLOYED_SHA=${snapshot.deployedSha || 'none'}`);
  const live = dryRun && readDeployed ? readDeployed() : null;
  const evaluation = evaluate(git, snapshot.deployedSha, live, target.sha, lines);
  lines.push(`DEPLOY_VERDICT=${evaluation.verdict}`);
  const fail = verdictFailure(evaluation.verdict, guard, target.sha, evaluation.error);
  if (fail && !(fail.overridable && allowRollback)) return failure(fail.code, fail.reason, fail.next, lines);
  const override = Boolean(fail);
  if (override) lines.push('DEPLOY_ROLLBACK_OVERRIDE=1');
  if (snapshot.lockSha) {
    lines.push(...describeLock(git, guard, snapshot.lockSha, now));
    return failure(
      'DEPLOY_LOCKED',
      `another ${guard.scope} deployment holds the lock`,
      'Wait for the holder to finish. Only if it crashed (see DEPLOY_LOCK_HOLDER / LOCK_STALE), release it with MANUAL_RELEASE_COMMAND.',
      lines,
    );
  }
  return {
    ok: true,
    lines,
    targetSha: target.sha,
    deployedSha: snapshot.deployedSha,
    verdict: evaluation.verdict,
    override,
    allowRollback,
  };
}

/**
 * Acquire the lease, re-judge under it, run the deploy, advance the deployed
 * ref with a lease on the in-lock value, then release the lease.
 */
function executeGuardedShip({ git, guard, prepared, execute, readDeployed, now = Date.now() }) {
  const lines = [];
  const targetSha = prepared.targetSha;
  const lock = createLockCommit(git, guard, targetSha, now);
  if (lock.error) return failure('DEPLOY_LOCK_UNAVAILABLE', `cannot create the lock commit: ${lock.error}`, 'Check the local git repository, then retry.', lines);

  const acquired = pushWithLease(git, { remote: guard.remote, ref: guard.lockRef, newSha: lock.sha, expected: '', retry: guard.retry });
  if (acquired.result === 'rejected') {
    lines.push('DEPLOY_LOCK=HELD');
    return failure('DEPLOY_LOCKED', `another ${guard.scope} deployment acquired the lock first`, 'Rerun the ship to see the holder, then wait for it to finish.', lines);
  }
  if (acquired.result !== 'ok') {
    lines.push('DEPLOY_LOCK=UNKNOWN', manualReleaseLine(guard, lock.sha));
    return failure('DEPLOY_LOCK_UNKNOWN', acquired.detail, 'Check the remote lock ref; if it holds this run\'s lock commit, release it with MANUAL_RELEASE_COMMAND before retrying.', lines);
  }
  lines.push('DEPLOY_LOCK=ACQUIRED', `DEPLOY_LOCK_SHA=${lock.sha}`);

  const releaseThenFail = (code, reason, next, extra = {}) => {
    lines.push(...releaseLock(git, guard, lock.sha).lines);
    return failure(code, reason, next, lines, extra);
  };

  const snapshot = fetchSnapshot(git, guard);
  if (!snapshot.ok) {
    lines.push('DEPLOY_VERDICT=UNREADABLE');
    const fail = verdictFailure('UNREADABLE', guard, targetSha, snapshot.error);
    return releaseThenFail(fail.code, fail.reason, fail.next);
  }
  if (snapshot.lockSha !== lock.sha) {
    lines.push(manualReleaseLine(guard, lock.sha));
    return failure('DEPLOY_LOCK_LOST', `the remote lock is ${snapshot.lockSha || 'absent'}, not this run's ${lock.sha}`, 'Do not deploy; inspect the lock ref and rerun the ship.', lines);
  }
  if (snapshot.deployedSha !== prepared.deployedSha) lines.push(`DEPLOYED_SHA=${snapshot.deployedSha || 'none'}`);
  const live = readDeployed ? readDeployed() : null;
  const evaluation = evaluate(git, snapshot.deployedSha, live, targetSha, lines);
  lines.push(`DEPLOY_VERDICT=${evaluation.verdict}`);
  const fail = verdictFailure(evaluation.verdict, guard, targetSha, evaluation.error);
  if (fail && !(fail.overridable && prepared.allowRollback)) return releaseThenFail(fail.code, fail.reason, fail.next);
  if (fail && !prepared.override) lines.push('DEPLOY_ROLLBACK_OVERRIDE=1');

  const exitStatus = execute(targetSha);
  if (exitStatus !== 0) {
    return releaseThenFail('DEPLOY_COMMAND_FAILED', `command exited with ${exitStatus}`, 'Inspect RUN_DIR and the command output, then fix configuration or target environment.', { exitStatus });
  }

  if (readDeployed) {
    const after = readDeployed();
    if (!after.ok || after.sha !== targetSha) {
      return releaseThenFail(
        'DEPLOYED_STATE_MISMATCH',
        `after deploy the live ${guard.scope} commit reads ${after.ok ? after.sha || 'none' : `unreadable (${after.error})`}, expected ${targetSha}`,
        'Verify the environment; the deployed ref was not advanced.',
      );
    }
  }

  const advanced = pushWithLease(git, { remote: guard.remote, ref: guard.deployRef, newSha: targetSha, expected: snapshot.deployedSha, retry: guard.retry });
  if (advanced.result === 'unknown') {
    lines.push('DEPLOY_REF_ADVANCE=UNKNOWN');
    return releaseThenFail(
      'DEPLOY_REF_ADVANCE_UNKNOWN',
      `the deploy succeeded but ${guard.deployRef} could not be advanced or confirmed (${advanced.detail})`,
      `The environment runs ${targetSha}. When ${guard.remote} is reachable, rerun ${guard.releaseCommand} --sha=${targetSha} to record it; until then the live-version check still blocks rollbacks.`,
    );
  }
  if (advanced.result !== 'ok') {
    lines.push('DEPLOY_REF_ADVANCE=FAILED');
    return releaseThenFail(
      'DEPLOY_REF_CAS_FAILED',
      `the deploy ran but ${guard.deployRef} changed under the lock (${advanced.detail || advanced.result})`,
      'Someone wrote the deployed ref outside the protocol; verify what is live and repair the ref deliberately.',
    );
  }
  lines.push('DEPLOY_REF_ADVANCE=OK');
  lines.push(...releaseLock(git, guard, lock.sha).lines);
  return { ok: true, lines };
}

function releaseLockManually({ git, guard, lockSha }) {
  const lines = ['DEPLOY_GUARD=ENABLED', `DEPLOY_SCOPE=${guard.scope}`];
  if (typeof lockSha !== 'string' || !FULL_SHA.test(lockSha)) {
    return failure('DEPLOY_LOCK_MISMATCH', '--release-lock must be the full 40-character lock commit SHA', 'Copy MANUAL_RELEASE_COMMAND from the blocked ship output.', lines);
  }
  const snapshot = fetchSnapshot(git, guard);
  if (!snapshot.ok) {
    const fail = verdictFailure('UNREADABLE', guard, '', snapshot.error);
    return failure(fail.code, fail.reason, fail.next, lines);
  }
  if (!snapshot.lockSha) {
    lines.push('DEPLOY_LOCK_RELEASE=ALREADY_RELEASED');
    return { ok: true, lines };
  }
  if (snapshot.lockSha !== lockSha) {
    return failure('DEPLOY_LOCK_MISMATCH', `the remote lock is ${snapshot.lockSha}, not ${lockSha}`, 'Rerun the ship to see the current holder before releasing anything.', lines);
  }
  const released = releaseLock(git, guard, lockSha);
  lines.push(...released.lines);
  if (!released.ok) return failure('DEPLOY_LOCK_RELEASE_FAILED', 'the lock could not be deleted', 'Retry when the remote is reachable.', lines);
  return { ok: true, lines };
}

function runReadDeployedCommand(command, { cwd, env }) {
  const result = spawnSync(command, { cwd, env, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (result.status !== 0) return { ok: false, error: `exit ${result.status === null ? result.signal || 'unknown' : result.status}` };
  const sha = lastLine(result.stdout);
  if (!sha) return { ok: true, sha: '' };
  return FULL_SHA.test(sha) ? { ok: true, sha } : { ok: false, error: 'last output line is not a 40-character lowercase SHA' };
}

module.exports = {
  classifyDeployment,
  createGitRunner,
  executeGuardedShip,
  fetchSnapshot,
  parsePushPorcelain,
  prepareGuardedShip,
  pushWithLease,
  releaseLockManually,
  resolveGuardConfig,
  runReadDeployedCommand,
};

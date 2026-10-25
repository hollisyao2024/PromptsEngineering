'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  classifyDeployment,
  createGitRunner,
  executeGuardedShip,
  parsePushPorcelain,
  prepareGuardedShip,
  pushWithLease,
  releaseLockManually,
  resolveGuardConfig,
} = require('../deploy-guard');

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};
delete GIT_ENV.GH_TOKEN;
delete GIT_ENV.GITHUB_TOKEN;

const DEPLOY_REF = 'refs/xirang/deploy/production';
const LOCK_REF = 'refs/xirang/deploy-lock/production';

function sh(cwd, args) {
  const result = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function commit(cwd, name) {
  fs.writeFileSync(path.join(cwd, `${name}.txt`), `${name}\n`);
  sh(cwd, ['add', '.']);
  sh(cwd, ['commit', '-q', '-m', name]);
  return sh(cwd, ['rev-parse', 'HEAD']);
}

// remote.git + two clones (machine A and B). main: c1 - c2 - c3, side: c1 - d1.
function setupFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-guard-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  sh(root, ['init', '-q', '--bare', '-b', 'main', remote]);
  const a = path.join(root, 'a');
  sh(root, ['clone', '-q', remote, a]);
  sh(a, ['checkout', '-q', '-b', 'main']);
  const c1 = commit(a, 'c1');
  const c2 = commit(a, 'c2');
  const c3 = commit(a, 'c3');
  sh(a, ['push', '-q', 'origin', 'main']);
  sh(a, ['checkout', '-q', '-b', 'side', c1]);
  const d1 = commit(a, 'd1');
  sh(a, ['push', '-q', 'origin', 'side']);
  sh(a, ['checkout', '-q', 'main']);
  const b = path.join(root, 'b');
  sh(root, ['clone', '-q', remote, b]);
  return { root, remote, a, b, c1, c2, c3, d1 };
}

function guardFor(overrides = {}) {
  return {
    enabled: true,
    env: 'production',
    scope: 'production',
    remote: 'origin',
    lockTtlSeconds: 3600,
    deployRef: DEPLOY_REF,
    lockRef: LOCK_REF,
    releaseCommand: 'pnpm agent -- ship production',
    retry: { delaysMs: [0, 0, 0], sleep: () => {} },
    ...overrides,
  };
}

function gitIn(cwd, wrap) {
  const git = createGitRunner({ repoRoot: cwd, cwd, env: GIT_ENV });
  return wrap ? wrap(git) : git;
}

function remoteRef(remote, ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', '-q', ref], { cwd: remote, env: GIT_ENV, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function deployOk(git, guard, options = {}) {
  const prepared = prepareGuardedShip({ git, guard, baseBranch: 'main', now: Date.now(), ...options });
  assert.equal(prepared.ok, true, prepared.reason);
  const executed = executeGuardedShip({ git, guard, prepared, execute: () => 0, now: Date.now() });
  assert.equal(executed.ok, true, executed.reason);
  return { prepared, executed };
}

test('resolveGuardConfig is opt-in and scoped by env and profile', () => {
  assert.equal(resolveGuardConfig({ ops: {} }, 'production', '').enabled, false);
  const ops = { rollbackGuard: { enabled: true, environments: ['staging', 'production'], remote: 'origin', lockTtlSeconds: 60 } };
  assert.equal(resolveGuardConfig({ ops }, 'dev', '').enabled, false);
  const prod = resolveGuardConfig({ ops }, 'production', '');
  assert.equal(prod.enabled, true);
  assert.equal(prod.deployRef, 'refs/xirang/deploy/production');
  assert.equal(prod.lockRef, 'refs/xirang/deploy-lock/production');
  assert.equal(prod.releaseCommand, 'pnpm agent -- ship production');
  const priv = resolveGuardConfig({ ops }, 'staging', 'private');
  assert.equal(priv.scope, 'private-staging');
  assert.equal(priv.releaseCommand, 'pnpm agent -- private ship staging');
  assert.match(resolveGuardConfig({ ops: { rollbackGuard: { enabled: true, environments: ['production'], remote: '-x' } } }, 'production', '').error, /remote/);
  assert.match(resolveGuardConfig({ ops: { rollbackGuard: { enabled: true, environments: ['production'], remote: 'origin', lockTtlSeconds: 0 } } }, 'production', '').error, /lockTtlSeconds/);
});

test('resolveGuardConfig defaults and validates remoteRetryDelaysMs', () => {
  const base = { enabled: true, environments: ['production'] };
  assert.deepEqual(resolveGuardConfig({ ops: { rollbackGuard: base } }, 'production', '').retry.delaysMs, [2000, 5000, 10000, 20000, 30000]);
  assert.deepEqual(resolveGuardConfig({ ops: { rollbackGuard: { ...base, remoteRetryDelaysMs: [] } } }, 'production', '').retry.delaysMs, []);
  assert.deepEqual(resolveGuardConfig({ ops: { rollbackGuard: { ...base, remoteRetryDelaysMs: [5, 10] } } }, 'production', '').retry.delaysMs, [5, 10]);
  for (const bad of [5, [-1], [1.5], ['1'], new Array(11).fill(1)]) {
    assert.match(resolveGuardConfig({ ops: { rollbackGuard: { ...base, remoteRetryDelaysMs: bad } } }, 'production', '').error, /remoteRetryDelaysMs/);
  }
});

test('parsePushPorcelain distinguishes ok, rejected and unknown', () => {
  const out = `To /x\n*\t0000:${LOCK_REF}\t[new reference]\nDone\n`;
  assert.equal(parsePushPorcelain(out, LOCK_REF), 'ok');
  assert.equal(parsePushPorcelain(`To /x\n!\t0000:${LOCK_REF}\t[rejected] (stale info)\nDone\n`, LOCK_REF), 'rejected');
  assert.equal(parsePushPorcelain(`To /x\n-\t:${LOCK_REF}\t[deleted]\nDone\n`, LOCK_REF), 'ok');
  assert.equal(parsePushPorcelain('', LOCK_REF), 'unknown');
});

test('force-with-lease on custom refs is an atomic create/advance/delete CAS against a real bare repo', (t) => {
  const fx = setupFixture(t);
  const git = gitIn(fx.a);
  assert.equal(pushWithLease(git, { remote: 'origin', ref: DEPLOY_REF, newSha: fx.c1, expected: '' }).result, 'ok');
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), fx.c1);
  // Creating again with an "expect absent" lease is rejected.
  assert.equal(pushWithLease(git, { remote: 'origin', ref: DEPLOY_REF, newSha: fx.c2, expected: '' }).result, 'rejected');
  // Advancing with a stale expected value is rejected, the right one succeeds.
  assert.equal(pushWithLease(git, { remote: 'origin', ref: DEPLOY_REF, newSha: fx.c3, expected: fx.c2 }).result, 'rejected');
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), fx.c1);
  assert.equal(pushWithLease(git, { remote: 'origin', ref: DEPLOY_REF, newSha: fx.c3, expected: fx.c1 }).result, 'ok');
  // Delete only with the current value.
  assert.equal(pushWithLease(git, { remote: 'origin', ref: DEPLOY_REF, newSha: '', expected: fx.c1 }).result, 'rejected');
  assert.equal(pushWithLease(git, { remote: 'origin', ref: DEPLOY_REF, newSha: '', expected: fx.c3 }).result, 'ok');
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), '');
});

test('classifyDeployment covers every verdict', (t) => {
  const fx = setupFixture(t);
  const git = gitIn(fx.a);
  assert.equal(classifyDeployment(git, '', fx.c2), 'NO_BASELINE');
  assert.equal(classifyDeployment(git, fx.c2, fx.c2), 'PASS');
  assert.equal(classifyDeployment(git, fx.c1, fx.c3), 'PASS');
  assert.equal(classifyDeployment(git, fx.c3, fx.c1), 'ROLLBACK');
  assert.equal(classifyDeployment(git, fx.c3, fx.d1), 'DIVERGED');
  assert.equal(classifyDeployment(git, 'f'.repeat(40), fx.c3), 'UNKNOWN');
});

test('first deploy records the target under the lock and releases it', (t) => {
  const fx = setupFixture(t);
  const git = gitIn(fx.a);
  const guard = guardFor();
  const { prepared, executed } = deployOk(git, guard);
  assert.equal(prepared.verdict, 'NO_BASELINE');
  assert.equal(prepared.targetSha, fx.c3);
  assert.ok(executed.lines.includes('DEPLOY_LOCK=ACQUIRED'));
  assert.ok(executed.lines.includes('DEPLOY_REF_ADVANCE=OK'));
  assert.ok(executed.lines.includes('DEPLOY_LOCK_RELEASE=OK'));
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), fx.c3);
  assert.equal(remoteRef(fx.remote, LOCK_REF), '');
});

test('another machine deploying an older commit is blocked as ROLLBACK unless overridden', (t) => {
  const fx = setupFixture(t);
  const guard = guardFor();
  deployOk(gitIn(fx.a), guard);
  const gitB = gitIn(fx.b);
  const blocked = prepareGuardedShip({ git: gitB, guard, baseBranch: 'main', sha: fx.c2, now: Date.now() });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'DEPLOY_ROLLBACK_BLOCKED');
  assert.ok(blocked.lines.includes('DEPLOY_VERDICT=ROLLBACK'));

  const { prepared } = deployOk(gitB, guard, { sha: fx.c2, allowRollback: true });
  assert.equal(prepared.override, true);
  assert.ok(prepared.lines.includes('DEPLOY_ROLLBACK_OVERRIDE=1'));
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), fx.c2);
});

test('a diverged target is blocked, and a newer descendant passes', (t) => {
  const fx = setupFixture(t);
  const guard = guardFor();
  deployOk(gitIn(fx.a), guard, { sha: fx.c2 });
  const gitB = gitIn(fx.b);
  const diverged = prepareGuardedShip({ git: gitB, guard, baseBranch: 'main', source: 'side', now: Date.now() });
  assert.equal(diverged.ok, false);
  assert.equal(diverged.code, 'DEPLOY_DIVERGED');
  const newer = prepareGuardedShip({ git: gitB, guard, baseBranch: 'main', now: Date.now() });
  assert.equal(newer.ok, true);
  assert.equal(newer.verdict, 'PASS');
  assert.equal(newer.targetSha, fx.c3);
});

test('an unknown target or unreachable remote fails closed', (t) => {
  const fx = setupFixture(t);
  const guard = guardFor();
  const git = gitIn(fx.a);
  const unknown = prepareGuardedShip({ git, guard, baseBranch: 'main', sha: 'e'.repeat(40), now: Date.now() });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'DEPLOY_TARGET_UNKNOWN');

  sh(fx.a, ['remote', 'set-url', 'origin', path.join(fx.root, 'missing.git')]);
  const unreadable = prepareGuardedShip({ git, guard, baseBranch: 'main', now: Date.now() });
  assert.equal(unreadable.ok, false);
  assert.equal(unreadable.code, 'DEPLOY_STATE_UNREADABLE');
  assert.ok(unreadable.lines.includes('DEPLOY_VERDICT=UNREADABLE'));
});

test('a shallow clone cannot prove ancestry and fails closed', (t) => {
  const fx = setupFixture(t);
  const shallow = path.join(fx.root, 'shallow');
  sh(fx.root, ['clone', '-q', '--depth', '1', `file://${fx.remote}`, shallow]);
  const result = prepareGuardedShip({ git: gitIn(shallow), guard: guardFor(), baseBranch: 'main', now: Date.now() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DEPLOY_STATE_UNREADABLE');
});

test('a held lock blocks with holder details and is flagged stale after its TTL', (t) => {
  const fx = setupFixture(t);
  const guard = guardFor({ lockTtlSeconds: 60 });
  const gitA = gitIn(fx.a);
  const preparedA = prepareGuardedShip({ git: gitA, guard, baseBranch: 'main', now: Date.now() });
  let blockedB;
  let staleB;
  const executedA = executeGuardedShip({
    git: gitA,
    guard,
    prepared: preparedA,
    now: Date.now(),
    execute: () => {
      const gitB = gitIn(fx.b);
      blockedB = prepareGuardedShip({ git: gitB, guard, baseBranch: 'main', now: Date.now() });
      staleB = prepareGuardedShip({ git: gitB, guard, baseBranch: 'main', now: Date.now() + 120_000 });
      return 0;
    },
  });
  assert.equal(executedA.ok, true, executedA.reason);
  assert.equal(blockedB.ok, false);
  assert.equal(blockedB.code, 'DEPLOY_LOCKED');
  assert.ok(blockedB.lines.some((line) => line.startsWith('DEPLOY_LOCK_HOLDER=')));
  assert.ok(blockedB.lines.some((line) => /^MANUAL_RELEASE_COMMAND=pnpm agent -- ship production --release-lock=[0-9a-f]{40}$/.test(line)));
  assert.ok(!blockedB.lines.includes('LOCK_STALE=1'));
  assert.ok(staleB.lines.includes('LOCK_STALE=1'));
  assert.equal(remoteRef(fx.remote, LOCK_REF), '');
});

test('losing the lock race after a clean preflight blocks without deploying', (t) => {
  const fx = setupFixture(t);
  const guard = guardFor();
  const gitA = gitIn(fx.a);
  const gitB = gitIn(fx.b);
  const preparedA = prepareGuardedShip({ git: gitA, guard, baseBranch: 'main', now: Date.now() });
  const preparedB = prepareGuardedShip({ git: gitB, guard, baseBranch: 'main', now: Date.now() });
  let ranB = false;
  const executedA = executeGuardedShip({
    git: gitA,
    guard,
    prepared: preparedA,
    now: Date.now(),
    execute: () => {
      const executedB = executeGuardedShip({ git: gitB, guard, prepared: preparedB, now: Date.now(), execute: () => { ranB = true; return 0; } });
      assert.equal(executedB.ok, false);
      assert.equal(executedB.code, 'DEPLOY_LOCKED');
      return 0;
    },
  });
  assert.equal(executedA.ok, true, executedA.reason);
  assert.equal(ranB, false);
});

test('a deployed-ref change behind the lock fails the CAS and still releases the lock', (t) => {
  const fx = setupFixture(t);
  const guard = guardFor();
  const gitA = gitIn(fx.a);
  const prepared = prepareGuardedShip({ git: gitA, guard, baseBranch: 'main', now: Date.now() });
  const executed = executeGuardedShip({
    git: gitA,
    guard,
    prepared,
    now: Date.now(),
    execute: () => {
      // A rogue writer bypassing the protocol moves the deployed ref mid-deploy.
      sh(fx.b, ['push', '-q', 'origin', `${fx.c1}:${DEPLOY_REF}`]);
      return 0;
    },
  });
  assert.equal(executed.ok, false);
  assert.equal(executed.code, 'DEPLOY_REF_CAS_FAILED');
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), fx.c1);
  assert.equal(remoteRef(fx.remote, LOCK_REF), '');
});

test('a failed deploy command only releases the lock', (t) => {
  const fx = setupFixture(t);
  const guard = guardFor();
  const git = gitIn(fx.a);
  const prepared = prepareGuardedShip({ git, guard, baseBranch: 'main', now: Date.now() });
  const executed = executeGuardedShip({ git, guard, prepared, now: Date.now(), execute: () => 3 });
  assert.equal(executed.ok, false);
  assert.equal(executed.code, 'DEPLOY_COMMAND_FAILED');
  assert.equal(executed.exitStatus, 3);
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), '');
  assert.equal(remoteRef(fx.remote, LOCK_REF), '');
});

test('an unknown push result is verified against the remote instead of replayed', (t) => {
  const fx = setupFixture(t);
  const guard = guardFor();
  // Every lease push really happens but reports no porcelain line (e.g. a dropped connection).
  const git = gitIn(fx.a, (inner) => (args, options) => {
    const result = inner(args, options);
    return args[0] === 'push' ? { ...result, status: 128, stdout: '' } : result;
  });
  const prepared = prepareGuardedShip({ git, guard, baseBranch: 'main', now: Date.now() });
  const executed = executeGuardedShip({ git, guard, prepared, now: Date.now(), execute: () => 0 });
  assert.equal(executed.ok, true, executed.reason);
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), fx.c3);
  assert.equal(remoteRef(fx.remote, LOCK_REF), '');
});

test('a lock release that cannot be confirmed reports the manual command but keeps the deploy OK', (t) => {
  const fx = setupFixture(t);
  const guard = guardFor();
  const git = gitIn(fx.a, (inner) => (args, options) => {
    const deleting = args[0] === 'push' && args.some((arg) => arg === `:${LOCK_REF}`);
    if (deleting) return { status: 128, stdout: '', stderr: 'network down' };
    if (args[0] === 'ls-remote' && args.includes(LOCK_REF)) return { status: 128, stdout: '', stderr: 'network down' };
    return inner(args, options);
  });
  const prepared = prepareGuardedShip({ git, guard, baseBranch: 'main', now: Date.now() });
  const executed = executeGuardedShip({ git, guard, prepared, now: Date.now(), execute: () => 0 });
  assert.equal(executed.ok, true, executed.reason);
  assert.ok(executed.lines.includes('DEPLOY_LOCK_RELEASE=FAILED'));
  assert.ok(executed.lines.some((line) => line.startsWith('MANUAL_RELEASE_COMMAND=pnpm agent -- ship production --release-lock=')));
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), fx.c3);
});

// Fails the first `times` calls matching `match` with a TLS-style error, like the flaky local proxy.
function flaky(times, match) {
  let left = times;
  return (inner) => (args, options) => {
    if (left > 0 && match(args)) {
      left -= 1;
      return { status: 128, stdout: '', stderr: 'fatal: unable to access: LibreSSL SSL_connect: SSL_ERROR_SYSCALL' };
    }
    return inner(args, options);
  };
}

function counting(counter, match) {
  return (inner) => (args, options) => {
    if (match(args)) counter.count += 1;
    return inner(args, options);
  };
}

const pushTo = (ref) => (args) => args[0] === 'push' && args.some((arg) => arg.endsWith(`:${ref}`));
const lsRemoteOf = (ref) => (args) => args[0] === 'ls-remote' && args.includes(ref);

test('a push that never reached the remote is retried under the same lease until it lands', (t) => {
  const fx = setupFixture(t);
  // push fails, the verifying ls-remote fails too, then everything recovers.
  const pushFlaky = flaky(1, pushTo(DEPLOY_REF));
  const lsFlaky = flaky(1, lsRemoteOf(DEPLOY_REF));
  const git = gitIn(fx.a, (inner) => pushFlaky(lsFlaky(inner)));
  const result = pushWithLease(git, { remote: 'origin', ref: DEPLOY_REF, newSha: fx.c2, expected: '', retry: guardFor().retry });
  assert.equal(result.result, 'ok', result.detail);
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), fx.c2);
});

test('a push that landed but could not be confirmed is verified, not pushed again', (t) => {
  const fx = setupFixture(t);
  const pushes = { count: 0 };
  // The push lands but its report is lost, and the remote is briefly unreadable.
  const lsFlaky = flaky(2, lsRemoteOf(DEPLOY_REF));
  const git = gitIn(fx.a, (inner) => counting(pushes, pushTo(DEPLOY_REF))(lsFlaky((args, options) => {
    const result = inner(args, options);
    return args[0] === 'push' ? { ...result, status: 128, stdout: '' } : result;
  })));
  const result = pushWithLease(git, { remote: 'origin', ref: DEPLOY_REF, newSha: fx.c2, expected: '', retry: guardFor().retry });
  assert.equal(result.result, 'ok', result.detail);
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), fx.c2);
  // The retry after the unreadable checks is rejected by the lease and then verified as already applied.
  assert.ok(pushes.count <= 3, `pushed ${pushes.count} times`);
});

test('a retried push whose lease no longer matches reports rejected', (t) => {
  const fx = setupFixture(t);
  sh(fx.b, ['push', '-q', 'origin', `${fx.c1}:${DEPLOY_REF}`]);
  const git = gitIn(fx.a, flaky(1, pushTo(DEPLOY_REF)));
  const result = pushWithLease(git, { remote: 'origin', ref: DEPLOY_REF, newSha: fx.c3, expected: '', retry: guardFor().retry });
  assert.equal(result.result, 'rejected');
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), fx.c1);
});

test('retries are bounded and wait the configured delays', (t) => {
  const fx = setupFixture(t);
  const waits = [];
  const down = () => ({ status: 128, stdout: '', stderr: 'network down' });
  const git = gitIn(fx.a, (inner) => (args, options) => (args[0] === 'push' || args[0] === 'ls-remote' ? down() : inner(args, options)));
  const result = pushWithLease(git, { remote: 'origin', ref: DEPLOY_REF, newSha: fx.c2, expected: '', retry: { delaysMs: [7, 11], sleep: (ms) => waits.push(ms) } });
  assert.equal(result.result, 'unknown');
  assert.deepEqual(waits, [7, 11]);
  assert.match(result.detail, /unreadable/);
});

test('a transient network failure while advancing the deployed ref is retried and the deploy completes', (t) => {
  const fx = setupFixture(t);
  const guard = guardFor();
  // Reproduces the 2026-10-18 staging run: the advance push and its ls-remote check both hit SSL_ERROR_SYSCALL.
  const pushFlaky = flaky(1, pushTo(DEPLOY_REF));
  const lsFlaky = flaky(1, lsRemoteOf(DEPLOY_REF));
  const git = gitIn(fx.a, (inner) => pushFlaky(lsFlaky(inner)));
  const prepared = prepareGuardedShip({ git, guard, baseBranch: 'main', now: Date.now() });
  const executed = executeGuardedShip({ git, guard, prepared, now: Date.now(), execute: () => 0 });
  assert.equal(executed.ok, true, executed.reason);
  assert.ok(executed.lines.includes('DEPLOY_REF_ADVANCE=OK'));
  assert.ok(executed.lines.includes('DEPLOY_LOCK_RELEASE=OK'));
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), fx.c3);
  assert.equal(remoteRef(fx.remote, LOCK_REF), '');
});

test('a deployed-ref advance that stays unknown gets its own code and a rerun command, and releases the lock', (t) => {
  const fx = setupFixture(t);
  const guard = guardFor();
  const down = () => ({ status: 128, stdout: '', stderr: 'network down' });
  const git = gitIn(fx.a, (inner) => (args, options) => (pushTo(DEPLOY_REF)(args) || lsRemoteOf(DEPLOY_REF)(args) ? down() : inner(args, options)));
  const prepared = prepareGuardedShip({ git, guard, baseBranch: 'main', now: Date.now() });
  const executed = executeGuardedShip({ git, guard, prepared, now: Date.now(), execute: () => 0 });
  assert.equal(executed.ok, false);
  assert.equal(executed.code, 'DEPLOY_REF_ADVANCE_UNKNOWN');
  assert.ok(executed.lines.includes('DEPLOY_REF_ADVANCE=UNKNOWN'));
  assert.ok(executed.lines.includes('DEPLOY_LOCK_RELEASE=OK'));
  assert.ok(executed.next.includes(`pnpm agent -- ship production --sha=${fx.c3}`), executed.next);
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), '');
  assert.equal(remoteRef(fx.remote, LOCK_REF), '');
});

test('a transient fetch failure in the snapshot is retried', (t) => {
  const fx = setupFixture(t);
  const git = gitIn(fx.a, flaky(2, (args) => args[0] === 'fetch'));
  const prepared = prepareGuardedShip({ git, guard: guardFor(), baseBranch: 'main', now: Date.now() });
  assert.equal(prepared.ok, true, prepared.reason);
  assert.equal(prepared.targetSha, fx.c3);
});

test('readDeployed cross-checks the live version and blocks on drift, failure or mismatch', (t) => {
  const fx = setupFixture(t);
  const guard = guardFor();
  const git = gitIn(fx.a);
  deployOk(git, guard, { sha: fx.c2 });

  // Live says c3 although the ref says c2: deploying c2 again would be a rollback of the live system.
  const drift = prepareGuardedShip({ git, guard, baseBranch: 'main', sha: fx.c2, dryRun: true, readDeployed: () => ({ ok: true, sha: fx.c3 }), now: Date.now() });
  assert.equal(drift.ok, false);
  assert.equal(drift.code, 'DEPLOY_ROLLBACK_BLOCKED');
  assert.ok(drift.lines.some((line) => line === `DEPLOYED_STATE_DRIFT=ref:${fx.c2}|live:${fx.c3}`));

  const unreadable = prepareGuardedShip({ git, guard, baseBranch: 'main', dryRun: true, readDeployed: () => ({ ok: false, error: 'exit 2' }), now: Date.now() });
  assert.equal(unreadable.ok, false);
  assert.equal(unreadable.code, 'DEPLOY_STATE_UNREADABLE');

  const prepared = prepareGuardedShip({ git, guard, baseBranch: 'main', now: Date.now() });
  let reads = 0;
  const mismatch = executeGuardedShip({
    git,
    guard,
    prepared,
    now: Date.now(),
    readDeployed: () => { reads += 1; return { ok: true, sha: fx.c2 }; },
    execute: () => 0,
  });
  assert.equal(reads, 2);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.code, 'DEPLOYED_STATE_MISMATCH');
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), fx.c2);
  assert.equal(remoteRef(fx.remote, LOCK_REF), '');
});

test('manual lock release only deletes the exact lock commit', (t) => {
  const fx = setupFixture(t);
  const guard = guardFor();
  const gitA = gitIn(fx.a);
  const prepared = prepareGuardedShip({ git: gitA, guard, baseBranch: 'main', now: Date.now() });
  let held = '';
  executeGuardedShip({
    git: gitA,
    guard,
    prepared,
    now: Date.now(),
    execute: () => { held = remoteRef(fx.remote, LOCK_REF); return 1; },
  });
  // Re-create a stuck lock with the held commit to simulate a crashed run.
  sh(fx.a, ['push', '-q', 'origin', `${held}:${LOCK_REF}`]);
  const gitB = gitIn(fx.b);
  const wrong = releaseLockManually({ git: gitB, guard, lockSha: 'a'.repeat(40) });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, 'DEPLOY_LOCK_MISMATCH');
  assert.equal(remoteRef(fx.remote, LOCK_REF), held);
  const released = releaseLockManually({ git: gitB, guard, lockSha: held });
  assert.equal(released.ok, true, released.reason);
  assert.equal(remoteRef(fx.remote, LOCK_REF), '');
});

function runGuardedShipCli(t, fx, args, shipCommand = 'node -e "console.log(process.argv.slice(1).join(\' \'))" -- {source_args} {dry_run_arg}') {
  fs.writeFileSync(path.join(fx.a, 'agent.config.json'), `${JSON.stringify({
    projectName: 'fixture',
    ops: {
      commands: { ship: { production: shipCommand } },
      rollbackGuard: { enabled: true },
    },
  }, null, 2)}\n`);
  const container = path.join(fx.root, 'container');
  const repoRoot = path.resolve(__dirname, '../../../..');
  return spawnSync(process.execPath, [path.join(repoRoot, 'infra/scripts/ops-tools/ops-run.js'), ...args], {
    cwd: fx.a,
    env: {
      ...GIT_ENV,
      AGENT_TMP_DIR: path.join(container, 'tmp'),
      AGENT_CACHE_DIR: path.join(container, 'cache'),
      AGENT_ARTIFACTS_DIR: path.join(container, 'artifacts'),
      AGENT_OPS_DEPLOY_ENABLED: 'true',
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

test('ops-run ship pins the target SHA, passes it via {source_args} and records the deploy', (t) => {
  const fx = setupFixture(t);
  const dry = runGuardedShipCli(t, fx, ['--action=ship', '--env=production', '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /DEPLOY_VERDICT=NO_BASELINE/);
  assert.match(dry.stdout, new RegExp(`SOURCE_ARGS=--sha=${fx.c3}`));
  assert.equal(remoteRef(fx.remote, LOCK_REF), '');
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), '');

  const real = runGuardedShipCli(t, fx, ['--action=ship', '--env=production']);
  assert.equal(real.status, 0, real.stderr);
  assert.match(real.stdout, new RegExp(`--sha=${fx.c3}`));
  assert.match(real.stdout, /STATUS=OK/);
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), fx.c3);

  const rollback = runGuardedShipCli(t, fx, ['--action=ship', '--env=production', `--sha=${fx.c1}`]);
  assert.equal(rollback.status, 1);
  assert.match(rollback.stderr, /STATUS=BLOCKED/);
  assert.match(rollback.stderr, /CODE=DEPLOY_ROLLBACK_BLOCKED/);
  assert.equal(remoteRef(fx.remote, DEPLOY_REF), fx.c3);
});

test('ops-run blocks a guarded ship whose command cannot receive the pinned SHA', (t) => {
  const fx = setupFixture(t);
  const result = runGuardedShipCli(t, fx, ['--action=ship', '--env=production', '--dry-run'], 'node -e ""');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /STATUS=BLOCKED/);
  assert.match(result.stderr, /\{source_args\}/);
});

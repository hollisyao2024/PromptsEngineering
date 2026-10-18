/**
 * Git primitives for the deploy guard (see deploy-guard.js): one-snapshot
 * fetch of branches and the refs/xirang deploy namespaces, ancestry
 * classification, and lease pushes. Remote calls retry with bounded backoff:
 * reads are idempotent, and a lease push is only re-sent while ls-remote shows
 * the ref still at the lease value or cannot be read. A re-sent push cannot
 * apply twice, because the lease rejects it once the ref has moved; the remote
 * value then decides whether that was this run's write or someone else's.
 */

const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { buildGitHubGitEnv } = require('../shared/github-auth');

const FULL_SHA = /^[0-9a-f]{40}$/;
const LOCK_AUTHOR = { name: 'xirang deploy guard', email: 'deploy-guard@xirang.invalid' };
// The local proxy fails in bursts lasting tens of seconds; ~67s of backoff rides one out.
const DEFAULT_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000, 30000];

function sleepSync(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function retryPlan(retry = {}) {
  return {
    delays: Array.isArray(retry.delaysMs) ? retry.delaysMs : DEFAULT_RETRY_DELAYS_MS,
    sleep: typeof retry.sleep === 'function' ? retry.sleep : sleepSync,
  };
}

// Runs attempt() up to delays.length + 1 times until it reports done.
function withRetries(retry, attempt) {
  const { delays, sleep } = retryPlan(retry);
  let outcome = attempt(0);
  for (let index = 0; !outcome.done && index < delays.length; index += 1) {
    sleep(delays[index]);
    outcome = attempt(index + 1);
  }
  return outcome;
}

function createGitRunner({ repoRoot, cwd, env = process.env, spawn = spawnSync } = {}) {
  return (args, options = {}) => {
    const baseEnv = { ...env, GIT_TERMINAL_PROMPT: '0', ...(options.env || {}) };
    const result = spawn('git', args, {
      cwd,
      encoding: 'utf8',
      input: options.input,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildGitHubGitEnv({ repoRoot, cwd, args, env: baseEnv }),
    });
    return {
      status: typeof result.status === 'number' ? result.status : 1,
      stdout: result.stdout || '',
      stderr: result.stderr || (result.error ? String(result.error.message) : ''),
    };
  };
}

function lastLine(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

function revParse(git, ref) {
  const result = git(['rev-parse', '--verify', '-q', ref]);
  const sha = result.stdout.trim();
  return result.status === 0 && FULL_SHA.test(sha) ? sha : '';
}

function mirrorRef(guard, kind) {
  return `refs/xirang-remote/${guard.remote}/${kind}/${guard.scope}`;
}

// One fetch refreshes branches plus the deploy and lock namespaces, so every
// value used as a lease comes from the same snapshot.
function fetchSnapshot(git, guard) {
  const shallow = git(['rev-parse', '--is-shallow-repository']);
  if (shallow.status !== 0) return { ok: false, error: `not a git repository: ${lastLine(shallow.stderr)}` };
  if (shallow.stdout.trim() === 'true') {
    return { ok: false, error: 'shallow clone cannot prove deployment ancestry; run git fetch --unshallow first' };
  }
  const { remote } = guard;
  const { result: fetched } = withRetries(guard.retry, () => {
    const result = git([
      'fetch',
      '--prune',
      '--no-tags',
      remote,
      `+refs/heads/*:refs/remotes/${remote}/*`,
      `+refs/xirang/deploy/*:refs/xirang-remote/${remote}/deploy/*`,
      `+refs/xirang/deploy-lock/*:refs/xirang-remote/${remote}/deploy-lock/*`,
    ]);
    return { done: result.status === 0, result };
  });
  if (fetched.status !== 0) {
    return { ok: false, error: `git fetch ${remote} failed: ${lastLine(fetched.stderr) || `exit ${fetched.status}`}` };
  }
  return {
    ok: true,
    deployedSha: revParse(git, mirrorRef(guard, 'deploy')),
    lockSha: revParse(git, mirrorRef(guard, 'deploy-lock')),
  };
}

function resolveTarget(git, guard, { sha, source, baseBranch }) {
  if (sha) {
    return git(['cat-file', '-e', `${sha}^{commit}`]).status === 0
      ? { sha }
      : { error: `target commit ${sha} is not present locally` };
  }
  if (source) {
    const resolved = revParse(git, `refs/remotes/${guard.remote}/${source}^{commit}`) || revParse(git, `${source}^{commit}`);
    return resolved ? { sha: resolved } : { error: `--source=${source} does not resolve to a commit` };
  }
  const base = revParse(git, `refs/remotes/${guard.remote}/${baseBranch}^{commit}`);
  return base ? { sha: base } : { error: `${guard.remote}/${baseBranch} does not resolve to a commit after fetch` };
}

function classifyDeployment(git, deployedSha, targetSha) {
  if (!deployedSha) return 'NO_BASELINE';
  if (deployedSha === targetSha) return 'PASS';
  if (git(['cat-file', '-e', `${deployedSha}^{commit}`]).status !== 0) return 'UNKNOWN';
  if (git(['cat-file', '-e', `${targetSha}^{commit}`]).status !== 0) return 'UNKNOWN';
  const forward = git(['merge-base', '--is-ancestor', deployedSha, targetSha]).status;
  if (forward === 0) return 'PASS';
  if (forward !== 1) return 'UNKNOWN';
  const backward = git(['merge-base', '--is-ancestor', targetSha, deployedSha]).status;
  if (backward === 0) return 'ROLLBACK';
  return backward === 1 ? 'DIVERGED' : 'UNKNOWN';
}

function parsePushPorcelain(stdout, ref) {
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const match = /^([ *+\-!=])\t([^\t]*)\t/.exec(line);
    if (!match) continue;
    const separator = match[2].indexOf(':');
    if (separator === -1 || match[2].slice(separator + 1) !== ref) continue;
    return match[1] === '!' ? 'rejected' : 'ok';
  }
  return 'unknown';
}

function lsRemote(git, remote, ref) {
  const result = git(['ls-remote', remote, ref]);
  if (result.status !== 0) return { ok: false, error: lastLine(result.stderr) };
  const line = result.stdout.split(/\r?\n/).find((entry) => entry.split('\t')[1] === ref);
  return { ok: true, sha: line ? line.split('\t')[0] : '' };
}

// newSha '' deletes; expected '' requires the ref to be absent.
// A first-attempt rejection is final. Any other non-ok attempt is judged by the
// remote value: newSha means applied, expected or unreadable means push again,
// anything else means another writer won the lease.
function pushWithLease(git, { remote, ref, newSha = '', expected = '', retry }) {
  return withRetries(retry, (attempt) => {
    const pushed = git([
      'push',
      '--porcelain',
      '--no-verify',
      `--force-with-lease=${ref}:${expected}`,
      remote,
      `${newSha}:${ref}`,
    ]);
    const result = parsePushPorcelain(pushed.stdout, ref);
    if (result === 'ok' || (result === 'rejected' && attempt === 0)) {
      return { done: true, result, detail: lastLine(pushed.stderr) };
    }
    const remoteState = lsRemote(git, remote, ref);
    if (remoteState.ok && remoteState.sha === newSha) return { done: true, result: 'ok', verified: true };
    if (remoteState.ok && remoteState.sha !== expected) {
      return { done: true, result: 'rejected', detail: `${ref} is ${remoteState.sha || 'absent'} on ${remote}, expected ${expected || 'absent'}` };
    }
    return {
      done: false,
      result: 'unknown',
      detail: remoteState.ok
        ? `push result unknown after ${attempt + 1} attempt(s); ${ref} is still ${remoteState.sha || 'absent'} on ${remote}: ${lastLine(pushed.stderr)}`
        : `push result unknown after ${attempt + 1} attempt(s) and ${remote} is unreadable: ${remoteState.error || lastLine(pushed.stderr)}`,
    };
  });
}

function createLockCommit(git, guard, targetSha, now) {
  const tree = git(['mktree'], { input: '' });
  if (tree.status !== 0) return { error: lastLine(tree.stderr) || 'git mktree failed' };
  const createdAt = new Date(now).toISOString();
  const message = JSON.stringify({
    schema: 'xirang-deploy-lock/v1',
    scope: guard.scope,
    env: guard.env,
    host: os.hostname(),
    user: os.userInfo().username,
    pid: process.pid,
    createdAt,
    ttlSeconds: guard.lockTtlSeconds,
    targetSha,
    nonce: crypto.randomBytes(8).toString('hex'),
  });
  const date = `${Math.floor(now / 1000)} +0000`;
  const created = git(['commit-tree', tree.stdout.trim(), '-m', message], {
    env: {
      GIT_AUTHOR_NAME: LOCK_AUTHOR.name,
      GIT_AUTHOR_EMAIL: LOCK_AUTHOR.email,
      GIT_COMMITTER_NAME: LOCK_AUTHOR.name,
      GIT_COMMITTER_EMAIL: LOCK_AUTHOR.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  });
  const sha = created.stdout.trim();
  if (created.status !== 0 || !FULL_SHA.test(sha)) return { error: lastLine(created.stderr) || 'git commit-tree failed' };
  return { sha };
}

module.exports = {
  DEFAULT_RETRY_DELAYS_MS,
  FULL_SHA,
  classifyDeployment,
  createGitRunner,
  createLockCommit,
  fetchSnapshot,
  lastLine,
  lsRemote,
  parsePushPorcelain,
  pushWithLease,
  resolveTarget,
};

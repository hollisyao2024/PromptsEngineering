'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../shared/config');
const {
  isPathInside,
  isSamePath,
  listWorktrees,
  parseWorktreePorcelain,
  readSessions,
  removeSession,
  removeWorktreeSafely,
  resolveContainerPath,
  safeRemoveTreeNoFollow,
  writeSession,
} = require('./worktree-core');

function runGitStrict(mainRoot, args) {
  const result = spawnSync('git', args, {
    cwd: mainRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
  }
  return result.stdout || '';
}

function pruneMissingAuthorizedRegistration(mainRoot, worktreePath) {
  const before = parseWorktreePorcelain(
    runGitStrict(mainRoot, ['worktree', 'list', '--porcelain']),
  );
  const target = before.find((entry) => isSamePath(entry.path, worktreePath));
  if (!target || !target.prunable) {
    throw new Error(`missing worktree registration is not explicitly prunable: ${worktreePath}`);
  }
  const unrelatedPrunable = before.filter(
    (entry) => entry.prunable && !isSamePath(entry.path, worktreePath),
  );
  if (unrelatedPrunable.length > 0) {
    throw new Error(
      `refusing to prune unrelated registrations: ${unrelatedPrunable.map((entry) => entry.path).join(', ')}`,
    );
  }

  runGitStrict(mainRoot, ['worktree', 'prune', '--expire', 'now']);
  const after = parseWorktreePorcelain(
    runGitStrict(mainRoot, ['worktree', 'list', '--porcelain']),
  );
  if (after.some((entry) => isSamePath(entry.path, worktreePath))) {
    throw new Error(`authorized prunable registration remains: ${worktreePath}`);
  }
  const unrelatedRemoved = before
    .filter((entry) => !isSamePath(entry.path, worktreePath))
    .filter((entry) => !after.some((candidate) => isSamePath(candidate.path, entry.path)));
  if (unrelatedRemoved.length > 0) {
    throw new Error(
      `prune changed unrelated registrations: ${unrelatedRemoved.map((entry) => entry.path).join(', ')}`,
    );
  }
}

function cleanupPayload(mainRoot, branch, worktreePath, previous = {}, error = '') {
  return {
    mainRoot: path.resolve(mainRoot),
    branch,
    worktree: path.resolve(worktreePath),
    requestedAt: previous.requestedAt || new Date().toISOString(),
    attempts: Number(previous.attempts || 0) + (error ? 1 : 0),
    lastAttemptAt: error ? new Date().toISOString() : (previous.lastAttemptAt || ''),
    lastError: error || previous.lastError || '',
  };
}

function markCleanupPending(options) {
  const {
    config,
    mainRoot,
    branch,
    worktreePath,
    writeSession: write = writeSession,
  } = options;
  if (!mainRoot || !path.isAbsolute(mainRoot)) throw new Error('mainRoot must be absolute');
  if (!worktreePath || !path.isAbsolute(worktreePath)) throw new Error('worktreePath must be absolute');
  if (!branch) throw new Error('branch is required');
  const payload = {
    branch,
    worktree: path.resolve(worktreePath),
    status: 'cleanup_pending',
    step: 'merged_cleanup_pending',
    cleanup: cleanupPayload(mainRoot, branch, worktreePath),
  };
  write(config, mainRoot, payload);
  return payload;
}

function isAuthorizedCleanupSession(session, mainRoot, worktreesRoot) {
  if (!session || session.status !== 'cleanup_pending' || !session.cleanup) return false;
  const branch = String(session.branch || '');
  const worktree = String(session.worktree || '');
  const cleanup = session.cleanup;
  if (!branch || !worktree || !path.isAbsolute(worktree)) return false;
  if (cleanup.branch !== branch) return false;
  if (!cleanup.worktree || !isSamePath(cleanup.worktree, worktree)) return false;
  if (!cleanup.mainRoot || !isSamePath(cleanup.mainRoot, mainRoot)) return false;
  return isPathInside(worktreesRoot, worktree);
}

function defaultDeleteBranch(mainRoot, branch) {
  const exists = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd: mainRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (exists.error) throw exists.error;
  if (exists.status !== 0) return;
  const deletion = spawnSync('git', ['branch', '-D', branch], {
    cwd: mainRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (deletion.error) throw deletion.error;
  if (deletion.status !== 0) {
    throw new Error((deletion.stderr || deletion.stdout || `cannot delete ${branch}`).trim());
  }
}

function reconcilePendingCleanups(options = {}) {
  const mainRoot = path.resolve(options.mainRoot);
  const config = options.config || loadConfig({ repoRoot: mainRoot });
  const worktreesRoot = options.worktreesRoot
    || resolveContainerPath(config, mainRoot, 'worktrees');
  const read = options.readSessions || readSessions;
  const list = options.listWorktrees || listWorktrees;
  const removeRegistered = options.removeRegisteredWorktree
    || ((input) => removeWorktreeSafely(input));
  const removeSess = options.removeSession || removeSession;
  const write = options.writeSession || writeSession;
  const deleteBranch = options.deleteBranch || defaultDeleteBranch;
  const onlyBranch = options.branch || '';
  const skipWorktreePath = options.skipWorktreePath || '';
  const completed = [];
  const pending = [];
  const errors = [];
  const registered = list(mainRoot);

  for (const session of read(config, mainRoot)) {
    if (!session || session.status !== 'cleanup_pending') continue;
    if (onlyBranch && session.branch !== onlyBranch) continue;
    if (!isAuthorizedCleanupSession(session, mainRoot, worktreesRoot)) {
      pending.push(session.branch || '(invalid)');
      errors.push({ branch: session.branch || '', error: 'invalid durable cleanup authorization' });
      continue;
    }
    if (skipWorktreePath && isSamePath(skipWorktreePath, session.worktree)) {
      pending.push(session.branch);
      errors.push({ branch: session.branch, error: 'cleanup deferred until caller leaves target worktree' });
      continue;
    }

    try {
      const entry = registered.find((item) => isSamePath(item.path, session.worktree));
      if (entry && entry.branch !== session.branch) {
        throw new Error(`registered branch mismatch: expected ${session.branch}, found ${entry.branch || '(detached)'}`);
      }
      if (entry) {
        if (fs.existsSync(session.worktree)) {
          removeRegistered({
            mainRoot,
            worktreePath: session.worktree,
            worktreesRoot,
            force: true,
          });
        } else {
          pruneMissingAuthorizedRegistration(mainRoot, session.worktree);
        }
      } else if (fs.existsSync(session.worktree)) {
        safeRemoveTreeNoFollow(session.worktree, { allowedRoot: worktreesRoot });
      }
      deleteBranch(mainRoot, session.branch);
      removeSess(config, mainRoot, session.branch);
      completed.push(session.branch);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      pending.push(session.branch);
      errors.push({ branch: session.branch, error: message });
      write(config, mainRoot, {
        branch: session.branch,
        worktree: session.worktree,
        status: 'cleanup_pending',
        step: 'merged_cleanup_pending',
        cleanup: cleanupPayload(
          mainRoot,
          session.branch,
          session.worktree,
          session.cleanup,
          message,
        ),
      });
    }
  }

  return { completed, pending, errors };
}

module.exports = {
  isAuthorizedCleanupSession,
  markCleanupPending,
  pruneMissingAuthorizedRegistration,
  reconcilePendingCleanups,
};

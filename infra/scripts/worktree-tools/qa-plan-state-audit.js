'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, resolveRuntimePath } = require('../shared/config');
const {
  getMainRepoRoot,
  getWorktreeRoot,
  listWorktrees,
} = require('./worktree-core');
const { safeRemoveTreeNoFollow } = require('./worktree-safe-remove');

const MANAGED_STATE_NAME = /^[a-zA-Z0-9._-]+-[0-9a-f]{12}\.json$/u;

function qaPlanStateFileName(worktreeRoot) {
  const worktreeName = path.basename(path.resolve(worktreeRoot))
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'repo';
  const worktreeHash = crypto
    .createHash('sha256')
    .update(path.resolve(worktreeRoot))
    .digest('hex')
    .slice(0, 12);
  return `${worktreeName}-${worktreeHash}.json`;
}

function getQaPlanSessionStatePath(options = {}) {
  const env = options.env || process.env;
  const customPath = env.QA_PLAN_SESSION_STATE_PATH;
  if (customPath && customPath.trim()) return customPath.trim();

  const cwd = options.cwd || process.cwd();
  const worktreeRoot = path.resolve(options.worktreeRoot || getWorktreeRoot(cwd));
  const mainRoot = path.resolve(options.mainRoot || getMainRepoRoot(cwd));
  const config = options.config || loadConfig({ repoRoot: worktreeRoot, env, argv: [] });
  const configuredSessionDir = config.worktree && config.worktree.sessionDir;
  const sessionDir = resolveRuntimePath(config, mainRoot, configuredSessionDir, 'worktree-sessions');
  return path.join(sessionDir, 'qa-plan', qaPlanStateFileName(worktreeRoot));
}

function countsFor(records) {
  const counts = {};
  for (const record of records) counts[record.state] = (counts[record.state] || 0) + 1;
  return counts;
}

function resultFor(records, apply) {
  return {
    status: records.some((record) => record.state === 'recovery_required') ? 'ATTENTION' : 'OK',
    mode: apply ? 'apply' : 'dry-run',
    counts: countsFor(records),
    records,
  };
}

function activeStateNames(worktreePaths) {
  return new Set((worktreePaths || []).filter(Boolean).map(qaPlanStateFileName));
}

function auditQaPlanSessionStates(options = {}) {
  const mainRoot = path.resolve(options.mainRoot || getMainRepoRoot(options.cwd || process.cwd()));
  const config = options.config || loadConfig({ repoRoot: mainRoot });
  const configuredSessionDir = config.worktree && config.worktree.sessionDir;
  const sessionDir = resolveRuntimePath(config, mainRoot, configuredSessionDir, 'worktree-sessions');
  const qaPlanDir = path.join(sessionDir, 'qa-plan');
  const list = options.listWorktrees || listWorktrees;
  const initialPaths = options.worktreePaths
    || list(mainRoot).map((entry) => entry.path).filter(Boolean);

  let directoryStat;
  try {
    directoryStat = fs.lstatSync(qaPlanDir);
  } catch (error) {
    if (error && error.code === 'ENOENT') return resultFor([], options.apply);
    return resultFor([{
      path: qaPlanDir,
      state: 'recovery_required',
      reason: `qa-plan-directory-inspection-failed:${error.message}`,
    }], options.apply);
  }
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    return resultFor([{
      path: qaPlanDir,
      state: 'recovery_required',
      reason: 'qa-plan-directory-not-real',
    }], options.apply);
  }

  const allowed = activeStateNames(initialPaths);
  let entries;
  try {
    entries = fs.readdirSync(qaPlanDir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    return resultFor([{
      path: qaPlanDir,
      state: 'recovery_required',
      reason: `qa-plan-directory-read-failed:${error.message}`,
    }], options.apply);
  }

  const records = entries.map((entry) => {
    const statePath = path.join(qaPlanDir, entry.name);
    if (allowed.has(entry.name)) {
      return { path: statePath, state: 'active', reason: 'registered-worktree' };
    }
    if (!entry.isFile() || entry.isSymbolicLink() || !MANAGED_STATE_NAME.test(entry.name)) {
      return { path: statePath, state: 'recovery_required', reason: 'unexpected-qa-plan-entry' };
    }
    return { path: statePath, state: 'cleanup_candidate', reason: 'unregistered-worktree-state' };
  });

  if (!options.apply) return resultFor(records, false);

  let refreshedNames;
  try {
    refreshedNames = activeStateNames(list(mainRoot).map((entry) => entry.path).filter(Boolean));
  } catch (error) {
    return resultFor(records.map((record) => record.state === 'cleanup_candidate'
      ? { ...record, state: 'recovery_required', reason: `worktree-revalidation-failed:${error.message}` }
      : record), true);
  }
  const applied = records.map((record) => {
    if (record.state !== 'cleanup_candidate') return record;
    try {
      if (refreshedNames.has(path.basename(record.path))) {
        return { ...record, state: 'active', reason: 'registered-during-revalidation' };
      }
      const stat = fs.lstatSync(record.path);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        return { ...record, state: 'recovery_required', reason: 'qa-plan-entry-drift' };
      }
      safeRemoveTreeNoFollow(record.path, { allowedRoot: qaPlanDir });
      if (fs.existsSync(record.path)) {
        return { ...record, state: 'recovery_required', reason: 'qa-plan-cleanup-verification-failed' };
      }
      return { ...record, state: 'cleaned', reason: 'qa-plan-cleanup-verified' };
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { ...record, state: 'cleaned', reason: 'qa-plan-already-absent' };
      }
      return { ...record, state: 'recovery_required', reason: `qa-plan-cleanup-failed:${error.message}` };
    }
  });
  return resultFor(applied, true);
}

module.exports = {
  auditQaPlanSessionStates,
  getQaPlanSessionStatePath,
  qaPlanStateFileName,
};

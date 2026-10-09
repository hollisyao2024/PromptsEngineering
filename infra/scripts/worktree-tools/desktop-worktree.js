'use strict';

/**
 * Claude Desktop "start with worktree" creates linked worktrees under
 * <main>/.claude/worktrees/<name>.  They are unmanaged until adopted in place;
 * afterwards their session carries provenance that authorizes post-merge
 * removal from this root, and nothing else does.
 */

const fs = require('fs');
const path = require('path');
const { isPathInside, isSamePath } = require('./worktree-safe-remove');

const DESKTOP_ORIGIN = 'claude-desktop';
const DESKTOP_WORKTREES_SEGMENTS = ['.claude', 'worktrees'];

function isRealDirectory(target) {
  try {
    const stat = fs.lstatSync(target);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Returns the Desktop worktrees root, or '' unless every segment is a real directory. */
function resolveDesktopWorktreesRoot(mainRoot) {
  if (!mainRoot || !path.isAbsolute(mainRoot)) return '';
  let current = path.resolve(mainRoot);
  for (const segment of DESKTOP_WORKTREES_SEGMENTS) {
    current = path.join(current, segment);
    if (!isRealDirectory(current)) return '';
  }
  return current;
}

/** True only for a direct child directory of the real Desktop worktrees root. */
function isDesktopWorktreePath(mainRoot, worktreePath) {
  const root = resolveDesktopWorktreesRoot(mainRoot);
  if (!root || !worktreePath || !path.isAbsolute(worktreePath)) return false;
  const resolved = path.resolve(worktreePath);
  if (path.dirname(resolved) === root) return true;
  try {
    return isSamePath(fs.realpathSync(path.dirname(resolved)), fs.realpathSync(root));
  } catch {
    return false;
  }
}

function hasDesktopProvenance(session) {
  const provenance = session && session.provenance;
  return Boolean(
    provenance
    && provenance.origin === DESKTOP_ORIGIN
    && typeof provenance.worktree === 'string'
    && typeof session.worktree === 'string'
    && path.isAbsolute(provenance.worktree)
    && isSamePath(provenance.worktree, session.worktree),
  );
}

/**
 * Root that a destructive cleanup of this session may operate under:
 * the container worktrees root for ordinary sessions, the Desktop root only
 * for an adopted session whose provenance names this exact child path, and ''
 * (fail closed) otherwise.
 */
function resolveSessionRemovalRoot(mainRoot, containerRoot, session) {
  const worktree = session && session.worktree;
  if (!worktree || !path.isAbsolute(worktree)) return '';
  if (containerRoot && isPathInside(containerRoot, worktree)) return containerRoot;
  if (!hasDesktopProvenance(session)) return '';
  if (!isDesktopWorktreePath(mainRoot, worktree)) return '';
  return resolveDesktopWorktreesRoot(mainRoot);
}

/**
 * Removal root for an explicit worktree path, looked up through its session.
 * Falls back to the container root so unauthorized Desktop paths stay rejected.
 */
function removalRootForWorktree(mainRoot, containerRoot, worktreePath, sessions = []) {
  const session = sessions.find((item) => item && item.worktree && worktreePath
    && isSamePath(item.worktree, worktreePath));
  return (session && resolveSessionRemovalRoot(mainRoot, containerRoot, session)) || containerRoot;
}

function buildDesktopProvenance(worktreePath, originalBranch, extra = {}) {
  return {
    origin: DESKTOP_ORIGIN,
    original_branch: originalBranch,
    worktree: path.resolve(worktreePath),
    adopted_at: new Date().toISOString(),
    ...extra,
  };
}

module.exports = {
  DESKTOP_ORIGIN,
  DESKTOP_WORKTREES_SEGMENTS,
  buildDesktopProvenance,
  hasDesktopProvenance,
  isDesktopWorktreePath,
  removalRootForWorktree,
  resolveDesktopWorktreesRoot,
  resolveSessionRemovalRoot,
};

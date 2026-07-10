'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function comparablePath(input) {
  const resolved = path.resolve(input);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSamePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function isPathInside(parentPath, candidatePath) {
  const parent = comparablePath(parentPath);
  const candidate = comparablePath(candidatePath);
  const relative = path.relative(parent, candidate);
  return Boolean(
    relative
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function lstatOrNull(targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function retryWritable(targetPath, action) {
  try {
    action();
  } catch (error) {
    if (!error || !['EACCES', 'EPERM'].includes(error.code)) throw error;
    fs.chmodSync(targetPath, 0o700);
    action();
  }
}

/**
 * Remove a filesystem tree without ever following a symlink or Windows junction.
 * Every node is inspected with lstat. Reparse points are unlinked as leaf nodes.
 */
function safeRemoveTreeNoFollow(rootPath, options = {}) {
  const allowedRoot = options.allowedRoot;
  if (!path.isAbsolute(rootPath) || !path.isAbsolute(allowedRoot || '')) {
    throw new Error('safe removal requires absolute rootPath and allowedRoot');
  }
  if (isSamePath(rootPath, allowedRoot)) {
    throw new Error(`refusing to remove the allowed container root: ${rootPath}`);
  }
  if (!isPathInside(allowedRoot, rootPath)) {
    throw new Error(`refusing to remove path outside allowed root: ${rootPath}`);
  }

  const counts = {
    removedFiles: 0,
    removedDirectories: 0,
    removedLinks: 0,
  };
  const allowedRootStat = lstatOrNull(allowedRoot);
  if (!allowedRootStat || allowedRootStat.isSymbolicLink() || !allowedRootStat.isDirectory()) {
    throw new Error(`allowed container root must be an existing real directory, not a link: ${allowedRoot}`);
  }

  const rootStat = lstatOrNull(rootPath);
  if (!rootStat) return counts;

  // Lexical containment is insufficient when an ancestor is itself a junction.
  // Resolve only the parent (never rootPath) so a root symlink can still be unlinked safely.
  const realAllowedRoot = fs.realpathSync(allowedRoot);
  const realRootParent = fs.realpathSync(path.dirname(path.resolve(rootPath)));
  if (!isSamePath(realAllowedRoot, realRootParent) && !isPathInside(realAllowedRoot, realRootParent)) {
    throw new Error(`refusing to remove through a linked ancestor outside the container root: ${rootPath}`);
  }

  // Explicit post-order traversal avoids recursion depth limits in node_modules.
  const stack = [{ targetPath: path.resolve(rootPath), expanded: false }];
  while (stack.length > 0) {
    const item = stack.pop();
    const stat = lstatOrNull(item.targetPath);
    if (!stat) continue;

    if (stat.isSymbolicLink()) {
      // chmod on a symlink can touch its target, so link deletion never retries via chmod.
      fs.unlinkSync(item.targetPath);
      counts.removedLinks += 1;
      continue;
    }

    if (!stat.isDirectory()) {
      retryWritable(item.targetPath, () => fs.unlinkSync(item.targetPath));
      counts.removedFiles += 1;
      continue;
    }

    if (!item.expanded) {
      stack.push({ targetPath: item.targetPath, expanded: true });
      const children = fs.readdirSync(item.targetPath);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({ targetPath: path.join(item.targetPath, children[index]), expanded: false });
      }
      continue;
    }

    // Re-check after visiting children. If the node changed into a link, unlink it only.
    const finalStat = lstatOrNull(item.targetPath);
    if (!finalStat) continue;
    if (finalStat.isSymbolicLink()) {
      fs.unlinkSync(item.targetPath);
      counts.removedLinks += 1;
    } else if (finalStat.isDirectory()) {
      retryWritable(item.targetPath, () => fs.rmdirSync(item.targetPath));
      counts.removedDirectories += 1;
    } else {
      retryWritable(item.targetPath, () => fs.unlinkSync(item.targetPath));
      counts.removedFiles += 1;
    }
  }

  return counts;
}

function runGitStrict(mainRoot, args) {
  const result = spawnSync('git', args, {
    cwd: mainRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed (exit ${result.status})${details ? `: ${details}` : ''}`);
  }
  return result.stdout || '';
}

function parseWorktreePorcelain(output) {
  const entries = [];
  let current = null;
  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: line.slice(9).trim(), locked: false };
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice(7).trim().replace(/^refs\/heads\//u, '');
    } else if (current && (line === 'locked' || line.startsWith('locked '))) {
      current.locked = true;
      current.lockReason = line.slice(6).trim();
    } else if (current && (line === 'prunable' || line.startsWith('prunable '))) {
      current.prunable = true;
      current.prunableReason = line.slice(8).trim();
    }
  }
  if (current) entries.push(current);
  return entries;
}

function removeWorktreeSafely(options = {}) {
  const {
    mainRoot,
    worktreePath,
    worktreesRoot,
    force = false,
  } = options;
  for (const [name, value] of Object.entries({ mainRoot, worktreePath, worktreesRoot })) {
    if (!value || !path.isAbsolute(value)) {
      throw new Error(`${name} must be an absolute path`);
    }
  }
  if (isSamePath(worktreePath, mainRoot)) {
    throw new Error(`refusing to remove the main worktree: ${worktreePath}`);
  }
  if (isSamePath(worktreePath, worktreesRoot)) {
    throw new Error(`refusing to remove the worktrees container root: ${worktreePath}`);
  }
  if (!isPathInside(worktreesRoot, worktreePath)) {
    throw new Error(`refusing to remove path outside the worktrees container: ${worktreePath}`);
  }

  const before = parseWorktreePorcelain(runGitStrict(mainRoot, ['worktree', 'list', '--porcelain']));
  const registered = before.find((entry) => isSamePath(entry.path, worktreePath));
  if (!registered) {
    throw new Error(`worktree path is not registered with Git: ${worktreePath}`);
  }
  if (registered.locked) {
    throw new Error(
      `worktree is locked${registered.lockReason ? ` (${registered.lockReason})` : ''}: ${worktreePath}`
    );
  }
  if (!lstatOrNull(worktreePath)) {
    throw new Error(`registered worktree directory is missing; refusing global prune: ${worktreePath}`);
  }

  const unrelatedPrunable = before.filter((entry) => (
    entry.prunable && !isSamePath(entry.path, worktreePath)
  ));
  if (unrelatedPrunable.length > 0) {
    throw new Error(
      `refusing to prune unrelated prunable worktree metadata: ${unrelatedPrunable
        .map((entry) => entry.path)
        .join(', ')}`
    );
  }

  // `git worktree prune` is repository-wide. Abort before deleting anything if it
  // would also touch an unrelated stale registration.
  const prunePreview = runGitStrict(mainRoot, [
    'worktree',
    'prune',
    '--dry-run',
    '--verbose',
    '--expire',
    'now',
  ]);
  if (prunePreview.trim()) {
    throw new Error(`refusing to prune unrelated prunable worktree metadata: ${prunePreview.trim()}`);
  }

  if (!force) {
    const status = runGitStrict(worktreePath, ['status', '--porcelain']);
    if (status.trim()) throw new Error(`worktree has uncommitted changes: ${worktreePath}`);
  }

  let cwd = '';
  try {
    cwd = process.cwd();
  } catch {
    // A previously removed cwd is treated as unsafe and moved to main below.
  }
  if (!cwd || isSamePath(cwd, worktreePath) || isPathInside(worktreePath, cwd)) {
    process.chdir(mainRoot);
  }

  const counts = safeRemoveTreeNoFollow(worktreePath, { allowedRoot: worktreesRoot });
  if (lstatOrNull(worktreePath)) {
    throw new Error(`physical worktree removal did not complete: ${worktreePath}`);
  }

  // Git for Windows can follow junctions during `git worktree remove`; never call it.
  // Removing the physical tree ourselves and pruning metadata is the safe equivalent.
  runGitStrict(mainRoot, ['worktree', 'prune', '--expire', 'now']);
  const after = parseWorktreePorcelain(runGitStrict(mainRoot, ['worktree', 'list', '--porcelain']));
  if (after.some((entry) => isSamePath(entry.path, worktreePath))) {
    throw new Error(`worktree remains registered after prune: ${worktreePath}`);
  }
  const afterPaths = new Set(after.map((entry) => comparablePath(entry.path)));
  const unrelatedRemoved = before
    .filter((entry) => !isSamePath(entry.path, worktreePath))
    .filter((entry) => !afterPaths.has(comparablePath(entry.path)));
  if (unrelatedRemoved.length > 0) {
    throw new Error(
      `worktree prune changed unrelated registrations: ${unrelatedRemoved.map((entry) => entry.path).join(', ')}`
    );
  }

  return {
    removed: true,
    path: path.resolve(worktreePath),
    branch: registered.branch || '',
    ...counts,
  };
}

module.exports = {
  isPathInside,
  isSamePath,
  parseWorktreePorcelain,
  removeWorktreeSafely,
  safeRemoveTreeNoFollow,
};

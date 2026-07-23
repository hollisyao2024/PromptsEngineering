#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  getMainRepoRoot,
  listWorktrees,
  removeSession,
  removeWorktreeSafely,
  resolveContainerPath,
  safeRemoveTreeNoFollow,
  readSessions,
  MANAGED_MARKER,
} = require('../worktree-tools/worktree-core');
const { loadConfig, resolveRepoRoot } = require('../shared/config');

const PROTECTED_BRANCHES = new Set(['main', 'master', 'develop']);

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    removeWorktrees: argv.includes('--remove-worktrees'),
    removeOrphans: argv.includes('--remove-orphans'),
    json: argv.includes('--json'),
  };
}

function collectManagedOrphans(repoRoot, config) {
  const root = resolveContainerPath(config, repoRoot, 'worktrees');
  const registered = new Set(listWorktrees(repoRoot).map((entry) => path.resolve(entry.path)));
  const sessions = new Set(readSessions(config, repoRoot).map((session) => session.worktree && path.resolve(session.worktree)));
  if (!fs.existsSync(root)) return { root, orphans: [], untrusted: [] };
  const orphans = []; const untrusted = [];
  for (const name of fs.readdirSync(root)) {
    const candidate = path.join(root, name);
    if (!fs.lstatSync(candidate).isDirectory() || registered.has(path.resolve(candidate))) continue;
    const markerPath = path.join(candidate, MANAGED_MARKER);
    if (!fs.existsSync(markerPath)) { untrusted.push(candidate); continue; }
    try {
      const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (marker.mainRoot === path.resolve(repoRoot) && !sessions.has(path.resolve(candidate))) orphans.push(candidate);
      else untrusted.push(candidate);
    } catch { untrusted.push(candidate); }
  }
  return { root, orphans, untrusted };
}

function runGit(repoRoot, args, allowFailure = false) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result;
}

function isMerged(repoRoot, branch, baseRef) {
  return runGit(repoRoot, ['merge-base', '--is-ancestor', branch, baseRef], true).status === 0;
}

function hasUniquePatch(repoRoot, branch, baseRef) {
  const result = runGit(repoRoot, ['cherry', '-v', baseRef, branch]);
  return result.stdout.split(/\r?\n/).some((line) => line.startsWith('+'));
}

function classifyBranch({ branch, attached, merged, hasUniquePatch }) {
  if (PROTECTED_BRANCHES.has(branch)) return 'protected';
  if (attached) return hasUniquePatch ? 'active-unique' : 'active-equivalent';
  if (merged) return 'merged';
  return hasUniquePatch ? 'unique' : 'equivalent';
}

function collectBranches(repoRoot, baseRef) {
  const worktreeByBranch = new Map(listWorktrees(repoRoot)
    .filter((entry) => entry.branch)
    .map((entry) => [entry.branch, entry]));
  const heads = runGit(repoRoot, ['for-each-ref', 'refs/heads', '--format=%(refname:short)'])
    .stdout.split(/\r?\n/).filter(Boolean);

  return heads.map((branch) => {
    const worktree = worktreeByBranch.get(branch) || null;
    const merged = isMerged(repoRoot, branch, baseRef);
    const unique = merged ? false : hasUniquePatch(repoRoot, branch, baseRef);
    return {
      branch,
      worktreePath: worktree ? worktree.path : '',
      classification: classifyBranch({ branch, attached: Boolean(worktree), merged, hasUniquePatch: unique }),
    };
  });
}

function summarize(entries) {
  return entries.reduce((summary, entry) => {
    summary[entry.classification] = (summary[entry.classification] || 0) + 1;
    return summary;
  }, {});
}

function cleanupEntry(repoRoot, config, entry, options) {
  if (!['merged', 'equivalent', 'active-equivalent'].includes(entry.classification)) return 'skipped';
  if (entry.worktreePath) {
    if (!options.removeWorktrees) return 'needs-worktree-removal';
    const dirty = runGit(entry.worktreePath, ['status', '--porcelain']).stdout.trim();
    if (dirty) throw new Error(`refusing to remove dirty worktree for ${entry.branch}: ${entry.worktreePath}`);
    const worktreesRoot = resolveContainerPath(config, repoRoot, 'worktrees');
    removeWorktreeSafely({ mainRoot: repoRoot, worktreePath: entry.worktreePath, worktreesRoot, force: true });
    removeSession(config, repoRoot, entry.branch);
  }
  runGit(repoRoot, ['branch', '-D', entry.branch]);
  return 'removed';
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
  const mainRoot = getMainRepoRoot(repoRoot);
  const config = loadConfig({ repoRoot: mainRoot });
  const baseRef = `origin/${config.baseBranch || 'main'}`;
  const entries = collectBranches(mainRoot, baseRef);
  const summary = summarize(entries);
  const orphanAudit = collectManagedOrphans(mainRoot, config);
  const result = { baseRef, summary, entries, removed: [], deferred: [], managedOrphans: orphanAudit.orphans, untrustedDirectories: orphanAudit.untrusted };

  if (options.apply) {
    for (const entry of entries) {
      const action = cleanupEntry(mainRoot, config, entry, options);
      if (action === 'removed') result.removed.push(entry.branch);
      if (action === 'needs-worktree-removal') result.deferred.push(entry.branch);
    }
  }
  if (options.apply && options.removeOrphans) {
    for (const orphan of orphanAudit.orphans) safeRemoveTreeNoFollow(orphan, { allowedRoot: orphanAudit.root });
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`BASE_REF=${baseRef}`);
  console.log(`SUMMARY=${JSON.stringify(summary)}`);
  for (const entry of entries) console.log(`${entry.classification}\t${entry.branch}${entry.worktreePath ? `\t${entry.worktreePath}` : ''}`);
  if (options.apply) {
    console.log(`REMOVED=${result.removed.join(',') || '(none)'}`);
    console.log(`DEFERRED=${result.deferred.join(',') || '(none)'}`);
  }
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`STATUS=BLOCKED\nREASON=${error.message}`); process.exit(1); }
}

module.exports = { classifyBranch, parseArgs, summarize, collectManagedOrphans };

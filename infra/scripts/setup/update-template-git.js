/**
 * Git helpers for the template update wrapper: shell-free command runner,
 * worktree detection, the local backfill baseline snapshot, and the
 * modified-file listing printed after a write.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function run(command, args, options = {}) {
  // Executable and argv come from fixed Git/Node call sites below. Keep shell
  // parsing disabled so target paths cannot become command syntax.
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, ...(options.env || {}) },
    shell: false,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function isGitWorktree(targetRoot) {
  const result = run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: targetRoot });
  return result.status === 0 && result.stdout.trim() === 'true';
}

function createBackfillBaseline(targetRoot) {
  if (!isGitWorktree(targetRoot)) {
    return { status: 'skipped', reason: 'target is not a git worktree' };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-backfill-baseline-'));
  const env = { GIT_INDEX_FILE: path.join(tempDir, 'index') };
  try {
    const head = run('git', ['rev-parse', '--verify', 'HEAD'], { cwd: targetRoot });
    const readTreeArgs = head.status === 0 ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'];
    const readTree = run('git', readTreeArgs, { cwd: targetRoot, env });
    if (readTree.status !== 0) throw new Error(`git ${readTreeArgs.join(' ')} failed: ${readTree.output.trim()}`);

    const add = run('git', ['add', '--all'], { cwd: targetRoot, env });
    if (add.status !== 0) throw new Error(`git add --all failed: ${add.output.trim()}`);

    const tree = run('git', ['write-tree'], { cwd: targetRoot, env });
    if (tree.status !== 0) throw new Error(`git write-tree failed: ${tree.output.trim()}`);

    const commitArgs = ['commit-tree', tree.stdout.trim(), '-m', 'agent: backfill baseline'];
    if (head.status === 0) commitArgs.push('-p', head.stdout.trim());
    const commit = run('git', commitArgs, {
      cwd: targetRoot,
      env: {
        ...env,
        GIT_AUTHOR_NAME: 'Agent Template',
        GIT_AUTHOR_EMAIL: 'agent-template@local.invalid',
        GIT_COMMITTER_NAME: 'Agent Template',
        GIT_COMMITTER_EMAIL: 'agent-template@local.invalid',
      },
    });
    if (commit.status !== 0) throw new Error(`git commit-tree failed: ${commit.output.trim()}`);

    const baseline = commit.stdout.trim();
    const updateRef = run('git', ['update-ref', 'refs/agent/backfill-baseline', baseline], { cwd: targetRoot });
    if (updateRef.status !== 0) throw new Error(`git update-ref failed: ${updateRef.output.trim()}`);
    return { status: 'created', ref: 'refs/agent/backfill-baseline', commit: baseline };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function collectGitNameStatus(targetRoot) {
  const output = [];
  const diff = run('git', ['diff', '--name-status'], { cwd: targetRoot });
  if (diff.status === 0 && diff.stdout.trim()) {
    output.push(...diff.stdout.trimEnd().split('\n'));
  }

  const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: targetRoot });
  if (untracked.status === 0 && untracked.stdout.trim()) {
    for (const file of untracked.stdout.trimEnd().split('\n')) {
      output.push(`A\t${file}`);
    }
  }

  return output;
}

module.exports = {
  collectGitNameStatus,
  createBackfillBaseline,
  isGitWorktree,
  run,
};

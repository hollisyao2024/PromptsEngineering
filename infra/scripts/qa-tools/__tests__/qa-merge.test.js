'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanupOrphanWorktreeDirs } = require('../qa-merge');
const { safeRemoveTreeNoFollow } = require('../../worktree-tools/worktree-core');

test('reclaims an empty orphan worktree when its session proves ownership', (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-merge-orphan-'));
  const mainRoot = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  const stale = path.join(worktreesRoot, 'tdd-stale');
  const active = path.join(worktreesRoot, 'tdd-active');
  fs.mkdirSync(path.join(mainRoot, '.git', 'worktrees'), { recursive: true });
  fs.mkdirSync(stale, { recursive: true });
  fs.mkdirSync(active, { recursive: true });
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: os.tmpdir() }));

  const result = cleanupOrphanWorktreeDirs(mainRoot, {
    config: {},
    worktreesRoot,
    readSessions: () => [{ branch: 'fix/stale', worktree: stale }],
    runListPorcelain: () => ({
      status: 0,
      stdout: `worktree ${mainRoot}\n\nworktree ${active}\nbranch refs/heads/fix/active\n`,
    }),
  });

  assert.deepEqual(result.removed, [stale]);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(active), true);
});

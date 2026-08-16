'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanupOrphanWorktreeDirs, upsertQaValidatedEntry } = require('../qa-merge');
const { safeRemoveTreeNoFollow } = require('../../worktree-tools/worktree-core');

const REAL_TMPDIR = fs.realpathSync(os.tmpdir());

test('reclaims an empty orphan worktree when its session proves ownership', (t) => {
  const container = fs.mkdtempSync(path.join(REAL_TMPDIR, 'qa-merge-orphan-'));
  const mainRoot = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  const stale = path.join(worktreesRoot, 'tdd-stale');
  const active = path.join(worktreesRoot, 'tdd-active');
  fs.mkdirSync(path.join(mainRoot, '.git', 'worktrees'), { recursive: true });
  fs.mkdirSync(stale, { recursive: true });
  fs.mkdirSync(active, { recursive: true });
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: REAL_TMPDIR }));

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

test('keeps an already-completed QA milestone stable across later PR merges', () => {
  const content = [
    '# Agent State',
    '',
    '- [x] 5. QA_VALIDATED',
    '',
    '## IN_PROGRESS',
    'branch: feature/next',
    'pr: 51',
    'step: qa',
    'started_at: 2026-08-16 10:00',
    '',
  ].join('\n');

  assert.equal(upsertQaValidatedEntry(content, 51, 'abcdef1', '2026-08-16'), content);
});

test('checks QA milestone without adding PR-specific history', () => {
  const content = '# Agent State\n\n- [ ] 5. QA_VALIDATED (发布前)\n';

  assert.equal(
    upsertQaValidatedEntry(content, 51, 'abcdef1', '2026-08-16'),
    '# Agent State\n\n- [x] 5. QA_VALIDATED\n'
  );
});

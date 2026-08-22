'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  auditQaPlanSessionStates,
  getQaPlanSessionStatePath,
} = require('../qa-plan-state-audit');
const { safeRemoveTreeNoFollow } = require('../worktree-safe-remove');

const realTemporaryRoot = fs.realpathSync(os.tmpdir());

function fixture() {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'qa-plan-state-audit-'));
  const mainRoot = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  const tmpRoot = path.join(container, 'tmp');
  const active = path.join(worktreesRoot, 'active');
  const stale = path.join(worktreesRoot, 'stale');
  fs.mkdirSync(mainRoot, { recursive: true });
  fs.mkdirSync(active, { recursive: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
  const config = {
    containerDirs: { tmp: tmpRoot, worktrees: worktreesRoot },
    worktree: { sessionDir: path.join(tmpRoot, 'worktree-sessions') },
  };
  return { container, mainRoot, tmpRoot, active, stale, config };
}

function writeState(input, worktreePath, payload = {}) {
  const statePath = getQaPlanSessionStatePath({
    mainRoot: input.mainRoot,
    worktreeRoot: worktreePath,
    config: input.config,
  });
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(payload)}\n`, 'utf8');
  return statePath;
}

test('QA plan state dry-run keeps registered worktrees and reports stale regular files without mutation', (t) => {
  const input = fixture();
  t.after(() => safeRemoveTreeNoFollow(input.container, { allowedRoot: realTemporaryRoot }));
  const activeState = writeState(input, input.active, { branch: 'feature/active' });
  const staleState = writeState(input, input.stale, { branch: 'feature/stale' });

  const result = auditQaPlanSessionStates({
    ...input,
    worktreePaths: [input.mainRoot, input.active],
    apply: false,
  });

  assert.deepEqual(result.counts, { active: 1, cleanup_candidate: 1 });
  assert.equal(fs.existsSync(activeState), true);
  assert.equal(fs.existsSync(staleState), true);
});

test('QA plan state apply deletes only an exact orphan and preserves a newly registered revalidation target', (t) => {
  const input = fixture();
  t.after(() => safeRemoveTreeNoFollow(input.container, { allowedRoot: realTemporaryRoot }));
  const activeState = writeState(input, input.active, { branch: 'feature/active' });
  const staleState = writeState(input, input.stale, { branch: 'feature/stale' });
  const result = auditQaPlanSessionStates({
    ...input,
    worktreePaths: [input.mainRoot],
    apply: true,
    listWorktrees: () => [{ path: input.mainRoot }, { path: input.active }],
  });

  assert.equal(fs.existsSync(activeState), true);
  assert.equal(fs.existsSync(staleState), false);
  assert.equal(result.records.some((record) => record.path === activeState && record.state === 'active'), true);
  assert.equal(result.records.some((record) => record.path === staleState && record.state === 'cleaned'), true);
});

test('QA plan state audit fails closed for linked entries and never touches their targets', (t) => {
  const input = fixture();
  t.after(() => safeRemoveTreeNoFollow(input.container, { allowedRoot: realTemporaryRoot }));
  const qaPlanDir = path.dirname(getQaPlanSessionStatePath({
    mainRoot: input.mainRoot,
    worktreeRoot: input.active,
    config: input.config,
  }));
  const external = path.join(input.container, 'external');
  fs.mkdirSync(qaPlanDir, { recursive: true });
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, 'sentinel.txt'), 'keep\n');
  fs.symlinkSync(external, path.join(qaPlanDir, 'linked-entry'), process.platform === 'win32' ? 'junction' : 'dir');

  const result = auditQaPlanSessionStates({
    ...input,
    worktreePaths: [input.mainRoot],
    apply: true,
  });

  assert.equal(result.status, 'ATTENTION');
  assert.equal(result.records[0].state, 'recovery_required');
  assert.equal(fs.readFileSync(path.join(external, 'sentinel.txt'), 'utf8'), 'keep\n');
  assert.equal(fs.existsSync(path.join(qaPlanDir, 'linked-entry')), true);
});

test('QA plan state apply preserves orphan candidates when Git worktree revalidation fails', (t) => {
  const input = fixture();
  t.after(() => safeRemoveTreeNoFollow(input.container, { allowedRoot: realTemporaryRoot }));
  const staleState = writeState(input, input.stale, { branch: 'feature/stale' });

  const result = auditQaPlanSessionStates({
    ...input,
    worktreePaths: [input.mainRoot],
    apply: true,
    listWorktrees: () => { throw new Error('simulated Git inspection failure'); },
  });

  assert.equal(result.status, 'ATTENTION');
  assert.equal(result.records[0].state, 'recovery_required');
  assert.match(result.records[0].reason, /worktree-revalidation-failed/u);
  assert.equal(fs.existsSync(staleState), true);
});

test('QA plan state path rejects a session directory outside the container tmp root', () => {
  const input = fixture();
  try {
    assert.throws(() => getQaPlanSessionStatePath({
      mainRoot: input.mainRoot,
      worktreeRoot: input.active,
      config: {
        ...input.config,
        worktree: { sessionDir: path.join(input.container, 'outside') },
      },
    }), /invalid runtime path:.*must be inside container tmp/u);
  } finally {
    safeRemoveTreeNoFollow(input.container, { allowedRoot: realTemporaryRoot });
  }
});

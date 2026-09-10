'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('node:child_process');
const {
  cleanupOrphanWorktreeDirs,
  upsertQaValidatedEntry,
  updateAgentState,
  printSummary,
} = require('../qa-merge');
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

function milestoneFixture(t, content) {
  const root = fs.mkdtempSync(path.join(REAL_TMPDIR, 'qa-merge-state-'));
  t.after(() => safeRemoveTreeNoFollow(root, { allowedRoot: REAL_TMPDIR }));
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  const file = path.join(root, 'docs', 'AGENT_STATE.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (content !== undefined) fs.writeFileSync(file, content);
  const output = [];
  t.mock.method(console, 'log', (...args) => output.push(args.join(' ')));
  return {
    root,
    file,
    output,
    summary(result) {
      printSummary({ number: 84, title: 'QA milestone' }, 'codex/qa-state', 'abcdef1', 'gh', result, '', root);
      return output.join('\n');
    },
  };
}

test('reports an already-completed milestone as successful without any file write', (t) => {
  const content = '# Agent State\n\n- [x] 5. QA_VALIDATED\n\nProject notes stay intact.\n';
  const fixture = milestoneFixture(t, content);
  const before = fs.statSync(fixture.file, { bigint: true });
  const writes = t.mock.method(fs, 'writeFileSync');

  const result = updateAgentState(fixture.root, 84, 'abcdef1');
  const output = fixture.summary(result);

  assert.doesNotMatch(output, /警告|更新失败|请手动勾选/u);
  assert.match(output, /QA_VALIDATED.*已完成/u);
  assert.deepEqual(result, { status: 'already-complete' });
  assert.equal(writes.mock.callCount(), 0);
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), content);
  assert.equal(fs.statSync(fixture.file, { bigint: true }).mtimeNs, before.mtimeNs);
});

test('checks an unfinished milestone once and preserves it on subsequent merges', (t) => {
  const fixture = milestoneFixture(t, '# Agent State\n\n- [ ] 5. QA_VALIDATED (发布前)\n');
  const writes = t.mock.method(fs, 'writeFileSync');
  const first = updateAgentState(fixture.root, 84, 'abcdef1');
  assert.match(fixture.summary(first), /AGENT_STATE\.md 已更新/u);
  assert.deepEqual(first, { status: 'updated' });
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), '# Agent State\n\n- [x] 5. QA_VALIDATED\n');

  const second = updateAgentState(fixture.root, 85, 'abcdef2');
  assert.deepEqual(second, { status: 'already-complete' });
  assert.equal(writes.mock.callCount(), 1);
  assert.doesNotMatch(fixture.summary(second), /更新失败|请手动勾选/u);
});

test('retains initialization of a missing milestone in an existing state document', (t) => {
  const fixture = milestoneFixture(t, '# Agent State\n\n- [x] 4. TDD_DONE\n');
  const result = updateAgentState(fixture.root, 84, 'abcdef1');
  assert.deepEqual(result, { status: 'updated' });
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), '# Agent State\n\n- [x] 4. TDD_DONE\n\n- [x] 5. QA_VALIDATED\n');
});

test('reports an absent state file as skipped and never fabricates an update failure', (t) => {
  const fixture = milestoneFixture(t);
  const result = updateAgentState(fixture.root, 84, 'abcdef1');
  const output = fixture.summary(result);
  assert.deepEqual(result, { status: 'missing' });
  assert.match(output, /AGENT_STATE\.md 不存在.*跳过/u);
  assert.doesNotMatch(output, /更新失败|请手动勾选/u);
  assert.equal(fs.existsSync(fixture.file), false);
});

test('retains read failures in the merge summary instead of marking them complete', (t) => {
  const fixture = milestoneFixture(t);
  fs.mkdirSync(fixture.file);
  const result = updateAgentState(fixture.root, 84, 'abcdef1');
  assert.equal(result.status, 'failed');
  assert.match(result.error, /EISDIR/u);
  assert.match(fixture.summary(result), /更新失败.*EISDIR/u);
  assert.equal(fs.statSync(fixture.file).isDirectory(), true);
});

test('retains write failures in the summary and preserves the unfinished milestone', (t) => {
  const content = '# Agent State\n\n- [ ] 5. QA_VALIDATED\n';
  const fixture = milestoneFixture(t, content);
  const originalWrite = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    if (file === fixture.file) throw new Error('EACCES: state file is read-only');
    return originalWrite(file, ...args);
  });

  const result = updateAgentState(fixture.root, 84, 'abcdef1');
  assert.equal(result.status, 'failed');
  assert.match(result.error, /EACCES/u);
  assert.match(fixture.summary(result), /更新失败.*EACCES/u);
  assert.equal(fs.readFileSync(fixture.file, 'utf8'), content);
});

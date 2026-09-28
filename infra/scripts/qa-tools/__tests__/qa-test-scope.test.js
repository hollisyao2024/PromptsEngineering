'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyTestScopeEvidence } = require('../qa-test-scope');

const HEAD = 'a'.repeat(40);
const ROOT = '/project/repo';
const WORKTREE = '/project/worktrees/change';
const BRANCH = 'codex/change';
const context = { projectRoot: ROOT, worktree: WORKTREE, branch: BRANCH };

function decision(overrides = {}) {
  return {
    version: 1,
    mode: 'targeted',
    impact_paths: ['infra/scripts/qa-tools/qa-verify.js'],
    commands: ['node --test qa-test-scope.test.js'],
    not_run: ['business E2E'],
    reason: 'Only the QA receipt path changed.',
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    version: 1,
    head_sha: HEAD,
    environment: 'Node 22 on macOS',
    dependencies: 'No dependency change',
    checks: [{
      command: 'node --test qa-test-scope.test.js',
      exit_code: 0,
      evidence: 'task evidence/qa-test-scope.log',
    }],
    ...overrides,
  };
}

function state(records = [
  `TEST_SCOPE_DECISION=${JSON.stringify(decision())}`,
  `TEST_SCOPE_RESULT=${JSON.stringify(result())}`,
], overrides = {}) {
  return {
    task_id: 'change', task_type: 'mutation', status: 'running',
    project_root: ROOT, worktree: WORKTREE, branch: BRANCH,
    steps: [{ evidence: records }],
    ...overrides,
  };
}

function verify(states, overrides = {}) {
  return verifyTestScopeEvidence({ states, context, headSha: HEAD, ...overrides });
}

test('targeted and static decisions with matching successful checks are accepted', () => {
  assert.equal(verify([state()]).taskId, 'change');
  const staticDecision = decision({ mode: 'static', commands: ['git diff --check'], not_run: ['business tests'] });
  const staticResult = result({ checks: [{ command: 'git diff --check', exit_code: 0, evidence: 'clean diff' }] });
  assert.equal(verify([state([
    `TEST_SCOPE_DECISION=${JSON.stringify(staticDecision)}`,
    `TEST_SCOPE_RESULT=${JSON.stringify(staticResult)}`,
  ])]).mode, 'static');
});

test('full scope requires a recognized trigger and investigation evidence', () => {
  const full = decision({ mode: 'full', full_trigger: 'unbounded_after_investigation', trigger_evidence: 'Caller map spans unknown packages.' });
  assert.equal(verify([state([`TEST_SCOPE_DECISION=${JSON.stringify(full)}`, `TEST_SCOPE_RESULT=${JSON.stringify(result())}`])]).mode, 'full');
  for (const bad of [
    decision({ mode: 'full' }),
    decision({ mode: 'full', full_trigger: 'file_count', trigger_evidence: 'Many files.' }),
    decision({ mode: 'full', full_trigger: 'whole_scope_impact', trigger_evidence: '' }),
  ]) {
    assert.throws(() => verify([state([`TEST_SCOPE_DECISION=${JSON.stringify(bad)}`, `TEST_SCOPE_RESULT=${JSON.stringify(result())}`])]), /full_trigger|trigger_evidence/);
  }
});

test('missing, foreign and ambiguous mutation tasks cannot supply QA evidence', () => {
  assert.throws(() => verify([]), /matching mutation task/);
  assert.throws(() => verify([state(undefined, { worktree: '/project/worktrees/other' })]), /matching mutation task/);
  assert.throws(() => verify([state(), state(undefined, { task_id: 'duplicate' })]), /ambiguous mutation tasks/);
  assert.throws(() => verify([state(undefined, { branch: 'other-branch' })]), /matching mutation task/);
});

test('an exact non-mutation task keeps the existing QA path', () => {
  assert.deepEqual(verify([state([], { task_type: 'operation' })]), { skipped: true });
});

test('malformed or incomplete decisions block QA', () => {
  for (const records of [
    [`TEST_SCOPE_DECISION={bad`, `TEST_SCOPE_RESULT=${JSON.stringify(result())}`],
    [`TEST_SCOPE_DECISION=${JSON.stringify(decision({ impact_paths: [] }))}`, `TEST_SCOPE_RESULT=${JSON.stringify(result())}`],
    [`TEST_SCOPE_DECISION=${JSON.stringify(decision({ commands: [] }))}`, `TEST_SCOPE_RESULT=${JSON.stringify(result())}`],
    [`TEST_SCOPE_RESULT=${JSON.stringify(result())}`],
  ]) {
    assert.throws(() => verify([state(records)]), /TEST_SCOPE_DECISION|impact_paths|commands/);
  }
});

test('missing, failed, unbound and mismatched results block QA', () => {
  const cases = [
    [`TEST_SCOPE_DECISION=${JSON.stringify(decision())}`],
    [`TEST_SCOPE_DECISION=${JSON.stringify(decision())}`, `TEST_SCOPE_RESULT=${JSON.stringify(result({ head_sha: 'b'.repeat(40) }))}`],
    [`TEST_SCOPE_DECISION=${JSON.stringify(decision())}`, `TEST_SCOPE_RESULT=${JSON.stringify(result({ checks: [{ command: 'node --test qa-test-scope.test.js', exit_code: 1, evidence: 'failure' }] }))}`],
    [`TEST_SCOPE_DECISION=${JSON.stringify(decision())}`, `TEST_SCOPE_RESULT=${JSON.stringify(result({ checks: [{ command: 'some other check', exit_code: 0, evidence: 'log' }] }))}`],
    [`TEST_SCOPE_DECISION=${JSON.stringify(decision())}`, `TEST_SCOPE_RESULT=${JSON.stringify(result({ checks: [{ command: 'node --test qa-test-scope.test.js', exit_code: 0, evidence: '' }] }))}`],
  ];
  for (const records of cases) assert.throws(() => verify([state(records)]), /TEST_SCOPE_RESULT|head_sha|checks|exit_code|evidence/);
});

test('a result must follow the latest decision; template source keeps its existing path', () => {
  const records = [
    `TEST_SCOPE_RESULT=${JSON.stringify(result())}`,
    `TEST_SCOPE_DECISION=${JSON.stringify(decision())}`,
  ];
  assert.throws(() => verify([state(records)]), /TEST_SCOPE_RESULT/);
  assert.deepEqual(verifyTestScopeEvidence({ states: [], context, headSha: HEAD, templateSource: true }), { skipped: true });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

function backflowState() {
  return state([], {
    steps: [
      { id: 'S5', evidence: [`TEST_SCOPE_RESULT=${JSON.stringify(result())}`] },
      { id: 'S9', evidence: [`TEST_SCOPE_DECISION=${JSON.stringify(decision())}`] },
    ],
    evidence_order: [{ step_id: 'S9', index: 0 }, { step_id: 'S5', index: 0 }],
  });
}

test('QA accepts a later checkpoint result in an earlier step', () => {
  assert.equal(verify([backflowState()]).mode, 'targeted');
});

test('QA rejects an old result before a new decision across steps', () => {
  const task = backflowState();
  task.evidence_order.reverse();
  assert.throws(() => verify([task]), /missing after the latest decision/);
});

function evidenceLogFixture(t, content = 'ok\n') {
  const runsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-test-scope-'));
  t.after(() => fs.rmSync(runsRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(runsRoot, 'change', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(runsRoot, 'change', 'evidence', 'qa.log'), content);
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  return { runsRoot, sha256 };
}

function withEvidence(evidence) {
  return [
    `TEST_SCOPE_DECISION=${JSON.stringify(decision())}`,
    `TEST_SCOPE_RESULT=${JSON.stringify(result({ checks: [{ command: 'node --test qa-test-scope.test.js', exit_code: 0, evidence }] }))}`,
  ];
}

test('evidence log references with sha256 must point at an existing, matching task evidence file', (t) => {
  const { runsRoot, sha256 } = evidenceLogFixture(t);
  assert.equal(verify([state(withEvidence(`task exec evidence/qa.log sha256=${sha256}`))], { runsRoot }).taskId, 'change');
  assert.throws(() => verify([state(withEvidence(`evidence/qa.log sha256=${'0'.repeat(64)}`))], { runsRoot }), /sha256/);
  assert.throws(() => verify([state(withEvidence(`evidence/missing.log sha256=${sha256}`))], { runsRoot }), /evidence file/);
  // Evidence without a log reference is still accepted; without runsRoot the reference is not checked (legacy callers).
  assert.equal(verify([state(withEvidence('task evidence/qa-test-scope.log'))], { runsRoot }).taskId, 'change');
  assert.equal(verify([state(withEvidence(`evidence/missing.log sha256=${sha256}`))]).taskId, 'change');
});

test('QA fails closed on missing, duplicate and invalid evidence references', () => {
  for (const order of [null, [], [{ step_id: 'S9', index: 0 }],
    [{ step_id: 'S9', index: 0 }, { step_id: 'S9', index: 0 }],
    [{ step_id: 'S9', index: 0 }, { step_id: 'S5', index: 1 }]]) {
    const task = backflowState(); task.evidence_order = order;
    assert.throws(() => verify([task]), /evidence_order/);
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseCliArgs, readRecordedModelReview, recordModelReview } = require('../tdd-review-gate');
const { createTask, readTaskState } = require('../../agent-runner/agent-task');

// The review gate used to be advisory only: nothing recorded the executor's "semantic review required/optional"
// verdict, so qa verify and the PR body could not prove the gate was honoured. `--record` writes the decision into
// the current task step as REVIEW_DECISION evidence and tdd push surfaces it.
test('parseCliArgs accepts --record, --reason and --task and rejects unknown record values', () => {
  assert.deepEqual(parseCliArgs(['--base', 'main', '--json']), {
    baseBranch: 'main', json: true, record: '', reason: '', taskId: '',
  });
  assert.deepEqual(parseCliArgs(['--record', 'required', '--reason', 'shared base lib', '--task', 'demo']), {
    baseBranch: '', json: false, record: 'required', reason: 'shared base lib', taskId: 'demo',
  });
  assert.deepEqual(parseCliArgs(['--record=optional', '--reason=docs', '--task=demo']).record, 'optional');
  assert.throws(() => parseCliArgs(['--record', 'maybe']), /--record/u);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'review-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = {
    runsRoot: path.join(root, 'agent-task-runs'),
    lockDir: path.join(root, 'agent-locks'),
    projectRoot: path.join(root, 'repo'),
    worktree: path.join(root, 'worktree'),
  };
  fs.mkdirSync(paths.projectRoot, { recursive: true });
  fs.mkdirSync(paths.worktree, { recursive: true });
  createTask({
    ...paths,
    taskId: 'demo-task',
    goal: 'ship',
    taskType: 'mutation',
    branch: 'feature/demo',
    steps: [{ title: 'implement', replay: 'safe' }, { title: 'push', replay: 'verify_first' }],
    acceptanceCriteria: ['done'],
    constraints: [],
    now: '2026-10-10T01:00:00.000Z',
  });
  return paths;
}

test('recordModelReview writes a REVIEW_DECISION evidence line to the current step and reads it back', (t) => {
  const paths = fixture(t);
  const written = recordModelReview({
    runsRoot: paths.runsRoot, lockDir: paths.lockDir, taskId: 'demo-task',
    decision: 'required', reason: 'touches shared base lib', headSha: 'a'.repeat(40), baseRef: 'origin/main',
    now: '2026-10-10T02:00:00.000Z',
  });
  assert.equal(written.stepId, 'S1');
  assert.deepEqual(written.record, {
    version: 1, decision: 'required', reason: 'touches shared base lib', head_sha: 'a'.repeat(40), base_ref: 'origin/main',
  });

  const state = readTaskState({ runsRoot: paths.runsRoot, taskId: 'demo-task' });
  const step = state.steps.find((item) => item.id === 'S1');
  assert.equal(step.status, 'running', 'recording the decision must not complete the step');
  const line = step.evidence.find((entry) => (entry.text || entry).startsWith('REVIEW_DECISION='));
  assert.ok(line, 'evidence line present');
  assert.deepEqual(JSON.parse(String(line.text || line).slice('REVIEW_DECISION='.length)), written.record);

  assert.deepEqual(readRecordedModelReview({ runsRoot: paths.runsRoot, taskId: 'demo-task' }), written.record);
  assert.equal(readRecordedModelReview({ runsRoot: paths.runsRoot, taskId: 'missing-task' }), undefined);
  assert.throws(() => recordModelReview({
    runsRoot: paths.runsRoot, lockDir: paths.lockDir, taskId: 'demo-task', decision: 'maybe', reason: 'x',
  }), /decision/u);
});

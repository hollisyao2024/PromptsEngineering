'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  cancelTask,
  checkpointTask,
  createTask,
  finishTask,
  parseCliArgs,
  readTaskState,
  resumeTask,
  safeTaskId,
  selectTaskState,
} = require('../agent-task');

const realTemporaryRoot = fs.realpathSync(os.tmpdir());

function fixture(t) {
  const root = fs.mkdtempSync(path.join(realTemporaryRoot, 'agent-task-'));
  const runsRoot = path.join(root, 'agent-task-runs');
  const lockDir = path.join(root, 'agent-locks');
  const projectRoot = path.join(root, 'repo');
  const worktree = path.join(root, 'worktree');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, runsRoot, lockDir, projectRoot, worktree };
}

function startInput(paths, overrides = {}) {
  return {
    ...paths,
    taskId: 'durable-task',
    goal: 'Finish every verified step',
    taskType: 'operation',
    branch: 'feature/durable-task',
    steps: [
      { title: 'inspect', replay: 'safe' },
      { title: 'publish', replay: 'verify_first' },
    ],
    acceptanceCriteria: ['all steps verified'],
    constraints: ['never replay unknown side effects'],
    now: '2026-08-16T01:00:00.000Z',
    ...overrides,
  };
}

test('creates one authoritative task state and refuses duplicate task ids', (t) => {
  const paths = fixture(t);
  const created = createTask(startInput(paths));
  const statePath = path.join(paths.runsRoot, 'durable-task', 'state.json');

  assert.equal(created.task_id, 'durable-task');
  assert.equal(created.steps[0].id, 'S1');
  assert.equal(created.steps[1].replay, 'verify_first');
  assert.equal(fs.existsSync(statePath), true);
  assert.deepEqual(readTaskState({ runsRoot: paths.runsRoot, taskId: 'durable-task' }), created);
  assert.throws(() => createTask(startInput(paths)), /already exists/i);
  assert.throws(() => createTask(startInput(paths, {
    taskId: 'bad-type-task',
    taskType: 'mutatoin',
  })), /invalid task type/i);
});

test('CLI keeps --step compatible between start declarations and checkpoints', () => {
  const started = parseCliArgs([
    'start', '--task', 'durable-task', '--desc', 'goal', '--step', 'inspect', '--verify-step', 'publish',
  ]);
  assert.deepEqual(started.steps, [
    { title: 'inspect', replay: 'safe' },
    { title: 'publish', replay: 'verify_first' },
  ]);

  const checkpoint = parseCliArgs([
    '--', 'checkpoint', '--task', 'durable-task', '--step', 'S1', '--status', 'done', '--evidence=exit=0',
  ]);
  assert.equal(checkpoint.stepId, 'S1');
  assert.deepEqual(checkpoint.steps, []);
  assert.deepEqual(checkpoint.evidence, ['exit=0']);
});

test('checkpoints completed steps only with evidence and advances deterministically', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths));

  assert.throws(() => checkpointTask({
    ...paths,
    taskId: 'durable-task',
    stepId: 'S1',
    status: 'done',
  }), /evidence/i);

  const updated = checkpointTask({
    ...paths,
    taskId: 'durable-task',
    stepId: 'S1',
    status: 'done',
    evidence: ['command exit=0'],
    nextAction: 'verify publish state',
    now: '2026-08-16T01:01:00.000Z',
  });

  assert.equal(updated.steps[0].status, 'done');
  assert.deepEqual(updated.steps[0].evidence, ['command exit=0']);
  assert.equal(updated.current_step, 'S2');
  assert.equal(updated.next_action, 'verify publish state');
});

test('resume rewinds safe interrupted work but fences verify-first side effects', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths));
  checkpointTask({
    ...paths,
    taskId: 'durable-task',
    stepId: 'S1',
    status: 'running',
    nextAction: 'inspect repository',
  });

  const safeResume = resumeTask({ ...paths, taskId: 'durable-task' });
  assert.equal(safeResume.steps[0].status, 'pending');
  assert.equal(safeResume.status, 'running');
  assert.match(safeResume.last_error.message, /interrupted/i);

  checkpointTask({
    ...paths,
    taskId: 'durable-task',
    stepId: 'S1',
    status: 'done',
    evidence: ['inspection complete'],
  });
  checkpointTask({
    ...paths,
    taskId: 'durable-task',
    stepId: 'S2',
    status: 'running',
    nextAction: 'publish once',
  });

  const fenced = resumeTask({ ...paths, taskId: 'durable-task' });
  assert.equal(fenced.steps[1].status, 'verify_required');
  assert.equal(fenced.status, 'blocked');
  assert.match(fenced.next_action, /verify/i);
});

test('auto selection binds to worktree and blocks ambiguous project tasks', (t) => {
  const paths = fixture(t);
  const first = createTask(startInput(paths));
  const otherWorktree = path.join(paths.root, 'other-worktree');
  fs.mkdirSync(otherWorktree);
  const second = createTask(startInput(paths, {
    taskId: 'other-task',
    branch: 'feature/other-task',
    worktree: otherWorktree,
  }));

  const selected = selectTaskState([first, second], {
    projectRoot: paths.projectRoot,
    worktree: paths.worktree,
    branch: 'feature/durable-task',
  });
  assert.equal(selected.task_id, 'durable-task');

  assert.throws(() => selectTaskState([first, second], {
    projectRoot: paths.projectRoot,
    worktree: paths.projectRoot,
    branch: 'main',
  }), /ambiguous/i);
});

test('state reads ignore temporary write remnants and fail closed on corrupt authority', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths));
  const taskDir = path.join(paths.runsRoot, 'durable-task');
  fs.writeFileSync(path.join(taskDir, 'state.json.tmp-crash'), '{partial');

  const valid = readTaskState({ runsRoot: paths.runsRoot, taskId: 'durable-task' });
  assert.equal(valid.task_id, 'durable-task');
  assert.equal(valid.status, 'running');

  fs.writeFileSync(path.join(taskDir, 'state.json'), '{corrupt');
  assert.throws(
    () => readTaskState({ runsRoot: paths.runsRoot, taskId: 'durable-task' }),
    /invalid task state/i,
  );
});

test('state reads reject a symlinked task runs root', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths));
  const linkedRoot = path.join(paths.root, 'linked-task-runs');
  fs.symlinkSync(paths.runsRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');

  assert.throws(
    () => readTaskState({ runsRoot: linkedRoot, taskId: 'durable-task' }),
    /real directory/i,
  );
  assert.equal(readTaskState({ runsRoot: paths.runsRoot, taskId: 'durable-task' }).status, 'running');
});

test('finish blocks incomplete evidence and invokes the mutation completion guard', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths, { taskType: 'mutation' }));
  let guardCalls = 0;

  const incomplete = finishTask({
    ...paths,
    taskId: 'durable-task',
    completionGuard: () => {
      guardCalls += 1;
      return { ok: true, output: 'STATUS=OK' };
    },
  });
  assert.equal(incomplete.status, 'BLOCKED');
  assert.match(incomplete.nextAction, /S1/);
  assert.equal(guardCalls, 0);

  for (const stepId of ['S1', 'S2']) {
    checkpointTask({
      ...paths,
      taskId: 'durable-task',
      stepId,
      status: 'done',
      evidence: [`${stepId} verified`],
    });
  }
  checkpointTask({
    ...paths,
    taskId: 'durable-task',
    acceptanceId: 'AC1',
    status: 'done',
    evidence: ['acceptance verified'],
  });

  const guardBlocked = finishTask({
    ...paths,
    taskId: 'durable-task',
    completionGuard: () => {
      guardCalls += 1;
      return { ok: false, output: 'STATUS=BLOCKED' };
    },
  });
  assert.equal(guardBlocked.status, 'BLOCKED');
  assert.match(guardBlocked.nextAction, /completion guard/i);
  assert.equal(guardCalls, 1);
  assert.equal(fs.existsSync(path.join(paths.runsRoot, 'durable-task')), true);
});

test('successful finish deletes only the owned task directory', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths));
  createTask(startInput(paths, { taskId: 'neighbor-task' }));
  for (const stepId of ['S1', 'S2']) {
    checkpointTask({ ...paths, taskId: 'durable-task', stepId, status: 'done', evidence: ['verified'] });
  }
  checkpointTask({
    ...paths,
    taskId: 'durable-task',
    acceptanceId: 'AC1',
    status: 'done',
    evidence: ['accepted'],
  });

  const result = finishTask({ ...paths, taskId: 'durable-task' });
  assert.equal(result.status, 'OK');
  assert.equal(result.taskId, 'durable-task');
  assert.equal(fs.existsSync(path.join(paths.runsRoot, 'durable-task')), false);
  assert.equal(fs.existsSync(path.join(paths.runsRoot, 'neighbor-task')), true);
});

test('finish recreates cleanup-pending state when physical deletion fails', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths, {
    steps: [{ title: 'inspect', replay: 'safe' }],
  }));
  checkpointTask({ ...paths, taskId: 'durable-task', stepId: 'S1', status: 'done', evidence: ['verified'] });
  checkpointTask({
    ...paths,
    taskId: 'durable-task',
    acceptanceId: 'AC1',
    status: 'done',
    evidence: ['accepted'],
  });

  const result = finishTask({
    ...paths,
    taskId: 'durable-task',
    removeTree: () => {
      fs.rmSync(path.join(paths.runsRoot, 'durable-task'), { recursive: true, force: true });
      throw new Error('simulated partial delete');
    },
  });
  const retained = readTaskState({ runsRoot: paths.runsRoot, taskId: 'durable-task' });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(retained.status, 'cleanup_pending');
  assert.match(retained.last_error.message, /partial delete/i);
});

test('cancel requires force and rejects unsafe task identifiers', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths));

  assert.throws(() => cancelTask({ ...paths, taskId: 'durable-task', force: false }), /--force/);
  assert.throws(() => safeTaskId('../escape'), /invalid task id/i);

  const result = cancelTask({ ...paths, taskId: 'durable-task', force: true });
  assert.equal(result.status, 'CANCELLED');
  assert.equal(fs.existsSync(path.join(paths.runsRoot, 'durable-task')), false);
});

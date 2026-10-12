'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  bindTaskLocation,
  cancelTask,
  checkpointTask,
  createTask,
  extendTask,
  finishTask,
  parseCliArgs,
  readTaskState,
  runMutationCompletionGuard,
  safeTaskId,
} = require('../agent-task');
const { fixture, startInput } = require('./agent-task.helpers');

test('finish blocks incomplete evidence and invokes the mutation completion guard', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths, { taskType: undefined }));
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

function completeDurableMutationTask(paths) {
  createTask(startInput(paths, { taskType: 'mutation' }));
  for (const stepId of ['S1', 'S2']) {
    checkpointTask({ ...paths, taskId: 'durable-task', stepId, status: 'done', evidence: ['verified'] });
  }
  checkpointTask({ ...paths, taskId: 'durable-task', acceptanceId: 'AC1', status: 'done', evidence: ['accepted'] });
}

test('finish runs the completion guard without holding the task lock', (t) => {
  const paths = fixture(t);
  completeDurableMutationTask(paths);
  const lockPath = path.join(paths.lockDir, 'agent-task-durable-task.lock');
  let guardCalls = 0;

  const result = finishTask({
    ...paths,
    taskId: 'durable-task',
    completionGuard: (state) => {
      guardCalls += 1;
      assert.equal(state.task_id, 'durable-task');
      assert.equal(fs.existsSync(lockPath), false, 'guard must not run under the task lock');
      // The real guard rebinds lifecycle task locations, which takes the same task lock.
      const bound = bindTaskLocation({
        ...paths,
        taskId: 'durable-task',
        worktree: path.join(paths.root, 'rebound-worktree'),
        branch: 'feature/rebound',
      });
      assert.equal(bound.status, 'BOUND');
      return { ok: true, output: 'STATUS=OK' };
    },
  });

  assert.equal(result.status, 'OK');
  assert.equal(guardCalls, 1);
  assert.equal(fs.existsSync(path.join(paths.runsRoot, 'durable-task')), false);
  assert.equal(fs.existsSync(lockPath), false);
});

test('finish re-validates task state after an unlocked completion guard', (t) => {
  const paths = fixture(t);
  completeDurableMutationTask(paths);

  const result = finishTask({
    ...paths,
    taskId: 'durable-task',
    completionGuard: () => {
      extendTask({
        ...paths,
        taskId: 'durable-task',
        reason: 'scope grew while the guard ran',
        steps: [{ title: 'late step', replay: 'safe' }],
      });
      return { ok: true, output: 'STATUS=OK' };
    },
  });

  assert.equal(result.status, 'BLOCKED');
  assert.match(result.nextAction, /S3/);
  const retained = readTaskState({ runsRoot: paths.runsRoot, taskId: 'durable-task' });
  assert.equal(retained.status, 'running');
});

test('mutation completion guard scopes the subprocess to the finishing task', () => {
  let invocation;
  const result = runMutationCompletionGuard({
    project_root: '/repo',
    task_id: 'cloud-sync-implementation',
  }, {
    spawnSync: (command, args, options) => {
      invocation = { command, args, options };
      return { status: 0, stdout: 'STATUS=OK\n', stderr: '' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, [
    'infra/scripts/tdd-tools/tdd-completion-guard.js',
    '--task',
    'cloud-sync-implementation',
  ]);
  assert.equal(invocation.options.cwd, '/repo');
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


test('checkpoint persists cross-step ordering and recovery with evidence atomically', t => {
  const input = startInput(fixture(t));
  assert.deepEqual(createTask(input).evidence_order, []);
  checkpointTask({ ...input, stepId: 'S2', status: 'running', evidence: ['decision'] });
  checkpointTask({ ...input, stepId: 'S1', status: 'done', evidence: ['result', 'review'] });
  checkpointTask({ ...input, stepId: 'S2', status: 'blocked', failureKind: 'tool_error',
    executionState: 'not_started', evidence: ['failure'], nextAction: 'Recover' });
  const state = checkpointTask({ ...input, stepId: 'S2', status: 'done',
    recoveryEvidence: 'verified recovery', evidence: ['success'] });
  assert.deepEqual(state.evidence_order, [
    { step_id: 'S2', index: 0 }, { step_id: 'S1', index: 0 }, { step_id: 'S1', index: 1 },
    { step_id: 'S2', index: 1 }, { step_id: 'S2', index: 2 }, { step_id: 'S2', index: 3 },
  ]);
  assert.deepEqual(readTaskState(input), state);
});

test('legacy v1 and v2 histories seed established order without timestamp guesses', t => {
  for (const version of [1, 2]) {
    const input = startInput(fixture(t)); const initial = createTask(input);
    delete initial.evidence_order; initial.schema_version = version;
    if (version === 1) for (const key of ['current_phase', 'phase_history', 'plan_revision', 'plan_history']) delete initial[key];
    initial.steps[0].evidence = ['old first']; initial.steps[0].updated_at = '2099-01-01T00:00:00Z';
    initial.steps[1].evidence = ['old second'];
    const file = path.join(input.runsRoot, input.taskId, 'state.json');
    fs.writeFileSync(file, JSON.stringify(initial));
    const state = checkpointTask({ ...input, stepId: 'S1', status: 'running', evidence: ['new checkpoint'] });
    assert.equal(state.schema_version, 2);
    assert.deepEqual(state.evidence_order, [{ step_id: 'S1', index: 0 }, { step_id: 'S2', index: 0 }, { step_id: 'S1', index: 1 }]);
    assert.deepEqual(state.steps[0].evidence, ['old first', 'new checkpoint']);
  }
});

test('corrupt ordering blocks state reads and checkpoints without rewriting history', t => {
  const input = startInput(fixture(t)); const initial = createTask(input);
  initial.steps[0].evidence = ['lost reference'];
  const file = path.join(input.runsRoot, input.taskId, 'state.json');
  const raw = JSON.stringify(initial); fs.writeFileSync(file, raw);
  assert.throws(() => readTaskState(input), /evidence_order/);
  assert.throws(() => checkpointTask({ ...input, stepId: 'S1', status: 'running', evidence: ['new'] }), /evidence_order/);
  assert.equal(fs.readFileSync(file, 'utf8'), raw);
});

test('checkpoint marks every repeated --acceptance-id done with the shared evidence', (t) => {
  const paths = fixture(t);
  const input = startInput(paths, { acceptanceCriteria: ['first result', 'second result', 'third result'] });
  createTask(input);
  const cli = parseCliArgs([
    'checkpoint', '--task', 'durable-task', '--acceptance-id', 'AC1', '--acceptance-id=AC3',
    '--status', 'done', '--evidence', 'verified together',
  ]);
  assert.deepEqual(cli.acceptanceIds, ['AC1', 'AC3']);
  const state = checkpointTask({ ...input, acceptanceIds: cli.acceptanceIds, status: 'done', evidence: ['verified together'] });
  assert.deepEqual(state.acceptance_criteria.map((item) => item.status), ['done', 'pending', 'done']);
  assert.deepEqual(state.acceptance_criteria[2].evidence, ['verified together']);

  assert.throws(
    () => checkpointTask({ ...input, acceptanceIds: ['AC2', 'AC9'], status: 'done', evidence: ['x'] }),
    /unknown acceptance criterion: AC9/u,
  );
  const unchanged = checkpointTask({ ...input, acceptanceId: 'AC1', status: 'done', evidence: ['legacy single id'] });
  assert.equal(unchanged.acceptance_criteria[1].status, 'pending', 'a rejected batch must not mark any criterion');
});

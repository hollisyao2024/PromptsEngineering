'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  bindTaskLocation,
  checkpointTask,
  createTask,
  extendTask,
  parseCliArgs,
  readTaskState,
  resumeTask,
  selectTaskState,
  transitionTaskPhase,
} = require('../agent-task');
const { fixture, startInput } = require('./agent-task.helpers');

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

test('defaults long tasks to mutation and records an explicit starting phase', (t) => {
  const paths = fixture(t);
  const created = createTask(startInput(paths, {
    taskType: undefined,
    phase: 'prd',
  }));

  assert.equal(created.task_type, 'mutation');
  assert.equal(created.current_phase, 'prd');
  assert.equal(created.plan_revision, 1);
  assert.deepEqual(created.phase_history.map((entry) => entry.phase), ['prd']);
});

test('mutation tasks require explicit acceptance before task state is created', (t) => {
  const paths = fixture(t);

  assert.throws(() => createTask(startInput(paths, {
    taskType: undefined,
    acceptanceCriteria: [],
  })), /mutation tasks require at least one explicit --acceptance/i);
  assert.equal(fs.existsSync(path.join(paths.runsRoot, 'durable-task')), false);

  const created = createTask(startInput(paths, {
    taskId: 'accepted-mutation',
    taskType: undefined,
    acceptanceCriteria: ['observable result verified'],
  }));
  assert.deepEqual(created.acceptance_criteria.map((item) => item.text), ['observable result verified']);
});

test('read-only task types keep the goal as their default acceptance', (t) => {
  const paths = fixture(t);

  for (const taskType of ['diagnose', 'research', 'operation']) {
    const goal = `${taskType} the current state`;
    const created = createTask(startInput(paths, {
      taskId: `${taskType}-task`,
      taskType,
      goal,
      acceptanceCriteria: [],
    }));
    assert.deepEqual(created.acceptance_criteria.map((item) => item.text), [goal]);
  }
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

  const extended = parseCliArgs([
    'extend', '--task', 'durable-task', '--add-step', 'inspect more',
    '--add-verify-step', 'publish more', '--add-acceptance', 'new output verified',
    '--reason', 'scope clarified',
  ]);
  assert.deepEqual(extended.steps, [
    { title: 'inspect more', replay: 'safe' },
    { title: 'publish more', replay: 'verify_first' },
  ]);
  assert.deepEqual(extended.acceptanceCriteria, ['new output verified']);
  assert.equal(extended.reason, 'scope clarified');

  const transitioned = parseCliArgs([
    'transition', '--task=durable-task', '--phase=arch', '--evidence=PRD_CONFIRMED',
  ]);
  assert.equal(transitioned.phase, 'arch');
  assert.deepEqual(transitioned.evidence, ['PRD_CONFIRMED']);
});

test('CLI parses bounded context and delegated exec arguments', () => {
  const context = parseCliArgs([
    'context', '--task', 'durable-task', '--max-bytes', '4096',
    '--include', 'docs/context.md#L2-L3',
  ]);
  assert.equal(context.command, 'context');
  assert.equal(context.maxBytes, '4096');
  assert.deepEqual(context.includes, ['docs/context.md#L2-L3']);

  const exec = parseCliArgs([
    'exec', '--task', 'durable-task', '--name', 'tests', '--',
    'node', '-e', 'console.log("ok")',
  ]);
  assert.equal(exec.command, 'exec');
  assert.equal(exec.name, 'tests');
  assert.deepEqual(exec.execCommand, ['node', '-e', 'console.log("ok")']);
});

test('appends plan changes without rewriting completed work', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths, {
    steps: [{ title: 'inspect', replay: 'safe' }],
    acceptanceCriteria: ['baseline accepted'],
  }));
  checkpointTask({
    ...paths,
    taskId: 'durable-task',
    stepId: 'S1',
    status: 'done',
    evidence: ['baseline inspected'],
  });

  const extended = extendTask({
    ...paths,
    taskId: 'durable-task',
    steps: [
      { title: 'inspect more', replay: 'safe' },
      { title: 'publish more', replay: 'verify_first' },
    ],
    acceptanceCriteria: ['new output verified'],
    reason: 'scope clarified',
    now: '2026-08-16T01:02:00.000Z',
  });

  assert.equal(extended.steps[0].status, 'done');
  assert.deepEqual(extended.steps[0].evidence, ['baseline inspected']);
  assert.deepEqual(extended.steps.slice(1).map((step) => [step.id, step.replay]), [
    ['S2', 'safe'],
    ['S3', 'verify_first'],
  ]);
  assert.equal(extended.acceptance_criteria[1].id, 'AC2');
  assert.equal(extended.plan_revision, 2);
  assert.deepEqual(extended.plan_history[0].added_step_ids, ['S2', 'S3']);
  assert.deepEqual(extended.plan_history[0].added_acceptance_ids, ['AC2']);
});

test('validates phase transitions and preserves evidence-backed history', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths, { phase: 'prd' }));

  assert.throws(() => transitionTaskPhase({
    ...paths,
    taskId: 'durable-task',
    phase: 'tdd',
    evidence: ['skip directly to code'],
  }), /invalid phase transition/i);
  assert.throws(() => transitionTaskPhase({
    ...paths,
    taskId: 'durable-task',
    phase: 'arch',
  }), /evidence/i);

  const architecture = transitionTaskPhase({
    ...paths,
    taskId: 'durable-task',
    phase: 'arch',
    evidence: ['PRD_CONFIRMED in task state'],
    now: '2026-08-16T01:03:00.000Z',
  });
  assert.equal(architecture.current_phase, 'arch');
  assert.deepEqual(architecture.phase_history.at(-1), {
    phase: 'arch',
    from_phase: 'prd',
    evidence: ['PRD_CONFIRMED in task state'],
    entered_at: '2026-08-16T01:03:00.000Z',
  });
});

test('upgrades legacy schema v1 state during recovery', (t) => {
  const paths = fixture(t);
  const created = createTask(startInput(paths));
  const statePath = path.join(paths.runsRoot, 'durable-task', 'state.json');
  const legacy = {
    ...created,
    schema_version: 1,
  };
  delete legacy.current_phase;
  delete legacy.phase_history;
  delete legacy.plan_revision;
  delete legacy.plan_history;
  fs.writeFileSync(statePath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');

  const resumed = resumeTask({ ...paths, taskId: 'durable-task' });
  assert.equal(resumed.schema_version, 2);
  assert.equal(resumed.current_phase, 'unspecified');
  assert.equal(resumed.plan_revision, 1);
  assert.deepEqual(resumed.phase_history, []);
  assert.deepEqual(resumed.plan_history, []);
});

test('keeps one durable task coherent across governance phases and interrupted effects', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths, {
    taskType: undefined,
    phase: 'prd',
    steps: [
      { title: 'confirm requirements', replay: 'safe' },
      { title: 'write architecture', replay: 'verify_first' },
    ],
    acceptanceCriteria: ['governance flow verified'],
  }));
  checkpointTask({
    ...paths,
    taskId: 'durable-task',
    stepId: 'S1',
    status: 'done',
    evidence: ['PRD confirmed'],
  });
  transitionTaskPhase({
    ...paths,
    taskId: 'durable-task',
    phase: 'arch',
    evidence: ['PRD_CONFIRMED'],
  });
  extendTask({
    ...paths,
    taskId: 'durable-task',
    steps: [{ title: 'plan implementation', replay: 'safe' }],
    acceptanceCriteria: [],
    reason: 'architecture exposed a planning dependency',
  });
  checkpointTask({
    ...paths,
    taskId: 'durable-task',
    stepId: 'S2',
    status: 'running',
    nextAction: 'verify architecture files before replay',
  });

  const resumed = resumeTask({ ...paths, taskId: 'durable-task' });
  assert.equal(resumed.current_phase, 'arch');
  assert.equal(resumed.plan_revision, 2);
  assert.equal(resumed.steps[1].status, 'verify_required');
  assert.equal(resumed.status, 'blocked');
  assert.match(resumed.next_action, /Verify external result/i);
  assert.throws(() => transitionTaskPhase({
    ...paths,
    taskId: 'durable-task',
    phase: 'task',
    evidence: ['ARCHITECTURE_DEFINED'],
  }), /unresolved step S2/i);

  checkpointTask({
    ...paths,
    taskId: 'durable-task',
    stepId: 'S2',
    status: 'done',
    evidence: ['external architecture files verified'],
  });
  let state = transitionTaskPhase({
    ...paths,
    taskId: 'durable-task',
    phase: 'task',
    evidence: ['ARCHITECTURE_DEFINED'],
  });
  state = transitionTaskPhase({ ...paths, taskId: 'durable-task', phase: 'tdd', evidence: ['TASK_PLANNED'] });
  state = transitionTaskPhase({ ...paths, taskId: 'durable-task', phase: 'qa', evidence: ['TDD_DONE'] });
  state = transitionTaskPhase({ ...paths, taskId: 'durable-task', phase: 'devops', evidence: ['QA_VALIDATED'] });
  assert.equal(state.current_phase, 'devops');
  assert.deepEqual(state.phase_history.map((entry) => entry.phase), [
    'prd', 'arch', 'task', 'tdd', 'qa', 'devops',
  ]);
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

test('one checkpoint can complete a step and its acceptance criterion atomically', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths, {
    steps: [{ title: 'verify output', replay: 'safe' }],
    acceptanceCriteria: ['output verified'],
  }));

  const state = checkpointTask({
    ...paths,
    taskId: 'durable-task',
    stepId: 'S1',
    acceptanceId: 'AC1',
    status: 'done',
    evidence: ['command exit=0'],
  });

  assert.equal(state.steps[0].status, 'done');
  assert.deepEqual(state.steps[0].evidence, ['command exit=0']);
  assert.equal(state.acceptance_criteria[0].status, 'done');
  assert.deepEqual(state.acceptance_criteria[0].evidence, ['command exit=0']);
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

test('explicit lifecycle binding moves an active task to its managed worktree', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths, {
    branch: 'main',
    worktree: paths.projectRoot,
  }));
  const reboundWorktree = path.join(paths.root, 'recovered-worktree');
  fs.mkdirSync(reboundWorktree);

  const result = bindTaskLocation({
    ...paths,
    taskId: 'durable-task',
    projectRoot: paths.projectRoot,
    worktree: reboundWorktree,
    branch: 'recovery/durable-task',
    now: '2026-08-16T02:00:00.000Z',
  });

  assert.equal(result.status, 'BOUND');
  const rebound = readTaskState({ runsRoot: paths.runsRoot, taskId: 'durable-task' });
  assert.equal(rebound.worktree, reboundWorktree);
  assert.equal(rebound.branch, 'recovery/durable-task');
  assert.equal(selectTaskState([rebound], {
    projectRoot: paths.projectRoot,
    worktree: reboundWorktree,
    branch: 'recovery/durable-task',
  }).task_id, 'durable-task');
});

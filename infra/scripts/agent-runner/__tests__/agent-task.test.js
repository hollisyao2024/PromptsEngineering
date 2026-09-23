'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  buildTaskContext,
  bindTaskLocation,
  cancelTask,
  checkpointTask,
  createTask,
  executeTaskCommand,
  extendTask,
  finishTask,
  formatTransitionOutput,
  parseCliArgs,
  readTaskState,
  runMutationCompletionGuard,
  resumeTask,
  safeTaskId,
  selectTaskState,
  transitionTaskPhase,
} = require('../agent-task');

const realTemporaryRoot = fs.realpathSync(os.tmpdir());

test('independent cleanup can be deferred to finish without recovering or replaying denial', t => {
  const input = startInput(fixture(t), { phase: 'tdd' });
  createTask(input);
  checkpointTask({ ...input, stepId: 'S1', status: 'done', evidence: ['code verified'] });
  const denied = checkpointTask({ ...input, stepId: 'S2', status: 'blocked',
    failureKind: 'policy_denied', executionState: 'not_started',
    evidence: ['cleanup rejected before start'], nextAction: 'Retain cleanup target' });
  const transition = { ...input, phase: 'qa', evidence: ['Tests passed'],
    deferCleanupStep: 'S2', cleanupEvidence: 'Temporary files are outside the verified commit; preserve the worktree; QA uses clean main' };
  assert.throws(() => transitionTaskPhase({ ...transition, cleanupEvidence: '' }), /cleanup.*evidence/i);
  assert.throws(() => transitionTaskPhase({ ...transition, deferCleanupStep: 'S9' }), /cleanup.*step/i);
  const advanced = transitionTaskPhase(transition);
  assert.equal(advanced.current_phase, 'qa');
  assert.equal(advanced.status, 'blocked');
  assert.deepEqual(advanced.steps, denied.steps);
  assert.equal(advanced.phase_history.at(-1).deferred_cleanup.step_id, 'S2');
  assert.equal(finishTask(input).status, 'BLOCKED');
  assert.throws(() => checkpointTask({ ...input, stepId: 'S2', status: 'running' }), /recovery evidence/);
  assert.equal(parseCliArgs(['transition', '--defer-cleanup-step', 'S2', '--cleanup-evidence=isolated']).cleanupEvidence, 'isolated');
});

test('cleanup deferral cannot waive unknown effects or other blockers', t => {
  for (const executionState of ['unknown', 'started', 'not_started']) {
    const input = startInput(fixture(t), { phase: 'tdd' }); createTask(input);
    checkpointTask({ ...input, stepId: 'S2', status: executionState === 'not_started' ? 'blocked' : 'verify_required',
      failureKind: 'tool_error', executionState, evidence: ['failed'], nextAction: 'Inspect' });
    if (executionState === 'not_started') checkpointTask({ ...input, stepId: 'S1', status: 'blocked', evidence: ['tests failed'], nextAction: 'Fix tests' });
    const before = readTaskState(input);
    assert.throws(() => transitionTaskPhase({ ...input, phase: 'qa', evidence: ['review'], deferCleanupStep: 'S2', cleanupEvidence: 'isolated temporary files' }), /cleanup|unresolved/);
    assert.deepEqual(readTaskState(input), before);
  }
});

function pathsFixture(t, config) {
  const paths = fixture(t);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: paths.projectRoot, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '--quiet');
  if (config) fs.writeFileSync(path.join(paths.projectRoot, 'agent.config.json'), JSON.stringify(config));
  const cli = path.resolve(__dirname, '../agent-task.js');
  const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'paths', ...args], {
    cwd, encoding: 'utf8', timeout: 15000,
  });
  return { ...paths, git, run };
}

function outputFields(result) {
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(result.stdout.trim().split(/\r?\n/).map(line => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

test('task paths reports required locations without initializing missing container directories', (t) => {
  const paths = pathsFixture(t);
  const before = fs.readdirSync(paths.root);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = paths.run(paths.projectRoot);
    const fields = outputFields(result);
    assert.equal(fields.STATUS, 'OK');
    assert.equal(fields.SIDE_EFFECTS, 'NONE');
    assert.equal(fields.PERMISSION_STATUS, 'NOT_EVALUATED');
    assert.equal(path.relative(fields.PROJECT_ROOT, paths.projectRoot), '');
    assert.equal(path.relative(fields.TASK_RUNS_ROOT, path.join(paths.root, 'tmp', 'agent-task-runs')), '');
    assert.equal(path.relative(fields.TASK_LOCK_ROOT, path.join(paths.root, 'tmp', 'agent-locks')), '');
    assert.equal(fields.STATE_PATH, undefined);
    assert.match(fields.NEXT_ACTION, /writable roots/i);
    assert.deepEqual(fs.readdirSync(paths.root), before);
  }
});

test('task paths from a linked worktree honors configured roots without touching existing state or locks', (t) => {
  const paths = pathsFixture(t, {
    containerDirs: { tmp: '../runtime' },
    worktree: { lockDir: '../runtime/locks' },
  });
  paths.git('add', 'agent.config.json');
  paths.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  paths.git('worktree', 'add', '--quiet', '-b', 'paths-check', paths.worktree);
  const statePath = path.join(paths.root, 'runtime', 'agent-task-runs', 'existing', 'state.json');
  const lockDir = path.join(paths.root, 'runtime', 'locks');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(statePath, 'sentinel state: paths must not parse or rewrite this');
  fs.writeFileSync(path.join(lockDir, 'sentinel.lock'), 'owned by another process');
  const stateBefore = fs.readFileSync(statePath);
  const lockBefore = fs.readFileSync(path.join(lockDir, 'sentinel.lock'));
  const treeBefore = fs.readdirSync(path.join(paths.root, 'runtime'), { recursive: true });
  const result = paths.run(paths.worktree, '--task', 'existing');
  const fields = outputFields(result);
  assert.equal(path.relative(fields.PROJECT_ROOT, paths.projectRoot), '');
  assert.equal(path.relative(fields.TASK_LOCK_ROOT, lockDir), '');
  assert.equal(path.relative(fields.STATE_PATH, statePath), '');
  assert.deepEqual(fs.readFileSync(statePath), stateBefore);
  assert.deepEqual(fs.readFileSync(path.join(lockDir, 'sentinel.lock')), lockBefore);
  assert.deepEqual(fs.readdirSync(path.join(paths.root, 'runtime'), { recursive: true }), treeBefore);
});

test('task paths rejects invalid task IDs and runtime topology without writes', (t) => {
  const paths = pathsFixture(t);
  const invalidId = paths.run(paths.projectRoot, '--task', '../escape');
  assert.notEqual(invalidId.status, 0);
  assert.match(invalidId.stderr, /invalid task id/);
  assert.equal(fs.existsSync(path.join(paths.root, 'tmp')), false);
  fs.writeFileSync(path.join(paths.projectRoot, 'agent.config.json'), JSON.stringify({
    containerDirs: { tmp: '../worktrees/tmp' },
  }));
  const invalidTopology = paths.run(paths.projectRoot);
  assert.notEqual(invalidTopology.status, 0);
  assert.match(invalidTopology.stderr, /invalid container topology/);
  assert.equal(fs.existsSync(path.join(paths.root, 'worktrees')), false);
});

test('CLI records denial, refuses unverified replay, and persists verified recovery', (t) => {
  const paths = fixture(t);
  const cli = path.resolve(__dirname, '../agent-task.js');
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: paths.projectRoot }).status, 0);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], {
    cwd: paths.projectRoot, encoding: 'utf8', timeout: 15000,
  });
  const started = run('start', '--task', 'cli-recovery', '--type', 'operation',
    '--desc', 'fixture', '--step', 'inspect');
  assert.equal(started.status, 0, started.stderr);
  const statePath = started.stdout.match(/^STATE_PATH=(.+)$/m)[1].trim();
  assert.equal(path.relative(paths.root, statePath).startsWith('..'), false);
  assert.equal(run('checkpoint', '--task', 'cli-recovery', '--step', 'S1',
    '--status', 'blocked', '--failure-kind', 'policy_denied',
    '--execution-state', 'not_started', '--evidence', 'fixture denial',
    '--next', 'verify permission').status, 0);
  const denied = run('checkpoint', '--task', 'cli-recovery', '--step', 'S1', '--status', 'running');
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /recovery evidence/i);
  assert.equal(run('checkpoint', '--task', 'cli-recovery', '--step', 'S1',
    '--status', 'done', '--evidence', 'fixture result verified',
    '--recovery-evidence', 'fixture authorization restored').status, 0);
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(state.steps[0].status, 'done');
  assert.equal(state.steps[0].failures.length, 1);
  assert.equal(state.steps[0].recoveries.length, 1);
});

test('policy denial survives resume and requires explicit recovery evidence', (t) => {
  const paths = fixture(t);
  const input = startInput(paths);
  createTask(input);
  const failed = checkpointTask({ ...input, stepId: 'S1', status: 'blocked',
    failureKind: 'policy_denied', executionState: 'not_started', callId: 'call-test',
    evidence: ['executor rejected before spawn'], nextAction: 'Obtain decision reason' });
  assert.equal(failed.last_error.failure_kind, 'policy_denied');
  assert.equal(failed.steps[0].failures[0].call_id, 'call-test');
  assert.equal(resumeTask(input).steps[0].status, 'blocked');
  assert.throws(() => checkpointTask({ ...input, stepId: 'S1', status: 'running' }), /recovery evidence/i);
  const recovered = checkpointTask({ ...input, stepId: 'S1', status: 'running',
    recoveryEvidence: 'Executor authorization restored; no child process had started' });
  assert.equal(recovered.steps[0].failures.length, 1);
  assert.equal(recovered.steps[0].recoveries.length, 1);
});

test('unknown execution requires verification; invalid failure input does not change state', (t) => {
  const input = startInput(fixture(t));
  const initial = createTask(input);
  assert.throws(() => checkpointTask({ ...input, stepId: 'S2', status: 'blocked',
    failureKind: 'unknown_result', executionState: 'unknown',
    evidence: ['connection lost'], nextAction: 'Read remote result' }), /verify_required/);
  assert.deepEqual(readTaskState(input), initial);
  const failed = checkpointTask({ ...input, stepId: 'S2', status: 'verify_required',
    failureKind: 'unknown_result', executionState: 'unknown',
    evidence: ['connection lost'], nextAction: 'Read remote result' });
  assert.equal(failed.last_error.execution_state, 'unknown');
  assert.throws(() => checkpointTask({ ...input, stepId: 'S2', status: 'done',
    evidence: ['assumed success'] }), /recovery evidence/i);
});

test('ordinary tool failure records an auditable recovery without replacing task history', (t) => {
  const input = startInput(fixture(t));
  createTask(input);
  checkpointTask({ ...input, stepId: 'S1', status: 'blocked',
    failureKind: 'tool_error', executionState: 'not_started',
    evidence: ['missing executable'], nextAction: 'Restore configured executable' });
  const done = checkpointTask({ ...input, stepId: 'S1', status: 'done',
    evidence: ['command completed once'], recoveryEvidence: 'Executable restored and result verified' });
  assert.equal(done.last_error, null);
  assert.equal(done.steps[0].failures[0].failure_kind, 'tool_error');
  assert.equal(done.steps[0].recoveries[0].failure_index, 0);
  const args = parseCliArgs(['checkpoint', '--failure-kind=tool_error',
    '--execution-state', 'not_started', '--call-id=call-test', '--recovery-evidence', 'verified']);
  assert.equal(args.failureKind, 'tool_error');
  assert.equal(args.executionState, 'not_started');
  assert.equal(args.callId, 'call-test');
  assert.equal(args.recoveryEvidence, 'verified');
});

test('failure evidence is required and corrupt recovery history fails closed', (t) => {
  const input = startInput(fixture(t));
  const initial = createTask(input);
  for (const overrides of [
    { evidence: [] }, { nextAction: '' }, { failureKind: 'auto_retry' },
    { executionState: 'unknown' }, { status: 'done' },
  ]) {
    assert.throws(() => checkpointTask({ ...input, stepId: 'S1', status: 'blocked',
      failureKind: 'policy_denied', executionState: 'not_started',
      evidence: ['denied'], nextAction: 'Investigate', ...overrides }));
    assert.deepEqual(readTaskState(input), initial);
  }
  const statePath = path.join(input.runsRoot, input.taskId, 'state.json');
  initial.steps[0].recoveries = [{ failure_index: 0, evidence: 'not backed by a failure' }];
  fs.writeFileSync(statePath, JSON.stringify(initial));
  assert.throws(() => readTaskState(input), /failure|recovery/);
});

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
    evidence: ['PRD_CONFIRMED in docs/AGENT_STATE.md'],
    now: '2026-08-16T01:03:00.000Z',
  });
  assert.equal(architecture.current_phase, 'arch');
  assert.deepEqual(architecture.phase_history.at(-1), {
    phase: 'arch',
    from_phase: 'prd',
    evidence: ['PRD_CONFIRMED in docs/AGENT_STATE.md'],
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

test('task context is bounded, read-only, and supports point reads', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths, {
    goal: `Keep the complete delivery boundary ${'goal '.repeat(180)}`,
    acceptanceCriteria: [
      'all steps verified',
      `keep the evidence complete ${'acceptance '.repeat(80)}`,
    ],
  }));
  checkpointTask({
    ...paths,
    taskId: 'durable-task',
    stepId: 'S1',
    status: 'done',
    evidence: [`verified ${'evidence '.repeat(120)}`],
  });
  fs.mkdirSync(path.join(paths.worktree, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(paths.worktree, 'docs', 'context.md'), [
    '# Context',
    'first line',
    'second line',
    'third line',
  ].join('\n'));
  const before = fs.readdirSync(paths.root, { recursive: true });

  const capsule = buildTaskContext({
    ...paths,
    taskId: 'durable-task',
    maxBytes: 2048,
    includes: ['docs/context.md#L2-L3'],
  });
  const after = fs.readdirSync(paths.root, { recursive: true });

  assert.ok(Buffer.byteLength(capsule, 'utf8') <= 2048);
  assert.match(capsule, /STATUS=OK/u);
  assert.match(capsule, /SIDE_EFFECTS=NONE/u);
  assert.match(capsule, /TASK_ID=durable-task/u);
  assert.match(capsule, /CURRENT_PHASE=unspecified/u);
  assert.match(capsule, /CURRENT_STEP=S2/u);
  assert.match(capsule, /HANDOFF_PROMPT=/u);
  assert.match(capsule, /TRUNCATED=true/u);
  assert.match(capsule, /first line/u);
  assert.match(capsule, /second line/u);
  assert.doesNotMatch(capsule, /third line/u);
  assert.deepEqual(after, before);
  assert.throws(() => buildTaskContext({ ...paths, taskId: 'missing-task' }), /not found/u);
  assert.throws(() => buildTaskContext({
    ...paths,
    taskId: 'durable-task',
    includes: ['../outside.md#L1-L1'],
  }), /inside/u);
  assert.ok(Buffer.byteLength(buildTaskContext({
    ...paths,
    taskId: 'durable-task',
  }), 'utf8') <= 8192);
});

test('task exec preserves logs, strips ANSI summaries, and returns the child exit code', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths, { worktree: paths.worktree }));
  const result = executeTaskCommand({
    ...paths,
    taskId: 'durable-task',
    name: 'focused-check',
    command: [
      process.execPath,
      '-e',
      "process.stdout.write('\\u001b[31mfirst\\u001b[0m\\nsecond\\nthird\\nfourth\\n'); process.exit(7);",
    ],
    maxSummaryBytes: 256,
    maxSummaryLines: 2,
  });

  assert.equal(result.status, 'FAILED');
  assert.equal(result.exitCode, 7);
  assert.match(result.logPath, /durable-task[\\/]evidence[\\/]focused-check\.log$/u);
  assert.equal(fs.existsSync(result.logPath), true);
  const log = fs.readFileSync(result.logPath, 'utf8');
  assert.match(log, /\u001b\[31mfirst/u);
  assert.match(result.summary, /third/u);
  assert.match(result.summary, /fourth/u);
  assert.doesNotMatch(result.summary, /\u001b\[/u);
  assert.doesNotMatch(result.summary, /first/u);
  assert.ok(Buffer.byteLength(result.summary, 'utf8') <= 256);
  assert.match(result.logSha256, /^[a-f0-9]{64}$/u);
  assert.throws(() => executeTaskCommand({
    ...paths,
    taskId: 'durable-task',
    name: 'focused-check',
    command: [process.execPath, '-e', 'process.exit(0)'],
  }), /already exists/u);
});

test('transition output requires a fresh bounded context before the next phase', () => {
  const output = formatTransitionOutput({
    task_id: 'durable-task',
    current_phase: 'qa',
    next_action: 'run focused QA',
  });
  assert.match(output, /STATUS=TRANSITIONED/u);
  assert.match(output, /CURRENT_PHASE=qa/u);
  assert.match(output, /CONTEXT_HANDOFF_REQUIRED=true/u);
  assert.match(output, /CONTEXT_COMMAND=pnpm agent -- task context --task durable-task/u);
});

test('CLI publishes task-state readers before running main to avoid audit circular loading', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'agent-task.js'), 'utf8');
  assert.ok(
    source.indexOf('module.exports = {') < source.indexOf('if (require.main === module)'),
    'agent-task exports must exist before task resume invokes the worktree auditor',
  );
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

test('state reads fail closed on discontinuous phase or plan histories', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths, { phase: 'prd' }));
  createTask(startInput(paths, { taskId: 'other-task' }));
  createTask(startInput(paths, { taskId: 'acceptance-task' }));
  createTask(startInput(paths, { taskId: 'progress-task' }));

  const phasePath = path.join(paths.runsRoot, 'durable-task', 'state.json');
  const brokenPhase = JSON.parse(fs.readFileSync(phasePath, 'utf8'));
  brokenPhase.current_phase = 'tdd';
  fs.writeFileSync(phasePath, `${JSON.stringify(brokenPhase, null, 2)}\n`, 'utf8');
  assert.throws(
    () => readTaskState({ runsRoot: paths.runsRoot, taskId: 'durable-task' }),
    /current_phase does not match phase history/i,
  );

  const planPath = path.join(paths.runsRoot, 'other-task', 'state.json');
  const brokenPlan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  brokenPlan.plan_revision = 2;
  fs.writeFileSync(planPath, `${JSON.stringify(brokenPlan, null, 2)}\n`, 'utf8');
  assert.throws(
    () => readTaskState({ runsRoot: paths.runsRoot, taskId: 'other-task' }),
    /plan history does not match plan_revision/i,
  );

  const acceptancePath = path.join(paths.runsRoot, 'acceptance-task', 'state.json');
  const brokenAcceptance = JSON.parse(fs.readFileSync(acceptancePath, 'utf8'));
  brokenAcceptance.acceptance_criteria[0].status = 'accepted';
  fs.writeFileSync(acceptancePath, `${JSON.stringify(brokenAcceptance, null, 2)}\n`, 'utf8');
  assert.throws(
    () => readTaskState({ runsRoot: paths.runsRoot, taskId: 'acceptance-task' }),
    /malformed acceptance criterion/i,
  );

  const progressPath = path.join(paths.runsRoot, 'progress-task', 'state.json');
  const brokenProgress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
  brokenProgress.current_step = 'S2';
  fs.writeFileSync(progressPath, `${JSON.stringify(brokenProgress, null, 2)}\n`, 'utf8');
  assert.throws(
    () => readTaskState({ runsRoot: paths.runsRoot, taskId: 'progress-task' }),
    /current_step does not match step progress/i,
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

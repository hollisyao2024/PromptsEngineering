'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  checkpointTask,
  createTask,
  finishTask,
  parseCliArgs,
  readTaskState,
  resumeTask,
  transitionTaskPhase,
} = require('../agent-task');
const { fixture, outputFields, pathsFixture, startInput } = require('./agent-task.helpers');

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

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  buildTaskContext,
  checkpointTask,
  createTask,
  executeTaskCommand,
  formatTransitionOutput,
  readTaskState,
} = require('../agent-task');
const { fixture, pathsFixture, startInput } = require('./agent-task.helpers');

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

test('task context indexes evidence without repeating its body or changing recovery routing', (t) => {
  const paths = fixture(t);
  const input = startInput(paths, { phase: 'tdd' });
  createTask(input);
  const fullEvidence = `verified delivery ${'unique supporting detail '.repeat(70)}`;
  checkpointTask({ ...input, stepId: 'S1', status: 'done', evidence: [fullEvidence] });
  checkpointTask({ ...input, stepId: 'S2', status: 'verify_required',
    failureKind: 'unknown_result', executionState: 'unknown',
    evidence: ['push outcome is unknown'], nextAction: 'Check remote SHA' });
  checkpointTask({ ...input, acceptanceId: 'AC1', status: 'done', evidence: ['acceptance checked'] });
  const stateBefore = readTaskState(input);

  const capsule = buildTaskContext(input);

  assert.match(capsule, /RESUME_COMMAND=pnpm agent -- task resume --task durable-task/u);
  assert.match(capsule, /AUTO_CONTINUE=false/u);
  assert.match(capsule, /CONTINUATION_ACTION=RESOLVE_BLOCKER/u);
  assert.match(capsule, /S2:verify_required:Check remote SHA/u);
  assert.match(capsule, /## Evidence Index/u);
  assert.match(capsule, /S1:1.*S2:1.*AC1:1/u);
  assert.ok(capsule.includes(`STATE_PATH=${path.join(paths.runsRoot, 'durable-task', 'state.json')}`));
  assert.doesNotMatch(capsule, /unique supporting detail|push outcome is unknown|acceptance checked/u);
  assert.ok(Buffer.byteLength(capsule, 'utf8') < Buffer.byteLength(fullEvidence, 'utf8'));
  assert.deepEqual(readTaskState(input), stateBefore);
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
  const rerun = executeTaskCommand({
    ...paths,
    taskId: 'durable-task',
    name: 'focused-check',
    command: [process.execPath, '-e', "process.stdout.write('rerun'); process.exit(0)"],
  });
  assert.equal(rerun.status, 'OK');
  assert.match(rerun.logPath, /evidence[\\/]focused-check-2\.log$/u);
  assert.match(fs.readFileSync(result.logPath, 'utf8'), /first/u, 'the earlier log stays untouched');
  const third = executeTaskCommand({
    ...paths,
    taskId: 'durable-task',
    name: 'focused-check',
    command: [process.execPath, '-e', 'process.exit(0)'],
  });
  assert.match(third.logPath, /evidence[\\/]focused-check-3\.log$/u);
});

test('task exec rejects an implicit full test before creating a log or spawning', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths, { worktree: paths.worktree }));
  for (const [name, command] of [
    ['accidental-full-test', ['pnpm', 'test']],
    ['wrapped-full-test', ['node', 'infra/scripts/shared/test-budget.js', '--', 'pnpm', 'test']],
  ]) {
    assert.throws(() => executeTaskCommand({
      ...paths,
      taskId: 'durable-task',
      name,
      command,
    }), /TEST_SCOPE_DECISION.*full/u);
    assert.equal(fs.existsSync(path.join(paths.runsRoot, 'durable-task', 'evidence', `${name}.log`)), false);
  }
});

test('task exec runs a command registered as a qa.business suite and still rejects any other', (t) => {
  const paths = fixture(t);
  createTask(startInput(paths, { worktree: paths.worktree }));
  // 带运行器名但没有测试文件，不登记时按 unbounded 被拦；node 实际只会忽略多余参数
  const command = ['node', '-e', '0', 'vitest'];
  const exec = (name, overrides) => executeTaskCommand({ ...paths, taskId: 'durable-task', name, command, ...overrides });

  assert.throws(() => exec('unregistered'), /TEST_SCOPE_DECISION/u);
  assert.equal(fs.existsSync(path.join(paths.runsRoot, 'durable-task', 'evidence', 'unregistered.log')), false);

  const result = exec('registered', { registeredCommands: ['node -e 0 vitest'] });
  assert.equal(result.status, 'OK');
  assert.equal(result.exitCode, 0);
  assert.equal(fs.existsSync(result.logPath), true);

  assert.throws(
    () => exec('other-arguments', { command: ['node', '-e', '1', 'vitest'], registeredCommands: ['node -e 0 vitest'] }),
    /TEST_SCOPE_DECISION/u,
  );
});

test('task exec CLI reads the suites registered in the project config to sanction their commands', (t) => {
  const suite = { name: 'unit', platform: '-', command: 'node -e 0 vitest', report: 'reports/unit.xml' };
  const paths = pathsFixture(t, { qa: { business: { enabled: true, suites: [suite] } } });
  createTask(startInput({
    ...paths,
    runsRoot: path.join(paths.root, 'tmp', 'agent-task-runs'),
    lockDir: path.join(paths.root, 'tmp', 'agent-locks'),
  }, { worktree: paths.projectRoot }));
  const cli = path.resolve(__dirname, '../agent-task.js');
  const exec = (name, ...command) => spawnSync(process.execPath, [cli, 'exec', '--task', 'durable-task', '--name', name, '--', ...command], {
    cwd: paths.projectRoot, encoding: 'utf8', timeout: 30000,
  });

  const registered = exec('registered', 'node', '-e', '0', 'vitest');
  assert.equal(registered.status, 0, registered.stderr);
  assert.match(registered.stdout, /STATUS=OK/u);
  assert.match(registered.stdout, /EXIT_CODE=0/u);

  const unregistered = exec('unregistered', 'node', '-e', '1', 'vitest');
  assert.notEqual(unregistered.status, 0);
  assert.match(unregistered.stderr, /TEST_SCOPE_DECISION/u);
});

test('transition refreshes the bounded context without stopping authorized continuation', () => {
  const output = formatTransitionOutput({
    task_id: 'durable-task',
    current_phase: 'qa',
    next_action: 'run focused QA',
  });
  assert.match(output, /STATUS=TRANSITIONED/u);
  assert.match(output, /CURRENT_PHASE=qa/u);
  assert.match(output, /CONTEXT_HANDOFF_REQUIRED=false/u);
  assert.match(output, /CONTEXT_REFRESH_REQUIRED=true/u);
  assert.match(output, /AUTO_CONTINUE=true/u);
  assert.match(output, /RESUME_COMMAND=pnpm agent -- task resume --task durable-task/u);
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

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  buildTaskContext, createTask, checkpointTask, finishTask, formatTransitionOutput,
  readTaskState, resumeTask, transitionTaskPhase,
} = require('../agent-task');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'xirang-continuation-'));
  const projectRoot = path.join(root, 'repo');
  fs.mkdirSync(projectRoot);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    projectRoot, worktree: projectRoot, branch: 'main',
    runsRoot: path.join(root, 'tmp', 'agent-task-runs'), lockDir: path.join(root, 'tmp', 'agent-locks'),
    taskId: 'workflow', taskType: 'operation', phase: 'prd', goal: 'Run authorized workflow',
    acceptanceCriteria: ['QA passed'],
    steps: ['prd', 'arch', 'task', 'tdd', 'qa'].map(title => ({ title, replay: 'safe' })),
  };
}

function fields(output) {
  return Object.fromEntries(output.split(/\r?\n/).map(line => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
}

test('PRD to QA continues in order with persistent checkpoints, exact resume and no repeated work', t => {
  const input = fixture(t);
  createTask(input);
  createTask({ ...input, taskId: 'unrelated' });
  const phases = ['prd', 'arch', 'task', 'tdd', 'qa'];
  for (let i = 0; i < phases.length; i++) {
    let state = resumeTask(input);
    assert.equal(state.current_phase, phases[i]);
    const capsule = fields(buildTaskContext(input));
    assert.equal(capsule.AUTO_CONTINUE, 'true');
    assert.equal(capsule.RESUME_COMMAND, 'pnpm agent -- task resume --task workflow');
    assert.doesNotMatch(capsule.HANDOFF_PROMPT, /--auto/);
    assert.match(capsule.HANDOFF_PROMPT, /read AGENTS\.md and docs\/CONVENTIONS\.md completely.*before task resume/u);
    assert.match(capsule.HANDOFF_PROMPT, /applied projects must also read RULES\.md completely/u);
    assert.match(capsule.HANDOFF_PROMPT, /[Cc]omplete truncated output to EOF/u);
    assert.equal(capsule.CONTINUATION_ACTION, 'CONTINUE_CURRENT_TASK');
    checkpointTask({ ...input, stepId: `S${i + 1}`, status: 'running', nextAction: `Execute ${phases[i]}` });
    // A process boundary rewinds only a safe, unfinished step.
    state = resumeTask(input);
    assert.equal(state.steps[i].status, 'pending');
    assert.ok(state.steps.slice(0, i).every(step => step.status === 'done'));
    checkpointTask({ ...input, stepId: `S${i + 1}`, status: 'done', evidence: [`${phases[i]} verified`] });
    if (i < phases.length - 1) {
      const options = { ...input, phase: phases[i + 1], evidence: [`${phases[i]} milestone`] };
      state = transitionTaskPhase(options);
      const output = fields(formatTransitionOutput(state));
      assert.equal(output.AUTO_CONTINUE, 'true');
      assert.equal(output.CONTEXT_HANDOFF_REQUIRED, 'false');
      assert.equal(output.CONTEXT_REFRESH_REQUIRED, 'true');
      assert.equal(output.ACTIVATE_ROLE, phases[i + 1].toUpperCase());
      assert.equal(output.RESUME_COMMAND, capsule.RESUME_COMMAND);
      assert.deepEqual(transitionTaskPhase(options), state, 'retry must not add another transition');
    }
  }
  const state = readTaskState(input);
  assert.deepEqual(state.phase_history.map(entry => entry.phase), phases);
  assert.equal(state.status, 'running', 'QA phase alone is not task completion');
  assert.equal(finishTask(input).status, 'BLOCKED', 'acceptance still needs real verification');
  assert.equal(readTaskState({ ...input, taskId: 'unrelated' }).current_phase, 'prd');
});

test('unknown side effects block continuation until recovery evidence is recorded', t => {
  const input = { ...fixture(t), phase: 'tdd', steps: [{ title: 'push', replay: 'verify_first' }] };
  createTask(input);
  checkpointTask({ ...input, stepId: 'S1', status: 'running', nextAction: 'Verify push result' });
  const interrupted = resumeTask(input);
  assert.equal(interrupted.steps[0].status, 'verify_required');
  for (const output of [buildTaskContext(input), formatTransitionOutput(interrupted)]) {
    assert.equal(fields(output).AUTO_CONTINUE, 'false');
    assert.equal(fields(output).CONTINUATION_ACTION, 'RESOLVE_BLOCKER');
  }
  assert.throws(() => transitionTaskPhase({ ...input, phase: 'qa', evidence: ['attempt'] }), /unresolved/);
  checkpointTask({ ...input, stepId: 'S1', status: 'verify_required', failureKind: 'unknown_result',
    executionState: 'unknown', evidence: ['Interrupted push needs remote verification'], nextAction: 'Read remote SHA' });
  checkpointTask({ ...input, stepId: 'S1', status: 'done', recoveryEvidence: 'remote SHA verified', evidence: ['push verified'] });
  assert.equal(fields(formatTransitionOutput(transitionTaskPhase({ ...input, phase: 'qa', evidence: ['verified'] }))).AUTO_CONTINUE, 'true');
});

test('policy denial and missing milestones never become automatic continuation', t => {
  const input = fixture(t); createTask(input);
  assert.throws(() => transitionTaskPhase({ ...input, phase: 'qa', evidence: ['skip'] }), /invalid phase/);
  assert.throws(() => transitionTaskPhase({ ...input, phase: 'arch', evidence: [] }), /requires evidence/);
  const state = checkpointTask({ ...input, stepId: 'S1', status: 'blocked', failureKind: 'policy_denied',
    executionState: 'not_started', evidence: ['denied'], nextAction: 'Wait for authorization change' });
  assert.equal(fields(formatTransitionOutput(state)).AUTO_CONTINUE, 'false');
  assert.throws(() => checkpointTask({ ...input, stepId: 'S1', status: 'running' }), /recovery evidence/);
});

test('capsule keeps the exact resume command even at its minimum byte budget', t => {
  const input = fixture(t); createTask(input);
  const output = buildTaskContext({ ...input, maxBytes: 512 });
  assert.ok(Buffer.byteLength(output) <= 512);
  assert.equal(fields(output).RESUME_COMMAND, 'pnpm agent -- task resume --task workflow');
  assert.match(output, /TRUNCATED=true/);
});

test('only proven independent cleanup can be deferred while QA automatically continues', t => {
  const input = { ...fixture(t), phase: 'tdd' }; createTask(input);
  checkpointTask({ ...input, stepId: 'S1', status: 'blocked', failureKind: 'tool_error', executionState: 'not_started',
    evidence: ['isolated cleanup not started'], nextAction: 'Clean retained files after QA' });
  const state = transitionTaskPhase({ ...input, phase: 'qa', evidence: ['TDD verified'], deferCleanupStep: 'S1',
    cleanupEvidence: 'Independent temp files, retained outside verified commit' });
  assert.equal(fields(formatTransitionOutput(state)).AUTO_CONTINUE, 'true');
  assert.equal(finishTask(input).status, 'BLOCKED');
  checkpointTask({ ...input, stepId: 'S2', status: 'blocked', evidence: ['QA failed'], nextAction: 'Fix QA failure' });
  assert.equal(fields(buildTaskContext(input)).AUTO_CONTINUE, 'false');
});

test('a not-started step waiting for the user keeps the task running and stops auto-continue', t => {
  const input = { ...fixture(t), phase: 'tdd' }; createTask(input);
  checkpointTask({ ...input, stepId: 'S1', status: 'done', evidence: ['built'] });
  let state = checkpointTask({ ...input, stepId: 'S2', status: 'pending', nextAction: 'Ask the user how to merge' });
  assert.equal(state.status, 'running');
  assert.equal(state.steps[1].status, 'pending');
  let capsule = fields(buildTaskContext(input));
  assert.equal(capsule.CONTINUATION_ACTION, 'WAIT_FOR_USER');
  assert.equal(capsule.AUTO_CONTINUE, 'false');
  assert.equal(capsule.NEXT_ACTION, 'Ask the user how to merge');
  // 等待不是 running：恢复入口不得把它改写为中断或待核验。
  assert.equal(resumeTask(input).steps[1].status, 'pending');
  // 其他步骤的 checkpoint 不带 --next 时，等待说明不能丢失。
  checkpointTask({ ...input, stepId: 'S3', status: 'done', evidence: ['independent work'] });
  assert.equal(fields(buildTaskContext(input)).NEXT_ACTION, 'Ask the user how to merge');
  assert.equal(fields(buildTaskContext(input)).CONTINUATION_ACTION, 'WAIT_FOR_USER');
  // 等待不算完成：完成门禁仍阻断，阶段推进不被阻断。
  assert.equal(finishTask(input).status, 'BLOCKED');
  assert.equal(transitionTaskPhase({ ...input, phase: 'qa', evidence: ['TDD verified'] }).current_phase, 'qa');
  // 用户确认后开始执行，等待标记随状态变化清除。
  state = checkpointTask({ ...input, stepId: 'S2', status: 'running', nextAction: 'Merge' });
  assert.equal(state.steps[1].awaiting_user, undefined);
  capsule = fields(buildTaskContext(input));
  assert.equal(capsule.CONTINUATION_ACTION, 'CONTINUE_CURRENT_TASK');
});

test('a waiting step only stops auto-continue once it is the first incomplete step', t => {
  const input = { ...fixture(t), phase: 'tdd' }; createTask(input);
  checkpointTask({ ...input, stepId: 'S2', status: 'pending', nextAction: 'Wait for the user' });
  assert.equal(fields(buildTaskContext(input)).CONTINUATION_ACTION, 'CONTINUE_CURRENT_TASK');
});

test('a never-started step marked blocked can return to waiting without keeping the task blocked', t => {
  const input = { ...fixture(t), phase: 'tdd' }; createTask(input);
  checkpointTask({ ...input, stepId: 'S1', status: 'done', evidence: ['built'] });
  assert.equal(checkpointTask({ ...input, stepId: 'S2', status: 'blocked', evidence: ['awaiting approval'], nextAction: 'Ask' }).status, 'blocked');
  const state = checkpointTask({ ...input, stepId: 'S2', status: 'pending', evidence: ['not started'], nextAction: 'Ask the user' });
  assert.equal(state.status, 'running');
  assert.equal(state.last_error, null);
  assert.equal(fields(buildTaskContext(input)).CONTINUATION_ACTION, 'WAIT_FOR_USER');
});

test('pending checkpoints require --next and never erase a started or unknown step', t => {
  const input = { ...fixture(t), phase: 'tdd', steps: [
    { title: 'waiting', replay: 'safe' },
    { title: 'started', replay: 'verify_first' },
    { title: 'unknown', replay: 'verify_first' },
    { title: 'failed', replay: 'verify_first' },
    { title: 'done', replay: 'safe' },
    { title: 'started then blocked', replay: 'verify_first' },
  ] };
  createTask(input);
  assert.throws(() => checkpointTask({ ...input, stepId: 'S1', status: 'pending' }), /--next/u);
  assert.equal(readTaskState(input).steps[0].awaiting_user, undefined);
  checkpointTask({ ...input, stepId: 'S2', status: 'running' });
  checkpointTask({ ...input, stepId: 'S3', status: 'verify_required', evidence: ['timed out'], nextAction: 'Verify' });
  checkpointTask({ ...input, stepId: 'S4', status: 'blocked', failureKind: 'policy_denied', executionState: 'not_started',
    evidence: ['denied'], nextAction: 'Ask' });
  checkpointTask({ ...input, stepId: 'S5', status: 'done', evidence: ['ok'] });
  checkpointTask({ ...input, stepId: 'S6', status: 'running' });
  checkpointTask({ ...input, stepId: 'S6', status: 'blocked', evidence: ['stuck'], nextAction: 'Check' });
  for (const stepId of ['S2', 'S3', 'S4', 'S5', 'S6']) {
    assert.throws(() => checkpointTask({ ...input, stepId, status: 'pending', nextAction: 'Wait' }),
      new RegExp(`${stepId}.*not-started`, 'u'), stepId);
  }
  const state = readTaskState(input);
  assert.deepEqual(state.steps.slice(1).map(step => step.status),
    ['running', 'verify_required', 'blocked', 'done', 'blocked']);
});

test('completion routing never marks QA entry, pending acceptance or cleanup as completed', t => {
  const input = { ...fixture(t), phase: 'qa', steps: [{ title: 'verify QA', replay: 'safe' }] };
  createTask(input);
  let state = checkpointTask({ ...input, stepId: 'S1', status: 'done', evidence: ['QA verified'] });
  assert.equal(fields(formatTransitionOutput(state)).CONTINUATION_ACTION, 'CONTINUE_CURRENT_TASK');
  state = checkpointTask({ ...input, acceptanceId: 'AC1', status: 'done', evidence: ['AC checked'] });
  assert.equal(fields(formatTransitionOutput(state)).CONTINUATION_ACTION, 'RUN_COMPLETION_GUARD');
  assert.equal(readTaskState(input).status, 'running');
  assert.equal(fields(formatTransitionOutput({ ...state, status: 'completed' })).AUTO_CONTINUE, 'false');
  assert.equal(fields(formatTransitionOutput({ ...state, status: 'cleanup_pending' })).CONTINUATION_ACTION, 'RESOLVE_BLOCKER');
});

test('real CLI transition and resume publish the same continuation contract across processes', t => {
  const input = fixture(t);
  const git = spawnSync('git', ['init', '--quiet'], { cwd: input.projectRoot, encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  const cli = path.resolve(__dirname, '../agent-task.js');
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: input.projectRoot, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    return fields(result.stdout);
  };
  run('start', '--task', 'cli-flow', '--phase', 'prd', '--type', 'operation', '--desc', 'flow', '--step', 'deliver');
  for (const phase of ['arch', 'task', 'tdd', 'qa']) {
    const transitioned = run('transition', '--task', 'cli-flow', '--phase', phase, '--evidence', 'verified milestone');
    assert.equal(transitioned.AUTO_CONTINUE, 'true');
    assert.equal(transitioned.CONTEXT_HANDOFF_REQUIRED, 'false');
    const resumed = run('resume', '--task', 'cli-flow');
    assert.equal(resumed.CURRENT_PHASE, phase);
    assert.equal(resumed.AUTO_CONTINUE, 'true');
    assert.equal(run('context', '--task', 'cli-flow').RESUME_COMMAND, 'pnpm agent -- task resume --task cli-flow');
  }
});

test('rules define acknowledged handoff or inline continuation without removing gates', () => {
  const root = path.resolve(__dirname, '../../../..');
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const conventions = fs.readFileSync(path.join(root, 'docs/CONVENTIONS.md'), 'utf8');
  assert.equal(/当前上下文(?:到此)?停止|同一阶段内才允许自动连续续跑/.test(agents), false);
  for (const pattern of [/接管确认/, /当前任务.*继续/, /不.*重复.*确认/, /真实阻塞/, /completion guard|完成门禁/, /task resume --task <id>/]) {
    assert.equal(pattern.test(agents), true, `AGENTS.md: missing ${pattern}`);
  }
  assert.doesNotMatch(conventions, /^## \d+\. 上下文预算与阶段交接/mu);
  assert.doesNotMatch(conventions, /接管确认/u);
});

test('all six experts use the shared task recovery policy', () => {
  const roles = path.resolve(__dirname, '../../../../AgentRoles');
  for (const file of ['PRD-WRITER', 'ARCHITECTURE-WRITER', 'TASK-PLANNING', 'TDD-PROGRAMMING', 'QA-TESTING', 'OPS-ENGINEERING']) {
    const text = fs.readFileSync(path.join(roles, `${file}-EXPERT.md`), 'utf8');
    assert.match(text, /任务状态、恢复与阶段切换遵循 `AGENTS\.md`“长任务断点续跑”/u, `${file}: shared recovery policy`);
  }
});

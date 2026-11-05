#!/usr/bin/env node
'use strict';

// /qa auto is an agent workflow. An explicitly configured driver also makes the
// generation/test/repair cycle executable in a terminal; no driver means handoff,
// never a successful test result. Task state remains the only recovery authority.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { runtimeContext, readTaskState, checkpointTask, safeTaskId } = require('../agent-runner/agent-task');
const { orderedStepEvidence } = require('../shared/task-evidence');
const { assertTestCommandScope } = require('../agent-runner/test-command-scope');
const { acquireLock } = require('../worktree-tools/worktree-core');
const { createWindowsSpawnInvocation } = require('../shared/toolchain-env');
const { runCommand, installSignalHandlers } = require('./qa-run-process');

const LAYERS = ['unit', 'integration', 'e2e', 'contract', 'recovery'];
const NAME = /^[a-z0-9][a-z0-9-]*$/u;
const USAGE = 'Usage: pnpm agent -- qa auto [--project | --module <name> | --template xirang] [--task <id> --step <S1>] [--plan]\nNo driver: current coding agent continues generation, execution, repair and QA; terminal execution requires qa.auto configuration.';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed, field) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`invalid ${field} keys`);
}
function command(value) {
  if (!Array.isArray(value) || !value.length || value.some(word => typeof word !== 'string' || !word || /[\u0000\r\n]/u.test(word))) {
    throw new Error('command must be a nonempty argv array');
  }
  return value;
}
function integer(value, fallback, min, max, field) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) throw new Error(`invalid ${field}`);
  return resolved;
}

function parseArgs(argv) {
  const result = { scope: 'task', taskId: '', stepId: '', plan: false };
  let selected = false;
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const [key, ...inline] = argv[i].split('=');
    if (!['--project', '--module', '--template', '--task', '--step', '--plan'].includes(key) || seen.has(key)) throw new Error(`unknown or duplicate option: ${key}`);
    seen.add(key);
    if (['--project', '--plan'].includes(key)) {
      if (inline.length) throw new Error(`${key} takes no value`);
      if (key === '--plan') { result.plan = true; continue; }
    }
    const value = ['--project', '--plan'].includes(key) ? '' : (inline.length ? inline.join('=') : argv[++i]);
    if (!['--project', '--plan'].includes(key) && (!value || value.startsWith('-'))) throw new Error(`${key} requires a value`);
    if (key === '--task') { result.taskId = safeTaskId(value); continue; }
    if (key === '--step') {
      if (!/^S[1-9][0-9]*$/u.test(value)) throw new Error('invalid step');
      result.stepId = value; continue;
    }
    if (selected) throw new Error('choose only one scope');
    selected = true;
    if (value && !NAME.test(value)) throw new Error('invalid scope name');
    result.scope = key === '--project' ? 'project' : `${key.slice(2)}:${value}`;
  }
  return result;
}

function resolveTarget(config, scope) {
  keys(config, ['driver', 'maxRepairs', 'timeoutSeconds', 'targets'], 'qa.auto');
  const driver = command(config.driver);
  const maxRepairs = integer(config.maxRepairs, 3, 0, 10, 'maxRepairs');
  const timeoutSeconds = integer(config.timeoutSeconds, 900, 1, 7200, 'timeoutSeconds');
  if (!object(config.targets) || !Object.hasOwn(config.targets, scope)) throw new Error(`target is not configured: ${scope}`);
  const target = config.targets[scope];
  keys(target, ['specs', 'tests', 'notApplicable'], 'target');
  if (!Array.isArray(target.specs) || !target.specs.length || target.specs.some(file => typeof file !== 'string' || !file)) throw new Error('target specs required');
  if (!Array.isArray(target.tests) || !target.tests.length) throw new Error('target tests required');
  keys(target.notApplicable || {}, LAYERS, 'notApplicable');
  const names = new Set();
  for (const entry of target.tests) {
    keys(entry, ['name', 'layer', 'command'], 'test');
    if (!NAME.test(entry.name) || names.has(entry.name) || !LAYERS.includes(entry.layer)) throw new Error('invalid test name/layer');
    names.add(entry.name); command(entry.command);
  }
  for (const layer of LAYERS) {
    const covered = target.tests.some(entry => entry.layer === layer);
    const reason = target.notApplicable?.[layer];
    if (covered && reason !== undefined) throw new Error(`conflicting layer: ${layer}`);
    if (!covered && (typeof reason !== 'string' || !reason.trim())) throw new Error(`missing layer: ${layer}`);
  }
  return { ...target, driver, maxRepairs, timeoutSeconds };
}

function agentProtocol(options) {
  return [
    'STATUS=PENDING', 'MODE=AGENT', `SCOPE=${options.scope}`, `AUTO_CONTINUE=${!options.plan}`,
    `CONTINUATION_ACTION=${options.plan ? 'PLAN_ONLY' : 'CONTINUE_CURRENT_TASK'}`,
    'SUMMARY=由当前编码代理连续完成测试生成、执行、修复和QA；此输出不是测试结果',
    'READ=AgentRoles/Handbooks/QA-AUTO.md',
    'NEXT_ACTION=读取QA-AUTO协议；按任务/worktree门禁确定唯一范围，读取规格和已有测试，设计反例，生成或补齐单元/集成/应用E2E/契约/恢复测试；执行测试，按规格修复实现并回归，默认最多3轮；最终HEAD证据齐备后执行qa verify。不得仅返回计划，不得降低断言或新增跳过。',
  ].join('\n');
}

// All selected suites rerun after a repair. Exit 124/125/126/127, signals and
// startup errors require diagnosis; only ordinary test failures enter repair.
async function runCycle(target, execute) {
  let repairs = 0;
  let generated = await execute('generate', null, 0);
  const unknown = result => result.unknown || result.exitCode === null;
  if (unknown(generated)) return { status: 'VERIFY_REQUIRED', repairs };
  if (generated.exitCode !== 0) return { status: 'BLOCKED', repairs };
  for (;;) {
    let failed = false;
    for (const suite of target.tests) {
      const result = await execute('test', suite, repairs);
      if (unknown(result)) return { status: 'VERIFY_REQUIRED', repairs };
      if ([124, 125, 126, 127].includes(result.exitCode)) return { status: 'BLOCKED', repairs };
      failed ||= result.exitCode !== 0;
    }
    if (!failed) return { status: 'TESTS_PASSED', repairs };
    if (repairs >= target.maxRepairs) return { status: 'FAILED', repairs };
    generated = await execute('repair', null, ++repairs);
    if (unknown(generated)) return { status: 'VERIFY_REQUIRED', repairs };
    if (generated.exitCode !== 0) return { status: 'BLOCKED', repairs };
  }
}

function validateBinding(context, state, stepId) {
  if (context.worktree === context.projectRoot || state.worktree !== context.worktree
    || state.project_root !== context.projectRoot || state.branch !== context.branch || state.status !== 'running'
    || state.task_type !== 'mutation'
    || state.steps.some(step => ['blocked', 'verify_required'].includes(step.status))) throw new Error('task binding/recovery requires verification in its linked worktree');
  const step = state.steps.find(item => item.id === stepId);
  if (!step || step.replay !== 'verify_first' || !['pending', 'running'].includes(step.status)) throw new Error('select an incomplete verify_first step');
}

function checkSpecs(root, specs) {
  for (const file of specs) {
    const resolved = path.resolve(root, file);
    if (path.isAbsolute(file) || !resolved.startsWith(root + path.sep) || !fs.realpathSync(resolved).startsWith(fs.realpathSync(root) + path.sep)
      || !fs.statSync(resolved).isFile() || !fs.readFileSync(resolved, 'utf8').trim()) throw new Error(`invalid specification path: ${file}`);
  }
}

async function executeConfigured(options, context, target) {
  if (!options.taskId || !options.stepId) throw new Error('configured execution requires --task and --step');
  const read = () => readTaskState({ runsRoot: context.runsRoot, taskId: options.taskId });
  validateBinding(context, read(), options.stepId);
  checkSpecs(context.worktree, target.specs);
  const specDigest = () => hash(JSON.stringify(target.specs.map(file => [file, hash(fs.readFileSync(path.join(context.worktree, file)))])));
  const specifications = specDigest();
  const release = acquireLock(context.lockDir, `qa-auto-${hash(context.worktree).slice(0, 16)}`, 0);
  const controller = { current: null, interrupted: null };
  const removeSignals = installSignalHandlers(controller);
  const digest = hash(JSON.stringify(context.config.qa.auto));
  const evidenceDir = path.join(context.runsRoot, options.taskId, 'evidence');
  const record = (status, evidence, nextAction, failure = {}) => checkpointTask({ ...context, taskId: options.taskId,
    stepId: options.stepId, status, evidence: [evidence], nextAction, ...failure });
  try {
    const prior = orderedStepEvidence(read()).filter(line => line.startsWith('QA_AUTO_EVENT='));
    if (prior.length && JSON.parse(prior.at(-1).slice(14)).status === 'started') throw new Error('previous command outcome is unknown; verify before replay');
    fs.mkdirSync(evidenceDir, { recursive: true });
    if (fs.lstatSync(evidenceDir).isSymbolicLink() || !fs.statSync(evidenceDir).isDirectory()) throw new Error('evidence directory must be a real directory');
    const logs = [];
    const result = await runCycle(target, async (stage, suite, round) => {
      if (controller.interrupted) return { exitCode: null, unknown: true };
      if (hash(JSON.stringify(runtimeContext(context.worktree).config.qa.auto)) !== digest) throw new Error('qa.auto configuration drift; re-plan before continuing');
      const argv = stage === 'test' ? suite.command : target.driver;
      assertTestCommandScope(argv, read());
      const logName = `qa-auto-${crypto.randomUUID()}.log`;
      const logPath = path.join(evidenceDir, logName);
      const fd = fs.openSync(logPath, 'wx');
      const entry = { stage, round, name: suite?.name || stage, scope: options.scope,
        task_id: options.taskId, step_id: options.stepId, config_digest: digest, specs_digest: specifications, command: argv };
      let observed;
      try {
        record('running', `QA_AUTO_EVENT=${JSON.stringify({ ...entry, status: 'started' })}`, '命令结果未知时先核验，不重放');
        const invocation = createWindowsSpawnInvocation(argv[0], argv.slice(1), { shell: false, env: process.env });
        observed = await runCommand({ command: invocation.bin, args: invocation.args, shell: invocation.options.shell,
          cwd: context.worktree, env: { ...process.env, XIRANG_QA_AUTO_STAGE: stage,
            XIRANG_QA_AUTO_CONTEXT: JSON.stringify({ ...entry, specs: target.specs, layers: LAYERS,
              logs, instruction: '依据规格生成/修复；复用已有测试，禁止降低断言/删除测试/skip/only；只修已授权范围，歧义/环境/权限失败非零退出。' }) },
          timeoutMs: target.timeoutSeconds * 1000, killGraceMs: 1000, controller, outputFd: fd });
      } finally { fs.closeSync(fd); }
      const evidence = `evidence/${logName} sha256=${hash(fs.readFileSync(logPath))}`;
      logs.push(evidence);
      const unknown = observed.timedOut || Boolean(observed.signal) || Boolean(controller.interrupted);
      const exitCode = observed.spawnError ? 127 : observed.exitCode;
      const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: context.worktree, encoding: 'utf8' });
      if (head.status !== 0) throw new Error('cannot bind evidence to HEAD');
      record(unknown ? 'verify_required' : 'running', `QA_AUTO_EVENT=${JSON.stringify({ ...entry, status: unknown ? 'unknown' : 'completed', exit_code: exitCode, evidence, head_sha: head.stdout.trim() })}`,
        unknown ? '核实命令及外部副作用后通过task恢复，不自动重放' : '继续所选范围测试闭环',
        unknown ? { failureKind: 'unknown_result', executionState: 'unknown' } : {});
      console.log(`COMMAND=${stage}|${entry.name}|${exitCode}|${evidence}`);
      if (specDigest() !== specifications) throw new Error('specifications changed during execution; return to PRD/QA before continuing');
      return { exitCode, unknown };
    });
    record(result.status === 'VERIFY_REQUIRED' ? 'verify_required' : result.status === 'TESTS_PASSED' ? 'running' : 'blocked',
      `QA_AUTO_RESULT=${JSON.stringify({ ...result, scope: options.scope, config_digest: digest, logs })}`,
      result.status === 'TESTS_PASSED' ? '完成最终提交、绑定TEST_SCOPE_RESULT、适用qa run及qa verify；尚未签发QA回执' : '诊断失败/核实副作用，保留日志与原测试；不要盲重试');
    console.log(`STATUS=${result.status === 'TESTS_PASSED' ? 'PENDING' : 'BLOCKED'}\nTEST_RESULT=${result.status}\nREPAIRS=${result.repairs}\nSUMMARY=所选测试执行结束；QA验收独立判定\nNEXT_ACTION=读取任务证据，完成最终HEAD的QA验证`);
    return result.status === 'TESTS_PASSED' ? 0 : 1;
  } catch (error) {
    // An exception after the start marker is an unknown result, not permission
    // to replay. Keep recovery in the same task state even on logging failures.
    const events = orderedStepEvidence(read()).filter(line => line.startsWith('QA_AUTO_EVENT='));
    if (events.length && JSON.parse(events.at(-1).slice(14)).status === 'started') {
      record('verify_required', 'QA_AUTO_ERROR=命令启动后结果未完整记录', '先核实日志和外部副作用，再恢复task；禁止盲重放',
        { failureKind: 'unknown_result', executionState: 'unknown' });
    } else if (read().status === 'running') {
      record('blocked', 'QA_AUTO_ERROR=执行前置或配置/规格一致性检查失败', '检查CLI原因与日志，解决后显式恢复，不自动重试');
    }
    throw error;
  } finally { removeSignals(); release(); }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); return 0; }
  const options = parseArgs(argv);
  const context = runtimeContext();
  if (options.scope.startsWith('template:')) {
    const identity = context.config.template?.identity;
    if (context.config.template?.role !== 'source' || options.scope !== `template:${typeof identity === 'string' ? identity : identity?.id}`) throw new Error('template scope requires the matching template source repository');
  }
  if (options.plan || !context.config.qa?.auto) { console.log(agentProtocol(options)); return 0; }
  return executeConfigured(options, context, resolveTarget(context.config.qa.auto, options.scope));
}

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(`STATUS=BLOCKED\nSUMMARY=QA自动闭环未完成\nREASON=${error.message}\nNEXT_ACTION=核实配置、任务与副作用后继续；不得改写预期`);
  process.exitCode = 1;
});
module.exports = { parseArgs, resolveTarget, agentProtocol, runCycle, validateBinding, main };

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs, resolveTarget, runCycle, agentProtocol, validateBinding } = require('../qa-auto');
const { resolveCommand } = require('../../agent-runner/agent-cli');
const { createTask, runtimeContext, readTaskState } = require('../../agent-runner/agent-task');
const { acquireLock } = require('../../worktree-tools/worktree-core');

const argv = ['node', 'driver.js'];
function config(overrides = {}) {
  return { driver: argv, targets: { project: {
    specs: ['SPEC.md'], tests: [{ name: 'unit', layer: 'unit', command: ['node', '--test', 'unit.test.js'] }],
    notApplicable: { integration: '无模块协作', e2e: '无应用', contract: '无外部接口', recovery: '无持久状态' },
  } }, ...overrides };
}

test('TC-QAUTO-001 RUL-QAUTO-001 routes only qa auto and resolves scopes without fallback', () => {
  assert.equal(resolveCommand(['qa', 'auto', '--project']).script, 'infra/scripts/qa-tools/qa-auto.js');
  assert.equal(parseArgs([]).scope, 'task');
  assert.equal(parseArgs(['--project']).scope, 'project');
  assert.equal(parseArgs(['--module', 'accounts']).scope, 'module:accounts');
  assert.equal(parseArgs(['--template=xirang']).scope, 'template:xirang');
  for (const args of [['--project', '--module', 'a'], ['--module', '../x'], ['--template'], ['--bogus'], ['--project', '--project']]) {
    assert.throws(() => parseArgs(args));
  }
  assert.throws(() => resolveTarget(config(), 'module:accounts'), /target/i);
});

test('TC-QAUTO-001 incomplete layers, unknown keys and invalid limits fail closed', () => {
  const c = config();
  assert.equal(resolveTarget(c, 'project').maxRepairs, 3);
  delete c.targets.project.notApplicable.e2e;
  assert.throws(() => resolveTarget(c, 'project'), /e2e/);
  for (const bad of [{ maxRepairs: -1 }, { maxRepairs: 11 }, { timeoutSeconds: 0 }, { unknown: true }, { driver: 'node bad' }]) {
    assert.throws(() => resolveTarget(config(bad), 'project'));
  }
});

test('TC-QAUTO-002 RUL-QAUTO-002 missing driver hands off with no pass claim', () => {
  const output = agentProtocol(parseArgs(['--module', 'accounts']));
  assert.match(output, /STATUS=PENDING/);
  assert.match(output, /AUTO_CONTINUE=true/);
  assert.match(output, /生成/);
  assert.match(output, /qa verify/);
  assert.doesNotMatch(output, /STATUS=OK|TESTS_PASSED/);
  assert.match(output, /accounts/);
  assert.match(agentProtocol(parseArgs(['--plan'])), /AUTO_CONTINUE=false/);
  const help = spawnSync(process.execPath, [path.resolve(__dirname, '../../agent-runner/agent-cli.js'), '--help'], { encoding: 'utf8' });
  assert.match(help.stdout, /qa auto \[--project/);
});

test('TC-QAUTO-003 RUL-QAUTO-003 generate then repair then rerun all suites', async () => {
  const calls = [];
  let repaired = false;
  const result = await runCycle({ maxRepairs: 3, tests: ['unit', 'e2e'] }, async (stage, item, round) => {
    calls.push([stage, item, round]);
    if (stage === 'repair') repaired = true;
    return { exitCode: stage === 'test' && item === 'unit' && !repaired ? 1 : 0 };
  });
  assert.equal(result.status, 'TESTS_PASSED');
  assert.deepEqual(calls.map(([stage, item]) => `${stage}:${item || ''}`),
    ['generate:', 'test:unit', 'test:e2e', 'repair:', 'test:unit', 'test:e2e']);
  assert.equal(result.repairs, 1);
});

test('TC-QAUTO-004 RUL-QAUTO-004 bounded failure and infrastructure failures never repair blindly', async () => {
  let repairs = 0;
  const result = await runCycle({ maxRepairs: 2, tests: ['unit'] }, async (stage) => {
    if (stage === 'repair') repairs++;
    return { exitCode: stage === 'test' ? 1 : 0 };
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(repairs, 2);
  const timeoutCalls = [];
  const timeout = await runCycle({ maxRepairs: 3, tests: ['unit', 'e2e'] }, async (stage) => {
    timeoutCalls.push(stage);
    return { exitCode: stage === 'test' ? 124 : 0, unknown: stage === 'test' };
  });
  assert.equal(timeout.status, 'VERIFY_REQUIRED');
  assert.deepEqual(timeoutCalls, ['generate', 'test']);
  const failedDriver = await runCycle({ maxRepairs: 3, tests: ['unit'] }, async () => ({ exitCode: 1 }));
  assert.equal(failedDriver.status, 'BLOCKED');
});

test('TC-QAUTO-005 RUL-QAUTO-005 task binding and recovery block before side effects', () => {
  const context = { worktree: '/tmp/wt', projectRoot: '/tmp/repo', branch: 'feature/qa' };
  const state = { worktree: '/tmp/wt', project_root: '/tmp/repo', branch: 'feature/qa', status: 'running', task_type: 'mutation',
    steps: [{ id: 'S1', status: 'pending', replay: 'verify_first' }] };
  assert.doesNotThrow(() => validateBinding(context, state, 'S1'));
  for (const changed of [{ worktree: '/tmp/other' }, { branch: 'main' }, { status: 'blocked' },
    { steps: [{ id: 'S1', status: 'verify_required', replay: 'verify_first' }] }]) {
    assert.throws(() => validateBinding(context, { ...state, ...changed }, 'S1'));
  }
  assert.throws(() => validateBinding({ ...context, projectRoot: '/tmp/wt' }, state, 'S1'));
});

test('TC-QAUTO-003 TC-QAUTO-006 real driver generates a failing test, repairs implementation and validates result', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-auto-cycle-'));
  try {
    fs.writeFileSync(path.join(root, 'driver.cjs'), `const fs=require('node:fs');
      if(process.argv[2]==='generate') {
        fs.writeFileSync('implementation.cjs','module.exports=1;');
        fs.writeFileSync('unit.test.cjs',"require('node:assert/strict').equal(require('./implementation.cjs'),2);");
      } else fs.writeFileSync('implementation.cjs','module.exports=2;');`);
    const stages = [];
    const result = await runCycle({ maxRepairs: 1, tests: ['unit'] }, async (stage) => {
      stages.push(stage);
      const args = stage === 'test' ? ['unit.test.cjs'] : ['driver.cjs', stage];
      const child = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
      return { exitCode: child.status };
    });
    assert.deepEqual(stages, ['generate', 'test', 'repair', 'test']);
    assert.equal(result.status, 'TESTS_PASSED');
    assert.equal(fs.readFileSync(path.join(root, 'implementation.cjs'), 'utf8'), 'module.exports=2;');
    assert.match(fs.readFileSync(path.join(root, 'unit.test.cjs'), 'utf8'), /,2\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('TC-QAUTO-003 TC-QAUTO-005 TC-QAUTO-006 CLI records a real closed loop in its bound linked worktree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-auto-cli-'));
  const main = path.join(root, 'repo');
  const wt = path.join(root, 'worktrees', 'auto');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') || key.startsWith('AGENT_') || key === 'NODE_TEST_CONTEXT') delete env[key];
  function git(cwd, args) {
    const r = spawnSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r;
  }
  try {
    fs.mkdirSync(main);
    git(main, ['init', '-b', 'main']);
    fs.writeFileSync(path.join(main, 'SPEC.md'), 'The public value must equal 2.');
    git(main, ['add', 'SPEC.md']); git(main, ['commit', '-m', 'fixture']);
    git(main, ['worktree', 'add', '-b', 'feature/auto', wt]);
    fs.writeFileSync(path.join(wt, 'driver.cjs'), `const fs=require('node:fs');
      if(process.env.XIRANG_QA_AUTO_STAGE==='generate') {
        fs.writeFileSync('value.cjs','module.exports=1;');
        fs.writeFileSync('unit.test.js',"require('node:assert/strict').equal(require('./value.cjs'),2);");
      } else fs.writeFileSync('value.cjs','module.exports=2;');`);
    const c = config({ driver: [process.execPath, 'driver.cjs'] });
    c.targets.project.tests[0].command[0] = process.execPath;
    fs.writeFileSync(path.join(wt, 'agent.config.json'), JSON.stringify({ qa: { auto: c } }));
    const context = runtimeContext(wt);
    createTask({ ...context, taskId: 'auto', goal: 'fixture', taskType: 'mutation', phase: 'tdd',
      acceptanceCriteria: ['value=2'], steps: [{ title: 'auto', replay: 'verify_first' }] });
    const script = path.resolve(__dirname, '../qa-auto.js');
    const result = spawnSync(process.execPath, [script, '--project', '--task', 'auto', '--step', 'S1'], { cwd: wt, env, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /TEST_RESULT=TESTS_PASSED/);
    assert.match(result.stdout, /REPAIRS=1/);
    assert.doesNotMatch(result.stdout, /QA_VERDICT=PASS|STATUS=OK/);
    const state = readTaskState({ runsRoot: context.runsRoot, taskId: 'auto' });
    const events = state.steps[0].evidence.filter(line => line.startsWith('QA_AUTO_EVENT='))
      .map(line => JSON.parse(line.slice(14))).filter(event => event.status === 'completed');
    assert.deepEqual(events.map(event => [event.stage, event.exit_code]), [['generate', 0], ['test', 1], ['repair', 0], ['test', 0]]);
    for (const event of events) {
      const [relative, digest] = event.evidence.split(' sha256=');
      const content = fs.readFileSync(path.join(context.runsRoot, 'auto', relative));
      assert.equal(require('node:crypto').createHash('sha256').update(content).digest('hex'), digest);
    }
    // Source ownership and concurrent invocations must fail before any driver.
    const template = spawnSync(process.execPath, [script, '--template', 'xirang'], { cwd: wt, env, encoding: 'utf8' });
    assert.equal(template.status, 1);
    assert.match(template.stderr, /matching template source/);
    const lockName = `qa-auto-${require('node:crypto').createHash('sha256').update(path.resolve(context.worktree)).digest('hex').slice(0, 16)}`;
    const release = acquireLock(context.lockDir, lockName, 0);
    try {
      const concurrent = spawnSync(process.execPath, [script, '--project', '--task', 'auto', '--step', 'S1'], { cwd: wt, env, encoding: 'utf8', timeout: 10000 });
      assert.equal(concurrent.status, 1);
      assert.match(concurrent.stderr, /lock/i);
      assert.equal(readTaskState({ runsRoot: context.runsRoot, taskId: 'auto' }).steps[0].evidence.length, state.steps[0].evidence.length);
    } finally { release(); }
    // A hung driver must stop without executing tests or attempting repair.
    fs.writeFileSync(path.join(wt, 'driver.cjs'), 'setInterval(()=>{},1000);');
    c.timeoutSeconds = 1;
    fs.writeFileSync(path.join(wt, 'agent.config.json'), JSON.stringify({ qa: { auto: c } }));
    const timeout = spawnSync(process.execPath, [script, '--project', '--task', 'auto', '--step', 'S1'], { cwd: wt, env, encoding: 'utf8', timeout: 15000 });
    assert.equal(timeout.status, 1, timeout.stdout + timeout.stderr);
    assert.match(timeout.stdout, /TEST_RESULT=VERIFY_REQUIRED/);
    assert.equal(readTaskState({ runsRoot: context.runsRoot, taskId: 'auto' }).steps[0].status, 'verify_required');
    const replay = spawnSync(process.execPath, [script, '--project', '--task', 'auto', '--step', 'S1'], { cwd: wt, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(replay.status, 1);
    assert.match(replay.stderr, /binding\/recovery/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// The shortcut must survive template application, including its execution protocol.
test('TC-QAUTO-001 template distribution includes the auto protocol and executable route', () => {
  const root = path.resolve(__dirname, '../../../..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'infra/templates/agent/template.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.rules.find(entry => entry.path === 'AgentRoles/Handbooks/QA-AUTO.md'),
    { path: 'AgentRoles/Handbooks/QA-AUTO.md', strategy: 'overwrite' });
  const protocol = fs.readFileSync(path.join(root, 'AgentRoles/Handbooks/QA-AUTO.md'), 'utf8');
  assert.match(protocol, /不得新增 `\/test`/u);
  assert.match(protocol, /qa verify/u);
  assert.equal(fs.existsSync(path.join(root, resolveCommand(['qa', 'auto']).script)), true);
});

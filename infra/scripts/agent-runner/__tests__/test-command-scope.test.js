'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assertTestCommandScope } = require('../test-command-scope');

const fullDecision = (command) => ({
  steps: [{ evidence: [`TEST_SCOPE_DECISION=${JSON.stringify({
    version: 1,
    mode: 'full',
    impact_paths: ['all application tests'],
    commands: [command],
    not_run: [],
    reason: 'Explicitly required by the user',
    full_trigger: 'explicit_requirement',
    trigger_evidence: 'User asked for a full suite',
  })}`] }],
});

test('task exec rejects generic test scripts and unbounded runners before execution', () => {
  for (const command of [
    ['pnpm', 'test'],
    ['pnpm', 'test', 'tests/one.test.ts'],
    ['pnpm', '--filter', '@app/web', 'test'],
    ['pnpm', 'run', 'test:all'],
    ['pnpm', '-r', 'test'],
    ['turbo', 'run', 'test'],
    ['npx', 'turbo', 'run', 'test'],
    ['bash', '-lc', 'pnpm test'],
    ['python3', '-m', 'pytest'],
    ['node', 'infra/scripts/shared/test-budget.js', '--name=command-test', '--', 'pnpm', 'test'],
    ['node', 'infra/scripts/test-tools/run-with-test-guards.js', 'pnpm', 'exec', 'turbo', 'run', 'test'],
    ['pnpm', 'exec', 'turbo', 'run', 'test'],
    ['pnpm', 'exec', 'vitest', 'run'],
    ['node', '--test'],
  ]) assert.throws(() => assertTestCommandScope(command, { steps: [] }), /TEST_SCOPE_DECISION.*full|explicit test file/u);
});

test('task exec permits explicit file runners and the guarded template route', () => {
  for (const command of [
    ['pnpm', 'agent', '--', 'test', '--file', 'tests/one.test.ts', '--', 'pnpm', 'exec', 'vitest', 'run'],
    ['pnpm', 'exec', 'vitest', 'run', 'tests/one.test.ts'],
    ['pnpm', 'exec', 'playwright', 'test', 'tests/one.spec.ts'],
    ['node', 'infra/scripts/shared/test-budget.js', '--', 'pnpm', 'exec', 'vitest', 'run', 'tests/one.test.ts'],
    ['node', '--test', 'tests/one.test.js'],
    ['pnpm', 'typecheck'],
  ]) assert.doesNotThrow(() => assertTestCommandScope(command, { steps: [] }));
});

test('task exec permits an intentionally full command only with matching recorded evidence', () => {
  assert.doesNotThrow(() => assertTestCommandScope(['pnpm', 'test:all'], fullDecision('pnpm test:all')));
  assert.throws(() => assertTestCommandScope(['pnpm', 'test'], fullDecision('pnpm test:all')), /TEST_SCOPE_DECISION/u);
});

function crossStepApproval(latestFull) {
  const full = fullDecision('pnpm test').steps[0].evidence[0];
  const targeted = `TEST_SCOPE_DECISION=${JSON.stringify({version: 1, mode: 'targeted', commands: ['node --test one.test.js']})}`;
  return { steps: [{ id: 'S5', evidence: [targeted] }, { id: 'S9', evidence: [full] }],
    evidence_order: latestFull
      ? [{ step_id: 'S5', index: 0 }, { step_id: 'S9', index: 0 }]
      : [{ step_id: 'S9', index: 0 }, { step_id: 'S5', index: 0 }] };
}

test('a newer targeted checkpoint revokes old full approval across steps', () => {
  assert.throws(() => assertTestCommandScope(['pnpm', 'test'], crossStepApproval(false)), /TEST_SCOPE_DECISION/);
  assert.doesNotThrow(() => assertTestCommandScope(['pnpm', 'test'], crossStepApproval(true)));
});

test('corrupt evidence order cannot authorize aggregate commands', () => {
  const state = crossStepApproval(true); state.evidence_order.pop();
  assert.throws(() => assertTestCommandScope(['pnpm', 'test'], state), /evidence_order/);
});

// ---------------------------------------------------------------- 已登记为 qa.business 套件的命令

const NO_STATE = { steps: [] };
const GUARDED_SUITE = 'node infra/scripts/test-tools/run-with-test-guards.js pnpm exec playwright test --project=web';
const words = (text) => text.split(/\s+/u);
const withRegistered = (...registeredCommands) => ({ registeredCommands });

test('task exec accepts a command registered as a qa.business suite when it is typed verbatim', () => {
  for (const registered of [GUARDED_SUITE, 'pnpm exec vitest run', 'pnpm test:e2e', 'pnpm exec playwright test --grep=@smoke,@core']) {
    const command = words(registered);
    // 对照：不登记时这些命令都会被拦下，说明放行来自登记而不是分类过宽
    assert.throws(() => assertTestCommandScope(command, NO_STATE), /TEST_SCOPE_DECISION/u, registered);
    assert.doesNotThrow(() => assertTestCommandScope(command, NO_STATE, withRegistered('pnpm agent -- qa run', registered)), registered);
  }
});

test('registered suite commands match by arguments, tolerating only extra spaces or tabs between them', () => {
  const registered = '  pnpm   exec\tvitest run  ';
  assert.doesNotThrow(() => assertTestCommandScope(['pnpm', 'exec', 'vitest', 'run'], NO_STATE, withRegistered(registered)));
  for (const command of [
    ['pnpm', 'exec', 'vitest'],
    ['pnpm', 'exec', 'vitest', 'run', '--watch'],
    ['pnpm', 'exec', 'vitest', 'watch'],
    ['pnpm', 'vitest', 'run'],
    ['pnpm', 'exec', 'vitest', 'run', ''],
    // 套上未登记的包装器，实际执行的就不再是登记的那条命令
    ['node', 'infra/scripts/test-tools/run-with-test-guards.js', 'pnpm', 'exec', 'vitest', 'run'],
    ['node', 'infra/scripts/shared/test-budget.js', '--', 'pnpm', 'exec', 'vitest', 'run'],
  ]) {
    assert.throws(() => assertTestCommandScope(command, NO_STATE, withRegistered(registered)), /TEST_SCOPE_DECISION/u, JSON.stringify(command));
  }
});

test('registering one suite command does not unlock other aggregate or unbounded commands', () => {
  const options = withRegistered('pnpm exec playwright test --project=web');
  for (const command of [
    ['pnpm', 'test'],
    ['pnpm', 'run', 'test:all'],
    ['turbo', 'run', 'test'],
    ['bash', '-lc', 'pnpm exec playwright test --project=web'],
    ['pnpm', 'exec', 'playwright', 'test', '--project=ios'],
    ['node', '--test'],
  ]) assert.throws(() => assertTestCommandScope(command, NO_STATE, options), /TEST_SCOPE_DECISION/u, JSON.stringify(command));
});

test('registered text that depends on shell syntax is never treated as an argument match', () => {
  for (const [registered, command] of [
    ['pnpm exec vitest run && pnpm exec playwright test', ['pnpm', 'exec', 'vitest', 'run', '&&', 'pnpm', 'exec', 'playwright', 'test']],
    ['pnpm exec vitest run; pnpm test', ['pnpm', 'exec', 'vitest', 'run;', 'pnpm', 'test']],
    ['pnpm exec vitest run | tee out.log', ['pnpm', 'exec', 'vitest', 'run', '|', 'tee', 'out.log']],
    ['pnpm exec vitest run > out.log', ['pnpm', 'exec', 'vitest', 'run', '>', 'out.log']],
    ['pnpm exec vitest run --reporter="junit"', ['pnpm', 'exec', 'vitest', 'run', '--reporter="junit"']],
    ["pnpm exec vitest run 'a b'", ['pnpm', 'exec', 'vitest', 'run', "'a", "b'"]],
    ['pnpm exec vitest run $TARGET', ['pnpm', 'exec', 'vitest', 'run', '$TARGET']],
    ['pnpm exec vitest run `pwd`', ['pnpm', 'exec', 'vitest', 'run', '`pwd`']],
    ['pnpm exec vitest run $(pwd)', ['pnpm', 'exec', 'vitest', 'run', '$(pwd)']],
    ['pnpm exec vitest run tests/*', ['pnpm', 'exec', 'vitest', 'run', 'tests/*']],
    ['pnpm exec vitest run ~/tests', ['pnpm', 'exec', 'vitest', 'run', '~/tests']],
    ['pnpm exec vitest run # comment', ['pnpm', 'exec', 'vitest', 'run', '#', 'comment']],
    ['pnpm exec vitest run\npnpm test', ['pnpm', 'exec', 'vitest', 'run\npnpm', 'test']],
  ]) {
    assert.throws(() => assertTestCommandScope(command, NO_STATE, withRegistered(registered)), /TEST_SCOPE_DECISION/u, registered);
  }
});

test('malformed registrations are ignored instead of weakening the guard', () => {
  const command = ['pnpm', 'exec', 'vitest', 'run'];
  for (const registeredCommands of [
    undefined, null, 'pnpm exec vitest run', {}, 42, [], [''], ['   '], [null, 42, {}], [['pnpm', 'exec', 'vitest', 'run']],
  ]) {
    assert.throws(() => assertTestCommandScope(command, NO_STATE, { registeredCommands }), /TEST_SCOPE_DECISION/u, JSON.stringify(registeredCommands));
  }
  assert.throws(() => assertTestCommandScope(command, NO_STATE, {}), /TEST_SCOPE_DECISION/u);
});

test('the rejection explains that commands registered under qa.business.suites are accepted verbatim', () => {
  assert.throws(
    () => assertTestCommandScope(['pnpm', 'exec', 'vitest', 'run'], NO_STATE),
    (error) => /qa\.business\.suites/u.test(error.message) && /TEST_SCOPE_DECISION.*full|explicit test file/u.test(error.message),
  );
  assert.throws(
    () => assertTestCommandScope(['pnpm', 'test'], NO_STATE, withRegistered('pnpm exec vitest run')),
    (error) => /qa\.business\.suites/u.test(error.message),
  );
});

test('a recorded mode=full decision keeps working alongside registered suite commands', () => {
  assert.doesNotThrow(() => assertTestCommandScope(['pnpm', 'test:all'], fullDecision('pnpm test:all'), withRegistered('pnpm exec vitest run')));
  assert.throws(() => assertTestCommandScope(['pnpm', 'test'], fullDecision('pnpm test:all'), withRegistered('pnpm exec vitest run')), /TEST_SCOPE_DECISION/u);
});

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

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
    ['pnpm', 'exec', 'turbo', 'run', 'test'],
    ['pnpm', 'exec', 'vitest', 'run'],
    ['node', '--test'],
  ]) assert.throws(() => assertTestCommandScope(command, { steps: [] }), /TEST_SCOPE_DECISION.*full|explicit test file/u);
});

test('task exec permits explicit file runners and the guarded template route', () => {
  for (const command of [
    ['pnpm', 'agent', '--', 'test', '--file', 'tests/one.test.ts', '--', 'pnpm', 'exec', 'vitest', 'run'],
    ['pnpm', 'exec', 'vitest', 'run', 'tests/one.test.ts'],
    ['node', '--test', 'tests/one.test.js'],
    ['pnpm', 'typecheck'],
  ]) assert.doesNotThrow(() => assertTestCommandScope(command, { steps: [] }));
});

test('task exec permits an intentionally full command only with matching recorded evidence', () => {
  assert.doesNotThrow(() => assertTestCommandScope(['pnpm', 'test:all'], fullDecision('pnpm test:all')));
  assert.throws(() => assertTestCommandScope(['pnpm', 'test'], fullDecision('pnpm test:all')), /TEST_SCOPE_DECISION/u);
});

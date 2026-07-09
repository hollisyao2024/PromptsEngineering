'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  commandArgs,
  parseArgs,
  parseGuardOutput,
  shouldSwitchToMainAfter,
} = require('../tdd-finish');

test('parseGuardOutput reads status, reason, and next commands', () => {
  const parsed = parseGuardOutput(`STATUS=BLOCKED
BRANCH=fix/example
REASON=当前任务分支尚未合入主分支，必须继续 /qa plan → /qa verify → /qa merge。
NEXT_COMMANDS=
  node infra/scripts/qa-tools/generate-qa.js
  node infra/scripts/qa-tools/qa-verify.js
  node infra/scripts/qa-tools/qa-merge.js
`);

  assert.equal(parsed.status, 'BLOCKED');
  assert.match(parsed.reason, /尚未合入主分支/);
  assert.deepEqual(parsed.nextCommands, [
    'node infra/scripts/qa-tools/generate-qa.js',
    'node infra/scripts/qa-tools/qa-verify.js',
    'node infra/scripts/qa-tools/qa-merge.js',
  ]);
});

test('commandArgs passes project scope to known finish commands', () => {
  assert.deepEqual(
    commandArgs('node infra/scripts/tdd-tools/tdd-sync.js', { scope: 'project', skipChecks: false }),
    ['infra/scripts/tdd-tools/tdd-sync.js', '--project'],
  );
});

test('commandArgs passes skip-checks only to qa merge', () => {
  assert.deepEqual(
    commandArgs('node infra/scripts/qa-tools/qa-merge.js', { scope: 'session', skipChecks: true }),
    ['infra/scripts/qa-tools/qa-merge.js', '--skip-checks'],
  );
  assert.deepEqual(
    commandArgs('node infra/scripts/qa-tools/qa-verify.js', { scope: 'session', skipChecks: true }),
    ['infra/scripts/qa-tools/qa-verify.js'],
  );
});

test('parseArgs rejects no-qa because finish must merge', () => {
  assert.throws(() => parseArgs(['--no-qa']), /cannot run with --no-qa/);
});

test('shouldSwitchToMainAfter only triggers after qa merge', () => {
  assert.equal(shouldSwitchToMainAfter('node infra/scripts/qa-tools/qa-merge.js'), true);
  assert.equal(shouldSwitchToMainAfter('node infra/scripts/tdd-tools/tdd-push.js'), false);
});

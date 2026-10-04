'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { spawnExitCode } = require('../spawn-exit');

test('spawnExitCode keeps numeric child exit codes', () => {
  assert.equal(spawnExitCode({ status: 0, signal: null }), 0);
  assert.equal(spawnExitCode({ status: 3, signal: null }), 3);
});

test('spawnExitCode maps signal termination to a non-zero shell code', () => {
  assert.equal(spawnExitCode({ status: null, signal: 'SIGKILL' }), 128 + os.constants.signals.SIGKILL);
  assert.equal(spawnExitCode({ status: null, signal: 'SIGTERM' }), 128 + os.constants.signals.SIGTERM);
  assert.equal(spawnExitCode({ status: null, signal: 'SIGUNKNOWN' }), 1);
  assert.equal(spawnExitCode({ status: null, signal: null }), 1);
});

test('github-auth-run fails when the wrapped command is killed by a signal', () => {
  const runner = path.resolve(__dirname, '..', 'github-auth-run.js');
  const result = spawnSync(process.execPath, [
    runner, '--', process.execPath, '-e', "process.kill(process.pid, 'SIGKILL')",
  ], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: '' } });
  assert.equal(result.status, 128 + os.constants.signals.SIGKILL);
});

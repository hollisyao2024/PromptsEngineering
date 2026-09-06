'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function tick(branch) {
  return spawnSync(process.execPath, [path.join(__dirname, '../tdd-tick.js')], {
    encoding: 'utf8',
    env: { ...process.env, TDD_BRANCH: branch },
  });
}

test('Codex maintenance branches sync without bypassing explicit TASK validation', () => {
  const maintenance = tick('codex/template-compatibility');
  assert.equal(maintenance.status, 0, maintenance.stdout + maintenance.stderr);
  assert.match(maintenance.stdout, /no-op/);
  assert.notEqual(tick('codex/TASK-NONEXISTENT-999-fix').status, 0);
  assert.notEqual(tick('unknown/unplanned').status, 0);
});

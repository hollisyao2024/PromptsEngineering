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

test('Claude Code cloud session branches sync without bypassing explicit TASK validation', () => {
  const session = tick('claude/epic-franklin-lw7fmw');
  assert.equal(session.status, 0, session.stdout + session.stderr);
  assert.match(session.stdout, /no-op/);
  assert.notEqual(tick('claude/TASK-NONEXISTENT-999-fix').status, 0);
  assert.notEqual(tick('claudex/unplanned').status, 0);
});

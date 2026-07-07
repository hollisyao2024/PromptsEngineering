'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('/tdd sync --help exits before Schema-Doc Sync Gate', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const script = path.join(repoRoot, 'infra/scripts/tdd-tools/tdd-sync.js');

  const result = spawnSync(process.execPath, [script, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node infra\/scripts\/tdd-tools\/tdd-sync\.js/);
  assert.doesNotMatch(result.stderr, /Schema-Doc Sync Gate/);
});

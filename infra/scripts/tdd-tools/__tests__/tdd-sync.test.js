'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { resolveProjectChecks, runProjectChecks } = require('../tdd-sync');

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

test('/tdd sync runs configured tdd.projectChecks before document synchronization', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const script = fs.readFileSync(path.join(repoRoot, 'infra/scripts/tdd-tools/tdd-sync.js'), 'utf8');
  const defaults = JSON.parse(fs.readFileSync(path.join(repoRoot, 'infra/templates/agent/config.example.json'), 'utf8'));

  assert.deepEqual(defaults.tdd.projectChecks, []);
  assert.match(script, /tdd\.projectChecks/);
  assert.match(script, /Project Check Gate/);
});

test('/tdd sync blocks when a required project check fails', () => {
  const config = { tdd: { projectChecks: [{ name: 'check:db-migrations', required: true }] } };
  assert.deepEqual(resolveProjectChecks(config), [{ name: 'check:db-migrations', required: true }]);
  assert.equal(runProjectChecks(config, {
    cwd: process.cwd(),
    pnpmBin: 'pnpm',
    spawn: () => ({ status: 1 }),
  }), false);
});

test('/tdd sync rejects unsafe project check names', () => {
  assert.throws(
    () => resolveProjectChecks({ tdd: { projectChecks: [{ name: 'check && unsafe', required: true }] } }),
    /invalid tdd\.projectChecks entry/,
  );
});

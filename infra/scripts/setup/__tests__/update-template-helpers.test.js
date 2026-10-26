'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../update-template-git');
const { migrateLegacyAgentConfig } = require('../update-template-local-config');

function project(t, config) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'update-template-helpers-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (config !== undefined) fs.writeFileSync(path.join(root, 'agent.config.json'), `${JSON.stringify(config, null, 2)}\n`);
  return { root, read: () => JSON.parse(fs.readFileSync(path.join(root, 'agent.config.json'), 'utf8')) };
}

test('run captures output larger than the spawnSync default buffer', () => {
  const result = run(process.execPath, ['-e', 'process.stdout.write("x".repeat(2 * 1024 * 1024))']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.length, 2 * 1024 * 1024);
});

test('run fails loudly when the command cannot start', () => {
  assert.throws(() => run('xirang-command-that-does-not-exist', []), /xirang-command-that-does-not-exist/);
});

test('legacy devops config is renamed to ops in place and the unused deploy flag is dropped', t => {
  const p = project(t, { baseBranch: 'main', devops: { deployEnabled: true, commands: { ship: 'x' } }, features: { devopsDeploy: true }, tail: 1 });
  const preview = migrateLegacyAgentConfig(p.root, false);
  assert.equal(preview.status, 'migrated');
  assert.deepEqual(Object.keys(p.read()), ['baseBranch', 'devops', 'features', 'tail'], 'dry-run must not write');
  const result = migrateLegacyAgentConfig(p.root, true);
  assert.equal(result.status, 'migrated');
  assert.deepEqual(result.changes, ['devops->ops', 'features.devopsDeploy removed', 'features removed (empty)']);
  assert.deepEqual(p.read(), { baseBranch: 'main', ops: { deployEnabled: true, commands: { ship: 'x' } }, tail: 1 });
  assert.deepEqual(Object.keys(p.read()), ['baseBranch', 'ops', 'tail']);
  assert.equal(migrateLegacyAgentConfig(p.root, true).status, 'unchanged');
});

test('config migration keeps other feature flags, skips missing config and blocks on devops+ops', t => {
  const kept = project(t, { features: { devopsDeploy: false, other: true } });
  migrateLegacyAgentConfig(kept.root, true);
  assert.deepEqual(kept.read(), { features: { other: true } });
  assert.equal(migrateLegacyAgentConfig(project(t).root, true).status, 'unchanged');
  const both = project(t, { devops: {}, ops: {} });
  assert.throws(() => migrateLegacyAgentConfig(both.root, true), /devops.*ops/);
  assert.deepEqual(both.read(), { devops: {}, ops: {} });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const source = path.resolve(__dirname, '../../../..');

test('installed template contracts accept the consumer package identity and version', (t) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-consumer-contract-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const pkg = { name: 'example-consumer', version: '0.3.7', private: true };
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(pkg));
  const apply = spawnSync(process.execPath, [
    path.join(source, 'infra/scripts/setup/template-apply-engine.js'),
    '--source', source, '--target', target, '--write',
  ], { cwd: target, encoding: 'utf8' });
  assert.equal(apply.status, 0, apply.stdout + apply.stderr);
  const installed = JSON.parse(fs.readFileSync(path.join(target, 'package.json')));
  assert.equal(installed.name, pkg.name);
  assert.equal(installed.version, pkg.version);
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const check = spawnSync(process.execPath, [
    '--test', path.join(target, 'infra/scripts/setup/__tests__/template-surface.test.js'),
  ], { cwd: target, encoding: 'utf8', env: childEnv });
  assert.match(check.stdout, /Xirang identity, official upstream/);
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

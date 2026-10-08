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
  const { orderedStepEvidence } = require(path.join(target, 'infra/scripts/shared/task-evidence.js'));
  const { assertTestCommandScope } = require(path.join(target, 'infra/scripts/agent-runner/test-command-scope.js'));
  const full = `TEST_SCOPE_DECISION=${JSON.stringify({ version: 1, mode: 'full', full_trigger: 'explicit_requirement', trigger_evidence: 'earlier approval', commands: ['pnpm test'] })}`;
  const targeted = 'TEST_SCOPE_DECISION={"version":1,"mode":"targeted"}';
  const task = { steps: [{ id: 'S5', evidence: [targeted] }, { id: 'S9', evidence: [full] }],
    evidence_order: [{ step_id: 'S9', index: 0 }, { step_id: 'S5', index: 0 }] };
  assert.deepEqual(orderedStepEvidence(task), [full, targeted]);
  assert.throws(() => assertTestCommandScope(['pnpm', 'test'], task), /TEST_SCOPE_DECISION/);
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const check = spawnSync(process.execPath, [
    '--test', path.join(target, 'infra/scripts/setup/__tests__/template-surface.test.js'),
    path.join(target, 'infra/scripts/setup/__tests__/template-boundaries.test.js'),
  ], { cwd: target, encoding: 'utf8', env: childEnv });
  assert.match(check.stdout, /Xirang identity, official upstream/);
  assert.match(check.stdout, /standalone template update still creates the workflow and converges/);
  assert.equal(check.status, 0, check.stdout + check.stderr);
  // 该测试检查息壤源自己的根 scripts.test；应用模板后的实际项目没有它，必须跳过而不是抛 TypeError。
  const coverage = spawnSync(process.execPath, [
    '--test', '--test-reporter=tap',
    path.join(target, 'infra/scripts/agent-runner/__tests__/root-test-script-coverage.test.js'),
  ], { cwd: target, encoding: 'utf8', env: childEnv });
  assert.match(coverage.stdout, /^ok \d+ - root test script covers .* # SKIP /mu);
  assert.equal(coverage.status, 0, coverage.stdout + coverage.stderr);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runTargetedTest } = require('../targeted-test');

test('targeted test entry rejects missing or invalid targets before starting a runner', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-targeted-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'unit.test.js'), '');
  assert.throws(() => runTargetedTest([], { cwd: root }), /--file/u);
  assert.throws(() => runTargetedTest(['--file', 'missing.test.js', '--', 'node', '--test'], { cwd: root }), /existing test file/u);
  assert.throws(() => runTargetedTest(['--file', 'unit.test.js', '--'], { cwd: root }), /runner/u);
  assert.throws(() => runTargetedTest(['--file', 'unit.test.js', '--', 'pnpm', 'test'], { cwd: root }), /aggregate test command/u);
  assert.throws(() => runTargetedTest(['--file', 'unit.test.js', '--', 'node', '-e', 'process.exit(0)'], { cwd: root }), /file-scoped runner/u);
});

test('targeted test entry appends exactly the requested file to an explicit runner', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-targeted-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'unit.test.js'), '');
  const args = ['--file', 'unit.test.js', '--', 'pnpm', 'exec', 'vitest', 'run'];
  let spawned;
  assert.equal(runTargetedTest(args, { cwd: root, spawn: (bin, parameters) => {
    spawned = { bin, parameters };
    return { status: 0 };
  } }), 0);
  assert.deepEqual(spawned, { bin: 'pnpm', parameters: ['exec', 'vitest', 'run', 'unit.test.js'] });
});

test('targeted test entry accepts a runner registered verbatim under qa.business.suites and still appends the file', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-targeted-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'unit.test.js'), '');
  const registered = ['node', 'tests/run-e2e.js', '--project=web'];
  const spawnStub = (bin, parameters) => ({ status: 0, bin, parameters });
  const run = (runner) => {
    let spawned;
    const status = runTargetedTest(['--file', 'unit.test.js', '--', ...runner], { cwd: root, spawn: (bin, parameters) => {
      spawned = { bin, parameters };
      return { status: 0 };
    } });
    return { status, spawned };
  };
  // 对照：未登记时同一运行器被拒绝，说明放行来自登记而不是运行器白名单放宽
  assert.throws(() => run(registered), /file-scoped runner/u);
  assert.throws(() => runTargetedTest(['--file', 'unit.test.js', '--', 'pnpm', 'test:e2e'], { cwd: root, spawn: spawnStub }), /aggregate test command/u);

  fs.writeFileSync(path.join(root, 'agent.config.json'), `${JSON.stringify({
    qa: { business: { suites: [
      { name: 'e2e', command: registered.join(' '), report: 'reports/e2e.xml' },
      { name: 'script', command: 'pnpm test:e2e', report: 'reports/script.xml' },
    ] } },
  }, null, 2)}\n`);
  assert.deepEqual(run(registered), { status: 0, spawned: { bin: 'node', parameters: ['tests/run-e2e.js', '--project=web', 'unit.test.js'] } });
  assert.deepEqual(run(['pnpm', 'test:e2e']), { status: 0, spawned: { bin: 'pnpm', parameters: ['test:e2e', 'unit.test.js'] } });
  // 其余拒绝规则不变：参数变体、非登记命令与无效文件仍被拦下
  assert.throws(() => run([...registered, '--headed']), /file-scoped runner/u);
  assert.throws(() => run(['pnpm', 'test']), /aggregate test command/u);
  assert.throws(() => runTargetedTest(['--file', 'missing.test.js', '--', ...registered], { cwd: root, spawn: spawnStub }), /existing test file/u);
});

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

test('targeted test entry passes regex-pattern runners a literal file pattern so [param] paths still match', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-targeted-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join('app', '[id]', 'route.test.ts');
  fs.mkdirSync(path.join(root, 'app', '[id]'), { recursive: true });
  fs.writeFileSync(path.join(root, file), '');
  const run = (runner) => {
    let spawned;
    runTargetedTest(['--file', file, '--', ...runner], { cwd: root, spawn: (bin, parameters) => {
      spawned = parameters.at(-1);
      return { status: 0 };
    } });
    return spawned;
  };
  // Jest 与 Playwright 把位置参数当正则：转义后只匹配字面路径
  const escaped = run(['pnpm', '--dir', 'apps/web', 'exec', 'jest', '--runInBand']);
  assert.equal(escaped, 'app/\\[id\\]/route\\.test\\.ts'.split('/').join(path.sep === '\\' ? '\\\\' : '/'));
  assert.match(path.join(root, file), new RegExp(escaped, 'u'));
  assert.doesNotMatch(path.join(root, 'app', 'i', 'route.test.ts'), new RegExp(escaped, 'u'));
  assert.equal(run(['npx', 'playwright', 'test']), escaped);
  // --runTestsByPath 按路径解析且运行器可能换了 cwd：传绝对路径，不转义
  assert.equal(run(['pnpm', 'exec', 'jest', '--runTestsByPath']), fs.realpathSync(path.join(root, file)));
  // 按子串或路径过滤的运行器保持原样
  assert.equal(run(['pnpm', 'exec', 'vitest', 'run']), file);
  assert.equal(run(['node', '--test']), file);
});

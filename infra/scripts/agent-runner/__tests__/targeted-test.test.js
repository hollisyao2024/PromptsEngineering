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

test('targeted test entry accepts runners registered under testing.targetedRunners with their cwd and file argument mode', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-targeted-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join('apps', 'web', 'src', '[id]', 'route.test.ts');
  fs.mkdirSync(path.join(root, 'apps', 'web', 'src', '[id]'), { recursive: true });
  fs.writeFileSync(path.join(root, file), '');
  const writeConfig = (targetedRunners) => fs.writeFileSync(path.join(root, 'agent.config.json'), `${JSON.stringify({
    testing: { targetedRunners },
  }, null, 2)}\n`);
  const run = (runner) => {
    let spawned;
    const status = runTargetedTest(['--file', file, '--', ...runner], { cwd: root, spawn: (bin, parameters, options) => {
      spawned = { bin, parameters, cwd: options.cwd };
      return { status: 0 };
    } });
    return { status, spawned };
  };
  const wrapper = ['node', 'scripts/run-jest.cjs', '--runTestsByPath'];
  // 对照：未登记时项目自有的包装脚本被拒绝
  assert.throws(() => run(wrapper), /file-scoped runner/u);

  writeConfig([
    { command: wrapper.join(' '), cwd: 'apps/web', fileArgument: 'absolute' },
    { command: 'node scripts/run-e2e.cjs', cwd: 'apps/web', fileArgument: 'pattern' },
    { command: 'node tools/run-unit.cjs' },
    'pnpm test',
  ]);
  const webRoot = path.join(root, 'apps', 'web');
  assert.deepEqual(run(wrapper), { status: 0, spawned: {
    bin: 'node', parameters: ['scripts/run-jest.cjs', '--runTestsByPath', fs.realpathSync(path.join(root, file))], cwd: webRoot,
  } });
  const relativeToWeb = path.join('src', '[id]', 'route.test.ts');
  assert.deepEqual(run(['node', 'scripts/run-e2e.cjs']).spawned, {
    bin: 'node', parameters: ['scripts/run-e2e.cjs', relativeToWeb.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')], cwd: webRoot,
  });
  // 默认 cwd 为当前 worktree 根，默认 fileArgument=path 原样追加
  assert.deepEqual(run(['node', 'tools/run-unit.cjs']).spawned, { bin: 'node', parameters: ['tools/run-unit.cjs', file], cwd: root });
  // 逐词精确匹配：参数变体不放行；登记也不能放行聚合命令
  assert.throws(() => run([...wrapper, '--coverage']), /file-scoped runner/u);
  assert.throws(() => run(['pnpm', 'test']), /aggregate test command/u);

  // 无效登记 fail-closed：cwd 越出 worktree、不存在或 fileArgument 非法
  writeConfig([{ command: 'node ../x.cjs', cwd: '..' }]);
  assert.throws(() => run(['node', '../x.cjs']), /testing\.targetedRunners cwd/u);
  writeConfig([{ command: 'node x.cjs', cwd: 'missing' }]);
  assert.throws(() => run(['node', 'x.cjs']), /testing\.targetedRunners cwd/u);
  writeConfig([{ command: 'node x.cjs', fileArgument: 'glob' }]);
  assert.throws(() => run(['node', 'x.cjs']), /testing\.targetedRunners fileArgument/u);
});

test('targeted test entry starts Windows batch-shim runners such as pnpm.cmd and propagates their exit code', { skip: process.platform !== 'win32' }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-targeted-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(root, 'unit.test.js'), '');
  // 模拟 pnpm 的 .cmd shim：记录收到的参数并按 FAKE_EXIT 退出
  fs.writeFileSync(path.join(bin, 'pnpm.cmd'), '@echo off\r\n>"%~dp0args.txt" echo %*\r\nexit /b %FAKE_EXIT%\r\n');
  const env = { ...process.env, PATH: [bin, process.env.PATH || process.env.Path || ''].join(path.delimiter), FAKE_EXIT: '0' };
  delete env.Path;
  const args = ['--file', 'unit.test.js', '--', 'pnpm', 'exec', 'vitest', 'run'];
  assert.equal(runTargetedTest(args, { cwd: root, env }), 0);
  assert.equal(fs.readFileSync(path.join(bin, 'args.txt'), 'utf8').trim(), '"exec" "vitest" "run" "unit.test.js"');
  assert.equal(runTargetedTest(args, { cwd: root, env: { ...env, FAKE_EXIT: '3' } }), 3);
  // cmd.exe 引号内无法安全承载的参数在启动前阻断
  fs.writeFileSync(path.join(root, 'a%b.test.js'), '');
  assert.throws(() => runTargetedTest(['--file', 'a%b.test.js', '--', 'pnpm', 'exec', 'vitest', 'run'], { cwd: root, env }), /cmd\.exe/u);
});

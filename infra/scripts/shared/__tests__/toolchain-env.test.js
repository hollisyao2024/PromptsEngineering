'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chmodSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { delimiter, join } = require('node:path');

const {
  createWindowsCmdInvocation,
  createWindowsSpawnInvocation,
  resolvePnpmBin,
  resolvePnpmNearNodeRuntime,
  resolveBashBin,
} = require('../toolchain-env');

test('Windows Bash resolver selects Git Bash instead of the WSL PATH shim', () => {
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  assert.equal(resolveBashBin('win32', {}, (file) => file === gitBash), gitBash);
  const fallback = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe';
  assert.equal(resolveBashBin('win32', {}, (file) => file === fallback), fallback);
});

test('Bash resolver preserves explicit installation and fails closed when unavailable', () => {
  const custom = 'D:\\tools\\Git\\bin\\bash.exe';
  assert.equal(resolveBashBin('win32', { BASH_PATH: custom }, (file) => file === custom), custom);
  assert.equal(resolveBashBin('win32', {}, () => false), '');
  assert.equal(resolveBashBin('linux', {}, () => false), 'bash');
});

test('resolvePnpmBin prefers AGENT_PNPM_BIN when configured', () => {
  assert.equal(resolvePnpmBin('win32', { AGENT_PNPM_BIN: 'C:\\tools\\pnpm.cjs' }), 'C:\\tools\\pnpm.cjs');
});

test('resolvePnpmNearNodeRuntime prefers pnpm installed next to the active Node runtime', () => {
  const tmp = join(tmpdir(), `agent-toolchain-${process.pid}-${Date.now()}`);
  try {
    const bin = join(tmp, 'bin');
    mkdirSync(bin, { recursive: true });
    const node = join(bin, 'node');
    const pnpm = join(bin, 'pnpm');
    writeFileSync(node, '');
    writeFileSync(pnpm, '#!/usr/bin/env sh\n');
    chmodSync(pnpm, 0o755);

    assert.equal(resolvePnpmNearNodeRuntime('pnpm', node), pnpm);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('createWindowsCmdInvocation runs pnpm JS entry through current node runtime', () => {
  const invocation = createWindowsCmdInvocation(
    'C:\\tools\\pnpm.cjs',
    ['install'],
    { env: { PATH: 'C:\\Windows\\System32' } },
    'win32',
    { AGENT_PNPM_BIN: 'C:\\tools\\pnpm.cjs' }
  );

  assert.equal(invocation.bin, process.execPath);
  assert.deepEqual(invocation.args, ['C:\\tools\\pnpm.cjs', 'install']);
  assert.equal(invocation.options.windowsHide, true);
});

test('createWindowsSpawnInvocation leaves non-Windows commands untouched', () => {
  const options = { cwd: '/repo', env: { PATH: '/usr/bin' } };
  assert.deepEqual(createWindowsSpawnInvocation('pnpm', ['exec', 'vitest'], options, 'linux'), {
    bin: 'pnpm', args: ['exec', 'vitest'], options,
  });
});

test('createWindowsSpawnInvocation routes PATHEXT batch shims through quoted cmd.exe', { skip: process.platform !== 'win32' }, () => {
  const tmp = join(tmpdir(), `xirang-spawn-invocation-${process.pid}`);
  const bin = join(tmp, 'bin');
  try {
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'pnpm.cmd'), '@exit /b 0\r\n');
    writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\n');
    writeFileSync(join(bin, 'tool.exe'), '');
    const env = { Path: [bin, 'C:\\missing'].join(delimiter), PATHEXT: '.COM;.EXE;.BAT;.CMD' };
    const options = { cwd: tmp, env };

    const shim = createWindowsSpawnInvocation('pnpm', ['exec', 'vitest', 'run', 'a b.test.ts'], options, 'win32');
    assert.equal(shim.bin, `"${join(bin, 'pnpm.cmd')}" "exec" "vitest" "run" "a b.test.ts"`);
    assert.deepEqual(shim.args, []);
    assert.equal(shim.options.shell, true);
    assert.equal(shim.options.windowsHide, true);
    assert.equal(shim.options.cwd, tmp);
    // 引号内 cmd.exe 仍会展开 % / ! 或被 " 截断：直接拒绝而不是尝试转义
    for (const unsafe of ['%PATH%', 'a!b', 'a"b', 'a\nb']) {
      assert.throws(() => createWindowsSpawnInvocation('pnpm', ['exec', unsafe], options, 'win32'), /cmd\.exe/u);
    }
    // 显式带路径的 shim 相对 cwd 解析
    assert.equal(createWindowsSpawnInvocation('bin\\pnpm', [], options, 'win32').options.shell, true);
    // 原生可执行文件与未解析命令保持原样，由 spawn 直接启动或报 ENOENT
    assert.deepEqual(createWindowsSpawnInvocation('tool', ['--x'], options, 'win32'), { bin: 'tool', args: ['--x'], options });
    assert.deepEqual(createWindowsSpawnInvocation('missing', [], options, 'win32'), { bin: 'missing', args: [], options });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// cmd.exe 对“带引号的裸名 + PATH 查找”启动的批处理把 %~dp0 算成当前目录，npm 全局 pnpm.cmd 因此找不到 pnpm.mjs。
// shim 用 %~dp0 定位同目录的 probe.js，只有解析成绝对路径启动时才能成功。
test('createWindowsCmdInvocation launches a bare .cmd name by absolute path so %~dp0 is the shim directory', { skip: process.platform !== 'win32' }, () => {
  const tmp = join(tmpdir(), `xirang-cmd-invocation-${process.pid}`);
  const bin = join(tmp, 'bin');
  const other = join(tmp, 'other');
  try {
    mkdirSync(bin, { recursive: true });
    mkdirSync(other, { recursive: true });
    writeFileSync(join(bin, 'probe.js'), 'process.exit(process.argv[2] === "run" ? 0 : 4);\n');
    writeFileSync(join(bin, 'shim.cmd'), '@node "%~dp0probe.js" %*\r\n');
    const env = { ...process.env, Path: [bin, process.env.Path || process.env.PATH].join(delimiter) };
    delete env.PATH;

    const invocation = createWindowsCmdInvocation('shim.cmd', ['run'], { cwd: other, env }, 'win32', env);
    assert.equal(invocation.bin, `"${join(bin, 'shim.cmd')}" "run"`);
    assert.equal(invocation.options.shell, true);
    const result = spawnSync(invocation.bin, invocation.args, { ...invocation.options, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);

    // 找不到时保留原名，由 cmd.exe 报出原始错误
    assert.equal(createWindowsCmdInvocation('missing.cmd', [], { cwd: other, env }, 'win32', env).bin, '"missing.cmd"');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

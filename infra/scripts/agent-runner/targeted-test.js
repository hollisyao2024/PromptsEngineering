#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../shared/config');
const { createWindowsSpawnInvocation } = require('../shared/toolchain-env');
const { isRegisteredSuiteCommand } = require('./test-command-scope');

// 与 task exec 同一口径：qa.business.suites 里逐词一致的登记命令视为项目已审定的套件入口，
// 不再套用聚合命令拦截与运行器白名单；文件校验与追加文件参数的行为保持不变。
function isRegisteredSuite(runner, cwd) {
  const { registeredSuiteCommands } = require('../qa-tools/business-config');
  return isRegisteredSuiteCommand(runner, registeredSuiteCommands(loadConfig({ repoRoot: cwd })));
}

const FILE_ARGUMENT_MODES = new Set(['path', 'absolute', 'pattern']);

// testing.targetedRunners 登记项目自有的文件级运行器（如带锁或内存预算的包装脚本），逐词精确匹配 command 才放行。
// cwd 是相对当前 worktree 根的启动目录且必须留在 worktree 内；fileArgument 决定追加形式：
// path（相对启动目录，默认）、absolute（真实绝对路径）、pattern（正则转义的相对路径）。登记无效时 fail-closed。
function registeredTargetedRunner(runner, cwd) {
  const entries = loadConfig({ repoRoot: cwd }).testing?.targetedRunners;
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    const spec = typeof entry === 'string' ? { command: entry } : entry;
    if (!spec || typeof spec !== 'object' || !isRegisteredSuiteCommand(runner, [spec.command])) continue;
    const fileArgument = spec.fileArgument ?? 'path';
    if (!FILE_ARGUMENT_MODES.has(fileArgument)) {
      throw new Error('testing.targetedRunners fileArgument must be path, absolute, or pattern');
    }
    const directory = spec.cwd ?? '.';
    const runCwd = typeof directory === 'string' && !path.isAbsolute(directory) ? path.resolve(cwd, directory) : '';
    if (!runCwd || !fs.existsSync(runCwd) || !fs.statSync(runCwd).isDirectory()) {
      throw new Error('testing.targetedRunners cwd must be an existing relative directory inside the current worktree');
    }
    const relative = path.relative(fs.realpathSync(cwd), fs.realpathSync(runCwd));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('testing.targetedRunners cwd must be an existing relative directory inside the current worktree');
    }
    return { cwd: runCwd, fileArgument };
  }
  return null;
}

function escapePattern(file) {
  return file.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
}

function parseTargetedTest(argv, cwd = process.cwd()) {
  if (argv[0] !== '--file' || !argv[1]) {
    throw new Error('test requires --file <existing test file> -- <runner> [args]');
  }
  const separator = argv.indexOf('--', 2);
  if (separator < 0 || separator === argv.length - 1 || separator !== 2) {
    throw new Error('test requires an explicit runner after --');
  }
  const file = argv[1];
  if (path.isAbsolute(file) || file.startsWith('-')) {
    throw new Error('test target must be a relative file inside the current worktree');
  }
  const absolute = path.resolve(cwd, file);
  if (!fs.existsSync(absolute)) throw new Error('test requires an existing test file');
  const relative = path.relative(fs.realpathSync(cwd), fs.realpathSync(absolute));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('test target must stay inside the current worktree');
  }
  const name = path.basename(file);
  const isTestFile = /[._-](?:test|spec)\.[cm]?[jt]sx?$/iu.test(name)
    || /(?:^test_.+|.+_test)\.py$/iu.test(name)
    || /_test\.go$/iu.test(name);
  if (!fs.statSync(absolute).isFile() || !isTestFile) {
    throw new Error('test requires an existing test file');
  }
  const runner = argv.slice(separator + 1);
  if (isRegisteredSuite(runner, cwd)) return { runner, file, registered: true };
  const executable = path.basename(runner[0]).replace(/\.cmd$/iu, '').toLowerCase();
  const first = runner[1] || '';
  if (['sh', 'bash', 'zsh', 'cmd', 'powershell'].includes(executable)
    || (['pnpm', 'npm', 'yarn', 'bun'].includes(executable)
      && (/^test(?::|$)/u.test(first) || (first === 'run' && /^test(?::|$)/u.test(runner[2] || ''))
        || (first === 'exec' && runner[2] === 'turbo')))) {
    throw new Error('aggregate test command is not accepted; pass a file-scoped runner');
  }
  const project = registeredTargetedRunner(runner, cwd);
  if (project) return { runner, file, project };
  const direct = ['vitest', 'jest', 'pytest'].includes(executable)
    || (executable === 'playwright' && first === 'test')
    || (executable === 'node' && first === '--test')
    || (executable === 'go' && first === 'test')
    || (/^python(?:3(?:\.\d+)?)?$/u.test(executable) && first === '-m' && runner[2] === 'pytest');
  const viaPackageManager = ['pnpm', 'npm', 'yarn', 'bun'].includes(executable)
    && runner.includes('exec')
    && ['vitest', 'jest', 'pytest', 'playwright'].includes(runner[runner.indexOf('exec') + 1]);
  const viaNpx = executable === 'npx' && ['vitest', 'jest', 'pytest', 'playwright'].includes(first);
  if (!direct && !viaPackageManager && !viaNpx) {
    throw new Error('test requires a file-scoped runner (Vitest, Jest, Playwright, Node test, Pytest, or Go test)');
  }
  return { runner, file };
}

// Jest 与 Playwright 把位置参数当正则匹配测试路径：`[id]` 会变成字符类而选不中文件，
// 因此转义为字面模式；Jest 的 --runTestsByPath 按路径解析且可能在其他目录启动（如 --dir），改传绝对路径。
function fileArgument(runner, file, cwd) {
  const tool = runner.find((part) => ['jest', 'playwright'].includes(path.basename(part).replace(/\.cmd$/iu, '').toLowerCase()));
  if (!tool) return file;
  if (runner.includes('--runTestsByPath')) return fs.realpathSync(path.resolve(cwd, file));
  return escapePattern(file);
}

function projectFileArgument({ cwd: runCwd, fileArgument }, file, cwd) {
  const absolute = fs.realpathSync(path.resolve(cwd, file));
  if (fileArgument === 'absolute') return absolute;
  const relative = path.relative(fs.realpathSync(runCwd), absolute);
  return fileArgument === 'pattern' ? escapePattern(relative) : relative;
}

// 默认启动器：Windows 上把 pnpm/npx 等 .cmd shim 改经受限引用的 cmd.exe 启动，其余平台与原生可执行文件原样 spawn。
// 注入的 spawn 仍收到逻辑运行器（runner[0] + 参数），平台适配只发生在真实启动这一层。
function spawnRunner(bin, args, options) {
  const invocation = createWindowsSpawnInvocation(bin, args, options);
  return spawnSync(invocation.bin, invocation.args, invocation.options);
}

function runTargetedTest(argv, { cwd = process.cwd(), env = process.env, spawn = spawnRunner } = {}) {
  const { runner, file, registered, project } = parseTargetedTest(argv, cwd);
  let argument = registered ? file : fileArgument(runner, file, cwd);
  if (project) argument = projectFileArgument(project, file, cwd);
  const result = spawn(runner[0], [...runner.slice(1), argument], {
    cwd: project ? project.cwd : cwd,
    env,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return typeof result.status === 'number' ? result.status : 1;
}

if (require.main === module) {
  try {
    process.exitCode = runTargetedTest(process.argv.slice(2));
  } catch (error) {
    console.error('STATUS=BLOCKED');
    console.error(`REASON=${error.message}`);
    process.exitCode = 2;
  }
}

module.exports = { parseTargetedTest, runTargetedTest };

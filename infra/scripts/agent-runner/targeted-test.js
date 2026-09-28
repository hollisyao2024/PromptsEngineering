#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
  const executable = path.basename(runner[0]).replace(/\.cmd$/iu, '').toLowerCase();
  const first = runner[1] || '';
  if (['sh', 'bash', 'zsh', 'cmd', 'powershell'].includes(executable)
    || (['pnpm', 'npm', 'yarn', 'bun'].includes(executable)
      && (/^test(?::|$)/u.test(first) || (first === 'run' && /^test(?::|$)/u.test(runner[2] || ''))
        || (first === 'exec' && runner[2] === 'turbo')))) {
    throw new Error('aggregate test command is not accepted; pass a file-scoped runner');
  }
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

function runTargetedTest(argv, { cwd = process.cwd(), spawn = spawnSync } = {}) {
  const { runner, file } = parseTargetedTest(argv, cwd);
  const result = spawn(runner[0], [...runner.slice(1), file], {
    cwd,
    env: process.env,
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

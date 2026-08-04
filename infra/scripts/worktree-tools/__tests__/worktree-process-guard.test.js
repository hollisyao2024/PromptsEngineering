'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findPathUsers,
  inspectWorktreeUsers,
  parseLsofCwdOutput,
  parseWindowsProcessOutput,
} = require('../worktree-process-guard');

test('lsof parser retains pid and cwd records', () => {
  assert.deepEqual(parseLsofCwdOutput('p101\nfcwd\nn/worktrees/task-a\np202\nfcwd\nn/repo\n'), [
    { pid: 101, path: '/worktrees/task-a', source: 'cwd' },
    { pid: 202, path: '/repo', source: 'cwd' },
  ]);
});

test('Windows parser uses command and executable paths as conservative usage signals', () => {
  const output = JSON.stringify([
    { ProcessId: 301, ExecutablePath: 'C:\\Program Files\\node.exe', CommandLine: 'node C:\\worktrees\\task-a\\node_modules\\vitest.mjs' },
    { ProcessId: 302, ExecutablePath: 'C:\\Windows\\explorer.exe', CommandLine: null },
  ]);
  assert.deepEqual(parseWindowsProcessOutput(output), [
    {
      pid: 301,
      paths: ['C:\\Program Files\\node.exe', 'node C:\\worktrees\\task-a\\node_modules\\vitest.mjs'],
      source: 'process',
    },
    { pid: 302, paths: ['C:\\Windows\\explorer.exe'], source: 'process' },
  ]);
});

test('path user filtering respects directory boundaries and excluded pids', () => {
  const records = [
    { pid: 1, path: '/container/worktrees/task', source: 'cwd' },
    { pid: 2, path: '/container/worktrees/task/apps/desktop', source: 'cwd' },
    { pid: 3, path: '/container/worktrees/task-copy', source: 'cwd' },
  ];
  assert.deepEqual(findPathUsers('/container/worktrees/task', records, { excludePids: [2] }), [
    { pid: 1, path: '/container/worktrees/task', source: 'cwd' },
  ]);
});

test('process inspection reports an unavailable platform probe without inventing users', () => {
  const result = inspectWorktreeUsers('/container/worktrees/task', {
    platform: 'darwin',
    spawnSync: () => ({ error: new Error('lsof unavailable'), status: null, stdout: '' }),
  });
  assert.equal(result.supported, false);
  assert.deepEqual(result.users, []);
  assert.match(result.reason, /lsof unavailable/u);
});

test('malformed Windows process output is rejected as an empty parsed record set', () => {
  assert.deepEqual(parseWindowsProcessOutput('{not-json'), []);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createTask, executeTaskCommand, parseCliArgs } = require('../agent-task');
const { fixture, pathsFixture, startInput } = require('./agent-task.helpers');

// Expectations come from the delivery boundary: default to the task worktree;
// main-only lifecycle commands must explicitly select the recorded project root.
const command = [process.execPath, '-e', 'console.log(process.cwd())'];

test('AC2 task exec keeps its worktree default and explicitly selects main', t => {
  const p = fixture(t);
  createTask(startInput(p));
  const run = (name, execCwd) => executeTaskCommand({ ...p, taskId: 'durable-task', name, command, execCwd });
  const normal = run('default');
  assert.equal(fs.realpathSync(normal.summary.trim()), fs.realpathSync(p.worktree));
  const main = run('main', 'main');
  assert.equal(fs.realpathSync(main.summary.trim()), fs.realpathSync(p.projectRoot));
  assert.equal(main.cwd, path.resolve(p.projectRoot));
  assert.equal(path.dirname(main.logPath), path.join(p.runsRoot, 'durable-task', 'evidence'));
  assert.equal(main.exitCode, 0);
  assert.match(main.logSha256, /^[a-f0-9]{64}$/u);
});

test('AC2 main execution survives removal of the bound development directory without changing state', t => {
  const p = fixture(t);
  createTask(startInput(p));
  const statePath = path.join(p.runsRoot, 'durable-task', 'state.json');
  const before = fs.readFileSync(statePath);
  fs.rmdirSync(p.worktree);
  const result = executeTaskCommand({ ...p, taskId: 'durable-task', name: 'after-cleanup', command, execCwd: 'main' });
  assert.equal(result.exitCode, 0);
  assert.equal(fs.realpathSync(result.summary.trim()), fs.realpathSync(p.projectRoot));
  assert.deepEqual(fs.readFileSync(statePath), before);
  assert.throws(() => executeTaskCommand({ ...p, taskId: 'durable-task', name: 'default-after-cleanup', command }), /ENOENT/u);
});

test('AC2 task exec rejects arbitrary cwd and preserves aggregate-test gates before log creation', t => {
  const p = fixture(t);
  createTask(startInput(p));
  for (const execCwd of ['../', p.root, '', 'MAIN']) {
    assert.throws(() => executeTaskCommand({ ...p, taskId: 'durable-task', name: 'invalid', command, execCwd }), /--cwd.*main.*worktree/u);
  }
  assert.throws(() => executeTaskCommand({ ...p, taskId: 'durable-task', name: 'full', command: ['pnpm', 'test'], execCwd: 'main' }), /TEST_SCOPE_DECISION/u);
  assert.equal(fs.existsSync(path.join(p.runsRoot, 'durable-task', 'evidence')), false);
  assert.equal(parseCliArgs(['exec', '--cwd', 'main']).execCwd, 'main');
  assert.equal(parseCliArgs(['exec', '--cwd=worktree']).execCwd, 'worktree');
});

test('AC2 main cwd must remain a real directory', t => {
  const p = fixture(t);
  createTask(startInput(p));
  fs.rmdirSync(p.projectRoot);
  fs.symlinkSync(p.worktree, p.projectRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => executeTaskCommand({ ...p, taskId: 'durable-task', name: 'symlink', command, execCwd: 'main' }), /real directory/u);
  assert.equal(fs.existsSync(path.join(p.runsRoot, 'durable-task', 'evidence', 'symlink.log')), false);
});

test('AC2 CLI runs main commands after cleanup and reports their actual cwd', t => {
  const p = pathsFixture(t);
  createTask(startInput({ ...p, runsRoot: path.join(p.root, 'tmp', 'agent-task-runs'), lockDir: path.join(p.root, 'tmp', 'agent-locks') }));
  fs.rmdirSync(p.worktree);
  const cli = path.resolve(__dirname, '../agent-task.js');
  const result = spawnSync(process.execPath, [cli, 'exec', '--task', 'durable-task', '--name', 'cli-main', '--cwd', 'main', '--', ...command], { cwd: p.projectRoot, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`EXEC_CWD=${p.projectRoot}`));
  assert.match(result.stdout, /STATUS=OK/u);
});

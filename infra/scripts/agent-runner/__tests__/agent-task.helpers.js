'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const realTemporaryRoot = fs.realpathSync(os.tmpdir());

function pathsFixture(t, config) {
  const paths = fixture(t);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: paths.projectRoot, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '--quiet');
  if (config) fs.writeFileSync(path.join(paths.projectRoot, 'agent.config.json'), JSON.stringify(config));
  const cli = path.resolve(__dirname, '../agent-task.js');
  const run = (cwd, ...args) => spawnSync(process.execPath, [cli, 'paths', ...args], {
    cwd, encoding: 'utf8', timeout: 15000,
  });
  return { ...paths, git, run };
}

function outputFields(result) {
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(result.stdout.trim().split(/\r?\n/).map(line => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(realTemporaryRoot, 'agent-task-'));
  const runsRoot = path.join(root, 'agent-task-runs');
  const lockDir = path.join(root, 'agent-locks');
  const projectRoot = path.join(root, 'repo');
  const worktree = path.join(root, 'worktree');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, runsRoot, lockDir, projectRoot, worktree };
}

function startInput(paths, overrides = {}) {
  return {
    ...paths,
    taskId: 'durable-task',
    goal: 'Finish every verified step',
    taskType: 'operation',
    branch: 'feature/durable-task',
    steps: [
      { title: 'inspect', replay: 'safe' },
      { title: 'publish', replay: 'verify_first' },
    ],
    acceptanceCriteria: ['all steps verified'],
    constraints: ['never replay unknown side effects'],
    now: '2026-08-16T01:00:00.000Z',
    ...overrides,
  };
}

module.exports = { fixture, outputFields, pathsFixture, startInput };

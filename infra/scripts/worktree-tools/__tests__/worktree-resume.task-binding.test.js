'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  createOrResumeWorktree,
  resolveContainerPath,
  safeRemoveTreeNoFollow,
} = require('../worktree-core');
const { bindTaskLocation, createTask, readTaskState } = require('../../agent-runner/agent-task');
const { loadConfig } = require('../../shared/config');

const realTemporaryRoot = fs.realpathSync(os.tmpdir());
const resumeScript = path.resolve(__dirname, '..', 'worktree-resume.js');

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('worktree resume --branch rebinds drifted tasks recorded on the session', (t) => {
  const container = fs.mkdtempSync(path.join(realTemporaryRoot, 'worktree-resume-binding-'));
  const repo = path.join(container, 'repo');
  fs.mkdirSync(repo);
  runGit(repo, ['init', '-b', 'main']);
  runGit(repo, ['config', 'user.email', 'test@example.com']);
  runGit(repo, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n');
  fs.writeFileSync(path.join(repo, 'agent.config.json'), JSON.stringify({
    baseBranch: 'main',
    containerDirs: { worktrees: '../worktrees' },
    worktree: { envSymlinks: [], sharedConfigSymlinks: [] },
  }, null, 2));
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', 'init']);
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: realTemporaryRoot }));

  const config = loadConfig({ repoRoot: repo });
  const tmpRoot = resolveContainerPath(config, repo, 'tmp');
  const runsRoot = path.join(tmpRoot, 'agent-task-runs');
  const lockDir = path.join(tmpRoot, 'agent-locks');
  createTask({
    runsRoot,
    lockDir,
    projectRoot: repo,
    worktree: repo,
    branch: 'main',
    taskId: 'cli-binding',
    goal: 'keep task bound to its worktree',
    taskType: 'operation',
    steps: [{ title: 'inspect', replay: 'safe' }],
    acceptanceCriteria: ['bound'],
  });
  const created = createOrResumeWorktree({
    cwd: repo,
    cli: { 'skip-fetch': true, phase: 'tdd', kind: 'fix', task: 'cli-binding', desc: 'cli binding' },
  });
  assert.equal(readTaskState({ runsRoot, taskId: 'cli-binding' }).worktree, created.worktreePath);

  // 模拟漂移：任务被改绑到主 worktree。
  bindTaskLocation({ runsRoot, lockDir, taskId: 'cli-binding', projectRoot: repo, worktree: repo, branch: 'main' });

  const result = spawnSync(process.execPath, [resumeScript, '--branch', created.branch], {
    cwd: repo, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /STATUS=RESUMED/);
  assert.match(result.stdout, /TASK_BINDING=cli-binding\|BOUND/);
  const state = readTaskState({ runsRoot, taskId: 'cli-binding' });
  assert.equal(state.worktree, created.worktreePath);
  assert.equal(state.branch, created.branch);
});

'use strict';

// task-remote-trial-fixes AC2：task start 常在主干执行，远端登记的 branch 为空；
// worktree new/resume 绑定任务后须把开发分支同步到远端登记（不提升 epoch），失权时只告警、不阻断。
// 用真实裸远端与两台“电脑”（独立容器、HOME 与 XIRANG_MACHINE_ID）端到端验证。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TASK_CLI = path.resolve(__dirname, '../../agent-runner/agent-task.js');
const NEW_SCRIPT = path.resolve(__dirname, '../worktree-new.js');
const RESUME_SCRIPT = path.resolve(__dirname, '../worktree-resume.js');
const TASK = 'shared-task';
const REF = `refs/xirang/task/${TASK}`;

const BASE_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};
for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'XIRANG_MACHINE_ID', 'AGENT_BASE_BRANCH']) delete BASE_ENV[key];

function sh(cwd, args) {
  const result = spawnSync('git', args, { cwd, env: BASE_ENV, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function fields(text) {
  const map = new Map();
  for (const line of String(text || '').split(/\r?\n/u)) {
    const index = line.indexOf('=');
    if (index > 0 && !map.has(line.slice(0, index))) map.set(line.slice(0, index), line.slice(index + 1));
  }
  return map;
}

function remoteSha(remote) {
  const result = spawnSync('git', ['rev-parse', '--verify', '-q', REF], { cwd: remote, env: BASE_ENV, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function remoteRecord(remote) {
  const sha = remoteSha(remote);
  if (!sha) return null;
  const body = sh(remote, ['cat-file', 'commit', sha]);
  return JSON.parse(body.slice(body.indexOf('\n\n') + 2));
}

/** 裸远端 + 两台电脑；agent.config.json 随种子提交，开启 task.remote（enforce）。 */
function setupMachines(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'worktree-task-remote-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  sh(root, ['init', '-q', '--bare', '-b', 'main', remote]);
  const seed = path.join(root, 'seed');
  sh(root, ['clone', '-q', remote, seed]);
  fs.writeFileSync(path.join(seed, 'README.md'), 'seed\n');
  fs.writeFileSync(path.join(seed, 'agent.config.json'), `${JSON.stringify({
    baseBranch: 'main',
    containerDirs: { worktrees: '../worktrees' },
    worktree: { envSymlinks: [], sharedConfigSymlinks: [] },
    task: { remote: { enabled: true, mode: 'enforce', remoteRetryDelaysMs: [] } },
  }, null, 2)}\n`);
  sh(seed, ['add', '.']);
  sh(seed, ['commit', '-q', '-m', 'seed']);
  sh(seed, ['push', '-q', 'origin', 'HEAD:main']);

  const machine = (name, machineId) => {
    const container = path.join(root, name);
    const repo = path.join(container, 'repo');
    const home = path.join(container, 'home');
    fs.mkdirSync(home, { recursive: true });
    sh(root, ['clone', '-q', remote, repo]);
    const env = { ...BASE_ENV, HOME: home, XIRANG_MACHINE_ID: machineId };
    const node = (script, args) => spawnSync(process.execPath, [script, ...args], {
      cwd: repo, env, encoding: 'utf8', timeout: 60000,
    });
    return {
      repo,
      task: (...args) => node(TASK_CLI, args),
      worktreeNew: (...args) => node(NEW_SCRIPT, args),
      worktreeResume: (...args) => node(RESUME_SCRIPT, args),
    };
  };
  return { remote, a: machine('A', 'machine-aaaa'), b: machine('B', 'machine-bbbb') };
}

test('AC2 worktree new/resume 把开发分支同步到远端登记；失权时只告警不阻断', (t) => {
  const { remote, a, b } = setupMachines(t);

  // 主干上 task start：登记存在但 branch 为空（主干不算任务分支）。
  const started = a.task('start', '--task', TASK, '--desc', 'shared work', '--type', 'operation', '--phase', 'tdd',
    '--acceptance', 'done', '--step', 'do it');
  assert.equal(started.status, 0, started.stdout + started.stderr);
  assert.equal(remoteRecord(remote).branch, '');

  // worktree new 绑定任务后同步分支：epoch 不变、仍为 claimed。
  const created = a.worktreeNew('--phase', 'tdd', '--task', TASK, '--skip-fetch', '--skip-bootstrap');
  assert.equal(created.status, 0, created.stdout + created.stderr);
  const createdOut = fields(created.stdout);
  assert.equal(createdOut.get('STATUS'), 'CREATED');
  const branch = createdOut.get('BRANCH_NAME');
  assert.ok(branch && branch !== 'main', created.stdout);
  assert.equal(createdOut.get('TASK_REMOTE_STATUS'), 'BRANCH_SYNCED', created.stdout + created.stderr);
  assert.equal(createdOut.get('TASK_REMOTE_BRANCH'), branch);
  let record = remoteRecord(remote);
  assert.equal(record.branch, branch);
  assert.equal(record.epoch, 1);
  assert.equal(record.state, 'claimed');
  assert.equal(record.holder.machineId, 'machine-aaaa');

  // 再次 resume：分支未变，不写远端。
  const before = remoteSha(remote);
  const resumed = a.worktreeResume('--branch', branch);
  assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
  const resumedOut = fields(resumed.stdout);
  assert.equal(resumedOut.get('STATUS'), 'RESUMED');
  assert.equal(resumedOut.get('TASK_REMOTE_STATUS'), 'BRANCH_UNCHANGED', resumed.stdout + resumed.stderr);
  assert.equal(remoteSha(remote), before);

  // B 强制夺取后，A 的 resume 仍成功，但明确告警失权且不改写 B 的登记。
  const takeover = b.task('takeover', '--task', TASK, '--reason', '接手', '--force');
  assert.equal(takeover.status, 0, takeover.stdout + takeover.stderr);
  const takenSha = remoteSha(remote);
  const lost = a.worktreeResume('--branch', branch);
  assert.equal(lost.status, 0, lost.stdout + lost.stderr);
  const lostOut = fields(lost.stdout);
  assert.equal(lostOut.get('STATUS'), 'RESUMED');
  assert.equal(lostOut.get('TASK_REMOTE_STATUS'), 'TASK_CLAIM_LOST', lost.stdout);
  assert.ok(lostOut.get('TASK_REMOTE_WARNING'), lost.stdout);
  assert.equal(remoteSha(remote), takenSha);
  record = remoteRecord(remote);
  assert.equal(record.holder.machineId, 'machine-bbbb');
  assert.equal(record.epoch, 2);
});

'use strict';

// task 远端登记的 CLI 端到端测试：两台电脑各有独立容器 <root>/A/repo、<root>/B/repo（同一裸远端的克隆），
// 以 XIRANG_MACHINE_ID 区分机器、HOME 指向临时目录。期望值取自任务 task-remote-claim 的验收项 AC1-AC6。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createGitRunner } = require('../../ops-tools/deploy-guard-git');
const { enforceRemoteClaim } = require('../task-remote');
const { runtimeContext } = require('../agent-task');

const CLI = path.resolve(__dirname, '../agent-task.js');
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

function sh(cwd, args, env = BASE_ENV) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function remoteConfig(remote = { enabled: true, mode: 'enforce', remoteRetryDelaysMs: [] }) {
  return JSON.stringify({ task: { remote } }, null, 2);
}

/** 建立裸远端与两台“电脑”：每台独立容器、HOME 与机器 ID。 */
function setupMachines(t, { config = remoteConfig() } = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'task-remote-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  sh(root, ['init', '-q', '--bare', '-b', 'main', remote]);
  const seed = path.join(root, 'seed');
  sh(root, ['clone', '-q', remote, seed]);
  fs.writeFileSync(path.join(seed, 'README.md'), 'seed\n');
  sh(seed, ['add', '.']);
  sh(seed, ['commit', '-q', '-m', 'seed']);
  sh(seed, ['push', '-q', 'origin', 'HEAD:main']);

  const machine = (name, machineId) => {
    const container = path.join(root, name);
    const repo = path.join(container, 'repo');
    const home = path.join(container, 'home');
    fs.mkdirSync(home, { recursive: true });
    sh(root, ['clone', '-q', remote, repo]);
    // agent.config.json 不提交：只作为本机的稀疏配置。
    fs.writeFileSync(path.join(repo, 'agent.config.json'), `${config}\n`);
    const env = { ...BASE_ENV, HOME: home, XIRANG_MACHINE_ID: machineId };
    const run = (...args) => spawnSync(process.execPath, [CLI, ...args], {
      cwd: repo, env, encoding: 'utf8', timeout: 60000,
    });
    const statePath = path.join(container, 'tmp', 'agent-task-runs', TASK, 'state.json');
    return { name, machineId, repo, env, run, statePath };
  };
  return { root, remote, a: machine('A', 'machine-aaaa'), b: machine('B', 'machine-bbbb') };
}

function fields(text) {
  const map = new Map();
  for (const line of String(text || '').split(/\r?\n/u)) {
    const index = line.indexOf('=');
    if (index > 0 && !map.has(line.slice(0, index))) map.set(line.slice(0, index), line.slice(index + 1));
  }
  return map;
}

function remoteRecord(remote) {
  const result = spawnSync('git', ['rev-parse', '--verify', '-q', REF], { cwd: remote, env: BASE_ENV, encoding: 'utf8' });
  if (result.status !== 0) return null;
  const body = sh(remote, ['cat-file', 'commit', result.stdout.trim()]);
  return JSON.parse(body.slice(body.indexOf('\n\n') + 2));
}

function startArgs(extra = []) {
  return ['start', '--task', TASK, '--desc', 'shared work', '--type', 'operation', '--phase', 'tdd',
    '--acceptance', 'done', '--step', 'do it', ...extra];
}

test('AC1 CLI：task.remote 关闭时 start 不访问远端、remote list 输出 SKIPPED', (t) => {
  const { a } = setupMachines(t, { config: '{}' });
  // 远端指向不存在的路径：任何访问都会失败，start 仍须成功。
  sh(a.repo, ['remote', 'set-url', 'origin', path.join(a.repo, '..', 'missing.git')]);
  const started = a.run(...startArgs());
  assert.equal(started.status, 0, started.stderr);
  assert.equal(fields(started.stdout).get('STATUS'), 'STARTED');
  assert.doesNotMatch(started.stdout, /TASK_REMOTE_/u);
  assert.equal(JSON.parse(fs.readFileSync(a.statePath, 'utf8')).remote, undefined);

  const listed = a.run('remote', 'list');
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(fields(listed.stdout).get('STATUS'), 'SKIPPED');

  const takeover = a.run('takeover', '--task', TASK, '--reason', 'x');
  assert.equal(takeover.status, 1);
  assert.match(takeover.stderr, /task\.remote\.enabled=true/u);
});

test('AC2-AC6 CLI：双机登记冲突、夺取、失权门禁、cancel 不释放他人登记、finish 置 done', (t) => {
  const { remote, a, b } = setupMachines(t);

  // AC2：A 开工即以 CAS 登记，本地 state.remote 绑定 epoch=1。
  const startedA = a.run(...startArgs());
  assert.equal(startedA.status, 0, startedA.stderr);
  const outA = fields(startedA.stdout);
  assert.equal(outA.get('STATUS'), 'STARTED');
  assert.equal(outA.get('TASK_REMOTE_STATUS'), 'REGISTERED');
  assert.equal(outA.get('TASK_REMOTE_EPOCH'), '1');
  const bindingA = JSON.parse(fs.readFileSync(a.statePath, 'utf8')).remote;
  assert.equal(bindingA.epoch, 1);
  assert.equal(bindingA.machine_id, 'machine-aaaa');
  assert.equal(bindingA.ref, REF);
  const recordA = remoteRecord(remote);
  assert.equal(recordA.state, 'claimed');
  assert.equal(recordA.holder.machineId, 'machine-aaaa');
  assert.equal(recordA.branch, '', '主干上开任务不广播 base branch');

  // AC2：B 开同一任务被 enforce 阻断，输出持有者，且不留下本地任务状态。
  const startedB = b.run(...startArgs());
  assert.equal(startedB.status, 1);
  const errB = fields(startedB.stderr);
  assert.equal(errB.get('STATUS'), 'BLOCKED');
  assert.equal(errB.get('TASK_REMOTE_STATUS'), 'CONFLICT');
  assert.match(errB.get('TASK_REMOTE_HOLDER'), /machine-aaaa/u);
  assert.match(errB.get('TASK_REMOTE_NEXT'), /task takeover --task shared-task/u);
  assert.equal(fs.existsSync(b.statePath), false);

  // AC4：B 只读查看看板。
  const listed = b.run('remote', 'list');
  assert.equal(listed.status, 0, listed.stderr);
  const listOut = fields(listed.stdout);
  assert.equal(listOut.get('STATUS'), 'OK');
  assert.equal(listOut.get('TASK_REMOTE_COUNT'), '1');
  assert.match(listOut.get('TASK_REMOTE'), /^shared-task\|claimed\|1\|[^|]*\/machine-aaaa\|\|[^|]+\|stale=false$/u);
  assert.equal(remoteRecord(remote).epoch, 1, 'list 不写远端');

  // AC3：takeover 必须带 reason；未过期须 --force；成功 epoch+1。
  const noReason = b.run('takeover', '--task', TASK);
  assert.equal(noReason.status, 1);
  assert.match(noReason.stderr, /--reason/u);
  const noForce = b.run('takeover', '--task', TASK, '--reason', 'A 机器故障');
  assert.equal(noForce.status, 1);
  assert.equal(fields(noForce.stderr).get('TASK_REMOTE_STATUS'), 'REQUIRES_FORCE');
  const taken = b.run('takeover', '--task', TASK, '--reason', 'A 机器故障', '--force');
  assert.equal(taken.status, 0, taken.stderr);
  const takenOut = fields(taken.stdout);
  assert.equal(takenOut.get('STATUS'), 'OK');
  assert.equal(takenOut.get('TASK_REMOTE_STATUS'), 'TAKEN_OVER');
  assert.equal(takenOut.get('TASK_REMOTE_EPOCH'), '2');
  assert.equal(takenOut.get('TASK_LOCAL_STATE'), 'MISSING');
  const recordB = remoteRecord(remote);
  assert.equal(recordB.holder.machineId, 'machine-bbbb');
  assert.equal(recordB.previousHolder.machineId, 'machine-aaaa');

  // AC5：A 的推送/合并门禁失权，任何 mode 都阻断。
  const gate = enforceRemoteClaim({
    context: runtimeContext(a.repo),
    identity: { machineId: 'machine-aaaa', host: 'host-a', user: 'dev-a' },
    gitFactory: (dir) => createGitRunner({ repoRoot: dir, cwd: dir, env: a.env }),
  });
  assert.equal(gate.status, 'TASK_CLAIM_LOST');
  assert.equal(gate.blocked, true);

  // AC6：A cancel 只删本地，不改 B 的登记。
  const cancelled = a.run('cancel', '--task', TASK, '--force');
  assert.equal(cancelled.status, 0, cancelled.stderr);
  assert.equal(fields(cancelled.stdout).get('TASK_REMOTE_STATUS'), 'NOT_HOLDER');
  assert.equal(remoteRecord(remote).state, 'claimed');
  assert.equal(remoteRecord(remote).holder.machineId, 'machine-bbbb');

  // B 建本地任务：远端已归本机，ALREADY_HOLDER 并绑定 epoch=2；完成后 finish 置 done。
  const resumedB = b.run(...startArgs());
  assert.equal(resumedB.status, 0, resumedB.stderr);
  assert.equal(fields(resumedB.stdout).get('TASK_REMOTE_STATUS'), 'ALREADY_HOLDER');
  assert.equal(JSON.parse(fs.readFileSync(b.statePath, 'utf8')).remote.epoch, 2);
  const checkpoint = b.run('checkpoint', '--task', TASK, '--step', 'S1', '--acceptance-id', 'AC1',
    '--status', 'done', '--evidence', 'verified', '--next', 'finish');
  assert.equal(checkpoint.status, 0, checkpoint.stderr);
  const finished = b.run('finish', '--task', TASK);
  assert.equal(finished.status, 0, finished.stderr);
  assert.equal(fields(finished.stdout).get('TASK_REMOTE_STATUS'), 'DONE');
  const done = remoteRecord(remote);
  assert.equal(done.state, 'done');
  assert.equal(done.epoch, 2);
});

test('AC2 CLI：warn 模式下他机持有只告警，本地任务照常创建但不绑定登记', (t) => {
  const { remote, a, b } = setupMachines(t, {
    config: remoteConfig({ enabled: true, mode: 'warn', remoteRetryDelaysMs: [] }),
  });
  assert.equal(a.run(...startArgs()).status, 0);
  const startedB = b.run(...startArgs());
  assert.equal(startedB.status, 0, startedB.stderr);
  const outB = fields(startedB.stdout);
  assert.equal(outB.get('STATUS'), 'STARTED');
  assert.equal(outB.get('TASK_REMOTE_STATUS'), 'CONFLICT');
  assert.equal(JSON.parse(fs.readFileSync(b.statePath, 'utf8')).remote, undefined);
  assert.equal(remoteRecord(remote).holder.machineId, 'machine-aaaa');
});

// ---------------------------------------------------------------------------
// task-remote-polish：期望值取自任务 task-remote-polish 的验收项 AC2、AC4。

test('polish-AC2 CLI：无活跃前任时 takeover 是补登记，输出 REGISTERED 且不提示 fenced', (t) => {
  const { remote, a, b } = setupMachines(t, {
    config: remoteConfig({ enabled: true, mode: 'warn', remoteRetryDelaysMs: [] }),
  });
  assert.equal(a.run(...startArgs()).status, 0);
  // warn：B 本地照常建任务但未绑定登记。
  assert.equal(b.run(...startArgs()).status, 0);
  assert.equal(a.run('cancel', '--task', TASK, '--force').status, 0);
  assert.equal(remoteRecord(remote).state, 'released');

  const claimed = b.run('takeover', '--task', TASK, '--reason', '补登记');
  assert.equal(claimed.status, 0, claimed.stderr);
  const out = fields(claimed.stdout);
  assert.equal(out.get('TASK_REMOTE_STATUS'), 'REGISTERED');
  assert.doesNotMatch(out.get('NEXT_ACTION') || '', /fenced/u);
  assert.equal(JSON.parse(fs.readFileSync(b.statePath, 'utf8')).remote.epoch, 2);
  const record = remoteRecord(remote);
  assert.equal(record.holder.machineId, 'machine-bbbb');
  assert.equal(record.previousHolder, undefined);
});

test('polish-AC4 CLI：remote prune 默认预览，--apply 删除已完成登记并保留活跃登记', (t) => {
  const { remote, a, b } = setupMachines(t);
  assert.equal(a.run(...startArgs()).status, 0);
  assert.equal(a.run('cancel', '--task', TASK, '--force').status, 0);
  assert.equal(b.run('start', '--task', 'active-task', '--desc', 'x', '--type', 'operation', '--phase', 'tdd',
    '--acceptance', 'done', '--step', 'do it').status, 0);

  const preview = a.run('remote', 'prune');
  assert.equal(preview.status, 0, preview.stderr);
  const previewOut = fields(preview.stdout);
  assert.equal(previewOut.get('STATUS'), 'DRY_RUN');
  assert.match(preview.stdout, /^TASK_REMOTE_PRUNE=shared-task\|released\|1\|would_delete$/mu);
  assert.match(preview.stdout, /^TASK_REMOTE_PRUNE=active-task\|claimed\|1\|keep_active$/mu);
  assert.notEqual(remoteRecord(remote), null);

  const applied = a.run('remote', 'prune', '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(fields(applied.stdout).get('STATUS'), 'OK');
  assert.match(applied.stdout, /^TASK_REMOTE_PRUNE=shared-task\|released\|1\|deleted$/mu);
  assert.equal(remoteRecord(remote), null);
  const active = spawnSync('git', ['rev-parse', '--verify', '-q', 'refs/xirang/task/active-task'], { cwd: remote, env: BASE_ENV, encoding: 'utf8' });
  assert.equal(active.status, 0);

  const usage = a.run('remote', 'prune', '--bogus');
  assert.notEqual(usage.status, 0);
});

test('polish-AC4 CLI：task.remote 关闭时 remote prune 输出 SKIPPED 且不访问远端', (t) => {
  const { a } = setupMachines(t, { config: remoteConfig({ enabled: false }) });
  const skipped = a.run('remote', 'prune', '--apply');
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(fields(skipped.stdout).get('STATUS'), 'SKIPPED');
});

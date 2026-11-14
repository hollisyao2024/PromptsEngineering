'use strict';

// 任务远端登记（refs/xirang/task/<id>）的定向测试。期望值取自任务 task-remote-claim 的验收项 AC1-AC6，
// 用真实裸仓库模拟两台机器（克隆 A/B），验证 CAS 登记、夺取、列举、持有者断言与收尾。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createGitRunner } = require('../../ops-tools/deploy-guard-git');
const {
  assertRemoteHolder,
  enforceRemoteClaim,
  finalizeRemoteTask,
  formatRemoteLines,
  listRemoteTasks,
  pruneRemoteTasks,
  registerTaskStart,
  remoteBindingOf,
  remoteNextAction,
  resolveMachineIdentity,
  resolveRemoteConfig,
  syncRemoteBranch,
  takeoverTask,
  taskRemoteRef,
} = require('../task-remote');

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};
delete GIT_ENV.GH_TOKEN;
delete GIT_ENV.GITHUB_TOKEN;

const MACHINE_A = { machineId: 'machine-aaaa', host: 'host-a', user: 'dev-a' };
const MACHINE_B = { machineId: 'machine-bbbb', host: 'host-b', user: 'dev-b' };
const T0 = Date.parse('2026-11-14T00:00:00.000Z');

function sh(cwd, args) {
  const result = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

// remote.git + 两个克隆 a/b，分别代表两台电脑。
function setupFixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'task-remote-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  sh(root, ['init', '-q', '--bare', '-b', 'main', remote]);
  const a = path.join(root, 'a');
  sh(root, ['clone', '-q', remote, a]);
  fs.writeFileSync(path.join(a, 'seed.txt'), 'seed\n');
  sh(a, ['add', '.']);
  sh(a, ['commit', '-q', '-m', 'seed']);
  sh(a, ['push', '-q', 'origin', 'HEAD:main']);
  const b = path.join(root, 'b');
  sh(root, ['clone', '-q', remote, b]);
  return { root, remote, a, b, gitA: gitIn(a), gitB: gitIn(b) };
}

function gitIn(cwd) {
  return createGitRunner({ repoRoot: cwd, cwd, env: GIT_ENV });
}

function cfgFor(overrides = {}) {
  return {
    enabled: true,
    mode: 'enforce',
    remote: 'origin',
    ttlSeconds: 3600,
    retry: { delaysMs: [], sleep: () => {} },
    ...overrides,
  };
}

function remoteRefSha(remote, ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', '-q', ref], { cwd: remote, env: GIT_ENV, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function remoteRecord(remote, ref) {
  const sha = remoteRefSha(remote, ref);
  if (!sha) return null;
  const body = sh(remote, ['cat-file', 'commit', sha]);
  return JSON.parse(body.slice(body.indexOf('\n\n') + 2));
}

function startOn(git, identity, overrides = {}) {
  return registerTaskStart({
    git,
    cfg: cfgFor(),
    taskId: 'shared-task',
    identity,
    branch: 'feature/SHARED-TASK',
    phase: 'tdd',
    now: T0,
    ...overrides,
  });
}

test('AC1 task.remote 默认关闭：模板默认值与解析结果均为 disabled', () => {
  const example = require('../../../templates/agent/config.example.json');
  assert.equal(example.task.remote.enabled, false);
  assert.equal(example.task.remote.mode, 'warn');
  assert.deepEqual(resolveRemoteConfig({}), { enabled: false });
  assert.deepEqual(resolveRemoteConfig({ task: { remote: { enabled: false, mode: 'enforce' } } }), { enabled: false });
});

test('AC1 开启后配置校验 fail-closed：非法 mode/remote/ttl/重试延迟均报错', () => {
  const ok = resolveRemoteConfig({ task: { remote: { enabled: true } } });
  assert.equal(ok.enabled, true);
  assert.equal(ok.error, undefined);
  assert.equal(ok.mode, 'warn');
  assert.equal(ok.remote, 'origin');
  assert.equal(ok.ttlSeconds, 86400);
  assert.deepEqual(ok.retry.delaysMs, [2000, 5000, 10000, 20000, 30000]);
  const bad = (remote) => resolveRemoteConfig({ task: { remote: { enabled: true, ...remote } } }).error;
  assert.match(bad({ mode: 'strict' }), /mode/);
  assert.match(bad({ remote: '-x' }), /remote/);
  assert.match(bad({ ttlSeconds: 0 }), /ttlSeconds/);
  assert.match(bad({ remoteRetryDelaysMs: [-1] }), /remoteRetryDelaysMs/);
});

test('AC1 关闭时 tdd push/qa merge 的门禁不访问远端', () => {
  let gitCalls = 0;
  const result = enforceRemoteClaim({
    context: { config: {}, runsRoot: '/nonexistent', projectRoot: '/x', worktree: '/x', branch: 'feature/x' },
    gitFactory: () => () => { gitCalls += 1; return { status: 1, stdout: '', stderr: '' }; },
    identity: MACHINE_A,
  });
  assert.equal(result.status, 'DISABLED');
  assert.equal(result.blocked, false);
  assert.equal(gitCalls, 0);
});

test('AC2 任务 ref 名称固定在 refs/xirang/task/ 下，拒绝无法成为合法 ref 的 ID', () => {
  assert.equal(taskRemoteRef('shared-task'), 'refs/xirang/task/shared-task');
  assert.throws(() => taskRemoteRef('bad.lock'), /task id/);
  assert.throws(() => taskRemoteRef('../x'), /task id/);
});

test('AC2 机器身份优先取环境变量，其次读取或生成用户目录下的 machine-id', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'task-remote-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const fromEnv = resolveMachineIdentity({ env: { XIRANG_MACHINE_ID: 'ci-runner-01' }, homedir: home });
  assert.equal(fromEnv.machineId, 'ci-runner-01');
  assert.throws(() => resolveMachineIdentity({ env: { XIRANG_MACHINE_ID: 'bad id!' }, homedir: home }), /XIRANG_MACHINE_ID/);
  const first = resolveMachineIdentity({ env: {}, homedir: home });
  const second = resolveMachineIdentity({ env: {}, homedir: home });
  assert.match(first.machineId, /^[0-9a-f]{32}$/);
  assert.equal(second.machineId, first.machineId);
  assert.ok(fs.existsSync(path.join(home, '.xirang', 'machine-id')));
});

test('AC2 task start 以 CAS 创建远端登记，epoch=1，记录持有者与分支', (t) => {
  const fx = setupFixture(t);
  const result = startOn(fx.gitA, MACHINE_A);
  assert.equal(result.status, 'REGISTERED');
  assert.equal(result.blocked, false);
  assert.equal(result.epoch, 1);
  const record = remoteRecord(fx.remote, 'refs/xirang/task/shared-task');
  assert.equal(record.schema, 'xirang-task-remote/v1');
  assert.equal(record.taskId, 'shared-task');
  assert.equal(record.epoch, 1);
  assert.equal(record.state, 'claimed');
  assert.equal(record.holder.machineId, MACHINE_A.machineId);
  assert.equal(record.branch, 'feature/SHARED-TASK');
  assert.deepEqual(remoteBindingOf(result, cfgFor()), {
    ref: 'refs/xirang/task/shared-task', remote: 'origin', epoch: 1, machine_id: MACHINE_A.machineId,
  });
  // 同机重复 start 幂等，不提升 epoch。
  const again = startOn(fx.gitA, MACHINE_A);
  assert.equal(again.status, 'ALREADY_HOLDER');
  assert.equal(again.blocked, false);
  assert.equal(again.epoch, 1);
});

test('AC2 他机活跃持有同 ID：enforce 阻断并输出持有者，warn 仅告警且不改远端', (t) => {
  const fx = setupFixture(t);
  startOn(fx.gitA, MACHINE_A);
  const before = remoteRefSha(fx.remote, 'refs/xirang/task/shared-task');
  const enforced = startOn(fx.gitB, MACHINE_B);
  assert.equal(enforced.status, 'CONFLICT');
  assert.equal(enforced.blocked, true);
  assert.equal(enforced.holder.machineId, MACHINE_A.machineId);
  const lines = formatRemoteLines(enforced).join('\n');
  assert.match(lines, /TASK_REMOTE_STATUS=CONFLICT/);
  assert.match(lines, /TASK_REMOTE_HOLDER=dev-a@host-a \(machine-aaaa\)/);
  assert.match(lines, /task takeover/);
  const warned = startOn(fx.gitB, MACHINE_B, { cfg: cfgFor({ mode: 'warn' }) });
  assert.equal(warned.status, 'CONFLICT');
  assert.equal(warned.blocked, false);
  assert.equal(remoteRefSha(fx.remote, 'refs/xirang/task/shared-task'), before);
});

test('AC2 远端不可读时 enforce 阻断、warn 放行，状态为 UNKNOWN', (t) => {
  const fx = setupFixture(t);
  const cfg = cfgFor({ remote: 'missing-remote' });
  const enforced = startOn(fx.gitA, MACHINE_A, { cfg });
  assert.equal(enforced.status, 'UNKNOWN');
  assert.equal(enforced.blocked, true);
  const warned = startOn(fx.gitA, MACHINE_A, { cfg: { ...cfg, mode: 'warn' } });
  assert.equal(warned.status, 'UNKNOWN');
  assert.equal(warned.blocked, false);
});

test('AC2 已释放或已完成的登记可被新 start 重新领取并 epoch+1', (t) => {
  const fx = setupFixture(t);
  const started = startOn(fx.gitA, MACHINE_A);
  const released = finalizeRemoteTask({
    git: fx.gitA, cfg: cfgFor(), taskId: 'shared-task', binding: remoteBindingOf(started, cfgFor()),
    identity: MACHINE_A, state: 'released', now: T0 + 1000,
  });
  assert.equal(released.status, 'RELEASED');
  const reclaimed = startOn(fx.gitB, MACHINE_B, { now: T0 + 2000 });
  assert.equal(reclaimed.status, 'REGISTERED');
  assert.equal(reclaimed.epoch, 2);
});

test('AC3 takeover 必须带 --reason；未过期须 --force；成功后 epoch+1 并记录原持有者', (t) => {
  const fx = setupFixture(t);
  startOn(fx.gitA, MACHINE_A);
  const base = { git: fx.gitB, cfg: cfgFor(), taskId: 'shared-task', identity: MACHINE_B, branch: 'feature/SHARED-TASK', phase: 'tdd' };
  assert.throws(() => takeoverTask({ ...base, reason: '', now: T0 + 1000 }), /--reason/);
  const refused = takeoverTask({ ...base, reason: 'A 机器宕机', now: T0 + 1000 });
  assert.equal(refused.status, 'REQUIRES_FORCE');
  assert.equal(refused.blocked, true);
  assert.equal(remoteRecord(fx.remote, 'refs/xirang/task/shared-task').epoch, 1);
  const taken = takeoverTask({ ...base, reason: 'A 机器宕机', force: true, now: T0 + 1000 });
  assert.equal(taken.status, 'TAKEN_OVER');
  assert.equal(taken.blocked, false);
  assert.equal(taken.epoch, 2);
  const record = remoteRecord(fx.remote, 'refs/xirang/task/shared-task');
  assert.equal(record.epoch, 2);
  assert.equal(record.holder.machineId, MACHINE_B.machineId);
  assert.equal(record.previousHolder.machineId, MACHINE_A.machineId);
  assert.equal(record.previousHolder.epoch, 1);
  assert.equal(record.reason, 'A 机器宕机');
});

test('AC3 登记过期后 takeover 免 --force；无登记时 takeover 直接领取 epoch=1', (t) => {
  const fx = setupFixture(t);
  startOn(fx.gitA, MACHINE_A);
  const expired = takeoverTask({
    git: fx.gitB, cfg: cfgFor(), taskId: 'shared-task', identity: MACHINE_B,
    reason: '心跳过期', now: T0 + 3601 * 1000,
  });
  assert.equal(expired.status, 'TAKEN_OVER');
  assert.equal(expired.epoch, 2);
  const fresh = takeoverTask({
    git: fx.gitB, cfg: cfgFor(), taskId: 'other-task', identity: MACHINE_B, reason: '补登记', now: T0,
  });
  // task-remote-polish AC2：没有活跃前任时只是补登记，不是夺取。
  assert.equal(fresh.status, 'REGISTERED');
  assert.equal(fresh.epoch, 1);
});

test('AC3 并发写入时 CAS 只允许一方成功：落后快照的 takeover 被拒绝', (t) => {
  const fx = setupFixture(t);
  startOn(fx.gitA, MACHINE_A);
  // B 先读到 epoch=1 的快照，随后 A 抢先改写（release），B 再按旧快照写入必须被拒。
  let raced = false;
  const racingGit = (args, options) => {
    if (!raced && args[0] === 'push') {
      raced = true;
      const binding = { ref: 'refs/xirang/task/shared-task', remote: 'origin', epoch: 1, machine_id: MACHINE_A.machineId };
      const released = finalizeRemoteTask({ git: fx.gitA, cfg: cfgFor(), taskId: 'shared-task', binding, identity: MACHINE_A, state: 'released', now: T0 + 500 });
      assert.equal(released.status, 'RELEASED');
    }
    return fx.gitB(args, options);
  };
  const result = takeoverTask({
    git: racingGit, cfg: cfgFor(), taskId: 'shared-task', identity: MACHINE_B, reason: '抢占', force: true, now: T0 + 1000,
  });
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.blocked, true);
  assert.equal(remoteRecord(fx.remote, 'refs/xirang/task/shared-task').state, 'released');
});

test('AC4 task remote list 只读列出远端登记并标记过期', (t) => {
  const fx = setupFixture(t);
  startOn(fx.gitA, MACHINE_A, { taskId: 'task-one', now: T0 });
  startOn(fx.gitA, MACHINE_A, { taskId: 'task-two', now: T0 + 3000 * 1000 });
  const before = sh(fx.remote, ['for-each-ref', '--format=%(objectname) %(refname)']);
  const listed = listRemoteTasks({ git: fx.gitB, cfg: cfgFor(), now: T0 + 3700 * 1000 });
  assert.equal(listed.ok, true);
  const byId = Object.fromEntries(listed.tasks.map((item) => [item.taskId, item]));
  assert.deepEqual(Object.keys(byId).sort(), ['task-one', 'task-two']);
  assert.equal(byId['task-one'].stale, true);
  assert.equal(byId['task-two'].stale, false);
  assert.equal(byId['task-one'].record.holder.machineId, MACHINE_A.machineId);
  assert.equal(sh(fx.remote, ['for-each-ref', '--format=%(objectname) %(refname)']), before);
});

test('AC5 持有者与 epoch 一致时断言通过；refresh 只刷新心跳不提升 epoch', (t) => {
  const fx = setupFixture(t);
  const started = startOn(fx.gitA, MACHINE_A);
  const binding = remoteBindingOf(started, cfgFor());
  const checked = assertRemoteHolder({ git: fx.gitA, cfg: cfgFor(), taskId: 'shared-task', binding, identity: MACHINE_A, now: T0 + 1000 });
  assert.equal(checked.status, 'OK');
  assert.equal(checked.blocked, false);
  const refreshed = assertRemoteHolder({
    git: fx.gitA, cfg: cfgFor(), taskId: 'shared-task', binding, identity: MACHINE_A,
    now: T0 + 5000, refresh: { state: 'review' },
  });
  assert.equal(refreshed.status, 'OK');
  const record = remoteRecord(fx.remote, 'refs/xirang/task/shared-task');
  assert.equal(record.epoch, 1);
  assert.equal(record.state, 'review');
  assert.equal(record.heartbeatAt, new Date(T0 + 5000).toISOString());
});

test('AC5 被夺取后原持有者断言失败：TASK_CLAIM_LOST 在 enforce 与 warn 下都阻断', (t) => {
  const fx = setupFixture(t);
  const started = startOn(fx.gitA, MACHINE_A);
  const binding = remoteBindingOf(started, cfgFor());
  takeoverTask({ git: fx.gitB, cfg: cfgFor(), taskId: 'shared-task', identity: MACHINE_B, reason: '接手', force: true, now: T0 + 1000 });
  for (const mode of ['enforce', 'warn']) {
    const lost = assertRemoteHolder({ git: fx.gitA, cfg: cfgFor({ mode }), taskId: 'shared-task', binding, identity: MACHINE_A, now: T0 + 2000 });
    assert.equal(lost.status, 'TASK_CLAIM_LOST');
    assert.equal(lost.blocked, true);
    const lines = formatRemoteLines(lost).join('\n');
    assert.match(lines, /TASK_REMOTE_STATUS=TASK_CLAIM_LOST/);
    assert.match(lines, /TASK_REMOTE_HOLDER=dev-b@host-b \(machine-bbbb\)/);
  }
  // refresh 也不得覆盖新持有者的登记。
  const attempted = assertRemoteHolder({
    git: fx.gitA, cfg: cfgFor(), taskId: 'shared-task', binding, identity: MACHINE_A, now: T0 + 3000, refresh: { state: 'review' },
  });
  assert.equal(attempted.status, 'TASK_CLAIM_LOST');
  assert.equal(remoteRecord(fx.remote, 'refs/xirang/task/shared-task').holder.machineId, MACHINE_B.machineId);
});

test('AC5 本地未绑定登记：enforce 阻断为 UNREGISTERED，warn 放行', (t) => {
  const fx = setupFixture(t);
  const enforced = assertRemoteHolder({ git: fx.gitA, cfg: cfgFor(), taskId: 'shared-task', binding: null, identity: MACHINE_A, now: T0 });
  assert.equal(enforced.status, 'UNREGISTERED');
  assert.equal(enforced.blocked, true);
  const warned = assertRemoteHolder({ git: fx.gitA, cfg: cfgFor({ mode: 'warn' }), taskId: 'shared-task', binding: null, identity: MACHINE_A, now: T0 });
  assert.equal(warned.status, 'UNREGISTERED');
  assert.equal(warned.blocked, false);
});

test('AC5 enforceRemoteClaim 只按当前分支或 worktree 精确匹配本地任务并断言', (t) => {
  const fx = setupFixture(t);
  const started = startOn(fx.gitA, MACHINE_A);
  const runsRoot = path.join(fx.root, 'runs');
  const taskDir = path.join(runsRoot, 'shared-task');
  fs.mkdirSync(taskDir, { recursive: true });
  const state = {
    task_id: 'shared-task', project_root: fx.a, worktree: fx.a, branch: 'feature/SHARED-TASK', status: 'running',
    remote: remoteBindingOf(started, cfgFor()),
  };
  const context = {
    config: { task: { remote: { enabled: true, mode: 'enforce', remoteRetryDelaysMs: [] } } },
    runsRoot, projectRoot: fx.a, worktree: fx.a, branch: 'feature/SHARED-TASK',
  };
  const listStates = () => [state];
  const ok = enforceRemoteClaim({ context, listStates, gitFactory: () => fx.gitA, identity: MACHINE_A, now: T0 + 1000 });
  assert.equal(ok.status, 'OK');
  assert.equal(ok.taskId, 'shared-task');
  takeoverTask({ git: fx.gitB, cfg: cfgFor(), taskId: 'shared-task', identity: MACHINE_B, reason: '接手', force: true, now: T0 + 2000 });
  const lost = enforceRemoteClaim({ context, listStates, gitFactory: () => fx.gitA, identity: MACHINE_A, now: T0 + 3000 });
  assert.equal(lost.status, 'TASK_CLAIM_LOST');
  assert.equal(lost.blocked, true);
  // 分支与 worktree 都不匹配时视为无绑定任务（不回退到项目内任意任务）。
  const unbound = enforceRemoteClaim({
    context: { ...context, branch: 'feature/OTHER', worktree: path.join(fx.root, 'elsewhere') },
    listStates, gitFactory: () => fx.gitA, identity: MACHINE_A, now: T0 + 3000,
  });
  assert.equal(unbound.status, 'NO_TASK');
  assert.equal(unbound.blocked, true);
});

test('AC5 tdd push 在推送前、qa merge 在合并前调用远端持有者门禁', () => {
  const pushSource = fs.readFileSync(path.join(__dirname, '../../tdd-tools/tdd-push.js'), 'utf8');
  const pushGate = pushSource.indexOf('enforceRemoteClaim(');
  assert.ok(pushGate > 0, 'tdd-push.js must call enforceRemoteClaim');
  assert.ok(pushGate < pushSource.indexOf('pushBranch();'), 'remote gate must run before pushBranch()');
  const mergeSource = fs.readFileSync(path.join(__dirname, '../../qa-tools/qa-merge.js'), 'utf8');
  const mergeGate = mergeSource.indexOf('enforceRemoteClaim(');
  assert.ok(mergeGate > 0, 'qa-merge.js must call enforceRemoteClaim');
  assert.ok(mergeGate < mergeSource.indexOf('// Step 11-12'), 'remote gate must run before the merge step');
});

test('AC6 finish 置 done；cancel 仅在本机持有时释放，非持有者不改远端', (t) => {
  const fx = setupFixture(t);
  const started = startOn(fx.gitA, MACHINE_A);
  const binding = remoteBindingOf(started, cfgFor());
  const notHolder = finalizeRemoteTask({ git: fx.gitB, cfg: cfgFor(), taskId: 'shared-task', binding: { ...binding, machine_id: MACHINE_B.machineId }, identity: MACHINE_B, state: 'released', now: T0 + 500 });
  assert.equal(notHolder.status, 'NOT_HOLDER');
  assert.equal(remoteRecord(fx.remote, 'refs/xirang/task/shared-task').state, 'claimed');
  const done = finalizeRemoteTask({ git: fx.gitA, cfg: cfgFor(), taskId: 'shared-task', binding, identity: MACHINE_A, state: 'done', now: T0 + 1000 });
  assert.equal(done.status, 'DONE');
  const record = remoteRecord(fx.remote, 'refs/xirang/task/shared-task');
  assert.equal(record.state, 'done');
  assert.equal(record.epoch, 1);
  assert.equal(record.holder.machineId, MACHINE_A.machineId);
});

// ---------------------------------------------------------------------------
// task-remote-trial-fixes：GuiXu 试用暴露的缺陷回归（AC1 阻断时不引导绕过、AC2 开发期分支可见）。

test('AC1 远端门禁阻断的下一动作按状态给出指引，且从不引导手动创建 PR 绕过门禁', () => {
  const statuses = ['TASK_CLAIM_LOST', 'UNREGISTERED', 'NO_TASK', 'AMBIGUOUS', 'UNKNOWN', 'CONFIG_ERROR',
    'INVALID_BINDING', 'STATE_ERROR', 'IDENTITY_ERROR', 'REJECTED'];
  for (const status of statuses) {
    const next = remoteNextAction({ status, taskId: 'shared-task', blocked: true });
    assert.equal(typeof next, 'string', status);
    assert.ok(next.length > 0, `${status} must have a next action`);
    assert.doesNotMatch(next, /pull\/new/, `${status} must not suggest creating a PR manually`);
  }
  assert.match(remoteNextAction({ status: 'TASK_CLAIM_LOST', taskId: 'shared-task' }), /task takeover --task shared-task/);
  assert.match(remoteNextAction({ status: 'UNREGISTERED', taskId: 'shared-task' }), /task takeover --task shared-task/);
  assert.match(remoteNextAction({ status: 'NO_TASK' }), /task start/);
  assert.match(remoteNextAction({ status: 'CONFIG_ERROR' }), /task\.remote/);
});

test('AC2 开发期同步分支：只更新 branch/phase，不提升 epoch；未变化时不写远端', (t) => {
  const fx = setupFixture(t);
  const started = startOn(fx.gitA, MACHINE_A, { branch: '' });
  const binding = remoteBindingOf(started, cfgFor());
  const ref = 'refs/xirang/task/shared-task';
  assert.equal(remoteRecord(fx.remote, ref).branch, '');

  const synced = syncRemoteBranch({
    git: fx.gitA, cfg: cfgFor(), taskId: 'shared-task', binding, identity: MACHINE_A,
    branch: 'feature/SHARED-TASK', phase: 'tdd', now: T0 + 1000,
  });
  assert.equal(synced.status, 'BRANCH_SYNCED');
  assert.equal(synced.blocked, false);
  const record = remoteRecord(fx.remote, ref);
  assert.equal(record.branch, 'feature/SHARED-TASK');
  assert.equal(record.epoch, 1);
  assert.equal(record.state, 'claimed');
  assert.equal(record.holder.machineId, MACHINE_A.machineId);

  const before = remoteRefSha(fx.remote, ref);
  const unchanged = syncRemoteBranch({
    git: fx.gitA, cfg: cfgFor(), taskId: 'shared-task', binding, identity: MACHINE_A,
    branch: 'feature/SHARED-TASK', phase: 'tdd', now: T0 + 2000,
  });
  assert.equal(unchanged.status, 'BRANCH_UNCHANGED');
  assert.equal(remoteRefSha(fx.remote, ref), before, 'unchanged branch must not write the registry');
});

test('AC2 同步分支时已失权：报告 TASK_CLAIM_LOST 但不阻断，且不改写他机登记', (t) => {
  const fx = setupFixture(t);
  const started = startOn(fx.gitA, MACHINE_A, { branch: '' });
  const binding = remoteBindingOf(started, cfgFor());
  takeoverTask({ git: fx.gitB, cfg: cfgFor(), taskId: 'shared-task', identity: MACHINE_B, reason: '接手', force: true, now: T0 + 500 });
  const ref = 'refs/xirang/task/shared-task';
  const before = remoteRefSha(fx.remote, ref);
  const lost = syncRemoteBranch({
    git: fx.gitA, cfg: cfgFor(), taskId: 'shared-task', binding, identity: MACHINE_A,
    branch: 'feature/SHARED-TASK', phase: 'tdd', now: T0 + 1000,
  });
  assert.equal(lost.status, 'TASK_CLAIM_LOST');
  assert.equal(lost.blocked, false, 'branch sync is advisory and never blocks worktree creation');
  assert.equal(remoteRefSha(fx.remote, ref), before);
  assert.equal(remoteRecord(fx.remote, ref).holder.machineId, MACHINE_B.machineId);
});

test('AC1 qa merge 远端门禁阻断时输出按状态生成的 NEXT_ACTION', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../qa-tools/qa-merge.js'), 'utf8');
  const gate = source.indexOf('enforceRemoteClaim(');
  const blockedAt = source.indexOf('if (remoteClaim.blocked)', gate);
  const throwAt = source.indexOf('throw new Error(', blockedAt);
  const nextAt = source.indexOf('NEXT_ACTION=${remoteNextAction(remoteClaim)}', blockedAt);
  assert.ok(blockedAt > gate && throwAt > blockedAt, 'qa-merge.js remote gate block must exist');
  assert.ok(nextAt > blockedAt && nextAt < throwAt, 'NEXT_ACTION must be printed before the gate throws');
});

// ---------------------------------------------------------------------------
// task-remote-polish：期望值取自任务 task-remote-polish 的验收项 AC1-AC4。

// 以原始提交消息直接写入登记 ref，用于构造损坏记录。
function pushRawRecord(cwd, ref, message) {
  const tree = spawnSync('git', ['mktree'], { cwd, env: GIT_ENV, encoding: 'utf8', input: '' });
  assert.equal(tree.status, 0, tree.stderr);
  const commit = sh(cwd, ['commit-tree', tree.stdout.trim(), '-m', message]);
  sh(cwd, ['push', '-q', 'origin', `${commit}:${ref}`]);
}

function finalizeOn(fx, taskId, state) {
  startOn(fx.gitA, MACHINE_A, { taskId });
  const binding = { ref: taskRemoteRef(taskId), remote: 'origin', epoch: 1, machine_id: MACHINE_A.machineId };
  const done = finalizeRemoteTask({ git: fx.gitA, cfg: cfgFor(), taskId, binding, identity: MACHINE_A, state, now: T0 + 100 });
  assert.match(done.status, /^(DONE|RELEASED)$/u);
}

function seedPruneFixture(t) {
  const fx = setupFixture(t);
  finalizeOn(fx, 'done-task', 'done');
  finalizeOn(fx, 'released-task', 'released');
  startOn(fx.gitA, MACHINE_A, { taskId: 'active-task' });
  pushRawRecord(fx.a, 'refs/xirang/task/broken-task', 'not json');
  return fx;
}

function actionsOf(result) {
  return Object.fromEntries(result.entries.map((entry) => [entry.taskId, entry.action]));
}

test('polish-AC1 fetch 失败时错误取首个 fatal 行，而不是 stderr 末行', (t) => {
  const fx = setupFixture(t);
  sh(fx.b, ['remote', 'set-url', 'origin', path.join(fx.root, 'missing.git')]);
  const listed = listRemoteTasks({ git: fx.gitB, cfg: cfgFor(), now: T0 });
  assert.equal(listed.ok, false);
  assert.match(listed.error, /does not appear to be a git repository/u);
  assert.doesNotMatch(listed.error, /and the repository exists/u);
  const started = startOn(fx.gitB, MACHINE_B);
  assert.equal(started.status, 'UNKNOWN');
  assert.match(started.detail, /does not appear to be a git repository/u);
});

test('polish-AC2 对已完成/已释放登记 takeover：REGISTERED、epoch+1、不记录 previousHolder', (t) => {
  const fx = setupFixture(t);
  finalizeOn(fx, 'shared-task', 'done');
  const claimed = takeoverTask({
    git: fx.gitB, cfg: cfgFor(), taskId: 'shared-task', identity: MACHINE_B, reason: '接手收尾', now: T0 + 1000,
  });
  assert.equal(claimed.status, 'REGISTERED');
  assert.equal(claimed.epoch, 2);
  assert.equal(claimed.previousHolder, undefined);
  const record = remoteRecord(fx.remote, 'refs/xirang/task/shared-task');
  assert.equal(record.holder.machineId, MACHINE_B.machineId);
  assert.equal(record.state, 'claimed');
  assert.equal(record.previousHolder, undefined);
  assert.equal(record.reason, '接手收尾');
  assert.deepEqual(remoteBindingOf(claimed, cfgFor()), {
    ref: 'refs/xirang/task/shared-task', remote: 'origin', epoch: 2, machine_id: MACHINE_B.machineId,
  });
});

test('polish-AC2 夺取活跃持有者仍为 TAKEN_OVER 并记录 previousHolder', (t) => {
  const fx = setupFixture(t);
  startOn(fx.gitA, MACHINE_A);
  const taken = takeoverTask({
    git: fx.gitB, cfg: cfgFor(), taskId: 'shared-task', identity: MACHINE_B, reason: 'A 离线', force: true, now: T0 + 10,
  });
  assert.equal(taken.status, 'TAKEN_OVER');
  assert.equal(taken.previousHolder.machineId, MACHINE_A.machineId);
});

test('polish-AC4 prune 默认只预览：列出 done/released 为 would_delete，远端不变', (t) => {
  const fx = seedPruneFixture(t);
  const refs = ['done-task', 'released-task', 'active-task', 'broken-task'].map((id) => `refs/xirang/task/${id}`);
  const before = refs.map((ref) => remoteRefSha(fx.remote, ref));
  const preview = pruneRemoteTasks({ git: fx.gitB, cfg: cfgFor(), apply: false, now: T0 + 1000 });
  assert.equal(preview.ok, true);
  assert.deepEqual(actionsOf(preview), {
    'active-task': 'keep_active',
    'broken-task': 'keep_invalid',
    'done-task': 'would_delete',
    'released-task': 'would_delete',
  });
  assert.deepEqual(refs.map((ref) => remoteRefSha(fx.remote, ref)), before);
});

test('polish-AC4 prune --apply 只删除 done/released，活跃与损坏登记保留', (t) => {
  const fx = seedPruneFixture(t);
  const applied = pruneRemoteTasks({ git: fx.gitB, cfg: cfgFor(), apply: true, now: T0 + 1000 });
  assert.equal(applied.ok, true);
  assert.deepEqual(actionsOf(applied), {
    'active-task': 'keep_active',
    'broken-task': 'keep_invalid',
    'done-task': 'deleted',
    'released-task': 'deleted',
  });
  assert.equal(remoteRefSha(fx.remote, 'refs/xirang/task/done-task'), '');
  assert.equal(remoteRefSha(fx.remote, 'refs/xirang/task/released-task'), '');
  assert.notEqual(remoteRefSha(fx.remote, 'refs/xirang/task/active-task'), '');
  assert.notEqual(remoteRefSha(fx.remote, 'refs/xirang/task/broken-task'), '');
  const listed = listRemoteTasks({ git: fx.gitB, cfg: cfgFor(), now: T0 + 1000 });
  assert.deepEqual(listed.tasks.map((entry) => entry.taskId), ['active-task', 'broken-task']);
});

test('polish-AC4 prune --apply 以快照 lease 删除：期间被重新领取的登记拒绝删除并保留', (t) => {
  const fx = setupFixture(t);
  finalizeOn(fx, 'done-task', 'done');
  let raced = false;
  const racingGit = (args, options) => {
    if (!raced && args[0] === 'push') {
      raced = true;
      const again = startOn(fx.gitA, MACHINE_A, { taskId: 'done-task', now: T0 + 500 });
      assert.equal(again.status, 'REGISTERED');
    }
    return fx.gitB(args, options);
  };
  const applied = pruneRemoteTasks({ git: racingGit, cfg: cfgFor(), apply: true, now: T0 + 1000 });
  assert.deepEqual(actionsOf(applied), { 'done-task': 'rejected' });
  const record = remoteRecord(fx.remote, 'refs/xirang/task/done-task');
  assert.equal(record.state, 'claimed');
  assert.equal(record.epoch, 2);
});

test('polish-AC4 prune 拉取失败时 ok=false 且不删除任何登记', (t) => {
  const fx = seedPruneFixture(t);
  sh(fx.b, ['remote', 'set-url', 'origin', path.join(fx.root, 'missing.git')]);
  const applied = pruneRemoteTasks({ git: fx.gitB, cfg: cfgFor(), apply: true, now: T0 + 1000 });
  assert.equal(applied.ok, false);
  assert.match(applied.error, /does not appear to be a git repository/u);
  assert.notEqual(remoteRefSha(fx.remote, 'refs/xirang/task/done-task'), '');
});

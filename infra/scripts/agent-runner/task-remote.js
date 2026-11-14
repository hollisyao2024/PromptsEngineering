'use strict';

/**
 * 任务远端登记：把 task start 的“正在做”广播到共享远端 refs/xirang/task/<id>，
 * 让多台电脑在开工、推送、合并前看到同一任务的唯一持有者。
 *
 * - 每条记录是一个空树 commit，提交消息为单行 JSON；有上一条记录时以其为 parent，形成审计链。
 * - 写入一律经 deploy-guard-git 的 pushWithLease 做 CAS：lease 取本次 fetch 的镜像值，空串表示 ref 必须不存在。
 * - epoch 是夺取计数（fencing token）：只有 takeover 或重新领取已结束的登记才 +1；
 *   本地 state.remote 绑定 {ref, remote, epoch, machine_id}，推送/合并前比对远端持有者与 epoch。
 * - 远端记录来自其他电脑，属于不可信数据：解析严格校验，输出前净化控制字符。
 * - 默认关闭（task.remote.enabled=false），关闭时任何入口都不访问远端。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { DEFAULT_CONFIG, deepMerge } = require('../shared/config');
const {
  FULL_SHA,
  createGitRunner,
  gitErrorLine,
  lastLine,
  pushWithLease,
} = require('../ops-tools/deploy-guard-git');

const RECORD_SCHEMA = 'xirang-task-remote/v1';
const REF_PREFIX = 'refs/xirang/task/';
const RECORD_AUTHOR = { name: 'xirang task registry', email: 'task-registry@xirang.invalid' };
const RECORD_STATES = new Set(['claimed', 'review', 'done', 'released']);
const ACTIVE_STATES = new Set(['claimed', 'review']);
const MODES = new Set(['warn', 'enforce']);
const CONFIG_KEYS = new Set(['enabled', 'mode', 'remote', 'ttlSeconds', 'remoteRetryDelaysMs']);
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MACHINE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TASK_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const MAX_TTL_SECONDS = 365 * 24 * 3600;
const MAX_RETRY_DELAYS = 10;
const MAX_RETRY_DELAY_MS = 120000;
const MAX_RECORD_BYTES = 16 * 1024;
const MAX_TEXT = 200;
// 本地任务已结束时不再参与推送/合并门禁的匹配。
const TERMINAL_LOCAL_STATUSES = new Set(['completed', 'cleanup_pending']);

function sleepSync(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// 与 deploy-guard-git 相同的有界重试：attempt() 返回 done=true 即停止。
function withRetries(retry = {}, attempt) {
  const delays = Array.isArray(retry.delaysMs) ? retry.delaysMs : [];
  const sleep = typeof retry.sleep === 'function' ? retry.sleep : sleepSync;
  let outcome = attempt(0);
  for (let index = 0; !outcome.done && index < delays.length; index += 1) {
    sleep(delays[index]);
    outcome = attempt(index + 1);
  }
  return outcome;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isoAt(now) {
  return new Date(now).toISOString();
}

// ---------------------------------------------------------------------------
// 配置

function resolveRemoteConfig(config) {
  const task = config && config.task;
  if (task === undefined || task === null) return { enabled: false };
  if (!isPlainObject(task)) return { enabled: true, error: 'task must be an object' };
  const raw = task.remote;
  if (raw === undefined || raw === null) return { enabled: false };
  if (!isPlainObject(raw)) return { enabled: true, error: 'task.remote must be an object' };
  // 关闭时保持现状：不校验其余键，也不访问远端。
  if (raw.enabled === undefined || raw.enabled === false) return { enabled: false };
  if (raw.enabled !== true) return { enabled: true, error: 'task.remote.enabled must be a boolean' };

  const defaults = DEFAULT_CONFIG && DEFAULT_CONFIG.task && DEFAULT_CONFIG.task.remote;
  if (!isPlainObject(defaults)) {
    return { enabled: true, error: 'task.remote defaults are missing from config.example.json' };
  }
  const merged = deepMerge(defaults, raw);
  const unknown = Object.keys(merged).filter((key) => !CONFIG_KEYS.has(key));
  if (unknown.length > 0) return { enabled: true, error: `unknown task.remote key(s): ${unknown.join(', ')}` };
  if (!MODES.has(merged.mode)) return { enabled: true, error: 'task.remote.mode must be warn or enforce' };
  if (typeof merged.remote !== 'string' || !REMOTE_NAME.test(merged.remote)) {
    return { enabled: true, error: 'task.remote.remote must be a git remote name' };
  }
  if (!Number.isInteger(merged.ttlSeconds) || merged.ttlSeconds <= 0 || merged.ttlSeconds > MAX_TTL_SECONDS) {
    return { enabled: true, error: `task.remote.ttlSeconds must be an integer in 1..${MAX_TTL_SECONDS}` };
  }
  const delays = merged.remoteRetryDelaysMs;
  if (!Array.isArray(delays) || delays.length > MAX_RETRY_DELAYS
    || delays.some((ms) => !Number.isInteger(ms) || ms < 0 || ms > MAX_RETRY_DELAY_MS)) {
    return {
      enabled: true,
      error: `task.remote.remoteRetryDelaysMs must be at most ${MAX_RETRY_DELAYS} integers in 0..${MAX_RETRY_DELAY_MS}`,
    };
  }
  return {
    enabled: true,
    mode: merged.mode,
    remote: merged.remote,
    ttlSeconds: merged.ttlSeconds,
    retry: { delaysMs: [...delays] },
  };
}

// ---------------------------------------------------------------------------
// 身份与命名

function taskRemoteRef(taskId) {
  const id = String(taskId || '');
  if (!TASK_ID.test(id) || id.includes('..') || id.endsWith('.lock') || id.endsWith('.')) {
    throw new Error(`invalid task id for remote registry: ${JSON.stringify(id)}`);
  }
  return `${REF_PREFIX}${id}`;
}

function mirrorPrefix(cfg) {
  return `refs/xirang-remote/${cfg.remote}/task/`;
}

// 机器身份：XIRANG_MACHINE_ID 优先（CI、容器等无稳定 HOME 的场景），否则读取或生成 ~/.xirang/machine-id。
function resolveMachineIdentity({ env = process.env, homedir, hostname, username } = {}) {
  let machineId = env && env.XIRANG_MACHINE_ID;
  if (machineId !== undefined && machineId !== '') {
    if (typeof machineId !== 'string' || !MACHINE_ID.test(machineId)) {
      throw new Error('XIRANG_MACHINE_ID must be 1-64 letters, numbers, dots, underscores, or hyphens');
    }
  } else {
    machineId = readOrCreateMachineId(homedir || os.homedir());
  }
  return {
    machineId,
    host: safeText(hostname !== undefined ? hostname : safeCall(() => os.hostname(), 'unknown-host')),
    user: safeText(username !== undefined ? username : safeCall(() => os.userInfo().username, 'unknown-user')),
  };
}

function safeCall(fn, fallback) {
  try {
    return fn() || fallback;
  } catch {
    return fallback;
  }
}

function readOrCreateMachineId(home) {
  if (!home || !path.isAbsolute(home)) throw new Error('cannot resolve home directory for ~/.xirang/machine-id; set XIRANG_MACHINE_ID');
  const dir = path.join(home, '.xirang');
  const file = path.join(dir, 'machine-id');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const readExisting = () => {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error(`${file} must be a regular file; remove it or set XIRANG_MACHINE_ID`);
    const value = fs.readFileSync(file, 'utf8').trim();
    if (!MACHINE_ID.test(value)) throw new Error(`${file} is malformed; remove it or set XIRANG_MACHINE_ID`);
    return value;
  };
  try {
    return readExisting();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const generated = crypto.randomBytes(16).toString('hex');
  try {
    // wx：并发首次生成时只有一个进程写入成功，其余读取同一结果。
    fs.writeFileSync(file, `${generated}\n`, { flag: 'wx', mode: 0o600 });
    return generated;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return readExisting();
  }
}

// ---------------------------------------------------------------------------
// 记录读写

// 控制字符、C1 与 Unicode 行/段分隔符一律替换为空格，防止远端记录伪造 KEY=VALUE 输出行。
const UNSAFE_TEXT = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'gu');

function safeText(value, max = MAX_TEXT) {
  return String(value === undefined || value === null ? '' : value).replace(UNSAFE_TEXT, ' ').slice(0, max);
}

function holderOf(identity) {
  return { machineId: identity.machineId, host: safeText(identity.host), user: safeText(identity.user) };
}

function isStale(record, cfg, now) {
  if (!record || !ACTIVE_STATES.has(record.state)) return false;
  const ttl = Number.isInteger(record.ttlSeconds) && record.ttlSeconds > 0 ? record.ttlSeconds : cfg.ttlSeconds;
  return now - Date.parse(record.heartbeatAt) > ttl * 1000;
}

function parseRecord(body, taskId) {
  if (Buffer.byteLength(body, 'utf8') > MAX_RECORD_BYTES) return { invalid: 'record exceeds size limit' };
  let data;
  try {
    data = JSON.parse(body.trim());
  } catch {
    return { invalid: 'record is not JSON' };
  }
  if (!isPlainObject(data)) return { invalid: 'record is not an object' };
  if (data.schema !== RECORD_SCHEMA) return { invalid: `unsupported schema ${safeText(data.schema, 60)}` };
  if (data.taskId !== taskId) return { invalid: 'record task id mismatch' };
  if (!Number.isInteger(data.epoch) || data.epoch < 1) return { invalid: 'record epoch must be a positive integer' };
  if (!RECORD_STATES.has(data.state)) return { invalid: `unsupported state ${safeText(data.state, 40)}` };
  const holder = data.holder;
  if (!isPlainObject(holder) || typeof holder.machineId !== 'string' || !MACHINE_ID.test(holder.machineId)) {
    return { invalid: 'record holder is malformed' };
  }
  if (typeof data.heartbeatAt !== 'string' || Number.isNaN(Date.parse(data.heartbeatAt))) {
    return { invalid: 'record heartbeatAt is malformed' };
  }
  if (data.ttlSeconds !== undefined && (!Number.isInteger(data.ttlSeconds) || data.ttlSeconds <= 0)) {
    return { invalid: 'record ttlSeconds is malformed' };
  }
  return { record: data };
}

// 拉取全部任务登记到 refs/xirang-remote/<remote>/task/*；glob 无匹配也算成功，--prune 同步删除。
function fetchTasks(git, cfg) {
  const { result } = withRetries(cfg.retry, () => {
    const fetched = git([
      'fetch',
      '--prune',
      '--no-tags',
      cfg.remote,
      `+${REF_PREFIX}*:${mirrorPrefix(cfg)}*`,
    ]);
    return { done: fetched.status === 0, result: fetched };
  });
  if (result.status !== 0) {
    return { ok: false, error: `git fetch ${cfg.remote} failed: ${gitErrorLine(result.stderr) || `exit ${result.status}`}` };
  }
  return { ok: true };
}

function readMirrorSha(git, ref) {
  const result = git(['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
  const sha = result.stdout.trim();
  return result.status === 0 && FULL_SHA.test(sha) ? sha : '';
}

function readRecordAt(git, sha, taskId) {
  const shown = git(['cat-file', 'commit', sha]);
  if (shown.status !== 0) return { ok: false, error: `git cat-file ${sha} failed: ${lastLine(shown.stderr)}` };
  const separator = shown.stdout.indexOf('\n\n');
  if (separator === -1) return { ok: true, sha, record: null, invalid: 'record commit has no message' };
  const parsed = parseRecord(shown.stdout.slice(separator + 2), taskId);
  return { ok: true, sha, record: parsed.record || null, invalid: parsed.invalid };
}

// 读取本次 fetch 后的镜像：sha 为空表示远端无登记。
function readRecord(git, cfg, taskId) {
  const sha = readMirrorSha(git, `${mirrorPrefix(cfg)}${taskId}`);
  if (!sha) return { ok: true, sha: '', record: null };
  return readRecordAt(git, sha, taskId);
}

function fetchAndRead(git, cfg, taskId) {
  const fetched = fetchTasks(git, cfg);
  if (!fetched.ok) return { ok: false, error: fetched.error };
  return readRecord(git, cfg, taskId);
}

function createRecordCommit(git, record, parentSha, now) {
  const tree = git(['mktree'], { input: '' });
  if (tree.status !== 0) return { error: lastLine(tree.stderr) || 'git mktree failed' };
  const date = `${Math.floor(now / 1000)} +0000`;
  const args = ['commit-tree', tree.stdout.trim()];
  if (parentSha) args.push('-p', parentSha);
  args.push('-m', JSON.stringify(record));
  const created = git(args, {
    env: {
      GIT_AUTHOR_NAME: RECORD_AUTHOR.name,
      GIT_AUTHOR_EMAIL: RECORD_AUTHOR.email,
      GIT_COMMITTER_NAME: RECORD_AUTHOR.name,
      GIT_COMMITTER_EMAIL: RECORD_AUTHOR.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  });
  const sha = created.stdout.trim();
  if (created.status !== 0 || !FULL_SHA.test(sha)) return { error: lastLine(created.stderr) || 'git commit-tree failed' };
  return { sha };
}

// CAS 写入：expectedSha 为本次读取的镜像值（'' 表示必须不存在）。返回 ok|rejected|unknown。
function writeRecord(git, cfg, taskId, record, expectedSha, now) {
  const commit = createRecordCommit(git, record, expectedSha, now);
  if (commit.error) return { result: 'unknown', detail: `cannot build registry record: ${commit.error}` };
  const pushed = pushWithLease(git, {
    remote: cfg.remote,
    ref: taskRemoteRef(taskId),
    newSha: commit.sha,
    expected: expectedSha,
    retry: cfg.retry,
  });
  return { ...pushed, sha: commit.sha };
}

function buildRecord({ taskId, epoch, state, event, identity, branch, phase, cfg, now, previous, extra = {} }) {
  const at = isoAt(now);
  const keepClaimedAt = previous && previous.epoch === epoch && previous.claimedAt;
  return {
    schema: RECORD_SCHEMA,
    taskId,
    epoch,
    state,
    event,
    holder: holderOf(identity),
    branch: branch ? safeText(branch) : (previous && previous.epoch === epoch ? previous.branch || '' : ''),
    phase: phase ? safeText(phase, 40) : (previous && previous.epoch === epoch ? previous.phase || '' : ''),
    claimedAt: keepClaimedAt ? previous.claimedAt : at,
    heartbeatAt: at,
    ttlSeconds: cfg.ttlSeconds,
    ...extra,
    nonce: crypto.randomBytes(8).toString('hex'),
  };
}

// ---------------------------------------------------------------------------
// 结果构造

function blockedByMode(cfg) {
  return cfg.mode === 'enforce';
}

function makeResult(status, { taskId, cfg, blocked, record, epoch, holder, stale, detail, extra } = {}) {
  return {
    status,
    blocked: Boolean(blocked),
    taskId,
    ref: taskId ? taskRemoteRef(taskId) : undefined,
    remote: cfg && cfg.remote,
    epoch: epoch !== undefined ? epoch : (record ? record.epoch : undefined),
    holder: holder !== undefined ? holder : (record ? record.holder : undefined),
    stale,
    record,
    detail,
    ...(extra || {}),
  };
}

function writeFailure(written, { taskId, cfg, blocked }) {
  if (written.result === 'rejected') {
    return makeResult('REJECTED', {
      taskId, cfg, blocked, detail: `registry changed concurrently; re-run to see the new holder (${safeText(written.detail)})`,
    });
  }
  return makeResult('UNKNOWN', { taskId, cfg, blocked, detail: safeText(written.detail || 'push result unknown') });
}

// ---------------------------------------------------------------------------
// 生命周期入口

/** task start：无登记或登记已结束时以 CAS 领取；他机活跃持有时冲突（enforce 阻断）。 */
function registerTaskStart({ git, cfg, taskId, identity, branch = '', phase = '', now = Date.now() }) {
  taskRemoteRef(taskId);
  const read = fetchAndRead(git, cfg, taskId);
  if (!read.ok) return makeResult('UNKNOWN', { taskId, cfg, blocked: blockedByMode(cfg), detail: read.error });
  if (read.invalid) {
    return makeResult('INVALID', {
      taskId, cfg, blocked: blockedByMode(cfg),
      detail: `remote registry record is invalid (${read.invalid}); inspect it or use task takeover --force`,
    });
  }
  const current = read.record;
  if (current && ACTIVE_STATES.has(current.state)) {
    const stale = isStale(current, cfg, now);
    if (current.holder.machineId === identity.machineId) {
      return makeResult('ALREADY_HOLDER', { taskId, cfg, blocked: false, record: current, stale });
    }
    return makeResult('CONFLICT', {
      taskId, cfg, blocked: blockedByMode(cfg), record: current, stale,
      detail: stale ? 'holder heartbeat expired; takeover does not need --force' : 'task is actively held by another machine',
    });
  }
  const epoch = current ? current.epoch + 1 : 1;
  const record = buildRecord({ taskId, epoch, state: 'claimed', event: 'start', identity, branch, phase, cfg, now });
  const written = writeRecord(git, cfg, taskId, record, read.sha, now);
  if (written.result !== 'ok') return writeFailure(written, { taskId, cfg, blocked: blockedByMode(cfg) });
  return makeResult('REGISTERED', { taskId, cfg, blocked: false, record, stale: false });
}

/** task takeover：必须 --reason；他机活跃且未过期时必须 --force；成功 epoch+1 并记录原持有者。 */
function takeoverTask({ git, cfg, taskId, identity, reason, force = false, branch = '', phase = '', now = Date.now() }) {
  const why = safeText(String(reason || '').trim(), 500);
  if (!why) throw new Error('task takeover requires --reason "<why>"');
  taskRemoteRef(taskId);
  const read = fetchAndRead(git, cfg, taskId);
  if (!read.ok) return makeResult('UNKNOWN', { taskId, cfg, blocked: true, detail: read.error });
  const current = read.record;
  if (read.invalid && !force) {
    return makeResult('REQUIRES_FORCE', {
      taskId, cfg, blocked: true, detail: `remote registry record is invalid (${read.invalid}); re-run with --force to replace it`,
    });
  }
  if (current && ACTIVE_STATES.has(current.state)) {
    const stale = isStale(current, cfg, now);
    if (current.holder.machineId === identity.machineId) {
      return makeResult('ALREADY_HOLDER', { taskId, cfg, blocked: false, record: current, stale });
    }
    if (!stale && !force) {
      return makeResult('REQUIRES_FORCE', {
        taskId, cfg, blocked: true, record: current, stale,
        detail: 'holder heartbeat is still fresh; confirm with the holder, then re-run with --force',
      });
    }
  }
  const epoch = current ? current.epoch + 1 : 1;
  // 只有替换活跃持有者（或无法判读的记录）才是夺取并隔离前任；无登记或已 done/released 只是补登记。
  const fenced = Boolean(read.invalid) || Boolean(current && ACTIVE_STATES.has(current.state));
  const previousHolder = fenced && current ? {
    machineId: current.holder.machineId,
    host: safeText(current.holder.host),
    user: safeText(current.holder.user),
    epoch: current.epoch,
    state: current.state,
    revokedAt: isoAt(now),
    reason: why,
  } : null;
  const record = buildRecord({
    taskId, epoch, state: 'claimed', event: 'takeover', identity, branch, phase, cfg, now,
    extra: previousHolder ? { previousHolder, reason: why } : { reason: why },
  });
  const written = writeRecord(git, cfg, taskId, record, read.sha, now);
  if (written.result !== 'ok') return writeFailure(written, { taskId, cfg, blocked: true });
  if (!fenced) return makeResult('REGISTERED', { taskId, cfg, blocked: false, record, stale: false });
  return makeResult('TAKEN_OVER', { taskId, cfg, blocked: false, record, stale: false, extra: { previousHolder } });
}

/** task remote list：只读拉取并列出全部登记。 */
function listRemoteTasks({ git, cfg, now = Date.now() }) {
  const fetched = fetchTasks(git, cfg);
  if (!fetched.ok) return { ok: false, error: fetched.error, tasks: [] };
  const prefix = mirrorPrefix(cfg);
  const refs = git(['for-each-ref', '--format=%(objectname) %(refname)', prefix]);
  if (refs.status !== 0) return { ok: false, error: `git for-each-ref failed: ${lastLine(refs.stderr)}`, tasks: [] };
  const tasks = [];
  for (const line of refs.stdout.split(/\r?\n/u)) {
    const [sha, refname] = line.trim().split(' ');
    if (!sha || !refname || !refname.startsWith(prefix)) continue;
    const taskId = refname.slice(prefix.length);
    if (!TASK_ID.test(taskId)) {
      tasks.push({ taskId: safeText(taskId, 80), sha, record: null, stale: false, invalid: 'task id is malformed' });
      continue;
    }
    const read = readRecordAt(git, sha, taskId);
    tasks.push({
      taskId,
      sha,
      record: read.record || null,
      stale: isStale(read.record, cfg, now),
      invalid: read.ok ? read.invalid : read.error,
    });
  }
  tasks.sort((left, right) => left.taskId.localeCompare(right.taskId));
  return { ok: true, tasks };
}

/**
 * task remote prune：清理已结束（done/released）的登记。默认只预览；apply 时逐条以本次快照 SHA 为
 * lease 删除，期间被重新领取或改写的登记会被拒绝并保留。活跃与无法判读的登记一律不动。
 * entries[].action：would_delete|deleted|keep_active|keep_invalid|rejected|unknown。
 */
function pruneRemoteTasks({ git, cfg, apply = false, now = Date.now() }) {
  const listed = listRemoteTasks({ git, cfg, now });
  if (!listed.ok) return { ok: false, error: listed.error, entries: [] };
  const entries = listed.tasks.map((task) => {
    const base = {
      taskId: task.taskId,
      state: task.record ? task.record.state : '',
      epoch: task.record ? task.record.epoch : '',
    };
    if (task.invalid || !task.record) return { ...base, action: 'keep_invalid', detail: safeText(task.invalid || 'record missing') };
    if (ACTIVE_STATES.has(task.record.state)) return { ...base, action: 'keep_active' };
    if (!apply) return { ...base, action: 'would_delete' };
    const pushed = pushWithLease(git, {
      remote: cfg.remote,
      ref: taskRemoteRef(task.taskId),
      newSha: '',
      expected: task.sha,
      retry: cfg.retry,
    });
    if (pushed.result === 'ok') return { ...base, action: 'deleted' };
    return { ...base, action: pushed.result === 'rejected' ? 'rejected' : 'unknown', detail: safeText(pushed.detail || '') };
  });
  return { ok: true, entries };
}

function normalizeBinding(binding) {
  if (!isPlainObject(binding)) return null;
  if (!Number.isInteger(binding.epoch) || binding.epoch < 1) return null;
  if (typeof binding.machine_id !== 'string' || !MACHINE_ID.test(binding.machine_id)) return null;
  return binding;
}

function holderMatches(record, binding, identity) {
  return Boolean(record)
    && record.holder.machineId === identity.machineId
    && binding.machine_id === identity.machineId
    && record.epoch === binding.epoch;
}

/**
 * 推送/合并前断言本机仍是持有者。失权（被夺取、epoch 变化、登记被结束或损坏）在任何 mode 下都阻断；
 * 未绑定或远端不可读按 mode 决定。refresh 时以 CAS 刷新心跳（可更新 state/branch/phase），不提升 epoch。
 */
function assertRemoteHolder({ git, cfg, taskId, binding, identity, now = Date.now(), refresh = null }) {
  if (binding === null || binding === undefined) {
    return makeResult('UNREGISTERED', {
      taskId, cfg, blocked: blockedByMode(cfg), detail: 'local task has no remote registration; run task takeover to register it',
    });
  }
  const bound = normalizeBinding(binding);
  if (!bound) {
    return makeResult('INVALID_BINDING', { taskId, cfg, blocked: true, detail: 'local state.remote binding is malformed' });
  }
  const read = fetchAndRead(git, cfg, taskId);
  if (!read.ok) return makeResult('UNKNOWN', { taskId, cfg, blocked: blockedByMode(cfg), detail: read.error });
  const lost = (record, detail) => makeResult('TASK_CLAIM_LOST', {
    taskId, cfg, blocked: true, record, epoch: record ? record.epoch : undefined, stale: isStale(record, cfg, now), detail,
  });
  const current = read.record;
  if (!current) return lost(null, read.invalid ? `remote record is invalid (${read.invalid})` : 'remote registration is missing');
  if (!holderMatches(current, bound, identity)) {
    return lost(current, `remote holder/epoch changed (local epoch ${bound.epoch}, remote epoch ${current.epoch})`);
  }
  if (!ACTIVE_STATES.has(current.state)) return lost(current, `remote registration is already ${current.state}`);
  if (!refresh) return makeResult('OK', { taskId, cfg, blocked: false, record: current, stale: isStale(current, cfg, now) });
  if (refresh.skipIfUnchanged
    && (!refresh.branch || safeText(refresh.branch) === current.branch)
    && (!refresh.phase || safeText(refresh.phase, 40) === current.phase)
    && (!refresh.state || refresh.state === current.state)) {
    return makeResult('OK', {
      taskId, cfg, blocked: false, record: current, stale: isStale(current, cfg, now), extra: { unchanged: true },
    });
  }

  const nextState = refresh.state && ACTIVE_STATES.has(refresh.state) ? refresh.state : current.state;
  const record = buildRecord({
    taskId, epoch: current.epoch, state: nextState, event: 'heartbeat', identity,
    branch: refresh.branch, phase: refresh.phase, cfg, now, previous: current,
  });
  const written = writeRecord(git, cfg, taskId, record, read.sha, now);
  if (written.result === 'ok') return makeResult('OK', { taskId, cfg, blocked: false, record, stale: false });
  if (written.result === 'unknown') {
    return makeResult('UNKNOWN', { taskId, cfg, blocked: blockedByMode(cfg), detail: safeText(written.detail) });
  }
  // 被拒：重读确认是否仍归本机（例如同机并发心跳），否则视为失权。
  const reread = fetchAndRead(git, cfg, taskId);
  if (!reread.ok) return makeResult('UNKNOWN', { taskId, cfg, blocked: blockedByMode(cfg), detail: reread.error });
  if (reread.record && holderMatches(reread.record, bound, identity) && ACTIVE_STATES.has(reread.record.state)) {
    return makeResult('OK', { taskId, cfg, blocked: false, record: reread.record, stale: false });
  }
  return lost(reread.record, 'remote registration changed during heartbeat');
}

/**
 * worktree new/resume 绑定任务后把开发分支同步到远端登记（task start 常在主干执行，登记 branch 为空）。
 * 只刷新本机持有的登记、不提升 epoch；分支与阶段未变时不写远端。永不阻断 worktree 生命周期：
 * 失权、远端不可读等结果原样返回供告警，blocked 恒为 false。
 */
function syncRemoteBranch({ git, cfg, taskId, binding, identity, branch, phase = '', now = Date.now() }) {
  if (!branch) return makeResult('BRANCH_UNCHANGED', { taskId, cfg, blocked: false, detail: 'no task branch to sync' });
  const result = assertRemoteHolder({
    git, cfg, taskId, binding, identity, now, refresh: { branch, phase, skipIfUnchanged: true },
  });
  if (result.status === 'OK') {
    return { ...result, status: result.unchanged ? 'BRANCH_UNCHANGED' : 'BRANCH_SYNCED', blocked: false };
  }
  return { ...result, blocked: false };
}

/** finish/cancel 收尾：仅本机持有时写 done/released；永不阻断本地收尾。 */
function finalizeRemoteTask({ git, cfg, taskId, binding, identity, state, now = Date.now() }) {
  if (!['done', 'released'].includes(state)) throw new Error(`invalid final remote state: ${state}`);
  const finalStatus = state === 'done' ? 'DONE' : 'RELEASED';
  const bound = normalizeBinding(binding);
  if (!bound) return makeResult('UNREGISTERED', { taskId, cfg, blocked: false, detail: 'local task has no remote registration' });
  const read = fetchAndRead(git, cfg, taskId);
  if (!read.ok) return makeResult('UNKNOWN', { taskId, cfg, blocked: false, detail: read.error });
  const current = read.record;
  if (!current || !holderMatches(current, bound, identity)) {
    return makeResult('NOT_HOLDER', {
      taskId, cfg, blocked: false, record: current,
      detail: 'remote registration belongs to another holder or epoch; left unchanged',
    });
  }
  if (current.state === state) return makeResult(finalStatus, { taskId, cfg, blocked: false, record: current });
  if (!ACTIVE_STATES.has(current.state)) {
    return makeResult('NOT_HOLDER', {
      taskId, cfg, blocked: false, record: current, detail: `remote registration is already ${current.state}; left unchanged`,
    });
  }
  const record = buildRecord({
    taskId, epoch: current.epoch, state, event: state === 'done' ? 'finish' : 'cancel', identity, cfg, now, previous: current,
    extra: { endedAt: isoAt(now) },
  });
  const written = writeRecord(git, cfg, taskId, record, read.sha, now);
  if (written.result !== 'ok') return writeFailure(written, { taskId, cfg, blocked: false });
  return makeResult(finalStatus, { taskId, cfg, blocked: false, record });
}

function remoteBindingOf(result, cfg) {
  if (!result || !['REGISTERED', 'ALREADY_HOLDER', 'TAKEN_OVER'].includes(result.status)) return null;
  return {
    ref: taskRemoteRef(result.taskId),
    remote: cfg.remote,
    epoch: result.epoch,
    machine_id: result.holder.machineId,
  };
}

// ---------------------------------------------------------------------------
// 输出

function formatHolder(holder) {
  if (!holder) return '';
  return `${safeText(holder.user) || '?'}@${safeText(holder.host) || '?'} (${safeText(holder.machineId, 64)})`;
}

function formatRemoteLines(result) {
  if (!result || result.status === 'DISABLED') return [];
  const lines = [`TASK_REMOTE_STATUS=${safeText(result.status, 40)}`];
  if (result.taskId) lines.push(`TASK_REMOTE_TASK=${safeText(result.taskId, 80)}`);
  if (result.ref) lines.push(`TASK_REMOTE_REF=${safeText(result.ref)}`);
  if (result.holder) lines.push(`TASK_REMOTE_HOLDER=${formatHolder(result.holder)}`);
  if (Number.isInteger(result.epoch)) lines.push(`TASK_REMOTE_EPOCH=${result.epoch}`);
  if (typeof result.stale === 'boolean') lines.push(`TASK_REMOTE_STALE=${result.stale}`);
  if (result.record && result.record.heartbeatAt) lines.push(`TASK_REMOTE_HEARTBEAT=${safeText(result.record.heartbeatAt, 40)}`);
  if (result.detail) lines.push(`TASK_REMOTE_DETAIL=${safeText(result.detail, 500)}`);
  const takeover = `pnpm agent -- task takeover --task ${safeText(result.taskId, 80)} --reason "<原因>"`;
  if (result.status === 'CONFLICT' || result.status === 'REQUIRES_FORCE') {
    lines.push(`TASK_REMOTE_NEXT=与持有者确认后执行 ${takeover}${result.stale ? '' : ' --force'}`);
  } else if (result.status === 'TASK_CLAIM_LOST') {
    lines.push('TASK_REMOTE_NEXT=本机已失去该任务的远端持有权：停止推送与合并，与当前持有者协调；确需收回时执行 '
      + `${takeover} --force`);
  } else if (result.status === 'UNREGISTERED') {
    lines.push(`TASK_REMOTE_NEXT=为本地任务补登记：${takeover}`);
  }
  return lines;
}

/**
 * tdd push / qa merge 远端门禁阻断时的唯一下一动作。按状态给出修复指引，
 * 从不建议手动创建 PR 或直接推送——那等于绕过多机持有者保护。
 */
function remoteNextAction(result) {
  const status = result && result.status;
  const taskId = safeText((result && result.taskId) || '<id>', 80);
  const takeover = `pnpm agent -- task takeover --task ${taskId} --reason "<原因>"`;
  switch (status) {
    case 'TASK_CLAIM_LOST':
      return `本机已失去该任务的远端持有权：停止推送与合并，与当前持有者协调；确需收回时执行 ${takeover} --force`;
    case 'UNREGISTERED':
      return `本地任务没有远端登记：先执行 ${takeover} 补登记，再重试`;
    case 'NO_TASK':
      return '当前 worktree/分支没有绑定活动任务：用 pnpm agent -- task start 登记，'
        + '再以 pnpm agent -- worktree new|resume --task <id> 绑定当前 worktree 后重试';
    case 'AMBIGUOUS':
      return '多个本地任务匹配当前 worktree/分支：用 pnpm agent -- task finish|cancel 收尾重复任务后重试';
    case 'UNKNOWN':
    case 'REJECTED':
      return '无法确认远端登记：检查远端可达性与 GH_TOKEN 后重试；不要绕过门禁手动推送或创建 PR';
    case 'CONFIG_ERROR':
      return '修正 agent.config.json 的 task.remote 配置后重试';
    case 'INVALID_BINDING':
      return `本地 state.json 的 remote 绑定损坏：核实远端持有者后执行 ${takeover}（未过期时加 --force）重新绑定`;
    case 'STATE_ERROR':
      return '本地任务状态不可读：修复 tmp/agent-task-runs 下的 state.json 后重试';
    case 'IDENTITY_ERROR':
      return '无法确定本机身份：设置 XIRANG_MACHINE_ID 或修复 ~/.xirang/machine-id 后重试';
    default:
      return '核实任务远端登记状态（pnpm agent -- task remote list）后重试';
  }
}

// ---------------------------------------------------------------------------
// tdd push / qa merge 门禁

function samePath(left, right) {
  return Boolean(left) && Boolean(right) && path.resolve(left) === path.resolve(right);
}

/**
 * 按当前 worktree 或分支精确匹配本地任务并断言远端持有者；不回退到项目内任意任务。
 * context 取自 agent-task 的 runtimeContext：{config, runsRoot, projectRoot, worktree, branch}。
 */
function enforceRemoteClaim({ context, listStates, gitFactory, identity, now = Date.now(), refresh = null } = {}) {
  const ctx = context || {};
  const cfg = resolveRemoteConfig(ctx.config);
  if (!cfg.enabled) return { status: 'DISABLED', blocked: false };
  if (cfg.error) return { status: 'CONFIG_ERROR', blocked: true, detail: cfg.error };

  let states;
  try {
    const list = listStates || require('./agent-task').listTaskStates;
    states = list({ runsRoot: ctx.runsRoot });
  } catch (error) {
    return { status: 'STATE_ERROR', blocked: true, detail: `cannot read local task states: ${error.message}` };
  }
  const matches = (states || []).filter((state) => state
    && samePath(state.project_root, ctx.projectRoot)
    && !TERMINAL_LOCAL_STATUSES.has(state.status)
    && (samePath(state.worktree, ctx.worktree) || (Boolean(ctx.branch) && state.branch === ctx.branch)));
  if (matches.length === 0) {
    return {
      status: 'NO_TASK',
      blocked: blockedByMode(cfg),
      detail: `no active local task is bound to worktree ${safeText(ctx.worktree)} or branch ${safeText(ctx.branch)}`,
    };
  }
  if (matches.length > 1) {
    return {
      status: 'AMBIGUOUS',
      blocked: true,
      detail: `multiple local tasks match this worktree/branch: ${matches.map((state) => state.task_id).join(', ')}`,
    };
  }
  const state = matches[0];

  let who = identity;
  if (!who) {
    try {
      who = resolveMachineIdentity();
    } catch (error) {
      return { status: 'IDENTITY_ERROR', blocked: true, taskId: state.task_id, detail: error.message };
    }
  }
  const git = (gitFactory || ((root) => createGitRunner({ repoRoot: root, cwd: root })))(ctx.worktree);
  return {
    ...assertRemoteHolder({ git, cfg, taskId: state.task_id, binding: state.remote || null, identity: who, now, refresh }),
    taskId: state.task_id,
  };
}

module.exports = {
  RECORD_SCHEMA,
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
};

'use strict';

// qa run 的进程控制：套件在独立进程组中运行，超时与中断都按组终止，不留孙进程。

const { spawn, spawnSync } = require('node:child_process');

const { createToolchainEnv } = require('../shared/toolchain-env');

const KILL_POLL_MS = 25;
const KILL_CONFIRM_MS = 2000;
const ORPHAN_SWEEP_ROUNDS = 3;
const PROCESS_TABLE_TIMEOUT_MS = 30000;
// 根进程启动时间取自 spawn 之前的 Date.now()，与系统记录的 CreationDate 之间留出少量计时误差。
const CREATION_SKEW_MS = 50;
const FORWARDED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const IS_WINDOWS = process.platform === 'win32';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code === 'ESRCH') return;
    try {
      process.kill(pid, signal);
    } catch {
      // 进程已经不在，或无权发送信号：交给后续的存活轮询与 SIGKILL 兜底。
    }
  }
}

function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

// Windows 没有进程组信号：taskkill /T /F 按父子关系强制结束整棵进程树。
// taskkill 失败（树已退出时也会报“找不到进程”）不抛出，交给 exit 事件收尾。
function killTreeWindows(pid) {
  const result = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  return !result.error;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

// 读取系统进程表（pid、父 pid、创建时间毫秒）。查询失败返回 null，由调用方放弃清扫而不是误杀。
function listProcessesWindows() {
  const script = 'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate | ForEach-Object { '
    + "if ($_.CreationDate) { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, "
    + '([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } }';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: PROCESS_TABLE_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.split(/\r?\n/u).map((line) => line.trim().split(/\s+/u).map(Number))
    .filter((fields) => fields.length === 3 && fields.every(Number.isFinite))
    .map(([pid, parentPid, createdAt]) => ({ pid, parentPid, createdAt }));
}

// taskkill /T 只能结束快照里已有的进程：父进程正在 CreateProcess 时被杀，新建的子进程会漏掉并成为孤儿
// （高负载下 cmd.exe 启动套件进程慢，超时恰好落在这一刻）。孤儿的父 pid 仍指向已退出的父进程，
// 所以在确认父进程退出后，按“父 pid 相同且创建于父进程存活期间”找出它们再按树终止。
// 时间窗口防止误杀复用了该 pid 的无关进程的子进程；逐层重复，覆盖孤儿自己也在创建子进程的情况。
async function sweepOrphansWindows(rootPid, rootStartedAt) {
  let roots = [{ pid: rootPid, startedAt: rootStartedAt }];
  for (let round = 0; round < ORPHAN_SWEEP_ROUNDS && roots.length > 0; round += 1) {
    for (const root of roots) {
      for (let deadline = Date.now() + KILL_CONFIRM_MS; processAlive(root.pid) && Date.now() < deadline;) await sleep(KILL_POLL_MS);
      root.endedBy = Date.now();
    }
    const table = listProcessesWindows();
    if (!table) return;
    const orphans = table.filter((entry) => roots.some((root) => entry.parentPid === root.pid
      && entry.createdAt >= root.startedAt - CREATION_SKEW_MS && entry.createdAt <= root.endedBy));
    for (const orphan of orphans) killTreeWindows(orphan.pid);
    roots = orphans.map((orphan) => ({ pid: orphan.pid, startedAt: orphan.createdAt }));
  }
}

// 先发 signal 并给 graceMs 的宽限，仍有成员存活再 SIGKILL，最后确认进程组已空。
// Windows 上 startedAt（根进程 spawn 前的时间）用于清扫 taskkill 竞态漏掉的孤儿。
async function terminateProcessGroup(pid, signal, graceMs, startedAt) {
  if (IS_WINDOWS) {
    killTreeWindows(pid);
    await sweepOrphansWindows(pid, startedAt);
    return;
  }
  signalGroup(pid, signal);
  for (let deadline = Date.now() + graceMs; groupAlive(pid) && Date.now() < deadline;) await sleep(KILL_POLL_MS);
  if (!groupAlive(pid)) return;
  signalGroup(pid, 'SIGKILL');
  for (let deadline = Date.now() + KILL_CONFIRM_MS; groupAlive(pid) && Date.now() < deadline;) await sleep(KILL_POLL_MS);
}

// controller 由调用方持有：current 是正在运行的套件的 { terminate, kill }，interrupted 记录首个收到的信号。
// 返回 { spawnError, timedOut, exitCode, signal, durationMs }；resolve 时该套件的进程组已经终止（超时或中断时）。
function runCommand({ command, cwd, env, shell, timeoutMs, killGraceMs, controller }) {
  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    const spawnedAtMs = Date.now();
    const observed = { spawnError: null, timedOut: false, exitCode: null, signal: null, durationMs: 0 };
    let child = null;
    let terminating = null;
    let timer = null;
    let done = false;

    const terminate = (signal) => {
      if (terminating || !child || child.pid === undefined) return;
      terminating = terminateProcessGroup(child.pid, signal, killGraceMs, spawnedAtMs);
    };
    // Windows 上 taskkill /F 强杀的进程以退出码 1 结束，看起来像套件自己失败；
    // 由本模块终止时改记为 POSIX 被信号终止的形态（exitCode=null），与其他平台的结果一致。
    const forcedOnWindows = () => IS_WINDOWS && terminating !== null;

    const complete = async () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      controller.current = null;
      if (terminating) await terminating;
      observed.durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      resolve(observed);
    };

    try {
      child = spawn(command, {
        cwd,
        env: createToolchainEnv(env),
        shell,
        detached: !IS_WINDOWS,
        stdio: ['ignore', 2, 2],
        windowsHide: true,
      });
    } catch (error) {
      observed.spawnError = error;
      complete();
      return;
    }

    child.once('error', (error) => {
      if (child.pid !== undefined) return;
      observed.spawnError = error;
      complete();
    });
    child.once('exit', (exitCode, signal) => {
      const forced = forcedOnWindows();
      observed.exitCode = forced ? null : exitCode;
      observed.signal = forced ? 'SIGKILL' : signal;
      complete();
    });
    controller.current = {
      terminate,
      kill: () => {
        if (child.pid === undefined) return;
        if (IS_WINDOWS) killTreeWindows(child.pid);
        else signalGroup(child.pid, 'SIGKILL');
      },
    };
    timer = setTimeout(() => {
      observed.timedOut = true;
      terminate('SIGTERM');
    }, timeoutMs);
  });
}

// 套件放在独立进程组后收不到终端的 Ctrl+C，必须由本进程转发：首个信号原样转给进程组，
// 再次收到同类信号则直接 SIGKILL。返回移除处理器的函数。
function installSignalHandlers(controller) {
  const handlers = FORWARDED_SIGNALS.map((signal) => {
    const handler = () => {
      const repeated = controller.interrupted !== null;
      controller.interrupted = controller.interrupted || signal;
      if (!controller.current) return;
      if (repeated) controller.current.kill();
      else controller.current.terminate(signal);
    };
    process.on(signal, handler);
    return [signal, handler];
  });
  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}

module.exports = { installSignalHandlers, runCommand, terminateProcessGroup };

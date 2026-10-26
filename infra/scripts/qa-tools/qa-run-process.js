'use strict';

// qa run 的进程控制：套件在独立进程组中运行，超时与中断都按组终止，不留孙进程。

const { spawn, spawnSync } = require('node:child_process');

const { createToolchainEnv } = require('../shared/toolchain-env');

const KILL_POLL_MS = 25;
const KILL_CONFIRM_MS = 2000;
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

// 先发 signal 并给 graceMs 的宽限，仍有成员存活再 SIGKILL，最后确认进程组已空。
async function terminateProcessGroup(pid, signal, graceMs) {
  if (IS_WINDOWS) {
    killTreeWindows(pid);
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
    const observed = { spawnError: null, timedOut: false, exitCode: null, signal: null, durationMs: 0 };
    let child = null;
    let terminating = null;
    let timer = null;
    let done = false;

    const terminate = (signal) => {
      if (terminating || !child || child.pid === undefined) return;
      terminating = terminateProcessGroup(child.pid, signal, killGraceMs);
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

module.exports = { installSignalHandlers, runCommand };

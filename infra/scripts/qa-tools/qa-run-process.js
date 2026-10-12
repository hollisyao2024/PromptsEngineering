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

// 先发 signal 并给 graceMs 的宽限，仍有成员存活再 SIGKILL，最后确认进程组已空。
async function terminateProcessGroup(pid, signal, graceMs) {
  if (IS_WINDOWS) {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
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
      observed.exitCode = exitCode;
      observed.signal = signal;
      complete();
    });
    controller.current = {
      terminate,
      kill: () => {
        if (!IS_WINDOWS && child.pid !== undefined) signalGroup(child.pid, 'SIGKILL');
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

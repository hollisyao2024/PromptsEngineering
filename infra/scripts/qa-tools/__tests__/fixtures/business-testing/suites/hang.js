'use strict';

// 桩套件：启动一个孙进程后一直挂起，用来验证超时与中断会终止整棵进程树。
// 用法：node hang.js <pid 文件> [ignore-term] [delay=<毫秒>]
// pid 文件写入两行：本进程 pid 与孙进程 pid。带 ignore-term 时本进程忽略 SIGTERM，
// 只有 SIGKILL 才能结束它，用来验证升级到强制终止的回退路径。
// 带 delay=<毫秒> 时推迟到该时间之后才启动孙进程并写出 pid 文件，用来确定性地复现“套件启动很慢”：
// 机器负载高时进程启动实测可能长达数十秒，依赖它“足够快”的测试会偶发失败。

const { spawn } = require('node:child_process');
const fs = require('node:fs');

const [pidFile, ...options] = process.argv.slice(2);
const delayOption = options.find((option) => option.startsWith('delay='));
const startupDelayMs = delayOption ? Number(delayOption.slice('delay='.length)) : 0;

if (options.includes('ignore-term')) process.on('SIGTERM', () => {});

function start() {
  const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  fs.writeFileSync(pidFile, `${process.pid}\n${grandchild.pid}\n`);
}

if (startupDelayMs > 0) setTimeout(start, startupDelayMs);
else start();
setInterval(() => {}, 1000);

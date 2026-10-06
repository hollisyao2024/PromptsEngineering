'use strict';

// 桩套件：启动一个孙进程后一直挂起，用来验证超时与中断会终止整棵进程树。
// 用法：node hang.js <pid 文件> [ignore-term]
// pid 文件写入两行：本进程 pid 与孙进程 pid。带 ignore-term 时本进程忽略 SIGTERM，
// 只有 SIGKILL 才能结束它，用来验证升级到强制终止的回退路径。

const { spawn } = require('node:child_process');
const fs = require('node:fs');

const [pidFile, mode] = process.argv.slice(2);

const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
if (mode === 'ignore-term') process.on('SIGTERM', () => {});
fs.writeFileSync(pidFile, `${process.pid}\n${grandchild.pid}\n`);
setInterval(() => {}, 1000);

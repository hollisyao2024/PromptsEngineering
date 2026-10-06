'use strict';

// 桩套件：把预置的 JUnit 报告复制到目标路径，并以指定退出码结束。
// 用法：node emit.js <标签> <源报告|-> <目标路径|-> <退出码> <标记文件> [探测路径]
// 启动时先向标记文件追加一行 JSON，证明本套件确实被启动，并记录当时的观察：
//   cwd            运行目录
//   pathFirst      PATH 的第一项
//   targetExisted  目标路径在启动时是否已存在（旧报告应已被删除）
//   probeExisted   探测路径在启动时是否已存在（用来观察旧报告或旧结果文件）

const fs = require('node:fs');
const path = require('node:path');

const [label, source, target, code, marker, probe] = process.argv.slice(2);

const started = {
  label,
  cwd: process.cwd(),
  pathFirst: (process.env.PATH || '').split(path.delimiter)[0],
  targetExisted: target !== '-' && fs.existsSync(target),
  probeExisted: probe ? fs.existsSync(probe) : null,
};
fs.appendFileSync(marker, `${JSON.stringify(started)}\n`);

if (source !== '-' && target !== '-') {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
process.exit(Number(code));

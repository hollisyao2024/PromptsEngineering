'use strict';

// 桩套件：每次启动按计数轮换一个预置变体，用来制造“多次运行结果不一致”。
// 用法：node alternate.js <计划文件> <目标路径> <标记文件>
// 计划文件为 JSON：{ "variants": [{ "source": "<源报告|->", "code": <退出码> }, ...] }。
// 计数保存在“<计划文件>.count”，第 k 次启动（从 0 起）使用 variants[k % n]；
// source 为 "-" 时不产出报告。启动时向标记文件追加一行 JSON，记录标签与所用变体序号。

const fs = require('node:fs');
const path = require('node:path');

const [planFile, target, marker] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const counterFile = `${planFile}.count`;
const count = fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, 'utf8')) : 0;
const index = count % plan.variants.length;
const variant = plan.variants[index];
fs.writeFileSync(counterFile, String(count + 1));
fs.appendFileSync(marker, `${JSON.stringify({ label: plan.label, variant: index })}\n`);

if (variant.source !== '-') {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(variant.source, target);
}
process.exit(Number(variant.code || 0));

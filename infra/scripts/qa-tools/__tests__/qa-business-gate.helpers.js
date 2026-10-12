'use strict';

// qa-business-gate 系列测试共用的场景构造、qa run 准备、门禁调用与断言辅助。
// 不含任何测试，由 qa-business-gate*.test.js 共享。

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { evaluateBusinessGate, formatBusinessGate } = require('../qa-business-gate');
const { IOS_CASES, WEB_CASES, createScenario } = require('./fixtures/business-testing/scenario');
const { pathsDocument, shopPaths } = require('./fixtures/business-testing/builders');

const PRD_FILE = 'docs/prd-modules/shop/PRD.md';
const PATHS_FILE = 'docs/qa-modules/shop/PATHS.md';
const HEAD_FOREIGN = 'f'.repeat(40);

const sha256Hex = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const codesOf = (records) => records.map((record) => record.code);
const blocksOf = (outcome, code) => outcome.blocks.filter((block) => block.code === code);
const show = (outcome) => formatBusinessGate(outcome).join('\n');

function scenarioFor(t, options) {
  const scenario = createScenario(options);
  t.after(() => scenario.cleanup());
  return scenario;
}

// 配置 web（及 ios）套件并运行 qa run；用例可替换，其余沿用基线。
function prepare(s, {
  web = WEB_CASES, webCode = 0, ios = IOS_CASES, iosCode = 0, extra = [], business = {},
} = {}) {
  const suites = [s.suite('web', { platform: 'web', cases: web, code: webCode })];
  if (ios) suites.push(s.suite('ios', { platform: 'ios', cases: ios, code: iosCode }));
  s.configure([...suites, ...extra], business);
  const result = s.run();
  assert.ok(fs.existsSync(s.resultsFile), `qa run 应写出结果文件：${result.stdout}${result.stderr}`);
  return result;
}

function evaluate(s, overrides = {}) {
  return evaluateBusinessGate({
    repoRoot: s.project.repo,
    mainRoot: s.project.repo,
    config: s.config(),
    headSha: s.head(),
    ...overrides,
  });
}

function symlinkOrSkip(t, target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath);
    return true;
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip('当前环境不允许创建符号链接');
      return false;
    }
    throw error;
  }
}

// 目录快照（不含 .git）：名称、类型、大小与修改时间，用来证明门禁没有写任何文件。
function snapshot(directory) {
  const entries = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current).sort()) {
      if (name === '.git') continue;
      const full = path.join(current, name);
      const stat = fs.lstatSync(full);
      entries.push(`${path.relative(directory, full)}|${stat.isDirectory() ? 'dir' : stat.size}|${stat.mtimeMs}`);
      if (stat.isDirectory()) walk(full);
    }
  };
  walk(directory);
  return entries;
}

const NO_CRITERION = { [PATHS_FILE]: pathsDocument(shopPaths((model) => { model.criterion = 'none'; })) };

module.exports = {
  HEAD_FOREIGN,
  NO_CRITERION,
  PATHS_FILE,
  PRD_FILE,
  blocksOf,
  codesOf,
  evaluate,
  prepare,
  scenarioFor,
  sha256Hex,
  show,
  snapshot,
  symlinkOrSkip,
};

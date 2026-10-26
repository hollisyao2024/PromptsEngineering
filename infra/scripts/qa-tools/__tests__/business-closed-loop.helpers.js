'use strict';

// 业务测试闭环测试的共享 helper：常量、qa run / qa verify 输出解析、场景前置，以及“变红 / 变绿”断言与破坏-恢复循环。
// 闭环测试的整体说明见 business-closed-loop.test.js 文件头。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runGit } = require('./fixtures/business-testing/builders');
const { IOS_CASES, WEB_CASES, createScenario } = require('./fixtures/business-testing/scenario');
const {
  attachOrigin,
  pushBranch,
  receiptPath,
  recordTestScope,
  runVerify,
} = require('./fixtures/business-testing/verify');

const PRD_FILE = 'docs/prd-modules/shop/PRD.md';
const PATHS_FILE = 'docs/qa-modules/shop/PATHS.md';
const CONFIG_FILE = 'agent.config.json';

// 回执在原有键集合之上追加 business 摘要（业务门禁通过时）、design 摘要（实际项目的测试设计门禁）、
// qa_verdict 与 no_module_reason（夹具以 --no-module 运行）；身份字段与 schema_version 不变。
const RECEIPT_KEYS = [
  'base_branch', 'base_sha', 'branch', 'business', 'design', 'head_sha', 'no_module_reason', 'qa_verdict', 'schema_version',
  'verdict', 'verified_at',
];

// 规模上限（ARCH §6 性能）：500 条 AC、2000 个用例，校验 + 绑定 + 判定不超过 5 秒（不含套件自身耗时）。
const BUDGET_MS = 5000;

// ---------------------------------------------------------------------------
// 共用工具
// ---------------------------------------------------------------------------

const output = (run) => `${run.stdout}${run.stderr}`;
const has = (run, pattern) => run.lines.some((line) => pattern.test(line));
const readReceiptFile = (s) => JSON.parse(fs.readFileSync(receiptPath(s), 'utf8'));
const gitStatus = (s) => runGit(s.project.repo, ['status', '--porcelain']);

function scenarioFor(t, options) {
  const scenario = createScenario(options);
  t.after(() => scenario.cleanup());
  return scenario;
}

// 改写 web 套件的预置报告：命令与配置都不变，下一次 qa run 复制到目标路径的就是新内容。
function rewriteWeb(s, cases) {
  s.suite('web', { platform: 'web', cases });
}

function runOk(s) {
  const run = s.run();
  assert.equal(run.status, 0, output(run));
  return run;
}

function configureBaseline(s, business = {}) {
  return s.configure([
    s.suite('web', { platform: 'web', cases: WEB_CASES }),
    s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
  ], business);
}

// 自定义套件的完整前置：与 readyForVerify 相同，但套件由调用方给出，并返回那次 qa run 的结果。
function readyWith(s, suites, business = {}, { env = {} } = {}) {
  attachOrigin(s);
  s.configure(suites, business);
  const run = s.run({ env });
  pushBranch(s);
  recordTestScope(s);
  return run;
}

// `qa run` 的 `NAME=value` 行。
function counter(run, name) {
  const line = run.stdout.split('\n').find((item) => item.startsWith(`${name}=`));
  return line === undefined ? undefined : line.slice(name.length + 1);
}

function filesUnder(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(full));
    else found.push(full);
  }
  return found;
}

// `BUSINESS_BLOCK=<code>|<subject>|<detail>`：detail 里还可能有竖线，只切前两段。
function blocksOf(run) {
  return run.lines
    .filter((line) => line.startsWith('BUSINESS_BLOCK='))
    .map((line) => {
      const [code, subject, ...detail] = line.slice('BUSINESS_BLOCK='.length).split('|');
      return { code, subject, detail: detail.join('|') };
    });
}

const sameSubject = (actual, wanted) => (wanted instanceof RegExp ? wanted.test(actual) : actual === wanted);

// 变红：非零退出、BLOCKED、包含期望的 code+subject、没有无关的阻断码、给出下一步、不签发回执（也不留旧回执）。
// allow 列出可以同时出现的伴随阻断码（例如失败的用例同时让路径覆盖出现缺口）。
function assertRed(s, run, expected, { allow = [] } = {}) {
  assert.equal(run.status, 1, output(run));
  assert.ok(run.lines.includes('BUSINESS_GATE=BLOCKED'), run.text);
  const blocks = blocksOf(run);
  for (const wanted of expected) {
    const found = blocks.find((item) => item.code === wanted.code && sameSubject(item.subject, wanted.subject));
    assert.ok(found, `门禁应阻断 ${wanted.code}|${wanted.subject}：\n${run.text}`);
    if (wanted.detail) assert.match(found.detail, wanted.detail);
  }
  const permitted = new Set([...expected.map((wanted) => wanted.code), ...allow]);
  assert.deepEqual(blocks.filter((item) => !permitted.has(item.code)), [], `出现了与本次破坏无关的阻断：\n${run.text}`);
  assert.ok(has(run, /^BUSINESS_NEXT_ACTION=\S/u), run.text);
  assert.match(run.text, /回执未签发/u);
  assert.equal(has(run, /^QA_RECEIPT=/u), false, run.text);
  assert.equal(fs.existsSync(receiptPath(s)), false, '被阻断时不得留下回执');
  return blocks;
}

// 变绿：退出 0、PASS、没有阻断、回执按当前 HEAD 签发。
function assertGreen(s, run) {
  assert.equal(run.status, 0, output(run));
  assert.ok(run.lines.includes('BUSINESS_GATE=PASS'), run.text);
  assert.equal(has(run, /^BUSINESS_(BLOCK|NEXT_ACTION)=/u), false, run.text);
  assert.ok(has(run, /^QA_RECEIPT=/u), run.text);
  const receipt = readReceiptFile(s);
  assert.equal(receipt.verdict, 'passed');
  assert.equal(receipt.head_sha, s.head());
}

// 一次“破坏 → 变红 → 恢复 → 变绿”的循环；恢复放在 finally 里，红色断言失败时也不会把后续循环带进脏状态。
async function cycleOf(t, s, observed, name, { breakIt, expect, allow = [], recover }) {
  await t.test(name, () => {
    try {
      breakIt();
      for (const item of assertRed(s, runVerify(s), expect, { allow })) observed.add(item.code);
    } finally {
      recover();
    }
    assertGreen(s, runVerify(s));
  });
}

module.exports = {
  PRD_FILE,
  PATHS_FILE,
  CONFIG_FILE,
  RECEIPT_KEYS,
  BUDGET_MS,
  output,
  has,
  readReceiptFile,
  gitStatus,
  scenarioFor,
  rewriteWeb,
  runOk,
  configureBaseline,
  readyWith,
  counter,
  filesUnder,
  blocksOf,
  assertRed,
  assertGreen,
  cycleOf,
};

'use strict';

// `qa verify` 接入业务验收门禁的端到端测试：真实的 `qa run` 写出结果，真实的 `qa verify`
// （cwd 为场景仓库）读取并判定，回执由生产代码签发或拒发；测试只构造场景、读取输出与回执。
// 未启用时保留既有门禁与回执行为；输出基线包含统一 CLI 结果块。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { SHOP_ACS, commitAll } = require('./fixtures/business-testing/builders');
const {
  WEB_CASES,
  createScenario,
  withStatus,
} = require('./fixtures/business-testing/scenario');
const {
  advanceHead,
  attachOrigin,
  pushBranch,
  readyForVerify,
  receiptPath,
  recordTestScope,
  runVerify,
} = require('./fixtures/business-testing/verify');

// 现行 `qa verify` 在业务门禁关闭时的完整输出（临时目录、回执名与提交号换成占位符）。
const GOLDEN_DISABLED = [
  '============================================================',
  'QA 验收检查工具 v1.1.0',
  '============================================================',
  '\u{1F9ED} 作用域：session（仅会话相关 QA 变更）',
  'ℹ️ 未识别到当前会话 QA 目标（no-op）。',
  'TEST_SCOPE_TASK=accept-check TEST_SCOPE_MODE=targeted',
  'QA_RECEIPT=<ROOT>/tmp/qa-verification-receipts/<KEY>.json',
  'BASE_BRANCH=main',
  'BASE_SHA=<SHA>',
  'HEAD_SHA=<SHA>',
  'STATUS=OK',
  'SUMMARY=QA 验收通过并签发回执 <ROOT>/tmp/qa-verification-receipts/<KEY>.json（BASE_SHA=<SHA> HEAD_SHA=<SHA>）',
  'NEXT_ACTION=执行 pnpm agent -- qa merge',
];

// 未启用业务门禁时回执结构不得变化：键集合固定；启用且通过后只多一个 business 摘要键。
const RECEIPT_KEYS = ['base_branch', 'base_sha', 'branch', 'head_sha', 'schema_version', 'verdict', 'verified_at'];
const BUSINESS_RECEIPT_KEYS = [...RECEIPT_KEYS, 'business'].sort();

function scenarioFor(t) {
  const scenario = createScenario();
  t.after(() => scenario.cleanup());
  return scenario;
}

function normalize(s, lines) {
  const roots = [...new Set([s.project.root, fs.realpathSync(s.project.root)])].sort((a, b) => b.length - a.length);
  return lines.map((line) => {
    let text = line;
    for (const root of roots) text = text.split(root).join('<ROOT>');
    return text
      .replace(/\\/gu, '/')
      .replace(/(qa-verification-receipts\/)[0-9a-f]{20}\.json/u, '$1<KEY>.json')
      .replace(/\b[0-9a-f]{40}\b/gu, '<SHA>');
  });
}

const output = (run) => `${run.stdout}${run.stderr}`;
const has = (run, pattern) => run.lines.some((line) => pattern.test(line));
const indexOfLine = (run, prefix) => run.lines.findIndex((line) => line.startsWith(prefix));
const readReceiptFile = (s) => JSON.parse(fs.readFileSync(receiptPath(s), 'utf8'));

// ---------------------------------------------------------------------------
// 默认关闭，行为不变
// ---------------------------------------------------------------------------

test('qa.business 默认关闭时 qa verify 的输出、退出码与回执同接入前一致，且不碰结果目录', (t) => {
  const s = scenarioFor(t);
  attachOrigin(s);
  pushBranch(s);
  recordTestScope(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 0, output(verify));
  assert.deepEqual(normalize(s, verify.lines), GOLDEN_DISABLED);
  assert.equal(verify.text.includes('BUSINESS_'), false);
  assert.equal(fs.existsSync(s.resultsDir), false);

  const receipt = readReceiptFile(s);
  assert.deepEqual(Object.keys(receipt).sort(), RECEIPT_KEYS);
  assert.equal(receipt.verdict, 'passed');
  assert.equal(receipt.head_sha, s.head());
});

test('enabled 为 false 时即使套件已配置、结果文件已损坏，qa verify 也同接入前一致', (t) => {
  const s = scenarioFor(t);
  readyForVerify(s, { business: { enabled: false }, run: false });
  const corrupt = '损坏的结果文件，未启用时不得被读取';
  fs.mkdirSync(s.resultsDir, { recursive: true });
  fs.writeFileSync(s.resultsFile, corrupt);

  const verify = runVerify(s);
  assert.equal(verify.status, 0, output(verify));
  assert.deepEqual(normalize(s, verify.lines), GOLDEN_DISABLED);
  assert.equal(fs.readFileSync(s.resultsFile, 'utf8'), corrupt);
  assert.deepEqual(Object.keys(readReceiptFile(s)).sort(), RECEIPT_KEYS);
});

test('模板源仓库不运行业务验收门禁，即使 qa.business 已启用', (t) => {
  const s = scenarioFor(t);
  attachOrigin(s);
  const config = {
    template: { role: 'source' },
    qa: { business: { enabled: true, suites: [s.suite('web', { platform: 'web', cases: WEB_CASES })] } },
  };
  s.project.write({ 'agent.config.json': `${JSON.stringify(config, null, 2)}\n` });
  commitAll(s.project.repo, 'template source with business testing enabled');
  pushBranch(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 0, output(verify));
  assert.match(verify.text, /模板源仓库：跳过业务 PRD\/QA 验收门禁。/u);
  assert.equal(verify.text.includes('BUSINESS_'), false);
  assert.ok(fs.existsSync(receiptPath(s)));
  assert.deepEqual(Object.keys(readReceiptFile(s)).sort(), RECEIPT_KEYS, '门禁没有运行，回执不得声称业务验收通过');
});

test('qa verify --help 说明业务验收门禁由 qa.business 控制', (t) => {
  const s = scenarioFor(t);
  const help = runVerify(s, { args: ['--help'] });

  assert.equal(help.status, 0, output(help));
  assert.match(help.text, /qa\.business/u);
  assert.match(help.text, /qa run/u);
});

// ---------------------------------------------------------------------------
// 启用后必需 AC 未被证明即阻断
// ---------------------------------------------------------------------------

test('启用后必需 AC 都被证明时 qa verify 放行：先打印门禁与风险披露，再签发回执', (t) => {
  const s = scenarioFor(t);
  readyForVerify(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 0, output(verify));
  assert.ok(verify.lines.includes('BUSINESS_GATE=PASS'), verify.text);
  assert.match(verify.lines[indexOfLine(verify, 'BUSINESS_SUMMARY=')] || '', /^BUSINESS_SUMMARY=业务验收通过/u);
  assert.ok(has(verify, /^BUSINESS_RISK=RISK_MANUAL_AC\|.*AC-SHOP-002-01/u), verify.text);
  assert.equal(has(verify, /^BUSINESS_(BLOCK|NEXT_ACTION)=/u), false, verify.text);

  // 顺序：既有的测试范围校验 → 业务门禁 → 回执。
  assert.ok(indexOfLine(verify, 'TEST_SCOPE_TASK=') >= 0, verify.text);
  assert.ok(indexOfLine(verify, 'TEST_SCOPE_TASK=') < indexOfLine(verify, 'BUSINESS_GATE='), verify.text);
  assert.ok(indexOfLine(verify, 'BUSINESS_GATE=') < indexOfLine(verify, 'QA_RECEIPT='), verify.text);

  const receipt = readReceiptFile(s);
  assert.deepEqual(Object.keys(receipt).sort(), BUSINESS_RECEIPT_KEYS);
  assert.equal(receipt.schema_version, 1, '摘要是追加字段，回执版本不变');
  assert.equal(receipt.verdict, 'passed');
  assert.equal(receipt.head_sha, s.head());

  // 回执里的业务摘要与刚打印的门禁输出、qa run 写下的结果一致：必需优先级、已证明的自动化 AC 条数、披露风险数、配置摘要。
  const proven = SHOP_ACS.filter((ac) => ac.priority === 'P0' && ac.verification === 'auto').length;
  assert.deepEqual(receipt.business, {
    gate: 'PASS',
    required_priorities: ['P0'],
    acs_proven: proven,
    risk_count: verify.lines.filter((line) => line.startsWith('BUSINESS_RISK=')).length,
    config_digest: JSON.parse(fs.readFileSync(s.resultsFile, 'utf8')).config_digest,
  });
  assert.match(verify.lines[indexOfLine(verify, 'BUSINESS_SUMMARY=')], new RegExp(`${proven} 条`, 'u'));
});

test('启用后 P0 AC 的用例失败时 qa verify 阻断：列出该 AC、非零退出、不签发回执', (t) => {
  const s = scenarioFor(t);
  readyForVerify(s, { web: withStatus(WEB_CASES, 'TC-SHOP-002', 'failed') });

  const verify = runVerify(s);
  assert.equal(verify.status, 1, output(verify));
  assert.ok(verify.lines.includes('BUSINESS_GATE=BLOCKED'), verify.text);
  assert.ok(has(verify, /^BUSINESS_BLOCK=AC_NOT_PROVEN\|AC-SHOP-001-02\|/u), verify.text);
  assert.ok(has(verify, /^BUSINESS_NEXT_ACTION=\S/u), verify.text);
  assert.match(verify.text, /回执未签发/u);
  assert.equal(has(verify, /^QA_RECEIPT=/u), false, verify.text);
  assert.equal(fs.existsSync(receiptPath(s)), false);
});

// ---------------------------------------------------------------------------
// 结果缺失、陈旧或被改动
// ---------------------------------------------------------------------------

test('启用后没有结果文件时 qa verify 阻断，并提示先运行 qa run', (t) => {
  const s = scenarioFor(t);
  readyForVerify(s, { run: false });

  const verify = runVerify(s);
  assert.equal(verify.status, 1, output(verify));
  assert.ok(has(verify, /^BUSINESS_BLOCK=RESULTS_MISSING\|/u), verify.text);
  assert.match(verify.text, /^BUSINESS_NEXT_ACTION=.*pnpm agent -- qa run/mu);
  assert.equal(fs.existsSync(receiptPath(s)), false);
});

test('结果之后又有新提交时 qa verify 阻断（RESULTS_STALE_HEAD），重新运行 qa run 后放行', (t) => {
  const s = scenarioFor(t);
  readyForVerify(s);
  advanceHead(s);

  const stale = runVerify(s);
  assert.equal(stale.status, 1, output(stale));
  assert.ok(has(stale, /^BUSINESS_BLOCK=RESULTS_STALE_HEAD\|/u), stale.text);
  assert.equal(fs.existsSync(receiptPath(s)), false);

  const rerun = s.run();
  assert.equal(rerun.status, 0, output(rerun));
  const fresh = runVerify(s);
  assert.equal(fresh.status, 0, output(fresh));
  assert.ok(fresh.lines.includes('BUSINESS_GATE=PASS'), fresh.text);
  assert.equal(readReceiptFile(s).head_sha, s.head());
});

test('报告副本被改动时 qa verify 阻断（REPORT_TAMPERED），此前签发的回执随之失效', (t) => {
  const s = scenarioFor(t);
  readyForVerify(s);

  const first = runVerify(s);
  assert.equal(first.status, 0, output(first));
  assert.ok(fs.existsSync(receiptPath(s)));

  fs.appendFileSync(s.copyFile('web'), '\n<!-- 事后追加 -->\n');
  const second = runVerify(s);
  assert.equal(second.status, 1, output(second));
  assert.ok(has(second, /^BUSINESS_BLOCK=REPORT_TAMPERED\|/u), second.text);
  assert.equal(fs.existsSync(receiptPath(s)), false);
});

// ---------------------------------------------------------------------------
// 配置不可信时失败即关闭
// ---------------------------------------------------------------------------

test('enabled 不是布尔值时 qa verify 按启用处理并阻断（CONFIG_INVALID）', (t) => {
  const s = scenarioFor(t);
  readyForVerify(s, { business: { enabled: 'false' }, run: false });

  const verify = runVerify(s);
  assert.equal(verify.status, 1, output(verify));
  assert.ok(has(verify, /^BUSINESS_BLOCK=CONFIG_INVALID\|qa\.business\.enabled\|/u), verify.text);
  assert.equal(fs.existsSync(receiptPath(s)), false);
});

test('开关键拼错（enable）时 qa verify 按启用处理并阻断（CONFIG_INVALID），不会悄悄跳过门禁并签发回执', (t) => {
  const s = scenarioFor(t);
  // 项目配置里只有拼错的 enable、没有 enabled（JSON 序列化会丢弃 undefined）；加载配置时模板默认值把 enabled 补成 false。
  readyForVerify(s, { business: { enabled: undefined, enable: true }, run: false });

  const verify = runVerify(s);
  assert.equal(verify.status, 1, output(verify));
  assert.ok(has(verify, /^BUSINESS_BLOCK=CONFIG_INVALID\|qa\.business\.enable\|/u), verify.text);
  assert.equal(fs.existsSync(receiptPath(s)), false);
});

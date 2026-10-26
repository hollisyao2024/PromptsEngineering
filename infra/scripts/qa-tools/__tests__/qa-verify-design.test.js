'use strict';

// `qa verify` 接入测试设计门禁（qa.design）的端到端测试：真实 git 场景 + 真实 qa run 结果 + 真实 qa verify CLI。
// 预期值来自 PR3 验收口径：warn 只记风险、enforce 阻断且不签发回执、模板源跳过、未知配置键 fail-closed，
// 回执携带 design 摘要（门禁、模式、规则与反例计数、隔离方式）。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { commitAll } = require('./fixtures/business-testing/builders');
const { IOS_CASES, WEB_CASES, createScenario } = require('./fixtures/business-testing/scenario');
const {
  attachOrigin,
  pushBranch,
  receiptPath,
  recordTestScope,
  runVerify,
} = require('./fixtures/business-testing/verify');
const { designDoc } = require('./qa-design.helpers');

const output = (run) => `${run.stdout}${run.stderr}`;
const has = (run, pattern) => run.lines.some((line) => pattern.test(line));
const indexOfLine = (run, prefix) => run.lines.findIndex((line) => line.startsWith(prefix));
const readReceiptFile = (s) => JSON.parse(fs.readFileSync(receiptPath(s), 'utf8'));

function scenarioFor(t) {
  const scenario = createScenario();
  t.after(() => scenario.cleanup());
  return scenario;
}

function writeConfig(s, config) {
  s.project.write({ 'agent.config.json': `${JSON.stringify(config, null, 2)}\n` });
}

// 写入配置后提交、推送，并记录绑定当前 HEAD 的测试范围证据（qa verify 先过范围校验，才轮到设计门禁）。
function commitConfigAndPrepare(s, config) {
  attachOrigin(s);
  writeConfig(s, config);
  commitAll(s.project.repo, 'configure qa design gate');
  pushBranch(s);
  recordTestScope(s);
}

// shop 域合规设计：三条 P0 规则分别以三条 P0 AC 为出处；AC-SHOP-002-01 在 PRD 中为人工验收，对应规则同为 manual。
// 必需维度只要求 boundary：RUL-SHOP-001 有可证明的反例，另两条写“不适用：理由”。
const SHOP_DESIGN = {
  rules: [
    ['RUL-SHOP-001', 'rule', '结算后进入支付页', 'AC-SHOP-001-01', 'P0', 'example', 'TC-SHOP-001'],
    ['RUL-SHOP-002', 'post', '有效卡号支付成功', 'AC-SHOP-001-02', 'P0', 'example', 'TC-SHOP-002'],
    ['RUL-SHOP-003', 'rule', '人工复核订单', 'AC-SHOP-002-01', 'P0', 'manual', '-'],
  ],
  advs: [
    ['ADV-SHOP-001', 'RUL-SHOP-001', 'boundary', '银行拒绝扣款', '提示失败并可重试', 'TC-SHOP-003'],
    ['ADV-SHOP-002', 'RUL-SHOP-002', 'boundary', '不适用：金额由上游订单锁定', '-', '-'],
    ['ADV-SHOP-003', 'RUL-SHOP-003', 'boundary', '不适用：人工验收项', '-', '-'],
  ],
};

// 改动 docs/qa-modules/shop/ 会让 qa verify 按 session diff 推断出 shop 模块并校验其 QA.md（既有语义），
// 因此写入 TEST-DESIGN 的用例同时提供一份合规 QA.md，使阻断与放行只取决于设计门禁。
const SHOP_QA_DOC = '# QA\n\n## 用例\n\n- US-SHOP-001 -> TC-SHOP-001\n- US-SHOP-002 -> TC-SHOP-002\n';

test('默认 warn：缺少 TEST-DESIGN 只记 DESIGN_RISK，照常签发回执并写入 design 摘要', (t) => {
  const s = scenarioFor(t);
  attachOrigin(s);
  pushBranch(s);
  recordTestScope(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 0, output(verify));
  assert.ok(verify.lines.includes('DESIGN_GATE=PASS_WITH_RISK MODE=warn DOCS=0'), verify.text);
  assert.ok(has(verify, /^DESIGN_RISK=DESIGN_ABSENT\|shop\|/u), verify.text);
  assert.equal(has(verify, /^DESIGN_BLOCK=/u), false, verify.text);
  assert.ok(verify.lines.includes('QA_VERDICT=PASS_WITH_RISK'), verify.text);

  // 顺序：测试范围校验 → 设计门禁 → 裁决与回执。
  assert.ok(indexOfLine(verify, 'TEST_SCOPE_TASK=') >= 0, verify.text);
  assert.ok(indexOfLine(verify, 'TEST_SCOPE_TASK=') < indexOfLine(verify, 'DESIGN_GATE='), verify.text);
  assert.ok(indexOfLine(verify, 'DESIGN_GATE=') < indexOfLine(verify, 'QA_VERDICT='), verify.text);

  assert.deepEqual(readReceiptFile(s).design, {
    gate: 'PASS_WITH_RISK',
    mode: 'warn',
    docs: 0,
    rules_total: 0,
    rules_verified: 0,
    adv_covered: '0/0',
    amendments: 0,
    isolation: 'NONE',
    risk_count: 1,
  });
});

test('enforce：缺少 TEST-DESIGN 即 DESIGN_GATE_BLOCKED，退出码 1 且不签发回执', (t) => {
  const s = scenarioFor(t);
  commitConfigAndPrepare(s, { qa: { design: { mode: 'enforce' } } });

  const verify = runVerify(s);
  assert.equal(verify.status, 1, output(verify));
  assert.ok(verify.lines.includes('DESIGN_GATE=BLOCKED MODE=enforce DOCS=0'), verify.text);
  assert.ok(has(verify, /^DESIGN_BLOCK=DESIGN_ABSENT\|shop\|/u), verify.text);
  assert.ok(has(verify, /^QA_VERIFY_BLOCK=DESIGN_GATE_BLOCKED\|/u), verify.text);
  assert.ok(verify.lines.includes('STATUS=BLOCKED'), verify.text);
  assert.ok(has(verify, /^NEXT_ACTION=.*qa design amend/u), verify.text);
  assert.equal(fs.existsSync(receiptPath(s)), false, '设计门禁阻断时不得签发回执');
});

test('enforce：合规设计且 TC 被 qa run 证明通过时放行，回执记录规则与反例计数', (t) => {
  const s = scenarioFor(t);
  attachOrigin(s);
  writeConfig(s, {
    qa: {
      business: {
        enabled: true,
        suites: [
          s.suite('web', { platform: 'web', cases: WEB_CASES }),
          s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
        ],
      },
      design: { mode: 'enforce', requiredDimensions: ['boundary'] },
    },
  });
  s.project.write({
    'docs/qa-modules/shop/QA.md': SHOP_QA_DOC,
    'docs/qa-modules/shop/TEST-DESIGN.md': designDoc(SHOP_DESIGN),
  });
  commitAll(s.project.repo, 'test(design): shop rules before implementation');
  const run = s.run();
  assert.ok(fs.existsSync(s.resultsFile), `qa run 应写出结果文件：${run.stdout}${run.stderr}`);
  pushBranch(s);
  recordTestScope(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 0, output(verify));
  assert.equal(has(verify, /^DESIGN_BLOCK=/u), false, verify.text);
  // 人工验证的必需规则不计入 RULES_VERIFIED，只记风险，因此门禁为 PASS_WITH_RISK。
  assert.ok(verify.lines.includes('DESIGN_GATE=PASS_WITH_RISK MODE=enforce DOCS=1'), verify.text);
  assert.ok(verify.lines.includes('RULES_TOTAL=3'), verify.text);
  assert.ok(verify.lines.includes('RULES_VERIFIED=2'), verify.text);
  assert.ok(verify.lines.includes('ADV_COVERED=3/3'), verify.text);
  assert.ok(verify.lines.includes('DESIGN_ISOLATION=subagent'), verify.text);
  assert.ok(has(verify, /^DESIGN_RISK=DESIGN_MANUAL\|RUL-SHOP-003\|/u), verify.text);
  assert.ok(indexOfLine(verify, 'BUSINESS_GATE=') < indexOfLine(verify, 'DESIGN_GATE='), verify.text);

  const receipt = readReceiptFile(s);
  assert.equal(receipt.design.gate, 'PASS_WITH_RISK');
  assert.equal(receipt.design.mode, 'enforce');
  assert.equal(receipt.design.docs, 1);
  assert.equal(receipt.design.rules_total, 3);
  assert.equal(receipt.design.rules_verified, 2);
  assert.equal(receipt.design.adv_covered, '3/3');
  assert.equal(receipt.design.isolation, 'subagent');
});

test('enforce：必需规则的 TC 在 qa run 结果中未通过即阻断', (t) => {
  const s = scenarioFor(t);
  attachOrigin(s);
  writeConfig(s, {
    qa: {
      business: {
        enabled: true,
        suites: [
          s.suite('web', { platform: 'web', cases: WEB_CASES }),
          s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
        ],
      },
      design: { mode: 'enforce', requiredDimensions: [] },
    },
  });
  // TC-SHOP-099 不在任何套件里：qa run 结果中只能是 missing。
  const unproven = {
    rules: [
      ['RUL-SHOP-001', 'rule', '结算后进入支付页', 'AC-SHOP-001-01', 'P0', 'example', 'TC-SHOP-099'],
      ['RUL-SHOP-002', 'post', '有效卡号支付成功', 'AC-SHOP-001-02', 'P0', 'example', 'TC-SHOP-002'],
      ['RUL-SHOP-003', 'rule', '人工复核订单', 'AC-SHOP-002-01', 'P0', 'manual', '-'],
    ],
  };
  s.project.write({
    'docs/qa-modules/shop/QA.md': SHOP_QA_DOC,
    'docs/qa-modules/shop/TEST-DESIGN.md': designDoc(unproven),
  });
  commitAll(s.project.repo, 'test(design): shop rules');
  s.run();
  pushBranch(s);
  recordTestScope(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 1, output(verify));
  assert.ok(has(verify, /^DESIGN_BLOCK=DESIGN_TC_UNPROVEN\|RUL-SHOP-001\|.*TC-SHOP-099/u), verify.text);
  const blocks = verify.lines.filter((line) => line.startsWith('QA_VERIFY_BLOCK='));
  assert.deepEqual(blocks.map((line) => line.split('|')[0]), ['QA_VERIFY_BLOCK=DESIGN_GATE_BLOCKED'], verify.text);
  assert.equal(fs.existsSync(receiptPath(s)), false);
});

test('模板源仓库跳过测试设计门禁：输出 DESIGN_GATE=SKIPPED，回执不含 design', (t) => {
  const s = scenarioFor(t);
  commitConfigAndPrepare(s, { template: { role: 'source' }, qa: { design: { mode: 'enforce' } } });

  const verify = runVerify(s);
  assert.equal(verify.status, 0, output(verify));
  assert.ok(verify.lines.includes('DESIGN_GATE=SKIPPED'), verify.text);
  assert.equal(has(verify, /^DESIGN_(BLOCK|RISK)=/u), false, verify.text);
  assert.equal(Object.hasOwn(readReceiptFile(s), 'design'), false, '门禁没有运行，回执不得携带 design 摘要');
});

test('qa.design 出现未知配置键时 fail-closed：DESIGN_CONFIG_INVALID 且不签发回执', (t) => {
  const s = scenarioFor(t);
  commitConfigAndPrepare(s, { qa: { design: { bogus: true } } });

  const verify = runVerify(s);
  assert.equal(verify.status, 1, output(verify));
  assert.ok(has(verify, /^QA_VERIFY_BLOCK=DESIGN_CONFIG_INVALID\|.*qa\.design\.bogus/u), verify.text);
  assert.ok(verify.lines.includes('STATUS=BLOCKED'), verify.text);
  assert.equal(fs.existsSync(receiptPath(s)), false);
});

test('qa verify --help 说明测试设计门禁由 qa.design 控制', (t) => {
  const s = scenarioFor(t);
  const help = runVerify(s, { args: ['--help'] });
  assert.equal(help.status, 0, output(help));
  assert.match(help.text, /qa\.design/u);
  assert.match(help.text, /DESIGN_BLOCK/u);
});

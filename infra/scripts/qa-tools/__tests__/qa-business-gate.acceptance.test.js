'use strict';

// 业务验收门禁（qa verify 的业务测试段）的判定测试：优先级、多端、路径覆盖与其余风险披露。
// 结果文件由真实的 `qa run` 针对桩套件生成，门禁读到的因此是生产代码写出的数据；各用例再改动仓库、
// 结果文件或报告副本来制造“陈旧、被改动、失败、缺失”等状态，核对门禁给出的阻断代码、披露项与判定顺序。

const test = require('node:test');
const assert = require('node:assert/strict');

const { IOS_CASES, WEB_CASES, withStatus } = require('./fixtures/business-testing/scenario');
const { SHOP_ACS, pathsDocument, prdDocument, shopPaths } = require('./fixtures/business-testing/builders');
const {
  NO_CRITERION,
  PATHS_FILE,
  PRD_FILE,
  blocksOf,
  codesOf,
  evaluate,
  prepare,
  scenarioFor,
  show,
} = require('./qa-business-gate.helpers');

// ---------------------------------------------------------------------------
// 优先级
// ---------------------------------------------------------------------------

test('低于必需优先级的自动化 AC 未通过只披露为 RISK_LOWER_PRIORITY', (t) => {
  const s = scenarioFor(t, { files: NO_CRITERION });
  prepare(s, { web: withStatus(WEB_CASES, 'AC-SHOP-001-03', 'failed') });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'PASS', show(outcome));
  assert.deepEqual(codesOf(outcome.risks), ['RISK_MANUAL_AC', 'RISK_LOWER_PRIORITY']);
  const risk = outcome.risks.find((item) => item.code === 'RISK_LOWER_PRIORITY');
  assert.match(risk.detail, /AC-SHOP-001-03/u);
  assert.match(risk.detail, /failed/u);
});

test('必需优先级可配置，加入 P1 后该 AC 未通过即阻断', (t) => {
  const s = scenarioFor(t, { files: NO_CRITERION });
  prepare(s, { web: withStatus(WEB_CASES, 'AC-SHOP-001-03', 'failed'), business: { requiredPriorities: ['P0', 'P1'] } });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['AC_NOT_PROVEN']);
  assert.equal(outcome.blocks[0].subject, 'AC-SHOP-001-03');
  assert.match(outcome.blocks[0].detail, /^P1 failed: /u);
  assert.equal(codesOf(outcome.risks).includes('RISK_LOWER_PRIORITY'), false);
});

test('验证方式为 manual 的 AC 只在必需优先级内披露为 RISK_MANUAL_AC', (t) => {
  const manualP1 = {
    id: 'AC-SHOP-002-02', story: 'US-SHOP-002', priority: 'P1', verification: 'manual', platform: '-',
    given: '用户在设置页', when: '切换语言', then: '文案经运营确认', tc: '-',
  };
  const files = { [PRD_FILE]: prdDocument([...SHOP_ACS, manualP1]) };

  const defaults = scenarioFor(t, { files });
  prepare(defaults);
  const onlyP0 = evaluate(defaults);
  assert.equal(onlyP0.status, 'PASS', show(onlyP0));
  const manualP0 = onlyP0.risks.find((risk) => risk.code === 'RISK_MANUAL_AC');
  assert.match(manualP0.detail, /AC-SHOP-002-01/u);
  assert.doesNotMatch(manualP0.detail, /AC-SHOP-002-02/u);

  const widened = scenarioFor(t, { files });
  prepare(widened, { business: { requiredPriorities: ['P0', 'P1'] } });
  const both = evaluate(widened);
  assert.equal(both.status, 'PASS', show(both));
  const manualBoth = both.risks.find((risk) => risk.code === 'RISK_MANUAL_AC');
  assert.match(manualBoth.detail, /AC-SHOP-002-01/u);
  assert.match(manualBoth.detail, /AC-SHOP-002-02/u);

  // 业务摘要随必需优先级变化：条数只数必需优先级内的自动化 AC，manual 的不算已证明。
  assert.deepEqual(onlyP0.requiredPriorities, ['P0']);
  assert.equal(onlyP0.provenCount, 2);
  assert.deepEqual(both.requiredPriorities, ['P0', 'P1']);
  assert.equal(both.provenCount, 3);
  assert.equal(both.riskCount, both.risks.length);
});

// ---------------------------------------------------------------------------
// 多端
// ---------------------------------------------------------------------------

test('声明的端没有任何套件提供结果时，该端为 missing 并阻断', (t) => {
  const s = scenarioFor(t);
  prepare(s, { ios: null });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['AC_NOT_PROVEN']);
  assert.equal(outcome.blocks[0].subject, 'AC-SHOP-001-02');
  assert.match(outcome.blocks[0].detail, /^P0 missing: .*ios: missing/u);
});

test('声明的端上有失败时阻断，即使其他端通过', (t) => {
  const s = scenarioFor(t);
  prepare(s, { ios: withStatus(IOS_CASES, 'AC-SHOP-001-02', 'failed'), iosCode: 1 });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['AC_NOT_PROVEN']);
  assert.equal(outcome.blocks[0].subject, 'AC-SHOP-001-02');
  assert.match(outcome.blocks[0].detail, /^P0 failed: /u);
  assert.ok(codesOf(outcome.risks).includes('RISK_SUITE_EXIT_NONZERO'));
});

test('未声明的端上出现失败同样阻断，额外的通过端不影响放行', (t) => {
  const failing = scenarioFor(t);
  prepare(failing, {
    extra: [failing.suite('android', {
      platform: 'android',
      cases: [{ name: 'AC-SHOP-001-02 android 支付成功', status: 'failed' }],
    })],
  });
  const blocked = evaluate(failing);
  assert.equal(blocked.status, 'BLOCKED', show(blocked));
  assert.equal(blocked.blocks[0].subject, 'AC-SHOP-001-02');
  assert.match(blocked.blocks[0].detail, /^P0 failed: /u);

  const passing = scenarioFor(t);
  prepare(passing, {
    extra: [passing.suite('android', {
      platform: 'android',
      cases: [{ name: 'AC-SHOP-001-02 android 支付成功', status: 'passed' }],
    })],
  });
  const allowed = evaluate(passing);
  assert.equal(allowed.status, 'PASS', show(allowed));
});

test('声明端为 - 的 AC 以总体状态判定，任一套件通过且无失败即可', (t) => {
  const s = scenarioFor(t);
  // AC-SHOP-001-03 声明为 -：由哪个端的套件证明都行，但出现失败即阻断。
  prepare(s, {
    business: { requiredPriorities: ['P0', 'P1'] },
    ios: [...IOS_CASES, { name: 'AC-SHOP-001-03 iOS 银行拒绝后可重试', status: 'failed' }],
    iosCode: 1,
  });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.equal(outcome.blocks[0].code, 'AC_NOT_PROVEN');
  assert.equal(outcome.blocks[0].subject, 'AC-SHOP-001-03');
  assert.match(outcome.blocks[0].detail, /^P1 failed: /u);
});

// ---------------------------------------------------------------------------
// 路径覆盖
// ---------------------------------------------------------------------------

test('准则 all-transitions 下，失败路径独占的转移失去覆盖，阻断并指出含该转移的路径', (t) => {
  const s = scenarioFor(t);
  // AC-SHOP-001-03 是 P1，不触发 AC_NOT_PROVEN，只有路径覆盖会拦住它。
  prepare(s, { web: withStatus(WEB_CASES, 'TC-SHOP-003', 'failed') });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['PATH_COVERAGE_GAP']);
  assert.equal(outcome.blocks[0].subject, 'TRN-SHOP-003');
  assert.match(outcome.blocks[0].detail, /PTH-SHOP-002/u);
  assert.match(outcome.blocks[0].detail, /failed/u);
  // 指出导致路径失败的具体 TC，便于定位或把路径拆短。
  assert.match(outcome.blocks[0].detail, /TC-SHOP-003=failed/u);
  assert.match(outcome.nextAction, /拆/u);
  assert.ok(codesOf(outcome.risks).includes('RISK_LOWER_PRIORITY'), '路径阻断时仍披露 AC 层面的风险');
});

test('准则 all-states 下，失败路径独占的状态失去覆盖', (t) => {
  const s = scenarioFor(t, {
    files: { [PATHS_FILE]: pathsDocument(shopPaths((model) => { model.criterion = 'all-states'; })) },
  });
  prepare(s, { web: withStatus(WEB_CASES, 'TC-SHOP-003', 'failed') });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['PATH_COVERAGE_GAP']);
  assert.equal(outcome.blocks[0].subject, 'STA-SHOP-004');
});

test('准则 none 时不检查路径覆盖，路径失败不阻断', (t) => {
  const s = scenarioFor(t, { files: NO_CRITERION });
  prepare(s, { web: withStatus(WEB_CASES, 'TC-SHOP-003', 'failed') });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'PASS', show(outcome));
});

test('路径关联的 TC 没有任何用例时路径不算通过，并指出缺失', (t) => {
  const s = scenarioFor(t);
  // AC-SHOP-001-03 是 P1：没有它的用例不触发 AC_NOT_PROVEN，只有路径覆盖会拦住 TRN-SHOP-003。
  prepare(s, { web: WEB_CASES.filter((item) => !item.name.includes('TC-SHOP-003')) });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['PATH_COVERAGE_GAP'], show(outcome));
  assert.equal(outcome.blocks[0].subject, 'TRN-SHOP-003');
  assert.match(outcome.blocks[0].detail, /PTH-SHOP-002/u);
  assert.match(outcome.blocks[0].detail, /missing/u);
});

// ---------------------------------------------------------------------------
// 其余风险披露
// ---------------------------------------------------------------------------

test('无标识的用例与引用了不存在标识的用例只披露，不阻断', (t) => {
  const s = scenarioFor(t);
  prepare(s, {
    web: [
      ...WEB_CASES,
      { name: 'smoke 首页可以打开', status: 'passed' },
      { name: 'AC-SHOP-009-09 不存在的验收', status: 'passed' },
      { name: 'TC-SHOP-099 不存在的用例', status: 'passed' },
    ],
  });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'PASS', show(outcome));
  assert.deepEqual(codesOf(outcome.risks), ['RISK_MANUAL_AC', 'RISK_UNLABELLED_CASES', 'RISK_UNKNOWN_IDS']);
  assert.match(outcome.risks[1].detail, /1/u);
  assert.match(outcome.risks[2].detail, /AC-SHOP-009-09/u);
  assert.match(outcome.risks[2].detail, /TC-SHOP-099/u);
});

test('只有 classname（describe/文件名）带标识的用例不计入验收，单独披露为 RISK_CLASSNAME_ONLY', (t) => {
  const s = scenarioFor(t);
  prepare(s, {
    web: [
      ...WEB_CASES.filter((item) => !item.name.includes('AC-SHOP-001-01')),
      { name: '结算进入支付页', classname: 'AC-SHOP-001-01 / TC-SHOP-001 结算', status: 'passed' },
    ],
  });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(blocksOf(outcome, 'AC_NOT_PROVEN').map((item) => item.subject), ['AC-SHOP-001-01']);
  assert.deepEqual(codesOf(outcome.risks), ['RISK_MANUAL_AC', 'RISK_UNLABELLED_CASES', 'RISK_CLASSNAME_ONLY']);
  const classnameRisk = outcome.risks.find((item) => item.code === 'RISK_CLASSNAME_ONLY');
  assert.match(classnameRisk.detail, /1/u);
  assert.match(classnameRisk.detail, /classname/u);
});

test('没有原子 AC 表的模块其验收不受门禁约束，披露为 RISK_MODULE_WITHOUT_TABLE', (t) => {
  const s = scenarioFor(t, {
    files: { 'docs/prd-modules/legacy/PRD.md': '# 旧模块 PRD\n\n只有叙述性的验收说明，没有原子 AC 表。\n' },
  });
  prepare(s);
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'PASS', show(outcome));
  const risk = outcome.risks.find((item) => item.code === 'RISK_MODULE_WITHOUT_TABLE');
  assert.ok(risk, show(outcome));
  assert.match(risk.detail, /legacy/u);
});

'use strict';

// 业务验收门禁的 repeat 段（G6）：只读 qa run --repeat 写出的结果与各轮报告副本。
// 必需优先级用例不一致或套件状态不一致阻断为 FLAKY；轮数低于 qa.business.repeat 阻断为 REPEAT_INSUFFICIENT；
// 各轮副本被改动阻断为 REPORT_TAMPERED，repeat 记录与副本重算不符阻断为 RESULTS_MISMATCH；
// 非必需优先级的不一致只披露为 RISK_FLAKY。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { IOS_CASES, WEB_CASES, withStatus } = require('./fixtures/business-testing/scenario');
const { blocksOf, codesOf, evaluate, scenarioFor, show } = require('./qa-business-gate.helpers');

function runAlternating(s, variants, { business = {}, args = ['--repeat', '2'] } = {}) {
  s.configure([
    s.alternating('web', { platform: 'web', variants }),
    s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
  ], business);
  const result = s.run({ args });
  assert.ok(fs.existsSync(s.resultsFile), `qa run 应写出结果文件：${result.stdout}${result.stderr}`);
  return result;
}

function runStable(s, { business = {}, args = ['--repeat', '2'] } = {}) {
  return runAlternating(s, [{ cases: WEB_CASES }], { business, args });
}

test('两轮一致：PASS，outcome 记录轮数与不稳定用例数', (t) => {
  const s = scenarioFor(t);
  runStable(s);
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'PASS', show(outcome));
  assert.equal(outcome.repeatRuns, 2);
  assert.equal(outcome.flakyCount, 0);
  assert.deepEqual(codesOf(outcome.risks).filter((code) => code === 'RISK_FLAKY'), []);
});

test('P0 用例两轮不一致：阻断为 FLAKY，主体为用例名', (t) => {
  const s = scenarioFor(t);
  runAlternating(s, [{ cases: WEB_CASES }, { cases: withStatus(WEB_CASES, 'TC-SHOP-002', 'failed') }]);
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['FLAKY'], show(outcome));
  assert.match(outcome.blocks[0].subject, /TC-SHOP-002/u);
  assert.match(outcome.blocks[0].detail, /passed.*failed/u);
  assert.match(outcome.nextAction, /qa run/u);
});

test('套件状态在各轮之间不一致：阻断为 FLAKY，主体为套件名', (t) => {
  const s = scenarioFor(t);
  runAlternating(s, [{ cases: WEB_CASES }, { code: 1 }]);
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.ok(blocksOf(outcome, 'FLAKY').some((block) => block.subject === 'web'), show(outcome));
});

test('非必需优先级用例不一致：PASS 并披露 RISK_FLAKY', (t) => {
  const s = scenarioFor(t);
  runAlternating(s, [{ cases: WEB_CASES }, { cases: withStatus(WEB_CASES, 'TC-SHOP-003', 'failed') }]);
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'PASS', show(outcome));
  assert.equal(outcome.flakyCount, 1);
  assert.ok(codesOf(outcome.risks).includes('RISK_FLAKY'), show(outcome));
});

test('运行轮数低于 qa.business.repeat：阻断为 REPEAT_INSUFFICIENT', (t) => {
  const s = scenarioFor(t);
  runStable(s, { business: { repeat: 3 }, args: ['--repeat', '2'] });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['REPEAT_INSUFFICIENT'], show(outcome));
  assert.match(outcome.blocks[0].detail, /2.*3/u);
});

test('缺少 repeat 段的旧结果按 1 轮处理：默认配置下 PASS', (t) => {
  const s = scenarioFor(t);
  runStable(s, { args: [] });
  s.editResults((results) => { delete results.repeat; });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'PASS', show(outcome));
  assert.equal(outcome.repeatRuns, 1);
});

test('要求多轮但结果只有 1 轮且缺少 repeat 段：阻断为 REPEAT_INSUFFICIENT', (t) => {
  const s = scenarioFor(t);
  runStable(s, { business: { repeat: 2 }, args: ['--repeat', '1'] });
  s.editResults((results) => { delete results.repeat; });
  const outcome = evaluate(s);

  assert.deepEqual(codesOf(outcome.blocks), ['REPEAT_INSUFFICIENT'], show(outcome));
});

test('第 2 轮报告副本被改动：阻断为 REPORT_TAMPERED', (t) => {
  const s = scenarioFor(t);
  runStable(s);
  fs.appendFileSync(s.copyFile('web', 2), '\n<!-- 事后追加 -->\n');
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['REPORT_TAMPERED'], show(outcome));
  assert.match(outcome.blocks[0].subject, /web/u);
});

test('第 2 轮报告副本缺失：阻断为 REPORT_TAMPERED', (t) => {
  const s = scenarioFor(t);
  runStable(s);
  fs.rmSync(s.copyFile('ios', 2));
  assert.deepEqual(codesOf(evaluate(s).blocks), ['REPORT_TAMPERED']);
});

test('篡改 repeat 记录掩盖不一致：按副本重算发现 RESULTS_MISMATCH', (t) => {
  const s = scenarioFor(t);
  runAlternating(s, [{ cases: WEB_CASES }, { cases: withStatus(WEB_CASES, 'TC-SHOP-002', 'failed') }]);
  s.editResults((results) => {
    results.repeat.flaky = [];
    results.repeat.summary = { ...results.repeat.summary, flaky: 0, required_flaky: 0, rate: 0 };
  });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.ok(codesOf(outcome.blocks).includes('RESULTS_MISMATCH'), show(outcome));
  assert.equal(codesOf(outcome.blocks).includes('FLAKY'), false, '记录不可信时不得再据其判定');
});

test('篡改 repeat.runs 冒充多轮：阻断（RESULTS_INVALID 或 RESULTS_MISMATCH）', (t) => {
  const s = scenarioFor(t);
  runStable(s, { business: { repeat: 3 }, args: ['--repeat', '2'] });
  s.editResults((results) => {
    results.repeat.runs = 3;
    results.repeat.summary.runs = 3;
  });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.ok(codesOf(outcome.blocks).some((code) => code === 'RESULTS_INVALID' || code === 'RESULTS_MISMATCH'), show(outcome));
});

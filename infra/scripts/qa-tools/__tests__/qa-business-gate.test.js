'use strict';

// 业务验收门禁（qa verify 的业务测试段）的判定测试：放行与披露、必需 AC 未被证明、结果缺失/陈旧、套件硬失败。
// 结果文件由真实的 `qa run` 针对桩套件生成，门禁读到的因此是生产代码写出的数据；各用例再改动仓库、
// 结果文件或报告副本来制造“陈旧、被改动、失败、缺失”等状态，核对门禁给出的阻断代码、披露项与判定顺序。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { formatBusinessGate } = require('../qa-business-gate');
const { IOS_CASES, WEB_CASES, withStatus } = require('./fixtures/business-testing/scenario');
const { SHOP_ACS, commitAll } = require('./fixtures/business-testing/builders');
const {
  HEAD_FOREIGN,
  blocksOf,
  codesOf,
  evaluate,
  prepare,
  scenarioFor,
  show,
} = require('./qa-business-gate.helpers');

// ---------------------------------------------------------------------------
// 放行与披露
// ---------------------------------------------------------------------------

test('必需 AC 都有通过的用例时放行，并披露人工验收项', (t) => {
  const s = scenarioFor(t);
  prepare(s);
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'PASS', show(outcome));
  assert.deepEqual(outcome.blocks, []);
  assert.deepEqual(codesOf(outcome.risks), ['RISK_MANUAL_AC']);
  assert.match(outcome.risks[0].detail, /AC-SHOP-002-01/u);
  assert.equal(outcome.nextAction, null);

  // 放行的判定自带回执要用的业务摘要：必需优先级、已证明的自动化 AC 条数、披露风险数，以及与 qa run 一致的配置摘要。
  assert.deepEqual(outcome.requiredPriorities, ['P0']);
  assert.equal(outcome.provenCount, SHOP_ACS.filter((ac) => ac.priority === 'P0' && ac.verification === 'auto').length);
  assert.equal(outcome.riskCount, outcome.risks.length);
  assert.equal(outcome.configDigest, JSON.parse(fs.readFileSync(s.resultsFile, 'utf8')).config_digest);

  const lines = formatBusinessGate(outcome);
  assert.equal(lines[0], 'BUSINESS_GATE=PASS');
  assert.match(lines[1], /^BUSINESS_SUMMARY=\S/u);
  assert.ok(lines.some((line) => /^BUSINESS_RISK=RISK_MANUAL_AC\|.*AC-SHOP-002-01/u.test(line)), lines.join('\n'));
  assert.equal(lines.some((line) => line.startsWith('BUSINESS_NEXT_ACTION=')), false);
  assert.equal(lines.some((line) => line.startsWith('BUSINESS_BLOCK=')), false);
});

// ---------------------------------------------------------------------------
// 必需 AC 未被证明
// ---------------------------------------------------------------------------

test('P0 自动化 AC 没有绑定用例时阻断并列出该 AC', (t) => {
  const s = scenarioFor(t);
  prepare(s, { web: WEB_CASES.filter((item) => !item.name.includes('AC-SHOP-001-01')) });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  const unproven = blocksOf(outcome, 'AC_NOT_PROVEN');
  assert.deepEqual(unproven.map((block) => block.subject), ['AC-SHOP-001-01']);
  assert.match(unproven[0].detail, /^P0 missing: .*web/u);
  // 路径 PTH-SHOP-001 依赖 TC-SHOP-001，缺失后其独占的转移 TRN-SHOP-002 失去覆盖，两个步骤互不遮蔽。
  assert.deepEqual(blocksOf(outcome, 'PATH_COVERAGE_GAP').map((block) => block.subject), ['TRN-SHOP-002']);
  assert.match(outcome.nextAction, /\S/u);

  const lines = formatBusinessGate(outcome);
  assert.equal(lines[0], 'BUSINESS_GATE=BLOCKED');
  assert.ok(lines.some((line) => /^BUSINESS_BLOCK=AC_NOT_PROVEN\|AC-SHOP-001-01\|P0 missing: /u.test(line)), lines.join('\n'));
  assert.ok(lines.some((line) => /^BUSINESS_NEXT_ACTION=\S/u.test(line)));
});

test('绑定用例失败时阻断，且套件退出码非零只作为风险披露', (t) => {
  const s = scenarioFor(t);
  prepare(s, { web: withStatus(WEB_CASES, 'TC-SHOP-002', 'failed'), webCode: 1 });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  const unproven = blocksOf(outcome, 'AC_NOT_PROVEN');
  assert.deepEqual(unproven.map((block) => block.subject), ['AC-SHOP-001-02']);
  assert.match(unproven[0].detail, /^P0 failed: /u);
  // 退出码非零但报告有效不是硬失败：不出现第 3–6 步的阻断代码。
  assert.deepEqual(codesOf(outcome.blocks).filter((code) => code !== 'AC_NOT_PROVEN' && code !== 'PATH_COVERAGE_GAP'), []);
  assert.ok(codesOf(outcome.risks).includes('RISK_SUITE_EXIT_NONZERO'), show(outcome));
});

test('绑定用例只有跳过时同样不算通过', (t) => {
  const s = scenarioFor(t);
  prepare(s, { web: withStatus(WEB_CASES, 'AC-SHOP-001-01', 'skipped') });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  const unproven = blocksOf(outcome, 'AC_NOT_PROVEN');
  assert.deepEqual(unproven.map((block) => block.subject), ['AC-SHOP-001-01']);
  assert.match(unproven[0].detail, /^P0 skipped: .*web/u);
});

test('套件退出码非零而报告中没有失败用例时阻断：退出码无法由报告解释，套件不可信', (t) => {
  const s = scenarioFor(t);
  prepare(s, { webCode: 3 });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  // 不可信套件短路后续判定：不再给出 AC 或路径结论，也不附带风险披露。
  assert.deepEqual(codesOf(outcome.blocks), ['SUITE_EXIT_UNEXPLAINED']);
  assert.equal(outcome.blocks[0].subject, 'web');
  assert.match(outcome.blocks[0].detail, /3/u);
  assert.match(outcome.nextAction, /\S/u);
  assert.ok(formatBusinessGate(outcome).some((line) => line.startsWith('BUSINESS_BLOCK=SUITE_EXIT_UNEXPLAINED|web|')));
});

// ---------------------------------------------------------------------------
// 结果缺失、陈旧或被改动
// ---------------------------------------------------------------------------

test('结果文件缺失时阻断，提示先运行 qa run，且不创建任何目录', (t) => {
  const s = scenarioFor(t);
  s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES })]);
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['RESULTS_MISSING']);
  assert.match(outcome.nextAction, /qa run/u);
  assert.equal(fs.existsSync(s.project.tmp), false, '门禁是只读的，不得创建容器 tmp');
});

test('结果文件无法解析、版本未知或副本路径越界时判为 RESULTS_INVALID', (t) => {
  const s = scenarioFor(t);
  prepare(s);

  fs.writeFileSync(s.resultsFile, '{这不是 JSON');
  assert.deepEqual(codesOf(evaluate(s).blocks), ['RESULTS_INVALID']);

  prepare(s);
  s.editResults((results) => { results.schema_version = 2; });
  assert.deepEqual(codesOf(evaluate(s).blocks), ['RESULTS_INVALID']);

  prepare(s);
  s.editResults((results) => { results.suites[0].report.copy = '../../../outside.xml'; });
  const escaped = evaluate(s);
  assert.deepEqual(codesOf(escaped.blocks), ['RESULTS_INVALID']);
  assert.match(escaped.nextAction, /qa run/u);
});

test('HEAD 与结果不一致时只报告 RESULTS_STALE_HEAD，不给出依据旧数据的 AC 清单', (t) => {
  const s = scenarioFor(t);
  // 报告里有失败用例：若不跳过后续判定，会误导地列出 AC_NOT_PROVEN。
  prepare(s, { web: withStatus(WEB_CASES, 'TC-SHOP-002', 'failed') });
  s.project.write({ 'docs/note.md': '新的提交\n' });
  commitAll(s.project.repo, 'new commit after qa run');
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['RESULTS_STALE_HEAD']);
  assert.deepEqual(outcome.risks, [], '结果不可信时不披露风险');
  assert.match(outcome.blocks[0].detail, new RegExp(s.head().slice(0, 12), 'u'));
  assert.match(outcome.nextAction, /qa run/u);
});

test('调用方传入的 HEAD 与结果中的 head_sha 比较', (t) => {
  const s = scenarioFor(t);
  prepare(s);
  const outcome = evaluate(s, { headSha: HEAD_FOREIGN });

  assert.deepEqual(codesOf(outcome.blocks), ['RESULTS_STALE_HEAD']);
  assert.match(outcome.blocks[0].detail, new RegExp(HEAD_FOREIGN.slice(0, 12), 'u'));
});

test('运行时工作区不洁净则结果不可信，并提示 .gitignore 或提交', (t) => {
  const s = scenarioFor(t);
  s.configure([
    s.suite('web', { platform: 'web', cases: WEB_CASES }),
    s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
  ]);
  s.project.write({ 'stray.txt': '运行 qa run 时尚未提交的文件\n' });
  s.run();
  assert.ok(fs.existsSync(s.resultsFile));
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['RESULTS_DIRTY_WORKTREE']);
  assert.match(outcome.blocks[0].detail, /\.gitignore/u);
  assert.match(outcome.nextAction, /qa run/u);
});

test('配置在运行后变化（摘要漂移）时阻断，未提交的配置修改也算', (t) => {
  const s = scenarioFor(t);
  prepare(s);
  s.project.write({
    'agent.config.json': `${JSON.stringify({
      qa: { business: { enabled: true, requiredPriorities: ['P0', 'P1'], suites: s.config().qa.business.suites } },
    }, null, 2)}\n`,
  });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['RESULTS_CONFIG_DRIFT']);
  assert.match(outcome.nextAction, /qa run/u);
});

test('新鲜度三项同时不满足时按固定顺序全部列出', (t) => {
  const s = scenarioFor(t);
  const suites = [
    s.suite('web', { platform: 'web', cases: WEB_CASES }),
    s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
  ];
  s.configure(suites);
  s.project.write({ 'stray.txt': '运行时未提交\n' });
  s.run();
  s.configure(suites, { requiredPriorities: ['P0', 'P1'] });
  const outcome = evaluate(s);

  assert.deepEqual(codesOf(outcome.blocks), ['RESULTS_STALE_HEAD', 'RESULTS_DIRTY_WORKTREE', 'RESULTS_CONFIG_DRIFT'], show(outcome));
});

// ---------------------------------------------------------------------------
// 套件硬失败
// ---------------------------------------------------------------------------

test('套件没产出报告或报告不可解析是硬失败，逐个列出且跳过后续判定', (t) => {
  const s = scenarioFor(t);
  s.configure([
    s.suite('ios', { platform: 'ios' }),
    s.suite('lint', { platform: '-', xml: '<testsuites><未闭合' }),
    s.suite('web', { platform: 'web', cases: WEB_CASES }),
  ]);
  s.run();
  assert.ok(fs.existsSync(s.resultsFile));
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['SUITE_HARD_FAILURE', 'SUITE_HARD_FAILURE']);
  assert.deepEqual(outcome.blocks.map((block) => block.subject), ['ios', 'lint']);
  assert.match(outcome.blocks[0].detail, /^report_missing/u);
  assert.match(outcome.blocks[1].detail, /^report_invalid/u);
  assert.deepEqual(outcome.risks, []);
  assert.match(outcome.nextAction, /qa run/u);
});

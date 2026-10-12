'use strict';

// 业务测试闭环：确定性与规模（500 条 AC / 2000 个用例）。
// 整条链路当作黑盒：真实的 qa run 写结果，真实的 qa verify 读结果并判定；整体说明见 business-closed-loop.test.js 文件头。
// 共享 helper 见 business-closed-loop.helpers.js。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

const { aggregateResults, judgeAc, parseJunitReport } = require('../business-results');
const { evaluateBusinessGate } = require('../qa-business-gate');
const { analyzeSpec } = require('../qa-paths');
const {
  SHOP_ACS,
  createProject,
  junitReport,
  prdDocument,
  shopProject,
} = require('./fixtures/business-testing/builders');
const { IOS_CASES, WEB_CASES, withStatus } = require('./fixtures/business-testing/scenario');
const { syntheticProject } = require('./fixtures/business-testing/synthetic');
const { readyForVerify, runVerify } = require('./fixtures/business-testing/verify');
const {
  PRD_FILE,
  BUDGET_MS,
  output,
  scenarioFor,
  rewriteWeb,
  runOk,
  configureBaseline,
  counter,
  blocksOf,
  assertGreen,
} = require('./business-closed-loop.helpers');

// ---------------------------------------------------------------------------
// 2. 确定性：同样的仓库状态与报告，输出逐字一致（时间字段除外）
// ---------------------------------------------------------------------------

test('确定性——同一状态重复运行 qa run，结果文件、报告副本与输出除耗时与生成时间外逐字一致', (t) => {
  const s = scenarioFor(t);
  configureBaseline(s);

  const snapshot = (run) => {
    const results = JSON.parse(fs.readFileSync(s.resultsFile, 'utf8'));
    delete results.generated_at;
    for (const suite of results.suites) delete suite.duration_ms;
    return {
      stdout: run.stdout.replace(/\|\d+ms\|/gu, '|<ms>|'),
      results: JSON.stringify(results, null, 2),
      reports: ['web', 'ios'].map((name) => fs.readFileSync(s.copyFile(name), 'utf8')),
    };
  };
  const first = snapshot(runOk(s));
  const second = snapshot(runOk(s));
  const third = snapshot(runOk(s));

  assert.ok(first.results.includes('"AC-SHOP-001-02"'), '快照里要有真实的聚合内容，避免空比较');
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
});

test('确定性——重复运行 qa verify 与门禁评估，通过与多项阻断两种状态下的输出都逐字一致', (t) => {
  const s = scenarioFor(t);
  readyForVerify(s);

  const green = [runVerify(s), runVerify(s), runVerify(s)];
  for (const run of green) {
    assertGreen(s, run);
    assert.equal(run.stdout, green[0].stdout);
  }

  // 多项阻断：TC-SHOP-001 缺失、TC-SHOP-002 失败。
  rewriteWeb(s, withStatus(WEB_CASES.filter((item) => !item.name.includes('TC-SHOP-001')), 'TC-SHOP-002', 'failed'));
  s.run();
  const red = [runVerify(s), runVerify(s), runVerify(s)];
  assert.ok(blocksOf(red[0]).length >= 3, red[0].text);
  for (const run of red) {
    assert.equal(run.status, 1, output(run));
    assert.equal(run.stdout, red[0].stdout);
  }

  const options = { repoRoot: s.project.repo, config: s.config(), headSha: s.head() };
  const evaluated = evaluateBusinessGate(options);
  assert.equal(evaluated.status, 'BLOCKED');
  assert.deepEqual(evaluateBusinessGate(options), evaluated);
});

test('确定性——用例顺序、套件顺序与 PRD 行序不同，聚合结果的各段逐字一致（套件清单按配置顺序记录）', (t) => {
  const forward = shopProject();
  const reversed = shopProject({ [PRD_FILE]: prdDocument([...SHOP_ACS].reverse()) });
  t.after(() => {
    forward.cleanup();
    reversed.cleanup();
  });

  const specOf = (project) => {
    const analysis = analyzeSpec({ repoRoot: project.repo });
    assert.equal(analysis.status, 'OK', JSON.stringify(analysis.violations));
    return analysis.spec;
  };
  const casesOf = (cases, suite) => {
    const parsed = parseJunitReport(Buffer.from(junitReport(cases, { suite })));
    assert.equal(parsed.ok, true, JSON.stringify(parsed));
    return parsed.cases;
  };
  // 两个规格里没有的编号（先 099 后 098），用来证明 unknown_ids 的顺序不随用例顺序变化。
  const orphans = [
    { name: 'TC-SHOP-099 规格里没有的用例甲', status: 'passed' },
    { name: 'TC-SHOP-098 规格里没有的用例乙', status: 'passed' },
  ];
  const web = casesOf([...WEB_CASES, ...orphans], 'web');
  const ios = casesOf(IOS_CASES, 'ios');

  const ordered = aggregateResults({
    spec: specOf(forward),
    suites: [{ name: 'web', platform: 'web', cases: web }, { name: 'ios', platform: 'ios', cases: ios }],
  });
  const shuffled = aggregateResults({
    spec: specOf(reversed),
    suites: [{ name: 'ios', platform: 'ios', cases: [...ios].reverse() }, { name: 'web', platform: 'web', cases: [...web].reverse() }],
  });

  assert.equal(Object.keys(ordered.acs).length, SHOP_ACS.length);
  assert.equal(Object.keys(ordered.paths).length, 2);
  assert.deepEqual(ordered.unknown_ids, ['TC-SHOP-098', 'TC-SHOP-099']);

  // 套件清单按配置顺序记录（qa run 也按配置顺序逐套执行），顺序本身属于输入；
  // 其余各段只由规格与用例内容决定，与用例、套件、PRD 行的先后无关。
  assert.deepEqual(ordered.suites.map((suite) => suite.name), ['web', 'ios']);
  assert.deepEqual(shuffled.suites.map((suite) => suite.name), ['ios', 'web']);
  const byName = (left, right) => (left.name < right.name ? -1 : Number(left.name > right.name));
  assert.deepEqual([...shuffled.suites].sort(byName), [...ordered.suites].sort(byName));
  for (const section of ['tcs', 'acs', 'paths', 'unknown_ids', 'summary']) {
    assert.equal(JSON.stringify(shuffled[section]), JSON.stringify(ordered[section]), section);
  }
});

// ---------------------------------------------------------------------------
// 3. 规模：500 条 AC、2000 个用例
// ---------------------------------------------------------------------------

test('规模——500 条 AC、2000 个用例的校验、绑定与判定在 5 秒内完成', (t) => {
  const model = syntheticProject();
  assert.equal(model.acs.length, 500);
  assert.equal(model.caseCount, 2000);
  const project = createProject(model.files);
  t.after(() => project.cleanup());

  const started = performance.now();
  const analysis = analyzeSpec({ repoRoot: project.repo });
  const web = parseJunitReport(Buffer.from(model.webXml));
  const ios = parseJunitReport(Buffer.from(model.iosXml));
  const aggregated = aggregateResults({
    spec: analysis.spec,
    suites: [{ name: 'web', platform: 'web', cases: web.cases }, { name: 'ios', platform: 'ios', cases: ios.cases }],
  });
  const verdicts = Object.values(aggregated.acs).map((record) => judgeAc(record));
  const elapsed = performance.now() - started;

  assert.equal(analysis.status, 'OK', JSON.stringify(analysis.violations.slice(0, 3)));
  assert.equal(web.ok && ios.ok, true);
  assert.equal(aggregated.summary.cases.total, 2000);
  assert.equal(aggregated.summary.acs.total, 500);
  assert.equal(verdicts.length, 500);
  assert.equal(verdicts.every((verdict) => verdict.proven), true);
  assert.ok(elapsed < BUDGET_MS, `校验 + 绑定 + 判定耗时 ${Math.round(elapsed)}ms，应当不超过 ${BUDGET_MS}ms`);
});

test('规模——真实 qa run 与门禁在 500 条 AC / 2000 个用例上放行，除套件自身耗时外都不超过 5 秒', (t) => {
  const model = syntheticProject();
  const s = scenarioFor(t, { shop: false, files: model.files });
  s.configure([
    s.suite('web', { platform: 'web', xml: model.webXml }),
    s.suite('ios', { platform: 'ios', xml: model.iosXml }),
  ]);

  const started = performance.now();
  const run = s.run();
  const wall = performance.now() - started;
  assert.equal(run.status, 0, output(run));
  assert.equal(counter(run, 'AC_TOTAL'), '500');
  assert.equal(counter(run, 'AC_PASSED'), '500');
  assert.equal(counter(run, 'CASES_TOTAL'), '2000');
  assert.equal(counter(run, 'PATH_TOTAL'), '500');
  assert.equal(counter(run, 'PATH_PASSED'), '500');
  const suiteMs = run.stdout.split('\n')
    .filter((line) => line.startsWith('SUITE='))
    .reduce((sum, line) => sum + Number(/\|(\d+)ms\|/u.exec(line)[1]), 0);
  assert.ok(wall - suiteMs < BUDGET_MS, `qa run 自身耗时 ${Math.round(wall - suiteMs)}ms，应当不超过 ${BUDGET_MS}ms`);

  const gateStarted = performance.now();
  const gate = evaluateBusinessGate({ repoRoot: s.project.repo, config: s.config(), headSha: s.head() });
  const gateMs = performance.now() - gateStarted;
  assert.equal(gate.status, 'PASS', JSON.stringify(gate.blocks.slice(0, 3)));
  assert.ok(gateMs < BUDGET_MS, `门禁评估耗时 ${Math.round(gateMs)}ms，应当不超过 ${BUDGET_MS}ms`);
});

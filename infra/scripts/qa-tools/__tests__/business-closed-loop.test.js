'use strict';

// 业务测试闭环（TASK-BIZTEST-011，AC-BIZTEST-006-01 / TC-BIZTEST-021）。
//
// 这里不再单测某个脚本，而是把整条链路当作黑盒：临时 Git 项目里放好 PRD 原子 AC 表、PATHS.md 和会产出
// JUnit 报告的桩套件；真实的 `qa run` 写结果，真实的 `qa verify`（cwd 为该项目）读结果并判定。
// 基线全绿之后一次只破坏一处——用例失败 / 跳过 / 缺失、结果陈旧、报告副本被改、工作区不干净、配置漂移、
// 套件硬失败、结果缺失、规格违规——门禁必须变红，给出对应的稳定错误码，并且不签发回执；恢复后必须重新变绿。
// 每一次“变红”都是对门禁的一个反例证明（R-BIZ-001：门禁可证伪）。测试自己不构造结果，也不替门禁下结论。
//
// 非功能性要求同样在这里验证：确定性、规模（500 条 AC / 2000 个用例）与安全负例。
// 信任边界是“可发现篡改”而不是“防篡改”：对内部完全自洽的整体伪造不做任何断言。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const { aggregateResults, judgeAc, parseJunitReport } = require('../business-results');
const { BLOCK_CODES, evaluateBusinessGate } = require('../qa-business-gate');
const { analyzeSpec } = require('../qa-paths');
const {
  SHOP_ACS,
  commitAll,
  createProject,
  junitReport,
  lineOf,
  pathsDocument,
  prdDocument,
  runGit,
  shopPaths,
  shopProject,
} = require('./fixtures/business-testing/builders');
const {
  IOS_CASES,
  WEB_CASES,
  createScenario,
  withStatus,
} = require('./fixtures/business-testing/scenario');
const { syntheticProject } = require('./fixtures/business-testing/synthetic');
const {
  advanceHead,
  attachOrigin,
  pushBranch,
  readyForVerify,
  receiptPath,
  recordTestScope,
  runVerify,
} = require('./fixtures/business-testing/verify');

const PRD_FILE = 'docs/prd-modules/shop/PRD.md';
const PATHS_FILE = 'docs/qa-modules/shop/PATHS.md';
const CONFIG_FILE = 'agent.config.json';

// 回执结构不得变化：键集合固定。
const RECEIPT_KEYS = ['base_branch', 'base_sha', 'branch', 'head_sha', 'schema_version', 'verdict', 'verified_at'];

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

// ---------------------------------------------------------------------------
// 1. 闭环：基线全绿 → 逐个破坏 → 变红 → 恢复 → 变绿
// ---------------------------------------------------------------------------

test('AC-BIZTEST-006-01 / TC-BIZTEST-021: 闭环——基线全绿，逐个破坏后门禁变红并给出对应错误码、不签发回执，恢复后重新变绿', async (t) => {
  const s = scenarioFor(t);
  readyForVerify(s);
  const observed = new Set();
  const cycle = (name, plan) => cycleOf(t, s, observed, name, plan);
  const stray = path.join(s.project.repo, 'stray.txt');
  const brokenPrd = prdDocument(SHOP_ACS.map((row) => (row.id === 'AC-SHOP-001-02' ? { ...row, priority: 'P9' } : row)));

  await t.test('基线：结果由真实 qa run 写在容器 tmp，门禁通过后才签发回执，仓库保持干净', () => {
    const run = runVerify(s);
    assertGreen(s, run);
    assert.deepEqual(Object.keys(readReceiptFile(s)).sort(), RECEIPT_KEYS);
    assert.ok(has(run, /^BUSINESS_RISK=RISK_MANUAL_AC\|.*AC-SHOP-002-01/u), run.text);
    assert.equal(path.relative(s.project.tmp, s.resultsFile).startsWith('..'), false, '结果只能写在容器 tmp 下');
    assert.equal(gitStatus(s), '');
  });

  await cycle('用例失败：P0 AC 的 web 用例失败', {
    breakIt: () => {
      rewriteWeb(s, withStatus(WEB_CASES, 'TC-SHOP-002', 'failed'));
      const run = s.run();
      assert.equal(run.status, 1, output(run));
      assert.ok(fs.existsSync(s.resultsFile), '用例失败时也要写出结果');
    },
    expect: [{ code: 'AC_NOT_PROVEN', subject: 'AC-SHOP-001-02' }],
    allow: ['PATH_COVERAGE_GAP'],
    recover: () => { rewriteWeb(s, WEB_CASES); runOk(s); },
  });

  await cycle('用例跳过：P0 AC 的 web 用例被跳过', {
    breakIt: () => {
      rewriteWeb(s, withStatus(WEB_CASES, 'TC-SHOP-002', 'skipped'));
      s.run();
      assert.ok(fs.existsSync(s.resultsFile), '用例被跳过时也要写出结果');
    },
    expect: [{ code: 'AC_NOT_PROVEN', subject: 'AC-SHOP-001-02' }],
    allow: ['PATH_COVERAGE_GAP'],
    recover: () => { rewriteWeb(s, WEB_CASES); runOk(s); },
  });

  await cycle('用例缺失：P0 AC 没有任何用例绑定到它', {
    breakIt: () => {
      rewriteWeb(s, WEB_CASES.filter((item) => !item.name.includes('TC-SHOP-001')));
      s.run();
      assert.ok(fs.existsSync(s.resultsFile), '用例缺失时也要写出结果');
    },
    expect: [{ code: 'AC_NOT_PROVEN', subject: 'AC-SHOP-001-01' }],
    allow: ['PATH_COVERAGE_GAP'],
    recover: () => { rewriteWeb(s, WEB_CASES); runOk(s); },
  });

  await cycle('结果陈旧：结果生成之后又有了新提交', {
    breakIt: () => advanceHead(s),
    expect: [{ code: 'RESULTS_STALE_HEAD', subject: 'head_sha' }],
    recover: () => { runOk(s); },
  });

  await cycle('报告副本被改动：结果记录的哈希与副本对不上', {
    breakIt: () => fs.appendFileSync(s.copyFile('web'), '\n<!-- 事后追加 -->\n'),
    expect: [{ code: 'REPORT_TAMPERED', subject: 'web' }],
    recover: () => { runOk(s); },
  });

  await cycle('工作区不干净：qa run 时仓库里有未跟踪文件', {
    breakIt: () => {
      fs.writeFileSync(stray, '运行 qa run 时遗留的未跟踪文件\n');
      const run = s.run();
      assert.match(run.stdout, /^WORKTREE_CLEAN=false$/mu);
    },
    expect: [{ code: 'RESULTS_DIRTY_WORKTREE', subject: 'worktree_clean' }],
    recover: () => { fs.rmSync(stray, { force: true }); runOk(s); },
  });

  await cycle('配置漂移：结果生成之后 qa.business 的必需优先级被改了', {
    breakIt: () => {
      const file = path.join(s.project.repo, CONFIG_FILE);
      const config = JSON.parse(fs.readFileSync(file, 'utf8'));
      config.qa.business.requiredPriorities = ['P0', 'P1'];
      fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    },
    expect: [{ code: 'RESULTS_CONFIG_DRIFT', subject: 'config_digest' }],
    recover: () => runGit(s.project.repo, ['checkout', '--', CONFIG_FILE]),
  });

  await cycle('套件硬失败：web 套件没有产出报告', {
    breakIt: () => {
      fs.rmSync(path.join(s.aux, 'web.source.xml'));
      const run = s.run();
      assert.equal(run.status, 1, output(run));
      assert.match(run.stdout, /^SUITE=web\|web\|report_missing\|/mu);
    },
    expect: [{ code: 'SUITE_HARD_FAILURE', subject: 'web' }],
    recover: () => { rewriteWeb(s, WEB_CASES); runOk(s); },
  });

  await cycle('结果缺失：结果文件被删除', {
    breakIt: () => fs.rmSync(s.resultsFile),
    expect: [{ code: 'RESULTS_MISSING', subject: 'ac-results.json' }],
    recover: () => { runOk(s); },
  });

  await cycle('规格违规：一条原子 AC 的优先级不在允许的取值内', {
    breakIt: () => s.project.write({ [PRD_FILE]: brokenPrd }),
    expect: [{ code: 'SPEC_INVALID', subject: `${PRD_FILE}:${lineOf(brokenPrd, 'AC-SHOP-001-02')}`, detail: /^PRIORITY_INVALID/u }],
    recover: () => runGit(s.project.repo, ['checkout', '--', PRD_FILE]),
  });

  await t.test('收尾：全部破坏都已恢复，仓库干净，门禁仍然放行；用到的阻断码都在稳定的错误码表内', () => {
    assert.equal(gitStatus(s), '');
    assertGreen(s, runVerify(s));
    for (const code of [
      'AC_NOT_PROVEN', 'RESULTS_STALE_HEAD', 'REPORT_TAMPERED', 'RESULTS_DIRTY_WORKTREE',
      'RESULTS_CONFIG_DRIFT', 'SUITE_HARD_FAILURE', 'RESULTS_MISSING', 'SPEC_INVALID',
    ]) {
      assert.ok(observed.has(code), `闭环应当让门禁给出过 ${code}`);
    }
    for (const code of observed) assert.ok(BLOCK_CODES.includes(code), `${code} 不在稳定的错误码表内`);
  });
});

test('AC-BIZTEST-006-01 / TC-BIZTEST-021: 伪造——改写聚合结果或替换报告副本都被门禁识破，不会被当作通过', async (t) => {
  const s = scenarioFor(t);
  readyForVerify(s);
  const greenResults = JSON.parse(fs.readFileSync(s.resultsFile, 'utf8'));
  const greenReport = fs.readFileSync(s.copyFile('web'));
  const observed = new Set();
  const cycle = (name, plan) => cycleOf(t, s, observed, name, plan);

  // 真实地让 TC-SHOP-002 失败：套件产出失败报告，qa run 如实记录。
  const failWeb = () => {
    rewriteWeb(s, withStatus(WEB_CASES, 'TC-SHOP-002', 'failed'));
    const run = s.run();
    assert.equal(run.status, 1, output(run));
  };
  const recover = () => { rewriteWeb(s, WEB_CASES); runOk(s); };

  await cycle('改一个字段：把失败的 AC 改成通过', {
    breakIt: () => {
      failWeb();
      s.editResults((results) => {
        results.acs['AC-SHOP-001-02'].status = 'passed';
        results.acs['AC-SHOP-001-02'].by_platform.web = 'passed';
      });
    },
    expect: [{ code: 'RESULTS_MISMATCH', subject: /^acs\.AC-SHOP-001-02\./u }],
    recover,
  });

  await cycle('整段嫁接：用绿色结果的 tcs / acs / paths / summary 覆盖失败结果', {
    breakIt: () => {
      failWeb();
      s.editResults((results) => {
        for (const section of ['tcs', 'acs', 'paths', 'summary']) results[section] = greenResults[section];
      });
    },
    expect: [{ code: 'RESULTS_MISMATCH', subject: /^(tcs|acs|paths|summary)\./u }],
    recover,
  });

  await cycle('替换副本：用绿色报告覆盖失败报告的副本', {
    breakIt: () => {
      failWeb();
      fs.writeFileSync(s.copyFile('web'), greenReport);
    },
    expect: [{ code: 'REPORT_TAMPERED', subject: 'web' }],
    recover,
  });

  await t.test('三种伪造都没有出现 AC_NOT_PROVEN：伪造在完整性校验这一步就被拦下，而不是靠重判才发现', () => {
    assert.deepEqual([...observed].sort(), ['REPORT_TAMPERED', 'RESULTS_MISMATCH']);
  });
});

// ---------------------------------------------------------------------------
// 2. 确定性：同样的仓库状态与报告，输出逐字一致（时间字段除外）
// ---------------------------------------------------------------------------

test('AC-BIZTEST-006-01 / TC-BIZTEST-021: 确定性——同一状态重复运行 qa run，结果文件、报告副本与输出除耗时与生成时间外逐字一致', (t) => {
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

test('AC-BIZTEST-006-01 / TC-BIZTEST-021: 确定性——重复运行 qa verify 与门禁评估，通过与多项阻断两种状态下的输出都逐字一致', (t) => {
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

test('AC-BIZTEST-006-01 / TC-BIZTEST-021: 确定性——用例顺序、套件顺序与 PRD 行序不同，聚合结果的各段逐字一致（套件清单按配置顺序记录）', (t) => {
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

test('AC-BIZTEST-006-01 / TC-BIZTEST-021: 规模——500 条 AC、2000 个用例的校验、绑定与判定在 5 秒内完成', (t) => {
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

test('AC-BIZTEST-006-01 / TC-BIZTEST-021: 规模——真实 qa run 与门禁在 500 条 AC / 2000 个用例上放行，除套件自身耗时外都不超过 5 秒', (t) => {
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

// ---------------------------------------------------------------------------
// 4. 安全负例：报告路径逃逸、XML 实体、命令注入样式文本、环境变量值
// ---------------------------------------------------------------------------

test('AC-BIZTEST-006-01 / TC-BIZTEST-021: 安全——报告路径越出仓库根或指向 .git 时 qa run 在启动任何套件前阻断，也不会在别处写文件', (t) => {
  const s = scenarioFor(t);
  const marker = path.join(s.aux, 'markers.log');
  const outside = path.join(s.aux, 'outside.xml');
  const hook = path.join(s.project.repo, '.git', 'hooks', 'post-commit');

  for (const report of ['../outside.xml', outside, '.git/hooks/post-commit']) {
    s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES, report })]);
    const run = s.run();
    assert.equal(run.status, 1, `${report}\n${output(run)}`);
    assert.match(run.stdout, /^STATUS=BLOCKED$/mu);
    assert.match(run.stdout, /^REASON=CONFIG_INVALID$/mu);
    assert.match(run.stdout, /^CONFIG_ERROR=qa\.business\.suites\[0\]\.report\|/mu);
    assert.equal(fs.existsSync(marker), false, `${report}：套件不应被启动`);
    assert.equal(fs.existsSync(outside), false, `${report}：不得写到仓库之外`);
    assert.equal(fs.existsSync(path.join(s.project.root, 'outside.xml')), false, `${report}：不得写到仓库之外`);
    assert.equal(fs.existsSync(hook), false, `${report}：不得写进 .git`);
    assert.equal(fs.existsSync(s.resultsFile), false, `${report}：配置无效时不写结果`);
  }
});

test('AC-BIZTEST-006-01 / TC-BIZTEST-021: 安全——带 DOCTYPE 与外部实体的报告被拒绝：实体不展开、不读取目标文件，门禁按套件硬失败阻断', (t) => {
  const s = scenarioFor(t);
  const secret = path.join(s.aux, 'xxe-target.txt');
  const canary = 'XXE-CANARY-7f3a91';
  fs.writeFileSync(secret, `${canary}\n`);

  const xxe = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!DOCTYPE testsuites [<!ENTITY id "AC-SHOP-001-01 / TC-SHOP-001"> <!ENTITY secret SYSTEM "file://${secret}">]>`,
    '<testsuites>',
    '  <testsuite name="web" tests="2">',
    '    <testcase name="&id; 结算进入支付页" classname="web"/>',
    '    <testcase name="&secret;" classname="web"/>',
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
  const run = readyWith(s, [
    s.suite('web', { platform: 'web', xml: xxe }),
    s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
  ]);
  assert.equal(run.status, 1, output(run));
  // 拒绝的原因必须是 DOCTYPE 本身，而不是后面某个实体引用碰巧解析失败。
  assert.match(run.stdout, /^SUITE=web\|web\|report_invalid\|.*报告无法使用（doctype）/mu);
  assert.match(run.stdout, /^SUITE=ios\|ios\|ok\|/mu, '其余套件照常运行');

  const verify = runVerify(s);
  assertRed(s, verify, [{ code: 'SUITE_HARD_FAILURE', subject: 'web' }]);

  // 递归展开的实体炸弹同样在 DOCTYPE 处被拒，不会被展开。
  const bomb = [
    '<?xml version="1.0"?>',
    '<!DOCTYPE lolz [',
    '  <!ENTITY lol "lol">',
    `  <!ENTITY lol1 "${'&lol;'.repeat(10)}">`,
    `  <!ENTITY lol2 "${'&lol1;'.repeat(10)}">`,
    `  <!ENTITY lol3 "${'&lol2;'.repeat(10)}">`,
    ']>',
    '<testsuites><testsuite name="web"><testcase name="&lol3;" classname="web"/></testsuite></testsuites>',
    '',
  ].join('\n');
  s.suite('web', { platform: 'web', xml: bomb });
  const bombRun = s.run();
  assert.equal(bombRun.status, 1, output(bombRun));
  assert.match(bombRun.stdout, /^SUITE=web\|web\|report_invalid\|.*报告无法使用（doctype）/mu);

  const everything = [
    run.stdout, run.stderr, verify.stdout, verify.stderr, bombRun.stdout, bombRun.stderr,
    ...filesUnder(s.project.tmp).map((file) => fs.readFileSync(file, 'utf8')),
  ].join('\n');
  assert.equal(everything.includes(canary), false, '外部实体指向的文件内容不得出现在任何输出、结果或副本里');
});

test('AC-BIZTEST-006-01 / TC-BIZTEST-021: 安全——PRD、PATHS 与报告里的命令注入样式文本只被当作数据：不执行、不改变判定', (t) => {
  const s = scenarioFor(t);
  const pwned = (name) => path.join(s.aux, `pwned-${name}`);
  const payload = (name) => `$(touch ${pwned(name)}) \`touch ${pwned(name)}\` ; touch ${pwned(name)} && touch ${pwned(name)}`;

  const prd = prdDocument(SHOP_ACS.map((row) => ({
    ...row, given: payload('given'), when: payload('when'), then: payload('then'),
  })));
  const paths = pathsDocument(shopPaths((model) => {
    model.transitions[0][2] = payload('action');
    model.paths[0][3] = payload('note');
  }));
  s.project.write({ [PRD_FILE]: prd, [PATHS_FILE]: paths });
  commitAll(s.project.repo, 'specs with injection-style text');

  const cases = WEB_CASES.map((item, index) => ({ ...item, name: `${item.name} ${payload(`case-${index}`)}` }));
  const run = readyWith(s, [
    s.suite('web', { platform: 'web', cases }),
    s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
  ]);
  assert.equal(run.status, 0, output(run));
  assertGreen(s, runVerify(s));

  assert.deepEqual(fs.readdirSync(s.aux).filter((name) => name.startsWith('pwned-')), [], '文本中的命令不得被执行');
  // 文本确实被当作数据读进来了，而不是被悄悄丢弃。
  const analysis = analyzeSpec({ repoRoot: s.project.repo });
  assert.equal(analysis.status, 'OK', JSON.stringify(analysis.violations));
  assert.equal(analysis.spec.acs.every((ac) => ac.given.includes('$(touch')), true);
  assert.deepEqual(fs.readdirSync(s.aux).filter((name) => name.startsWith('pwned-')), []);
});

test('AC-BIZTEST-006-01 / TC-BIZTEST-021: 安全——环境变量的值不进入输出、结果与报告副本；命令字符串按配置原样记录', (t) => {
  const s = scenarioFor(t);
  const token = 'canary-9d2c61';
  const probe = path.join(s.aux, `${token}.txt`);
  fs.writeFileSync(probe, 'probe\n');
  const env = { BIZ_PROBE: probe };

  const web = s.suite('web', { platform: 'web', cases: WEB_CASES });
  web.command += ' "$BIZ_PROBE"';
  const ios = s.suite('ios', { platform: 'ios', cases: IOS_CASES });
  const run = readyWith(s, [web, ios], {}, { env });
  assert.equal(run.status, 0, output(run));
  const verify = runVerify(s, { env });
  assertGreen(s, verify);

  // 变量确实传给了套件，并由 shell 在命令里展开：桩套件观察到探针路径存在。
  const markers = fs.readFileSync(path.join(s.aux, 'markers.log'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(markers.find((item) => item.label === 'web').probeExisted, true);

  // 但变量的值不会出现在任何输出、结果或副本里；结果只按配置原样记录命令文本。
  const results = JSON.parse(fs.readFileSync(s.resultsFile, 'utf8'));
  assert.ok(results.suites.find((suite) => suite.name === 'web').command.endsWith('"$BIZ_PROBE"'));
  const everything = [
    run.stdout, run.stderr, verify.stdout, verify.stderr,
    ...filesUnder(s.project.tmp).map((file) => fs.readFileSync(file, 'utf8')),
  ].join('\n');
  assert.equal(everything.includes(token), false, '环境变量的值不得出现在输出与容器 tmp 的任何文件里');
});

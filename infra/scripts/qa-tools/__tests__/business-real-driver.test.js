'use strict';

// e2e 驱动的真实输出对业务验收契约的回归。
//
// 夹具取自 Playwright 1.62.1 + 本机 Google Chrome 对 e2e 模块生成物（配置与示例用例）的真实运行，不是手写的 XML：
//   playwright/junit-pass.xml    三个应用的示例用例全部通过，与 Playwright 原始输出逐字节一致
//   playwright/junit-failed.xml  同一次运行里 admin 应用首页渲染为空白，另有声明跳过、运行时跳过、
//                                抛出异常（消息含 CDATA 结束符与标签）的用例；脱敏只有两处：本机绝对路径前缀
//                                改为 /workspace，三处 CDATA 标题行的行尾空格删除（git diff --check），其余字节不变
// 解析、聚合与判定只读取夹具；闭环回放用真实的 `qa run` 与 `qa verify` CLI，套件命令只是把夹具复制到报告路径。
// 这里因此不启动 Playwright、浏览器或开发服务器——真实驱动的端到端运行记录在 QA 报告里。

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_REPORT_BYTES,
  aggregateResults,
  evaluateSuiteOutcome,
  extractCaseLabels,
  judgeAc,
  parseJunitReport,
} = require('../business-results');
const { loadBusinessSpec } = require('../business-spec');
const { createProject, pathsDocument, prdDocument } = require('./fixtures/business-testing/builders');
const { createScenario } = require('./fixtures/business-testing/scenario');
const { attachOrigin, pushBranch, receiptPath, recordTestScope, runVerify } = require('./fixtures/business-testing/verify');

const QA_PATHS = path.join(__dirname, '..', 'qa-paths.js');
const FIXTURES = path.join(__dirname, 'fixtures', 'business-testing', 'playwright');
// e2e 模块 README 里 suite 片段的 report：<模块路径>/reports/junit.xml，模块路径取默认值 packages/e2e。
const REPORT_PATH = 'packages/e2e/reports/junit.xml';
// 生成的 e2e 包 .gitignore 里的行；报告路径必须被它忽略（R-BIZ-008）。
const MODULE_GITIGNORE = 'node_modules/\nreports/\ntest-results/\nplaywright-report/\n';

const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name));

// 示例用例使用的占位编号；真实项目里的编号取自 PRD 原子 AC 表。
const HOME_AC = {
  id: 'AC-EXAMPLE-001-01',
  story: 'US-EXAMPLE-001',
  priority: 'P0',
  verification: 'auto',
  platform: 'web',
  given: '应用已启动',
  when: '打开首页',
  then: '返回成功响应并渲染页面',
  tc: 'TC-EXAMPLE-001',
};
// 失败夹具里的第二组用例：一条 AC 同时绑定失败、两种跳过与异常。
const SHAPES_AC = {
  id: 'AC-EXAMPLE-002-01',
  story: 'US-EXAMPLE-002',
  priority: 'P0',
  verification: 'auto',
  platform: 'web',
  given: '用例失败、跳过或抛出异常',
  when: '驱动写出 JUnit 报告',
  then: '各种状态被如实记录',
  tc: 'TC-EXAMPLE-002, TC-EXAMPLE-003, TC-EXAMPLE-004, TC-EXAMPLE-005',
};

// 示例 AC 的路径模型：一个界面、一个转移、一条由 TC-EXAMPLE-001 覆盖的路径。
const HOME_PATHS = {
  criterion: 'all-transitions',
  screens: [['SCR-EXAMPLE-001', '应用首页', 'web', '打开首页']],
  states: [
    ['STA-EXAMPLE-001', 'SCR-EXAMPLE-001', '应用已启动', ''],
    ['STA-EXAMPLE-002', 'SCR-EXAMPLE-001', '首页已渲染', ''],
  ],
  transitions: [['TRN-EXAMPLE-001', 'STA-EXAMPLE-001', '打开首页', '-', 'STA-EXAMPLE-002', 'AC-EXAMPLE-001-01']],
  paths: [['PTH-EXAMPLE-001', 'TRN-EXAMPLE-001', 'TC-EXAMPLE-001', '首页可达主路径']],
};

function parseFixture(name) {
  const parsed = parseJunitReport(fixture(name));
  assert.equal(parsed.ok, true, `${name} 应当可解析：${parsed.message}`);
  return parsed.cases;
}

function aggregateFixture(name, rows, keep = () => true) {
  const cases = parseFixture(name).filter(keep);
  const project = createProject({ 'docs/prd-modules/example/PRD.md': prdDocument(rows) });
  try {
    const spec = loadBusinessSpec({ repoRoot: project.repo });
    return aggregateResults({ spec, suites: [{ name: 'e2e', platform: 'web', cases }] });
  } finally {
    project.cleanup();
  }
}

// ---------------------------------------------------------------------------
// 解析：真实 JUnit 的各种形态
// ---------------------------------------------------------------------------

test('真实通过报告解析为三个通过的用例，名称同时带 AC 与 TC 编号', () => {
  const cases = parseFixture('junit-pass.xml');
  assert.deepEqual(cases.map(({ status }) => status), ['passed', 'passed', 'passed']);
  assert.deepEqual(cases.map(({ classname }) => classname), [
    'tests/admin/sample.spec.ts',
    'tests/site/sample.spec.ts',
    'tests/desktop/sample.spec.ts',
  ]);
  for (const item of cases) {
    assert.equal(item.name, 'AC-EXAMPLE-001-01 应用首页可达 › TC-EXAMPLE-001 首页返回成功响应并渲染页面');
    assert.deepEqual(extractCaseLabels(item), { acs: ['AC-EXAMPLE-001-01'], tcs: ['TC-EXAMPLE-001'] });
  }
});

test('真实失败报告的七个用例逐项映射为失败、失败、跳过、跳过、异常、通过、通过', () => {
  const xml = fixture('junit-failed.xml').toString('utf8');
  // 夹具自检：这份报告确实带着需要被正确跳过的结构，解析器不能被它们带偏。
  assert.match(xml, /<testsuites [^>]*tests="7"/u);
  assert.match(xml, /\[\[ATTACHMENT\|/u, 'system-out 里的附件标记在 CDATA 内');
  assert.match(xml, /<properties>\s*<property name="skip" value="">/u, '声明跳过的 property 值为空');
  assert.match(xml, /<property name="skip" value="前置条件不满足">/u, '运行时跳过带原因');
  assert.match(xml, /<error message="payload \]\]&gt; end &amp; &lt;tag attr=&quot;x&quot;&gt; done" type="Error">/u);

  const cases = parseFixture('junit-failed.xml');
  assert.equal(cases.length, 7, '不得因 CDATA、属性里的 ]]&gt; 或正文里的标签文本多出或少掉用例');
  assert.deepEqual(cases.map(({ status }) => status), ['failed', 'failed', 'skipped', 'skipped', 'error', 'passed', 'passed']);
  assert.deepEqual(cases.map((item) => extractCaseLabels(item).tcs.join()), [
    'TC-EXAMPLE-001',
    'TC-EXAMPLE-002',
    'TC-EXAMPLE-003',
    'TC-EXAMPLE-004',
    'TC-EXAMPLE-005',
    'TC-EXAMPLE-001',
    'TC-EXAMPLE-001',
  ]);
  assert.deepEqual(cases.map(({ classname }) => classname), [
    'tests/admin/sample.spec.ts',
    'tests/site/real-shapes.spec.ts',
    'tests/site/real-shapes.spec.ts',
    'tests/site/real-shapes.spec.ts',
    'tests/site/real-shapes.spec.ts',
    'tests/site/sample.spec.ts',
    'tests/desktop/sample.spec.ts',
  ]);
});

test('Playwright 把断言失败写成 failure、把抛出的异常写成 error，两者分别是 failed 与 error', () => {
  const cases = parseFixture('junit-failed.xml');
  const byTc = (tc, index = 0) => cases.filter((item) => extractCaseLabels(item).tcs.includes(tc))[index];
  assert.equal(byTc('TC-EXAMPLE-002').status, 'failed');
  assert.equal(byTc('TC-EXAMPLE-005').status, 'error');
  assert.equal(byTc('TC-EXAMPLE-001', 0).status, 'failed', 'admin 首页渲染空白，断言可见性失败');
  assert.equal(byTc('TC-EXAMPLE-001', 1).status, 'passed');
  assert.equal(byTc('TC-EXAMPLE-001', 2).status, 'passed');
});

// ---------------------------------------------------------------------------
// 套件结果：Playwright 的退出码与报告
// ---------------------------------------------------------------------------

test('全部通过时退出码 0 为 ok；有失败时退出码 1 为 exit_nonzero，真实报告里的用例仍然绑定', () => {
  const evaluate = (name, exitCode) => evaluateSuiteOutcome({
    exitCode,
    reportBytes: fixture(name),
    reportProblem: null,
    timeoutSeconds: 900,
    maxBytes: MAX_REPORT_BYTES,
  });

  const passed = evaluate('junit-pass.xml', 0);
  assert.equal(passed.status, 'ok');
  assert.equal(passed.cases.length, 3);

  const failed = evaluate('junit-failed.xml', 1);
  assert.equal(failed.status, 'exit_nonzero');
  assert.equal(failed.cases.length, 7, 'Playwright 有失败用例时以 1 退出，报告完整，用例要继续参与判定');
  assert.equal(failed.report.bytes, fixture('junit-failed.xml').length);
});

// ---------------------------------------------------------------------------
// 聚合与判定：按 PRD 的 AC/TC 编号绑定
// ---------------------------------------------------------------------------

test('真实通过报告使示例 AC 在 web 端通过，且被判定为已证明', () => {
  const aggregate = aggregateFixture('junit-pass.xml', [HOME_AC]);
  assert.deepEqual(aggregate.tcs['TC-EXAMPLE-001'], {
    status: 'passed',
    cases: { total: 3, passed: 3, failed: 0, error: 0, skipped: 0 },
  });
  const record = aggregate.acs['AC-EXAMPLE-001-01'];
  assert.equal(record.status, 'passed');
  assert.deepEqual(record.by_platform, { web: 'passed' });
  assert.deepEqual(judgeAc(record), { proven: true, state: 'passed', reason: null });
  assert.deepEqual(aggregate.unknown_ids, []);
});

test('同一 TC 在一个应用上失败，整条 AC 与 TC 即为失败，不被另外两个应用的通过抵消', () => {
  const aggregate = aggregateFixture('junit-failed.xml', [HOME_AC, SHAPES_AC]);
  assert.deepEqual(aggregate.tcs['TC-EXAMPLE-001'].cases, { total: 3, passed: 2, failed: 1, error: 0, skipped: 0 });
  assert.equal(aggregate.tcs['TC-EXAMPLE-001'].status, 'failed');
  const home = aggregate.acs['AC-EXAMPLE-001-01'];
  assert.equal(home.status, 'failed');
  assert.deepEqual(home.by_platform, { web: 'failed' });
  assert.equal(judgeAc(home).proven, false);
});

test('一条 AC 同时绑定失败、跳过与异常用例时为失败；两种真实跳过形态单独出现时为跳过，不算通过', () => {
  const mixed = aggregateFixture('junit-failed.xml', [HOME_AC, SHAPES_AC]);
  assert.equal(mixed.acs['AC-EXAMPLE-002-01'].status, 'failed');
  assert.equal(mixed.tcs['TC-EXAMPLE-002'].status, 'failed');
  assert.equal(mixed.tcs['TC-EXAMPLE-003'].status, 'skipped');
  assert.equal(mixed.tcs['TC-EXAMPLE-004'].status, 'skipped');
  assert.equal(mixed.tcs['TC-EXAMPLE-005'].status, 'failed', 'error 用例与 failed 一样让 TC 变为 failed');
  assert.deepEqual(mixed.tcs['TC-EXAMPLE-005'].cases, { total: 1, passed: 0, failed: 0, error: 1, skipped: 0 });

  const onlySkipped = aggregateFixture('junit-failed.xml', [SHAPES_AC], (item) => item.status === 'skipped');
  const record = onlySkipped.acs['AC-EXAMPLE-002-01'];
  assert.equal(record.status, 'skipped');
  assert.deepEqual(record.by_platform, { web: 'skipped' });
  assert.equal(judgeAc(record).proven, false);
});

test('报告里 PRD 没有登记的编号只作披露，不让已登记的 AC 被误判', () => {
  const aggregate = aggregateFixture('junit-failed.xml', [HOME_AC]);
  assert.deepEqual(aggregate.unknown_ids, ['AC-EXAMPLE-002-01', 'TC-EXAMPLE-002', 'TC-EXAMPLE-003', 'TC-EXAMPLE-004', 'TC-EXAMPLE-005']);
  assert.equal(aggregate.acs['AC-EXAMPLE-001-01'].status, 'failed');
  assert.deepEqual(Object.keys(aggregate.acs), ['AC-EXAMPLE-001-01']);
});

// ---------------------------------------------------------------------------
// 闭环回放：真实 qa run 与 qa verify 读取真实报告
// ---------------------------------------------------------------------------

const blocksOf = (run) => run.lines
  .filter((line) => line.startsWith('BUSINESS_BLOCK='))
  .map((line) => line.slice('BUSINESS_BLOCK='.length).split('|').slice(0, 2).join('|'));

test('回放闭环——真实失败报告让 qa verify 变红且不签发回执，换成真实通过报告后变绿', (t) => {
  const s = createScenario({
    shop: false,
    files: {
      '.gitignore': 'node_modules/\n',
      'packages/e2e/.gitignore': MODULE_GITIGNORE,
      'docs/prd-modules/example/PRD.md': prdDocument([HOME_AC]),
      'docs/qa-modules/example/PATHS.md': pathsDocument(HOME_PATHS).replace('购物模块', '示例模块'),
    },
  });
  t.after(() => s.cleanup());
  attachOrigin(s);

  const paths = spawnSync(process.execPath, [QA_PATHS], { cwd: s.project.repo, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(paths.status, 0, `${paths.stdout}${paths.stderr}`);
  assert.match(paths.stdout, /^STATUS=OK$/mu);

  // 与 Playwright 一致：全部通过退出 0，有失败退出 1，两种情况下报告都写在 report 路径。
  const replay = (name, exitCode) => {
    s.configure([s.suite('e2e', { platform: 'web', xml: fixture(name).toString('utf8'), code: exitCode, report: REPORT_PATH })]);
    const run = s.run();
    pushBranch(s);
    recordTestScope(s);
    return run;
  };

  const failedRun = replay('junit-failed.xml', 1);
  assert.equal(failedRun.status, 1, `${failedRun.stdout}${failedRun.stderr}`);
  assert.ok(fs.existsSync(s.resultsFile), '用例失败时也要写出结果');
  const red = runVerify(s);
  assert.equal(red.status, 1, red.text);
  assert.ok(red.lines.includes('BUSINESS_GATE=BLOCKED'), red.text);
  assert.deepEqual(blocksOf(red).sort(), ['AC_NOT_PROVEN|AC-EXAMPLE-001-01', 'PATH_COVERAGE_GAP|TRN-EXAMPLE-001'], red.text);
  assert.ok(red.lines.some((line) => /^BUSINESS_RISK=RISK_UNKNOWN_IDS\|/u.test(line)), '报告里未登记的编号只披露');
  assert.ok(red.lines.some((line) => /^BUSINESS_RISK=RISK_SUITE_EXIT_NONZERO\|/u.test(line)), '退出码非零只披露');
  assert.equal(fs.existsSync(receiptPath(s)), false, '被阻断时不得留下回执');

  const passedRun = replay('junit-pass.xml', 0);
  assert.equal(passedRun.status, 0, `${passedRun.stdout}${passedRun.stderr}`);
  const green = runVerify(s);
  assert.equal(green.status, 0, green.text);
  assert.ok(green.lines.includes('BUSINESS_GATE=PASS'), green.text);
  assert.deepEqual(blocksOf(green), [], green.text);
  assert.ok(green.lines.some((line) => line.startsWith('QA_RECEIPT=')), green.text);
  const receipt = JSON.parse(fs.readFileSync(receiptPath(s), 'utf8'));
  assert.equal(receipt.verdict, 'passed');
  assert.equal(receipt.head_sha, s.head());
});

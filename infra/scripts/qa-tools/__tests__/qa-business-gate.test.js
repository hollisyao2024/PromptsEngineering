'use strict';

// 业务验收门禁（qa verify 的业务测试段）的判定测试。结果文件由真实的 `qa run` 针对桩套件生成，
// 门禁读到的因此是生产代码写出的数据；各用例再改动仓库、结果文件或报告副本来制造
// “陈旧、被改动、失败、缺失”等状态，核对门禁给出的阻断代码、披露项与判定顺序。

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { MAX_REPORT_BYTES, aggregateResults, parseJunitReport } = require('../business-results');
const { evaluateBusinessGate, formatBusinessGate, verifyBusinessAcceptance } = require('../qa-business-gate');
const { analyzeSpec } = require('../qa-paths');
const {
  IOS_CASES,
  WEB_CASES,
  createScenario,
  withStatus,
} = require('./fixtures/business-testing/scenario');
const {
  SHOP_ACS,
  commitAll,
  pathsDocument,
  prdDocument,
  shopPaths,
} = require('./fixtures/business-testing/builders');

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

test('报告有效、套件退出码非零但 AC 全部通过时放行并披露（不以退出码单独阻断）', (t) => {
  const s = scenarioFor(t);
  prepare(s, { webCode: 3 });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'PASS', show(outcome));
  assert.deepEqual(codesOf(outcome.risks), ['RISK_MANUAL_AC', 'RISK_SUITE_EXIT_NONZERO']);
  const risk = outcome.risks.find((item) => item.code === 'RISK_SUITE_EXIT_NONZERO');
  assert.match(risk.detail, /web/u);
  assert.match(risk.detail, /3/u);
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

// ---------------------------------------------------------------------------
// 完整性：报告副本与重算
// ---------------------------------------------------------------------------

test('报告副本被改动时阻断为 REPORT_TAMPERED，并提示重新运行 qa run', (t) => {
  const s = scenarioFor(t);
  prepare(s);
  fs.appendFileSync(s.copyFile('web'), '\n<!-- 事后追加 -->\n');
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['REPORT_TAMPERED']);
  assert.equal(outcome.blocks[0].subject, 'web');
  assert.match(outcome.nextAction, /qa run/u);
});

test('报告副本缺失、被换成目录或符号链接时同样阻断', (t) => {
  const s = scenarioFor(t);
  prepare(s);
  const copy = s.copyFile('web');

  fs.rmSync(copy);
  assert.deepEqual(codesOf(evaluate(s).blocks), ['REPORT_TAMPERED'], '副本缺失');

  prepare(s);
  fs.rmSync(copy);
  fs.mkdirSync(copy);
  assert.deepEqual(codesOf(evaluate(s).blocks), ['REPORT_TAMPERED'], '副本被换成目录');

  prepare(s);
  const content = path.join(s.aux, 'web-copy.xml');
  fs.copyFileSync(copy, content);
  fs.rmSync(copy);
  if (!symlinkOrSkip(t, content, copy)) return;
  // 符号链接指向内容完全相同的文件，SHA256 仍一致，但门禁只接受普通文件。
  assert.deepEqual(codesOf(evaluate(s).blocks), ['REPORT_TAMPERED'], '副本被换成符号链接');
});

test('仓库内报告文件被改动不影响判定，门禁只信任容器里的副本', (t) => {
  const s = scenarioFor(t);
  prepare(s);
  fs.writeFileSync(path.join(s.project.repo, 'reports', 'web.xml'), '<被改过的报告');
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'PASS', show(outcome));
});

test('只改结果里的派生字段会被重算发现（RESULTS_MISMATCH），伪造的通过不放行', (t) => {
  const s = scenarioFor(t);
  // 套件退出码为 0，但报告里 AC-SHOP-001-02 失败；结果如实记录时门禁必须阻断。
  prepare(s, { web: withStatus(WEB_CASES, 'TC-SHOP-002', 'failed') });
  assert.deepEqual(blocksOf(evaluate(s), 'AC_NOT_PROVEN').map((block) => block.subject), ['AC-SHOP-001-02']);

  s.editResults((results) => {
    results.acs['AC-SHOP-001-02'].status = 'passed';
    results.acs['AC-SHOP-001-02'].by_platform.web = 'passed';
  });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.ok(outcome.blocks.length > 0);
  assert.equal(new Set(codesOf(outcome.blocks)).size, 1);
  assert.equal(outcome.blocks[0].code, 'RESULTS_MISMATCH');
  assert.ok(outcome.blocks.some((block) => block.subject === 'acs.AC-SHOP-001-02.status'), show(outcome));
  assert.deepEqual(outcome.risks, []);
});

test('同时改副本并重写 SHA256 与字节数，但派生字段不动，仍被重算发现', (t) => {
  const s = scenarioFor(t);
  prepare(s, { web: withStatus(WEB_CASES, 'TC-SHOP-002', 'failed') });
  const copy = s.copyFile('web');
  const forged = fs.readFileSync(copy, 'utf8').replace('<failure message="boom">stack</failure>', '');
  assert.notEqual(forged, fs.readFileSync(copy, 'utf8'), '夹具应当真的去掉了失败标记');
  fs.writeFileSync(copy, forged);
  s.editResults((results) => {
    const report = results.suites.find((suite) => suite.name === 'web').report;
    report.sha256 = sha256Hex(forged);
    report.bytes = Buffer.byteLength(forged);
  });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual([...new Set(codesOf(outcome.blocks))], ['RESULTS_MISMATCH']);
});

test('副本被换成无法解析的内容且摘要同步重写时，以 RESULTS_MISMATCH 阻断', (t) => {
  const s = scenarioFor(t);
  prepare(s);
  const broken = '<testsuites><未闭合';
  fs.writeFileSync(s.copyFile('web'), broken);
  s.editResults((results) => {
    const report = results.suites.find((suite) => suite.name === 'web').report;
    report.sha256 = sha256Hex(broken);
    report.bytes = Buffer.byteLength(broken);
  });
  const outcome = evaluate(s);

  assert.deepEqual(codesOf(outcome.blocks), ['RESULTS_MISMATCH'], show(outcome));
  assert.match(outcome.blocks[0].detail, /无法再次解析/u);
});

test('结果里少了一个已配置的套件，即使派生字段被一并重算，也以 RESULTS_MISMATCH 阻断', (t) => {
  const s = scenarioFor(t);
  // ios 套件失败；伪造者把它的记录整个删掉，并按“只有 web 运行过”重算 tcs/acs/paths/summary，
  // 逐字段重算已无差异——只有“已配置套件与结果记录的套件是否一致”这一项能发现它。
  prepare(s, { ios: withStatus(IOS_CASES, 'iOS', 'failed'), iosCode: 1 });
  const { spec } = analyzeSpec({ repoRoot: s.project.repo });
  const web = parseJunitReport(fs.readFileSync(s.copyFile('web')), { maxBytes: MAX_REPORT_BYTES });
  assert.equal(web.ok, true);
  const forged = aggregateResults({ spec, suites: [{ name: 'web', platform: 'web', cases: web.cases }] });
  s.editResults((results) => {
    results.suites = results.suites.filter((suite) => suite.name === 'web');
    Object.assign(results, {
      tcs: forged.tcs, acs: forged.acs, paths: forged.paths, unknown_ids: forged.unknown_ids, summary: forged.summary,
    });
  });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['RESULTS_MISMATCH'], show(outcome));
  assert.equal(outcome.blocks[0].subject, 'suites');
  assert.match(outcome.blocks[0].detail, /ios/u);
  assert.deepEqual(outcome.risks, []);
});

test('运行后又改了 PRD（未提交）会因规格变化被重算发现', (t) => {
  const s = scenarioFor(t);
  prepare(s);
  s.project.write({
    [PRD_FILE]: prdDocument(SHOP_ACS.map((row) => (row.id === 'AC-SHOP-001-03' ? { ...row, priority: 'P0' } : row))),
  });
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual([...new Set(codesOf(outcome.blocks))], ['RESULTS_MISMATCH']);
  assert.ok(outcome.blocks.some((block) => /AC-SHOP-001-03/u.test(block.subject)), show(outcome));
});

test('差异很多时只列前 10 项，并给出未列出的数量', (t) => {
  const s = scenarioFor(t);
  prepare(s);
  s.editResults((results) => {
    // 4 条 AC × 3 个字段 = 12 处差异。
    for (const record of Object.values(results.acs)) {
      record.priority = 'P3';
      record.status = 'failed';
      record.verification = record.verification === 'auto' ? 'manual' : 'auto';
    }
  });
  const outcome = evaluate(s);

  const mismatches = blocksOf(outcome, 'RESULTS_MISMATCH');
  assert.equal(mismatches.length, 11, show(outcome));
  assert.equal(mismatches.slice(0, 10).every((block) => block.subject.startsWith('acs.')), true);
  assert.match(mismatches[10].detail, /另有 2 项差异未列出/u);
});

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

// ---------------------------------------------------------------------------
// 配置与规格（第 1、2 步）
// ---------------------------------------------------------------------------

test('配置非法时第一步阻断，逐项报告字段，不读取规格与结果', (t) => {
  const s = scenarioFor(t);
  s.configure([{ name: 'Bad Name', platform: 'web', command: 'true', report: 'reports/x.xml' }]);
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.ok(outcome.blocks.length >= 1);
  assert.deepEqual([...new Set(codesOf(outcome.blocks))], ['CONFIG_INVALID']);
  assert.ok(outcome.blocks.every((block) => block.subject.startsWith('qa.business')), show(outcome));
  assert.ok(outcome.blocks.some((block) => /name/u.test(block.subject)), show(outcome));
  assert.match(outcome.nextAction, /qa\.business|agent\.config\.json/u);
  assert.equal(fs.existsSync(s.project.tmp), false);
});

test('开启业务测试但没有配置任何套件时同样按配置非法处理', (t) => {
  const s = scenarioFor(t);
  s.configure([]);
  const outcome = evaluate(s);

  assert.deepEqual(codesOf(outcome.blocks), ['CONFIG_INVALID'], show(outcome));
  assert.equal(outcome.blocks[0].subject, 'qa.business.suites');
});

test('enabled 无法判读时按已开启并阻断（失败即关闭）', (t) => {
  const s = scenarioFor(t);
  const outcome = evaluate(s, { config: { qa: { business: { enabled: 'yes', suites: [] } } } });

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.ok(outcome.blocks.some((block) => block.code === 'CONFIG_INVALID' && block.subject === 'qa.business.enabled'), show(outcome));
});

test('项目没有任何原子 AC 表时阻断为 NO_ATOMIC_AC，不再追问结果文件', (t) => {
  const s = scenarioFor(t, { shop: false });
  s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES })]);
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['NO_ATOMIC_AC']);
  assert.equal(fs.existsSync(s.project.tmp), false);
});

test('路径模型违规时阻断为 SPEC_INVALID，附原始违规代码与位置', (t) => {
  const s = scenarioFor(t, {
    files: {
      [PATHS_FILE]: pathsDocument(shopPaths((model) => { model.paths[0][1] = 'TRN-SHOP-001 → TRN-SHOP-099'; })),
    },
  });
  s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES })]);
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual([...new Set(codesOf(outcome.blocks))], ['SPEC_INVALID']);
  const unknown = outcome.blocks.find((block) => /^REF_UNKNOWN: /u.test(block.detail));
  assert.ok(unknown, show(outcome));
  assert.match(unknown.subject, /^docs\/qa-modules\/shop\/PATHS\.md(:\d+)?$/u);
});

test('运行后规格被改坏时，SPEC_INVALID 先于结果比对阻断', (t) => {
  const s = scenarioFor(t);
  prepare(s);
  s.project.write({
    [PATHS_FILE]: pathsDocument(shopPaths((model) => { model.paths[0][1] = 'TRN-SHOP-001 → TRN-SHOP-099'; })),
  });
  const outcome = evaluate(s);

  assert.deepEqual([...new Set(codesOf(outcome.blocks))], ['SPEC_INVALID'], show(outcome));
});

// ---------------------------------------------------------------------------
// 输出契约、确定性、只读与失败即关闭
// ---------------------------------------------------------------------------

test('判定结果与输出文本在重复调用时逐字节一致', (t) => {
  const s = scenarioFor(t);
  prepare(s, { web: withStatus(WEB_CASES, 'TC-SHOP-002', 'failed'), webCode: 1 });
  const first = evaluate(s);
  const second = evaluate(s);

  assert.deepEqual(second, first);
  assert.equal(formatBusinessGate(second).join('\n'), formatBusinessGate(first).join('\n'));
});

test('门禁是只读的：不创建、不修改任何文件（含阻断与放行两种结果）', (t) => {
  const s = scenarioFor(t);
  prepare(s, { web: withStatus(WEB_CASES, 'TC-SHOP-002', 'failed') });
  const before = snapshot(s.project.root);
  const blocked = evaluate(s);
  assert.equal(blocked.status, 'BLOCKED');
  assert.deepEqual(snapshot(s.project.root), before);

  const clean = scenarioFor(t);
  prepare(clean);
  const cleanBefore = snapshot(clean.project.root);
  assert.equal(evaluate(clean).status, 'PASS');
  assert.deepEqual(snapshot(clean.project.root), cleanBefore);
});

test('输出行不会被多行文本、竖线或控制字符破坏，超长说明被截断', () => {
  const lines = formatBusinessGate({
    status: 'BLOCKED',
    summary: '阻断 1 项\nBUSINESS_GATE=PASS',
    blocks: [{
      code: 'AC_NOT_PROVEN',
      subject: 'AC|X\n注入',
      detail: `第一行\n第二行\r\n\u0007控制字符${'长'.repeat(1000)}`,
    }],
    risks: [{ code: 'RISK_MANUAL_AC', detail: 'a\nb\tc' }],
    nextAction: '重新运行\nBUSINESS_GATE=PASS',
  });

  assert.equal(lines.filter((line) => line.startsWith('BUSINESS_GATE=')).length, 1, lines.join('\n'));
  assert.equal(lines[0], 'BUSINESS_GATE=BLOCKED');
  for (const line of lines) assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u, JSON.stringify(line));

  const block = lines.find((line) => line.startsWith('BUSINESS_BLOCK='));
  const [code, subject, ...rest] = block.slice('BUSINESS_BLOCK='.length).split('|');
  assert.equal(code, 'AC_NOT_PROVEN');
  assert.equal(subject, 'AC/X 注入');
  const detail = rest.join('|');
  assert.ok(Array.from(detail).length <= 400, `detail 长度 ${Array.from(detail).length}`);
  assert.ok(detail.endsWith('…'));
  assert.ok(lines.includes('BUSINESS_RISK=RISK_MANUAL_AC|a b c'), lines.join('\n'));
});

test('入参不合法或内部出错时按阻断处理（GATE_ERROR），不抛出异常', (t) => {
  const s = scenarioFor(t);
  prepare(s);

  const badHead = evaluate(s, { headSha: 'xyz' });
  assert.equal(badHead.status, 'BLOCKED');
  assert.deepEqual(codesOf(badHead.blocks), ['GATE_ERROR']);
  assert.match(badHead.blocks[0].detail, /headSha/u);

  const noConfig = evaluate(s, { config: null });
  assert.deepEqual(codesOf(noConfig.blocks), ['GATE_ERROR']);

  const noOptions = evaluateBusinessGate();
  assert.equal(noOptions.status, 'BLOCKED');
  assert.deepEqual(codesOf(noOptions.blocks), ['GATE_ERROR']);
  assert.match(formatBusinessGate(noOptions).join('\n'), /^BUSINESS_BLOCK=GATE_ERROR\|-\|/mu);
});

// ---------------------------------------------------------------------------
// qa verify 接入：verifyBusinessAcceptance
// ---------------------------------------------------------------------------

const verifyOptions = (s, overrides = {}) => ({
  repoRoot: s.project.repo,
  mainRoot: s.project.repo,
  config: s.config(),
  headSha: s.head(),
  ...overrides,
});

// 沿用场景已加载的配置，只替换 qa.business 的个别字段（如 enabled）。
function withBusiness(s, patch) {
  const config = s.config();
  return { ...config, qa: { ...config.qa, business: { ...config.qa.business, ...patch } } };
}

const SILENT = Object.freeze({ enabled: false, blocked: false, lines: [], outcome: null });

test('qa.business 未启用时接入函数不读规格与结果、不输出任何行', (t) => {
  const absent = path.resolve('business-gate-nonexistent-root');
  const disabledConfigs = [
    {},
    { qa: {} },
    { qa: { business: {} } },
    { qa: { business: { enabled: false } } },
    { qa: { business: { enabled: false, suites: 'not-a-list' } } },
  ];
  for (const config of disabledConfigs) {
    const result = verifyBusinessAcceptance({ repoRoot: absent, mainRoot: absent, config, headSha: 'not-a-sha' });
    assert.deepEqual(result, SILENT, JSON.stringify(config));
  }
  assert.equal(fs.existsSync(absent), false);

  // 结果文件已损坏时，关闭状态仍然什么都不读；同一份数据在启用状态下才被读到并阻断。
  const s = scenarioFor(t);
  prepare(s);
  fs.writeFileSync(s.resultsFile, '损坏的结果文件，未启用时不得被读取');
  const before = snapshot(s.project.root);

  assert.deepEqual(verifyBusinessAcceptance(verifyOptions(s, { config: withBusiness(s, { enabled: false }) })), SILENT);
  assert.deepEqual(snapshot(s.project.root), before);

  const enabled = verifyBusinessAcceptance(verifyOptions(s));
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.blocked, true);
  assert.deepEqual(codesOf(enabled.outcome.blocks), ['RESULTS_INVALID']);
});

test('启用后接入函数在必需 AC 都被证明时放行，返回可直接打印的输出行并披露风险', (t) => {
  const s = scenarioFor(t);
  prepare(s);
  const result = verifyBusinessAcceptance(verifyOptions(s));

  assert.equal(result.enabled, true);
  assert.equal(result.blocked, false, result.lines.join('\n'));
  assert.equal(result.outcome.status, 'PASS');
  assert.deepEqual(result.lines, formatBusinessGate(evaluate(s)));
  assert.equal(result.lines[0], 'BUSINESS_GATE=PASS');
  assert.ok(result.lines.some((line) => /^BUSINESS_RISK=RISK_MANUAL_AC\|.*AC-SHOP-002-01/u.test(line)), result.lines.join('\n'));
});

test('启用后接入函数在 AC 未被证明时阻断，输出行与门禁判定一致', (t) => {
  const s = scenarioFor(t);
  prepare(s, { web: withStatus(WEB_CASES, 'TC-SHOP-002', 'failed') });
  const result = verifyBusinessAcceptance(verifyOptions(s));

  assert.equal(result.enabled, true);
  assert.equal(result.blocked, true);
  assert.equal(result.outcome.status, 'BLOCKED');
  assert.deepEqual(result.lines, formatBusinessGate(evaluate(s)));
  assert.equal(result.lines[0], 'BUSINESS_GATE=BLOCKED');
  assert.ok(result.lines.some((line) => /^BUSINESS_BLOCK=AC_NOT_PROVEN\|AC-SHOP-001-02\|/u.test(line)), result.lines.join('\n'));
  assert.ok(result.lines.some((line) => line.startsWith('BUSINESS_NEXT_ACTION=')), result.lines.join('\n'));
});

test('启用后 HEAD 不符或结果缺失时接入函数阻断，并提示重新运行 qa run', (t) => {
  const s = scenarioFor(t);
  prepare(s);

  const stale = verifyBusinessAcceptance(verifyOptions(s, { headSha: HEAD_FOREIGN }));
  assert.equal(stale.blocked, true);
  assert.deepEqual(codesOf(stale.outcome.blocks), ['RESULTS_STALE_HEAD']);
  assert.match(stale.lines.join('\n'), /^BUSINESS_NEXT_ACTION=.*qa run/mu);

  fs.rmSync(s.resultsDir, { recursive: true, force: true });
  const missing = verifyBusinessAcceptance(verifyOptions(s));
  assert.equal(missing.blocked, true);
  assert.deepEqual(codesOf(missing.outcome.blocks), ['RESULTS_MISSING']);
  assert.match(missing.lines.join('\n'), /^BUSINESS_NEXT_ACTION=.*qa run/mu);
});

test('enabled 不是布尔值时按启用处理并阻断，不会悄悄关闭门禁', (t) => {
  const s = scenarioFor(t);
  prepare(s);

  for (const enabled of ['false', 0, null, 'yes']) {
    const result = verifyBusinessAcceptance(verifyOptions(s, { config: withBusiness(s, { enabled }) }));
    assert.equal(result.enabled, true, JSON.stringify(enabled));
    assert.equal(result.blocked, true, JSON.stringify(enabled));
    const [invalid] = blocksOf(result.outcome, 'CONFIG_INVALID');
    assert.ok(invalid, result.lines.join('\n'));
    assert.equal(invalid.subject, 'qa.business.enabled');
  }
});

test('开关键拼错时（合并默认值后 enabled 仍为 false）按启用处理并阻断，不会悄悄关闭门禁', (t) => {
  const s = scenarioFor(t);
  prepare(s);

  for (const [key, patch] of [['enable', { enable: true }], ['requiredPriority', { requiredPriority: ['P0', 'P1'] }]]) {
    const result = verifyBusinessAcceptance(verifyOptions(s, { config: withBusiness(s, { enabled: false, ...patch }) }));
    assert.equal(result.enabled, true, key);
    assert.equal(result.blocked, true, key);
    const [invalid] = blocksOf(result.outcome, 'CONFIG_INVALID');
    assert.ok(invalid, result.lines.join('\n'));
    assert.equal(invalid.subject, `qa.business.${key}`);
  }
});

test('入参不合法或读取配置出错时接入函数按阻断处理（GATE_ERROR），不抛出异常', () => {
  const gateError = (result) => {
    assert.equal(result.enabled, true);
    assert.equal(result.blocked, true);
    assert.deepEqual(codesOf(result.outcome.blocks), ['GATE_ERROR']);
    assert.equal(result.lines[0], 'BUSINESS_GATE=BLOCKED');
    assert.match(result.lines.join('\n'), /^BUSINESS_BLOCK=GATE_ERROR\|-\|/mu);
    assert.match(result.lines.join('\n'), /^BUSINESS_NEXT_ACTION=\S/mu);
    return result;
  };
  const absent = path.resolve('business-gate-nonexistent-root');

  gateError(verifyBusinessAcceptance());
  gateError(verifyBusinessAcceptance(null));
  gateError(verifyBusinessAcceptance({ repoRoot: absent, headSha: HEAD_FOREIGN }));
  gateError(verifyBusinessAcceptance({ repoRoot: absent, config: null, headSha: HEAD_FOREIGN }));
  gateError(verifyBusinessAcceptance({ repoRoot: absent, config: 'qa.business', headSha: HEAD_FOREIGN }));
  gateError(verifyBusinessAcceptance({ repoRoot: absent, config: [], headSha: HEAD_FOREIGN }));

  const unreadable = { get qa() { throw new Error('配置读取失败'); } };
  const result = gateError(verifyBusinessAcceptance({ repoRoot: absent, config: unreadable, headSha: HEAD_FOREIGN }));
  assert.match(result.outcome.blocks[0].detail, /配置读取失败/u);
  assert.equal(fs.existsSync(absent), false);
});

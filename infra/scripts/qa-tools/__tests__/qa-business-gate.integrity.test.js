'use strict';

// 业务验收门禁（qa verify 的业务测试段）的判定测试：完整性（报告副本与重算）。
// 结果文件由真实的 `qa run` 针对桩套件生成，门禁读到的因此是生产代码写出的数据；各用例再改动仓库、
// 结果文件或报告副本来制造“陈旧、被改动、失败、缺失”等状态，核对门禁给出的阻断代码、披露项与判定顺序。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MAX_REPORT_BYTES, aggregateResults, parseJunitReport } = require('../business-results');
const { analyzeSpec } = require('../qa-paths');
const { IOS_CASES, WEB_CASES, withStatus } = require('./fixtures/business-testing/scenario');
const { SHOP_ACS, prdDocument } = require('./fixtures/business-testing/builders');
const {
  PRD_FILE,
  blocksOf,
  codesOf,
  evaluate,
  prepare,
  scenarioFor,
  sha256Hex,
  show,
  symlinkOrSkip,
} = require('./qa-business-gate.helpers');

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

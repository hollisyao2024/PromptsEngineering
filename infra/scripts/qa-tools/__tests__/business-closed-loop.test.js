'use strict';

// 业务测试闭环。
//
// 这里不再单测某个脚本，而是把整条链路当作黑盒：临时 Git 项目里放好 PRD 原子 AC 表、PATHS.md 和会产出
// JUnit 报告的桩套件；真实的 `qa run` 写结果，真实的 `qa verify`（cwd 为该项目）读结果并判定。
// 基线全绿之后一次只破坏一处——用例失败 / 跳过 / 缺失、结果陈旧、报告副本被改、工作区不干净、配置漂移、
// 套件硬失败、结果缺失、规格违规——门禁必须变红，给出对应的稳定错误码，并且不签发回执；恢复后必须重新变绿。
// 每一次“变红”都是对门禁的一个反例证明（R-BIZ-001：门禁可证伪）。测试自己不构造结果，也不替门禁下结论。
//
// 非功能性要求同样在这里验证：确定性、规模（500 条 AC / 2000 个用例）与安全负例。
// 信任边界是“可发现篡改”而不是“防篡改”：对内部完全自洽的整体伪造不做任何断言。
//
// 本文件覆盖闭环与伪造识别；确定性与规模见 business-closed-loop.determinism.test.js，
// 安全负例见 business-closed-loop.security.test.js，共享 helper 见 business-closed-loop.helpers.js。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { BLOCK_CODES } = require('../qa-business-gate');
const {
  SHOP_ACS,
  lineOf,
  prdDocument,
  runGit,
} = require('./fixtures/business-testing/builders');
const { WEB_CASES, withStatus } = require('./fixtures/business-testing/scenario');
const { advanceHead, readyForVerify, runVerify } = require('./fixtures/business-testing/verify');
const {
  PRD_FILE,
  CONFIG_FILE,
  RECEIPT_KEYS,
  output,
  has,
  readReceiptFile,
  gitStatus,
  scenarioFor,
  rewriteWeb,
  runOk,
  assertGreen,
  cycleOf,
} = require('./business-closed-loop.helpers');

// ---------------------------------------------------------------------------
// 1. 闭环：基线全绿 → 逐个破坏 → 变红 → 恢复 → 变绿
// ---------------------------------------------------------------------------

test('闭环——基线全绿，逐个破坏后门禁变红并给出对应错误码、不签发回执，恢复后重新变绿', async (t) => {
  const s = scenarioFor(t);
  readyForVerify(s);
  const observed = new Set();
  const cycle = (name, plan) => cycleOf(t, s, observed, name, plan);
  const stray = path.join(s.project.repo, 'stray.txt');
  const brokenPrd = prdDocument(SHOP_ACS.map((row) => (row.id === 'AC-SHOP-001-02' ? { ...row, priority: 'P9' } : row)));

  await t.test('基线：结果由真实 qa run 写在容器 tmp，门禁通过后才签发回执，仓库保持干净', () => {
    const run = runVerify(s);
    assertGreen(s, run);
    const receipt = readReceiptFile(s);
    assert.deepEqual(Object.keys(receipt).sort(), RECEIPT_KEYS);
    assert.equal(receipt.schema_version, 1);
    assert.equal(receipt.business.gate, 'PASS');
    assert.deepEqual(receipt.business.required_priorities, ['P0']);
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

test('伪造——改写聚合结果或替换报告副本都被门禁识破，不会被当作通过', async (t) => {
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

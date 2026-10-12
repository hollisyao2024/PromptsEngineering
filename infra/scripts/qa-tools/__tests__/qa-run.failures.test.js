'use strict';

// qa run 的运行层测试：必需优先级 AC 未证明与套件硬失败。
// 套件命令是 fixtures/business-testing/suites 下的桩脚本：
// emit.js 复制预置报告并按指定退出码结束，hang.js 启动孙进程后挂起。
// 每个场景都在 <root>/repo 下建立真实 git 仓库，结果落在 <root>/tmp 的容器目录；共享 helper 见 qa-run.helpers.js。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { runBusinessSuites } = require('../qa-run');
const { junitReport } = require('./fixtures/business-testing/builders');
const {
  HANG_TIMEOUT_SECONDS,
  SLOW_START_MS,
  HELD_TIMEOUT_SECONDS,
  WEB_CASES,
  IOS_CASES,
  fieldsOf,
  fieldOf,
  assertAllDead,
  readPids,
  reap,
  runCli,
  createScenario,
  startHungSuite,
  expectNotProven,
} = require('./qa-run.helpers');

// ---------------------------------------------------------------- 必需优先级 AC 未证明：与 qa verify 同一判定，qa run 也不放行

test('必需优先级的自动化 AC 没有任何用例时 FAILED(AC_NOT_PROVEN)，结果与套件记录照常输出', () => {
  const s = createScenario();
  try {
    s.configure([
      s.suite('web', { platform: 'web', cases: WEB_CASES.slice(1) }), // 去掉 AC-SHOP-001-01 的用例
      s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
    ]);

    const result = runCli(s.project);

    expectNotProven(result, ['AC-SHOP-001-01']);
    assert.match(fieldsOf(result.stdout, 'AC_OPEN')[0], /^AC-SHOP-001-01\|P0\|missing\|/u);
    assert.match(fieldOf(result.stdout, 'SUMMARY'), /有 1 条必需优先级（P0）的自动化 AC 未证明/u, '摘要要点出未证明的 AC 数量与必需优先级');
    assert.match(fieldOf(result.stdout, 'NEXT_ACTION'), /AC_OPEN/u);
    assert.match(fieldOf(result.stdout, 'NEXT_ACTION'), /pnpm agent -- qa run/u);
    assert.deepEqual(fieldsOf(result.stdout, 'SUITE').map((line) => line.split('|').slice(0, 3).join('|')), ['web|web|ok', 'ios|ios|ok']);
    assert.equal(fieldOf(result.stdout, 'RESULTS_FILE'), s.resultsFile);
    assert.equal(s.results().ok, true);
  } finally {
    s.cleanup();
  }
});

test('必需优先级的自动化 AC 的用例全部被跳过时 FAILED(AC_NOT_PROVEN)，状态为 skipped', () => {
  const s = createScenario();
  try {
    const skipped = [{ ...WEB_CASES[0], status: 'skipped' }, ...WEB_CASES.slice(1)];
    s.configure([
      s.suite('web', { platform: 'web', cases: skipped }),
      s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
    ]);

    const result = runCli(s.project);

    expectNotProven(result, ['AC-SHOP-001-01']);
    assert.match(fieldsOf(result.stdout, 'AC_OPEN')[0], /^AC-SHOP-001-01\|P0\|skipped\|/u);
    assert.equal(s.results().results.acs['AC-SHOP-001-01'].status, 'skipped');
  } finally {
    s.cleanup();
  }
});

test('库接口同样以 FAILED/AC_NOT_PROVEN 返回，并带上未证明的 AC 与已写出的结果文件', async () => {
  const s = createScenario();
  try {
    s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES })]);

    const outcome = await runBusinessSuites(s.libraryOptions());

    assert.equal(outcome.status, 'FAILED');
    assert.equal(outcome.reason, 'AC_NOT_PROVEN');
    assert.deepEqual(outcome.acOpen.map((item) => [item.id, item.priority, item.state]), [['AC-SHOP-001-02', 'P0', 'missing']]);
    assert.equal(outcome.resultsFile, s.resultsFile);
    assert.equal(s.results().ok, true);
  } finally {
    s.cleanup();
  }
});

test('低于必需优先级的自动化 AC 与 manual 的 AC 未证明时仍 STATUS=OK，AC_OPEN 为空', () => {
  const s = createScenario();
  try {
    // AC-SHOP-001-03 是 P1 自动化 AC，AC-SHOP-002-01 是 P0 的 manual AC：默认只要求 P0 的自动化 AC。
    s.configure([
      s.suite('web', { platform: 'web', cases: WEB_CASES.slice(0, 2) }),
      s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
    ]);

    const result = runCli(s.project);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fieldOf(result.stdout, 'STATUS'), 'OK');
    assert.equal(fieldOf(result.stdout, 'REASON'), undefined);
    assert.deepEqual(fieldsOf(result.stdout, 'AC_OPEN'), []);
    assert.equal(s.results().results.acs['AC-SHOP-001-03'].status, 'missing');
  } finally {
    s.cleanup();
  }
});

test('requiredPriorities 放宽到 P1 后，P1 的自动化 AC 缺用例同样 FAILED(AC_NOT_PROVEN)', () => {
  const s = createScenario();
  try {
    s.configure([
      s.suite('web', { platform: 'web', cases: WEB_CASES.slice(0, 2) }),
      s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
    ], { requiredPriorities: ['P0', 'P1'] });

    const result = runCli(s.project);

    expectNotProven(result, ['AC-SHOP-001-03']);
    assert.match(fieldsOf(result.stdout, 'AC_OPEN')[0], /^AC-SHOP-001-03\|P1\|missing\|/u);
    assert.match(fieldOf(result.stdout, 'SUMMARY'), /必需优先级（P0\/P1）/u, '摘要列出配置的必需优先级');
  } finally {
    s.cleanup();
  }
});

// ---------------------------------------------------------------- 硬失败：套件不会掩盖，后续套件继续

test('套件无法启动时记录 spawn_error 并仍写出结果', async () => {
  const s = createScenario();
  try {
    s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES })]);

    const outcome = await runBusinessSuites(s.libraryOptions({
      shell: '/nonexistent/shell',
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    }));

    assert.equal(outcome.status, 'FAILED');
    assert.equal(outcome.reason, 'SUITE_FAILED');
    const [suite] = outcome.results.suites;
    assert.equal(suite.status, 'spawn_error');
    assert.equal(suite.exit_code, null);
    assert.equal(suite.cases, 0);
    assert.equal(suite.report, null);
    assert.match(suite.detail, /无法启动套件命令/u);
    const read = s.results();
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.equal(read.results.suites[0].status, 'spawn_error');
    assert.equal(read.results.generated_at, '2026-01-02T03:04:05.000Z');
  } finally {
    s.cleanup();
  }
});

// 真实计时器、走 CLI：桩套件的启动延迟长于超时窗口，所以它在写出 pid 文件之前就被终止。
// 用例因此不依赖桩套件的启动速度，快机器和慢机器上的行为一致；进程树的终止由下面持有计时器的用例验证。
test('套件超时后记录 timeout，后续套件继续运行', () => {
  const s = createScenario();
  const pidFile = path.join(s.aux, 'slow.pids');
  try {
    s.configure([
      s.hang('slow', { platform: 'web', pidFile, startupDelayMs: SLOW_START_MS }),
      s.suite('after', { platform: 'web', cases: WEB_CASES }),
    ]);

    const result = runCli(s.project);

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(fieldOf(result.stdout, 'STATUS'), 'FAILED');
    assert.equal(fieldOf(result.stdout, 'REASON'), 'SUITE_FAILED');
    const [slow, after] = fieldsOf(result.stdout, 'SUITE');
    assert.match(slow, new RegExp(`^slow\\|web\\|timeout\\|exit=-\\|\\d+ms\\|0 cases\\|sha256=-\\|运行超过 ${HANG_TIMEOUT_SECONDS} 秒被终止$`, 'u'));
    assert.match(after, /^after\|web\|ok\|exit=0\|/u);
    const results = s.results().results;
    assert.deepEqual(results.suites.map((suite) => suite.status), ['timeout', 'ok']);
    assert.ok(
      results.suites[0].duration_ms >= HANG_TIMEOUT_SECONDS * 1000 - 100,
      `超时套件的耗时应接近限制，实际 ${results.suites[0].duration_ms}ms`,
    );
    assert.equal(results.suites[0].exit_code, null);
  } finally {
    reap(readPids(pidFile));
    s.cleanup();
  }
});

test('套件超时后终止整棵进程树，记录 timeout', async (t) => {
  const s = createScenario();
  let hung = null;
  try {
    // 启动延迟模拟套件启动很慢：用例必须等到进程树出现才触发超时，而不是赌套件够快。
    hung = startHungSuite(t, s, { startupDelayMs: SLOW_START_MS });
    const pids = await hung.ready();

    const outcome = await hung.timeout();

    const [suite] = outcome.results.suites;
    assert.equal(suite.status, 'timeout');
    assert.equal(suite.exit_code, null);
    assert.match(suite.detail, new RegExp(`运行超过 ${HELD_TIMEOUT_SECONDS} 秒被终止`, 'u'));
    await assertAllDead(pids);
  } finally {
    await hung?.dispose();
    s.cleanup();
  }
});

test('套件忽略 SIGTERM 时升级为强制终止，整棵进程树仍被清理', async (t) => {
  const s = createScenario();
  let hung = null;
  try {
    hung = startHungSuite(t, s, { ignoreTerm: true, killGraceMs: 200 });
    const pids = await hung.ready();

    const outcome = await hung.timeout();

    assert.equal(outcome.results.suites[0].status, 'timeout');
    await assertAllDead(pids);
  } finally {
    await hung?.dispose();
    s.cleanup();
  }
});

test('套件没有产出报告时记录 report_missing，后续套件继续运行', () => {
  const s = createScenario();
  try {
    s.configure([
      s.suite('quiet', { platform: 'web' }),
      s.suite('next', { platform: 'web', cases: WEB_CASES }),
    ]);

    const result = runCli(s.project);

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(s.markers().map((marker) => marker.label), ['quiet', 'next']);
    const [quiet, next] = s.results().results.suites;
    assert.equal(quiet.status, 'report_missing');
    assert.equal(quiet.report, null);
    assert.equal(quiet.cases, 0);
    assert.equal(next.status, 'ok');
  } finally {
    s.cleanup();
  }
});

const INVALID_REPORTS = [
  ['零个 testcase', junitReport([], { suite: 'broken' })],
  [
    '带 DOCTYPE 的报告（即使里面有通过的用例）',
    '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><testsuites><testsuite name="s"><testcase name="AC-SHOP-001-01 passes"/></testsuite></testsuites>\n',
  ],
  ['不是 XML 的文本', '这不是 XML 报告\n'],
];

for (const [label, xml] of INVALID_REPORTS) {
  test(`报告无效（${label}）时记录 report_invalid，不绑定任何用例，后续套件继续运行`, () => {
    const s = createScenario();
    try {
      s.configure([
        s.suite('broken', { platform: 'web', xml }),
        s.suite('next', { platform: 'web', cases: WEB_CASES }),
      ]);

      const result = runCli(s.project);

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.deepEqual(s.markers().map((marker) => marker.label), ['broken', 'next']);
      const results = s.results().results;
      assert.equal(results.suites[0].status, 'report_invalid');
      assert.equal(results.suites[0].report, null);
      assert.equal(results.suites[0].cases, 0);
      assert.equal(results.suites[1].status, 'ok');
      assert.equal(results.summary.cases.total, 3, '无效报告里的用例不得计入');
    } finally {
      s.cleanup();
    }
  });
}

test('DOCTYPE 报告里“通过”的用例不会让 AC 通过', () => {
  const s = createScenario();
  try {
    const xml = INVALID_REPORTS[1][1];
    s.configure([s.suite('broken', { platform: 'web', xml })]);

    runCli(s.project);

    assert.equal(s.results().results.acs['AC-SHOP-001-01'].status, 'missing');
  } finally {
    s.cleanup();
  }
});

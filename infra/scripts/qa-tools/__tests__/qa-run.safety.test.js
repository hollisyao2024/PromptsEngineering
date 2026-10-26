'use strict';

// qa run 的运行层测试：陈旧产物与路径安全、工作区状态、运行环境与输出、中断。
// 套件命令是 fixtures/business-testing/suites 下的桩脚本：
// emit.js 复制预置报告并按指定退出码结束，hang.js 启动孙进程后挂起。
// 每个场景都在 <root>/repo 下建立真实 git 仓库，结果落在 <root>/tmp 的容器目录；共享 helper 见 qa-run.helpers.js。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { junitReport } = require('./fixtures/business-testing/builders');
const { runBusinessSuites } = require('../qa-run');
const {
  WEB_CASES,
  fieldsOf,
  fieldOf,
  assertAllDead,
  waitForPids,
  reap,
  runCli,
  startCli,
  withinCeiling,
  symlinkOrSkip,
  createScenario,
  expectBlocked,
  provingSuites,
  expectUntouched,
} = require('./qa-run.helpers');

// ---------------------------------------------------------------- 陈旧产物与路径安全

test('运行前删除旧报告，套件看不到上一次留下的文件，被忽略的旧报告不弄脏工作区', () => {
  const s = createScenario({ files: { '.gitignore': 'reports/\n', 'reports/web.xml': junitReport(WEB_CASES, { suite: 'stale' }) } });
  try {
    s.configure([s.suite('web', { platform: 'web' })]);
    assert.equal(fs.existsSync(path.join(s.project.repo, 'reports', 'web.xml')), true, '前置条件：旧报告存在');

    const result = runCli(s.project);

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(s.markers().map((marker) => marker.targetExisted), [false]);
    const results = s.results().results;
    assert.equal(results.suites[0].status, 'report_missing');
    assert.equal(results.worktree_clean, true);
  } finally {
    s.cleanup();
  }
});

test('多个套件共用同一报告路径时，每个套件前都重新删除旧报告', () => {
  const s = createScenario();
  try {
    s.configure([
      s.suite('first', { platform: 'web', cases: WEB_CASES, report: 'reports/shared.xml' }),
      s.suite('second', { platform: 'web', report: 'reports/shared.xml' }),
    ]);

    runCli(s.project);

    assert.deepEqual(s.markers().map((marker) => [marker.label, marker.targetExisted]), [['first', false], ['second', false]]);
    assert.deepEqual(s.results().results.suites.map((suite) => suite.status), ['ok', 'report_missing']);
  } finally {
    s.cleanup();
  }
});

test('运行前删除旧的 ac-results.json，运行后写出新的', () => {
  const s = createScenario({ files: { '.gitignore': 'reports/\n' } });
  try {
    s.configure(provingSuites(s));
    assert.equal(runCli(s.project).status, 0);
    assert.equal(fs.existsSync(s.resultsFile), true, '前置条件：第一次运行写出了结果');
    const firstDigest = s.results().results.config_digest;

    s.configure(provingSuites(s, { web: { probe: s.resultsFile } }));
    const second = runCli(s.project);

    assert.equal(second.status, 0, second.stdout + second.stderr);
    // 只有第二次运行的 web 套件带探针：它启动时旧结果已经不存在。
    assert.deepEqual(s.markers().filter((marker) => marker.probeExisted !== null).map((marker) => marker.probeExisted), [false]);
    const read = s.results();
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.notEqual(read.results.config_digest, firstDigest, '第二次运行写出的是新结果');
  } finally {
    s.cleanup();
  }
});

function expectReportPathInvalid(s, name, reportPath, pattern) {
  const result = runCli(s.project);
  expectBlocked(result, 'REPORT_PATH_INVALID');
  const line = fieldsOf(result.stdout, 'REPORT_PATH').find((entry) => entry.startsWith(`${name}|${reportPath}|`));
  assert.ok(line, `缺少 REPORT_PATH=${name}|${reportPath}|…：\n${result.stdout}`);
  assert.match(line, pattern);
  expectUntouched(s);
}

test('报告路径本身是符号链接时 BLOCKED(REPORT_PATH_INVALID)，不删除链接目标', (t) => {
  const s = createScenario();
  try {
    s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES })]);
    const outside = path.join(s.aux, 'outside.xml');
    fs.writeFileSync(outside, '不得被删除\n');
    fs.mkdirSync(path.join(s.project.repo, 'reports'));
    const link = path.join(s.project.repo, 'reports', 'web.xml');
    if (!symlinkOrSkip(t, outside, link)) return;

    expectReportPathInvalid(s, 'web', 'reports/web.xml', /符号链接/u);

    assert.equal(fs.readFileSync(outside, 'utf8'), '不得被删除\n');
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  } finally {
    s.cleanup();
  }
});

test('报告路径的祖先目录是符号链接时 BLOCKED(REPORT_PATH_INVALID)', (t) => {
  const s = createScenario();
  try {
    s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES, report: 'out-link/web.xml' })]);
    const elsewhere = path.join(s.aux, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, 'web.xml'), '不得被删除\n');
    if (!symlinkOrSkip(t, elsewhere, path.join(s.project.repo, 'out-link'), 'dir')) return;

    expectReportPathInvalid(s, 'web', 'out-link/web.xml', /符号链接/u);

    assert.equal(fs.readFileSync(path.join(elsewhere, 'web.xml'), 'utf8'), '不得被删除\n');
  } finally {
    s.cleanup();
  }
});

test('报告路径指向目录时 BLOCKED(REPORT_PATH_INVALID)', () => {
  const s = createScenario();
  try {
    s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES })]);
    fs.mkdirSync(path.join(s.project.repo, 'reports', 'web.xml'), { recursive: true });

    expectReportPathInvalid(s, 'web', 'reports/web.xml', /不是普通文件/u);

    assert.equal(fs.statSync(path.join(s.project.repo, 'reports', 'web.xml')).isDirectory(), true);
  } finally {
    s.cleanup();
  }
});

test('报告已被 git 跟踪时 BLOCKED(REPORT_PATH_INVALID)，提示 git rm --cached 且不删除文件', () => {
  const s = createScenario({ files: { 'reports/web.xml': '已提交的旧报告\n' } });
  try {
    s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES })]);

    expectReportPathInvalid(s, 'web', 'reports/web.xml', /git rm --cached/u);

    assert.equal(fs.readFileSync(path.join(s.project.repo, 'reports', 'web.xml'), 'utf8'), '已提交的旧报告\n');
  } finally {
    s.cleanup();
  }
});

test('报告路径的中间段是普通文件时 BLOCKED(REPORT_PATH_INVALID)', () => {
  const s = createScenario({ files: { 'package.json': '{}\n' } });
  try {
    s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES, report: 'package.json/report.xml' })]);

    expectReportPathInvalid(s, 'web', 'package.json/report.xml', /不是目录/u);

    assert.equal(fs.readFileSync(path.join(s.project.repo, 'package.json'), 'utf8'), '{}\n');
  } finally {
    s.cleanup();
  }
});

// ---------------------------------------------------------------- 工作区状态

test('运行前工作区干净时 WORKTREE_CLEAN=true 且没有警告', () => {
  const s = createScenario();
  try {
    s.configure(provingSuites(s));

    const result = runCli(s.project);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fieldOf(result.stdout, 'WORKTREE_CLEAN'), 'true');
    assert.deepEqual(fieldsOf(result.stdout, 'WARNING'), []);
    assert.equal(s.results().results.worktree_clean, true);
  } finally {
    s.cleanup();
  }
});

test('运行前工作区不干净时照常运行，但记录 worktree_clean=false 并给出 .gitignore 提示', () => {
  const s = createScenario();
  try {
    const head = s.configure(provingSuites(s));
    s.project.write({ 'scratch.txt': '未提交的改动\n' });

    const result = runCli(s.project);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fieldOf(result.stdout, 'STATUS'), 'OK');
    assert.equal(fieldOf(result.stdout, 'WORKTREE_CLEAN'), 'false');
    assert.match(fieldOf(result.stdout, 'WARNING'), /\.gitignore/u);
    const { results } = s.results();
    assert.equal(results.worktree_clean, false);
    assert.equal(results.head_sha, head);
  } finally {
    s.cleanup();
  }
});

// ---------------------------------------------------------------- 运行环境与输出

test('套件在仓库根运行，PATH 首项是当前 node 所在目录', () => {
  const s = createScenario();
  try {
    s.configure(provingSuites(s));

    const result = runCli(s.project);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const started = s.markers();
    assert.equal(started.length, 2, '两个套件都启动了');
    for (const marker of started) {
      assert.equal(marker.cwd, s.project.repo);
      assert.equal(marker.pathFirst, path.dirname(process.execPath));
    }
  } finally {
    s.cleanup();
  }
});

test('套件自己的输出只进 stderr，stdout 只含结构化的 KEY=value 行', () => {
  const s = createScenario();
  try {
    s.configure(provingSuites(s, { web: { prefix: 'echo NOISE-FROM-SUITE && ' } }));

    const result = runCli(s.project);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /NOISE-FROM-SUITE/u);
    assert.match(result.stderr, /NOISE-FROM-SUITE/u);
    for (const line of result.stdout.split('\n').filter(Boolean)) assert.match(line, /^[A-Z][A-Z_]*=/u, line);
  } finally {
    s.cleanup();
  }
});

test('qa.business.enabled 为 false 时 qa run 仍然运行套件', () => {
  const s = createScenario();
  try {
    s.configure(provingSuites(s), { enabled: false });

    const result = runCli(s.project);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(s.markers().length, 2);
    assert.equal(s.results().ok, true);
  } finally {
    s.cleanup();
  }
});

test('--help 打印用法并以 0 退出，不运行任何套件', () => {
  const s = createScenario();
  try {
    s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES })]);

    const result = runCli(s.project, ['--help']);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /qa run/u);
    assert.match(result.stdout, /AC_NOT_PROVEN/u, '用法需要说明必需优先级的 AC 未证明时的结果');
    expectUntouched(s);
  } finally {
    s.cleanup();
  }
});

// ---------------------------------------------------------------- 中断

// Windows 上 child.kill('SIGINT') 实为 TerminateProcess：CLI 的信号处理器不会运行，套件进程树被遗留，
// 且孤儿进程持有 CLI 的 stdio 管道，close 事件永不触发、用例无限挂起。中断路径由下方进程内用例在各平台覆盖。
const CLI_SIGNAL_UNSUPPORTED = process.platform === 'win32'
  && 'Windows 无法从外部向子进程投递可捕获的 SIGINT（TerminateProcess），由进程内中断用例覆盖';

test('运行中收到 SIGINT 时终止整棵进程树、不写结果、不再启动后续套件', { skip: CLI_SIGNAL_UNSUPPORTED }, async () => {
  const s = createScenario();
  let pids = null;
  try {
    const pidFile = path.join(s.aux, 'stuck.pids');
    s.configure([
      s.hang('stuck', { platform: 'web', pidFile, timeoutSeconds: 120 }),
      s.suite('after', { platform: 'web', cases: WEB_CASES }),
    ]);

    const run = startCli(s.project);
    pids = await waitForPids(pidFile);
    run.child.kill('SIGINT');
    const done = await run.closed;

    assert.equal(done.code, 1, done.stdout + done.stderr);
    assert.equal(fieldOf(done.stdout, 'STATUS'), 'FAILED', done.stdout);
    assert.equal(fieldOf(done.stdout, 'REASON'), 'INTERRUPTED', done.stdout);
    await assertAllDead(pids);
    assert.equal(s.results().code, 'RESULTS_MISSING', '被中断的运行不得留下结果');
    assert.deepEqual(s.markers(), [], '被中断后不得启动后续套件');
  } finally {
    reap(pids);
    s.cleanup();
  }
});

// 进程内调用库注册的 SIGINT 处理器（不经 process.emit，避免触发测试框架自身的终止处理器），
// 各平台都验证中断会终止整棵进程树：POSIX 走进程组信号，Windows 走 taskkill /T /F。
test('库接口的 SIGINT 处理器终止整棵进程树、不写结果、不再启动后续套件，并在返回后移除处理器', async () => {
  const s = createScenario();
  const before = new Set(process.listeners('SIGINT'));
  const added = () => process.listeners('SIGINT').filter((handler) => !before.has(handler));
  let pids = null;
  let running = null;
  try {
    const pidFile = path.join(s.aux, 'stuck.pids');
    s.configure([
      s.hang('stuck', { platform: 'web', pidFile, timeoutSeconds: 120 }),
      s.suite('after', { platform: 'web', cases: WEB_CASES }),
    ]);

    running = runBusinessSuites(s.libraryOptions({ handleSignals: true }));
    pids = await waitForPids(pidFile);
    const handlers = added();
    assert.equal(handlers.length, 1, '运行期间库应注册且只注册一个 SIGINT 处理器');
    handlers[0]('SIGINT');
    const outcome = await withinCeiling(running, '库在收到 SIGINT 后没有结束套件运行');

    assert.equal(outcome.status, 'FAILED', outcome.summary);
    assert.equal(outcome.reason, 'INTERRUPTED', outcome.summary);
    await assertAllDead(pids);
    assert.equal(s.results().code, 'RESULTS_MISSING', '被中断的运行不得留下结果');
    assert.deepEqual(s.markers(), [], '被中断后不得启动后续套件');
    assert.deepEqual(added(), [], '运行结束后应移除信号处理器');
  } finally {
    reap(pids);
    if (running) await withinCeiling(running, '库没有结束套件运行').catch(() => {});
    s.cleanup();
  }
});

test('输出逐条列出非必需优先级的未证明自动化 AC 与未通过路径及其 TC', () => {
  const { formatRunReport } = require('../qa-run');
  const lines = formatRunReport({
    status: 'FAILED', reason: 'SUITE_FAILED', summary: 's', nextAction: 'n', worktreeClean: true,
    configErrors: [], violations: [], pathProblems: [], warnings: [],
    acOpen: [{ id: 'AC-A-001-01', priority: 'P0', state: 'failed', reason: '存在失败用例' }],
    resultsFile: '/tmp/r.json',
    results: {
      suites: [],
      unknown_ids: [],
      summary: {
        acs: { total: 4, passed: 1, failed: 2, skipped: 0, missing: 0, manual: 1 },
        cases: { total: 3, passed: 1, failed: 2, error: 0, skipped: 0 },
        paths: { total: 2, passed: 1 },
      },
      tcs: { 'TC-A-1': { status: 'passed' }, 'TC-A-2': { status: 'failed' } },
      acs: {
        'AC-A-001-01': { verification: 'auto', priority: 'P0', status: 'failed', by_platform: {}, platforms: [] },
        'AC-A-002-01': { verification: 'auto', priority: 'P1', status: 'failed', by_platform: {}, platforms: [] },
        'AC-A-003-01': { verification: 'auto', priority: 'P1', status: 'passed', by_platform: {}, platforms: [] },
        'AC-A-004-01': { verification: 'manual', priority: 'P2', status: 'missing', by_platform: {}, platforms: [] },
      },
      paths: {
        'PTH-A-001': { status: 'failed', tcs: ['TC-A-1', 'TC-A-2', 'TC-A-3'] },
        'PTH-A-002': { status: 'passed', tcs: ['TC-A-1'] },
      },
    },
  });
  const field = (name) => lines.filter((line) => line.startsWith(`${name}=`)).map((line) => line.slice(name.length + 1));
  assert.deepEqual(field('AC_OPEN').map((line) => line.split('|')[0]), ['AC-A-001-01']);
  assert.deepEqual(field('AC_UNPROVEN'), ['AC-A-002-01|P1|failed|存在失败用例']);
  assert.deepEqual(field('PATH_OPEN'), ['PTH-A-001|failed|TC-A-2=failed,TC-A-3=missing']);
});

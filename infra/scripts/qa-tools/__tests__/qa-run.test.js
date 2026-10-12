'use strict';

// qa run 的运行层测试：CLI 启动、门禁前置阻断、正常运行与结果绑定、多端绑定。
// 套件命令是 fixtures/business-testing/suites 下的桩脚本：
// emit.js 复制预置报告并按指定退出码结束，hang.js 启动孙进程后挂起。
// 每个场景都在 <root>/repo 下建立真实 git 仓库，结果落在 <root>/tmp 的容器目录；共享 helper 见 qa-run.helpers.js。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadConfig } = require('../../shared/config');
const { resolveBusinessConfig } = require('../business-config');
const {
  commitAll,
  lineOf,
  pathsDocument,
  runGit,
  runNodeScript,
  shopPaths,
} = require('./fixtures/business-testing/builders');
const {
  SCRIPT,
  SUITES,
  PATHS_FILE,
  escapeRegExp,
  sha256Hex,
  statusMap,
  WEB_CASES,
  IOS_CASES,
  fieldsOf,
  fieldOf,
  runCli,
  createScenario,
  expectBlocked,
  provingSuites,
  expectNotProven,
  expectUntouched,
} = require('./qa-run.helpers');

test('CLI 子进程无法启动时，断言消息里带出 signal/error', () => {
  const missingCwd = path.join(SUITES, `missing-${process.pid}`);
  const result = runNodeScript(SCRIPT, { cwd: missingCwd });
  assert.ok(result.error, 'spawnSync 应当报告启动错误');
  assert.match(result.stderr, /\[runNodeScript\] signal=- error=ENOENT /u);
});

// ---------------------------------------------------------------- 门禁前置：阻断且无副作用

test('配置非法时 BLOCKED(CONFIG_INVALID)，不运行套件也不写任何文件', () => {
  const s = createScenario();
  try {
    s.configure([s.suite('Bad Name', { platform: 'web', cases: WEB_CASES })]);

    const result = runCli(s.project);

    expectBlocked(result, 'CONFIG_INVALID');
    assert.match(result.stdout, /^CONFIG_ERROR=qa\.business\.suites\[0\]\.name\|/mu);
    expectUntouched(s);
  } finally {
    s.cleanup();
  }
});

test('没有配置任何套件时 BLOCKED(NO_SUITES)', () => {
  const s = createScenario();
  try {
    expectBlocked(runCli(s.project), 'NO_SUITES');
    s.configure([]);
    expectBlocked(runCli(s.project), 'NO_SUITES');
    expectUntouched(s);
  } finally {
    s.cleanup();
  }
});

test('规格违规时 BLOCKED(SPEC_INVALID)，保留上一次结果且不再启动套件', () => {
  const s = createScenario();
  try {
    s.configure(provingSuites(s));
    const first = runCli(s.project);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const before = fs.readFileSync(s.resultsFile, 'utf8');
    const startedBefore = s.markers().length;

    const broken = pathsDocument(shopPaths((model) => { model.transitions[1][1] = 'STA-SHOP-099'; }));
    s.project.write({ [PATHS_FILE]: broken });
    commitAll(s.project.repo, 'break paths');
    const second = runCli(s.project);

    expectBlocked(second, 'SPEC_INVALID');
    assert.match(
      second.stdout,
      new RegExp(`^VIOLATION=REF_UNKNOWN\\|${escapeRegExp(PATHS_FILE)}:${lineOf(broken, 'TRN-SHOP-002')}\\|`, 'mu'),
    );
    assert.equal(fs.readFileSync(s.resultsFile, 'utf8'), before, '被阻断时不得改动已有结果');
    assert.equal(s.markers().length, startedBefore, '被阻断时不得再启动套件');
  } finally {
    s.cleanup();
  }
});

test('仓库里没有任何原子 AC 时 BLOCKED(SPEC_INVALID)', () => {
  const s = createScenario({ shop: false });
  try {
    s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES })]);

    const result = runCli(s.project);

    expectBlocked(result, 'SPEC_INVALID');
    assert.match(result.stdout, /^VIOLATION=NO_ATOMIC_AC\|/mu);
    expectUntouched(s);
  } finally {
    s.cleanup();
  }
});

test('仓库还没有任何提交时 BLOCKED(NO_HEAD)', () => {
  const s = createScenario({ git: false });
  try {
    s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES })]);
    runGit(s.project.repo, ['init', '--quiet', '--initial-branch=main']);

    expectBlocked(runCli(s.project), 'NO_HEAD');
    expectUntouched(s);
  } finally {
    s.cleanup();
  }
});

// ---------------------------------------------------------------- 正常运行与结果绑定

test('全部套件正常时 STATUS=OK，结果落在容器 tmp 并绑定 HEAD、配置摘要与 AC/TC/路径', () => {
  const s = createScenario();
  try {
    const head = s.configure([
      s.suite('web', { platform: 'web', cases: WEB_CASES }),
      s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
    ]);

    const result = runCli(s.project);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fieldOf(result.stdout, 'STATUS'), 'OK');
    assert.equal(fieldOf(result.stdout, 'HEAD_SHA'), head);
    assert.equal(fieldOf(result.stdout, 'RESULTS_FILE'), s.resultsFile);
    assert.deepEqual(fieldsOf(result.stdout, 'AC_OPEN'), []);
    assert.equal(fieldOf(result.stdout, 'AC_TOTAL'), '4');
    assert.equal(fieldOf(result.stdout, 'AC_PASSED'), '3');
    assert.equal(fieldOf(result.stdout, 'AC_MISSING'), '1');
    assert.equal(fieldOf(result.stdout, 'AC_MANUAL'), '1');
    assert.equal(fieldOf(result.stdout, 'CASES_TOTAL'), '4');
    assert.equal(fieldOf(result.stdout, 'CASES_PASSED'), '4');
    assert.equal(fieldOf(result.stdout, 'PATH_TOTAL'), '2');
    assert.equal(fieldOf(result.stdout, 'PATH_PASSED'), '2');

    assert.equal(path.dirname(s.resultsDir), path.join(s.project.tmp, 'qa-business-results'));
    assert.ok(path.relative(s.project.repo, s.resultsDir).startsWith('..'), '结果不得写进仓库的 tracked 目录');
    const read = s.results();
    assert.equal(read.ok, true, JSON.stringify(read));
    const { results } = read;
    const merged = loadConfig({ repoRoot: s.project.repo, env: {}, cli: {} });
    assert.equal(results.head_sha, head);
    assert.equal(results.worktree_clean, true);
    assert.equal(results.config_digest, resolveBusinessConfig(merged).digest);
    assert.equal(fieldOf(result.stdout, 'CONFIG_DIGEST'), results.config_digest);
    assert.deepEqual(statusMap(results.acs), {
      'AC-SHOP-001-01': 'passed',
      'AC-SHOP-001-02': 'passed',
      'AC-SHOP-001-03': 'passed',
      'AC-SHOP-002-01': 'missing',
    });
    assert.deepEqual(statusMap(results.tcs), { 'TC-SHOP-001': 'passed', 'TC-SHOP-002': 'passed', 'TC-SHOP-003': 'passed' });
    assert.deepEqual(statusMap(results.paths), { 'PTH-SHOP-001': 'passed', 'PTH-SHOP-002': 'passed' });
    assert.deepEqual(results.acs['AC-SHOP-001-02'].by_platform, { ios: 'passed', web: 'passed' });
    assert.deepEqual(results.suites.map((suite) => [suite.name, suite.platform, suite.status]), [
      ['web', 'web', 'ok'],
      ['ios', 'ios', 'ok'],
    ]);
  } finally {
    s.cleanup();
  }
});

test('记录套件退出码、报告 SHA256 与字节数，并保存逐字节相同的报告副本', () => {
  const s = createScenario();
  try {
    const suites = provingSuites(s);
    const [entry] = suites;
    s.configure(suites);

    const result = runCli(s.project);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const source = fs.readFileSync(path.join(s.aux, 'web.source.xml'));
    const digest = sha256Hex(source);
    const suite = s.results().results.suites.find((item) => item.name === 'web');
    assert.equal(suite.command, entry.command);
    assert.equal(suite.exit_code, 0);
    assert.equal(suite.status, 'ok');
    assert.equal(suite.cases, 3);
    assert.deepEqual(suite.report, { path: 'reports/web.xml', copy: 'reports/web.xml', sha256: digest, bytes: source.length });
    assert.equal(Buffer.compare(fs.readFileSync(path.join(s.resultsDir, 'reports', 'web.xml')), source), 0);
    assert.match(
      fieldOf(result.stdout, 'SUITE'),
      new RegExp(`^web\\|web\\|ok\\|exit=0\\|\\d+ms\\|3 cases\\|sha256=${digest}\\|-$`, 'u'),
    );
  } finally {
    s.cleanup();
  }
});

test('套件非零退出但报告有效时仍绑定用例，运行以 FAILED(SUITE_FAILED) 报告', () => {
  const s = createScenario();
  try {
    s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES, code: 3 })]);

    const result = runCli(s.project);

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(fieldOf(result.stdout, 'STATUS'), 'FAILED');
    assert.equal(fieldOf(result.stdout, 'REASON'), 'SUITE_FAILED', '套件失败的原因优先于 AC_NOT_PROVEN');
    assert.deepEqual(fieldsOf(result.stdout, 'AC_OPEN').map((line) => line.split('|')[0]), ['AC-SHOP-001-02'], '失败时 AC_OPEN 仍照常列出');
    assert.match(fieldOf(result.stdout, 'SUITE'), /^web\|web\|exit_nonzero\|exit=3\|\d+ms\|3 cases\|sha256=[0-9a-f]{64}\|退出码 3$/u);
    const read = s.results();
    assert.equal(read.ok, true, JSON.stringify(read));
    const [suite] = read.results.suites;
    assert.equal(suite.status, 'exit_nonzero');
    assert.equal(suite.exit_code, 3);
    assert.equal(read.results.acs['AC-SHOP-001-01'].status, 'passed');
  } finally {
    s.cleanup();
  }
});

test('报告里有失败用例时 FAILED 并列出未通过的 AC，即使套件退出码为 0', () => {
  // 报告目录按约定写入 .gitignore，否则第二次 configure 的提交会把第一次运行留下的报告纳入版本控制。
  const s = createScenario({ files: { '.gitignore': 'reports/\n' } });
  try {
    const failing = [{ ...WEB_CASES[0], status: 'failed' }, ...WEB_CASES.slice(1)];
    s.configure([s.suite('web', { platform: 'web', cases: failing, code: 1 })]);

    const nonzero = runCli(s.project);

    assert.equal(nonzero.status, 1, nonzero.stdout + nonzero.stderr);
    assert.equal(fieldOf(nonzero.stdout, 'STATUS'), 'FAILED');
    assert.match(nonzero.stdout, /^AC_OPEN=AC-SHOP-001-01\|P0\|failed\|/mu);
    assert.equal(s.results().results.acs['AC-SHOP-001-01'].status, 'failed');

    s.configure([s.suite('web', { platform: 'web', cases: failing, code: 0 })]);
    const zero = runCli(s.project);

    assert.equal(zero.status, 1, '套件退出码为 0 也不得掩盖报告里的失败用例');
    assert.equal(fieldOf(zero.stdout, 'STATUS'), 'FAILED');
    assert.equal(fieldOf(zero.stdout, 'REASON'), 'SUITE_FAILED');
    assert.match(fieldOf(zero.stdout, 'SUITE'), /^web\|web\|ok\|exit=0\|/u);
  } finally {
    s.cleanup();
  }
});

test('报告里出现不属于规格的标识时汇总为 UNKNOWN_IDS，不阻断运行', () => {
  const s = createScenario();
  try {
    const cases = [...WEB_CASES, { name: 'AC-SHOP-009-09 / TC-SHOP-099 拼写错误的标识', status: 'passed' }];
    s.configure(provingSuites(s, { web: { cases } }));

    const result = runCli(s.project);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fieldOf(result.stdout, 'UNKNOWN_IDS'), 'AC-SHOP-009-09,TC-SHOP-099');
  } finally {
    s.cleanup();
  }
});

// ---------------------------------------------------------------- 多端绑定

test('声明了端的 AC 按端绑定，任一端失败都出现在 AC_OPEN', () => {
  const s = createScenario();
  try {
    s.configure([
      s.suite('web', { platform: 'web', cases: WEB_CASES }),
      s.suite('ios', { platform: 'ios', cases: [{ ...IOS_CASES[0], status: 'failed' }], code: 1 }),
    ]);

    const result = runCli(s.project);

    assert.equal(fieldOf(result.stdout, 'STATUS'), 'FAILED', result.stdout);
    const record = s.results().results.acs['AC-SHOP-001-02'];
    assert.equal(record.status, 'failed');
    assert.deepEqual(record.by_platform, { ios: 'failed', web: 'passed' });
    assert.deepEqual(fieldsOf(result.stdout, 'AC_OPEN').map((line) => line.split('|').slice(0, 3).join('|')), ['AC-SHOP-001-02|P0|failed']);
  } finally {
    s.cleanup();
  }
});

test('声明的端没有套件提供时按 missing 列入 AC_OPEN，必需优先级的 AC 未证明故 FAILED(AC_NOT_PROVEN)', () => {
  const s = createScenario();
  try {
    s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES })]);

    const result = runCli(s.project);

    expectNotProven(result, ['AC-SHOP-001-02']);
    assert.match(fieldsOf(result.stdout, 'AC_OPEN')[0], /^AC-SHOP-001-02\|P0\|missing\|.*ios/u);
    const read = s.results();
    assert.equal(read.ok, true, '结果照常写出，供 qa verify 复验');
    const record = read.results.acs['AC-SHOP-001-02'];
    assert.equal(record.status, 'passed', '整体状态来自 web 端');
    assert.deepEqual(record.by_platform, { ios: 'missing', web: 'passed' });
  } finally {
    s.cleanup();
  }
});

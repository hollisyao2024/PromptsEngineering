'use strict';

// qa run 的运行层测试。套件命令是 fixtures/business-testing/suites 下的桩脚本：
// emit.js 复制预置报告并按指定退出码结束，hang.js 启动孙进程后挂起。
// 每个场景都在 <root>/repo 下建立真实 git 仓库，结果落在 <root>/tmp 的容器目录。

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { DEFAULT_CONFIG, loadConfig } = require('../../shared/config');
const { resolveBusinessConfig } = require('../business-config');
const { RESULTS_FILE, readResults, resultsDirectory } = require('../business-results');
const { runBusinessSuites } = require('../qa-run');
const {
  commitAll,
  createProject,
  junitReport,
  lineOf,
  pathsDocument,
  runGit,
  runNodeScript,
  shopPaths,
  shopProject,
} = require('./fixtures/business-testing/builders');

const SCRIPT = path.join(__dirname, '..', 'qa-run.js');
const SUITES = path.join(__dirname, 'fixtures', 'business-testing', 'suites');
const EMIT = path.join(SUITES, 'emit.js');
const HANG = path.join(SUITES, 'hang.js');
const PATHS_FILE = 'docs/qa-modules/shop/PATHS.md';
// 走 CLI 的超时用例使用真实计时器；窗口只用来验证“超时被记录”，用例不依赖桩套件能在窗口内启动完成。
const HANG_TIMEOUT_SECONDS = 1;
// 桩套件的启动延迟，比窗口长半秒：确定性地模拟“机器负载高、套件启动慢于时限”（全量并发下进程启动实测可达 20 秒以上）。
const SLOW_START_MS = HANG_TIMEOUT_SECONDS * 1000 + 500;
// 进程内用例持有库的超时计时器，真实计时不会触发；按延迟值识别库的计时器，所以这个名义超时刻意不同于任何等待上限。
const HELD_TIMEOUT_SECONDS = 90;
// 等待类条件的兜底上限：条件成立立即返回，只有失败时才会用满；实测全量并发下桩套件启动最长约 24 秒，留出数倍余量。
const WAIT_CEILING_MS = 120000;

const quote = (value) => JSON.stringify(String(value));
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const sha256Hex = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const statusMap = (records) => Object.fromEntries(Object.entries(records).map(([id, record]) => [id, record.status]));

const WEB_CASES = [
  { name: 'AC-SHOP-001-01 / TC-SHOP-001 结算进入支付页', status: 'passed' },
  { name: 'AC-SHOP-001-02 / TC-SHOP-002 web 支付成功', status: 'passed' },
  { name: 'AC-SHOP-001-03 / TC-SHOP-003 银行拒绝后可重试', status: 'passed' },
];
const IOS_CASES = [{ name: 'AC-SHOP-001-02 iOS 支付成功', status: 'passed' }];

function fieldsOf(output, key) {
  return [...String(output).matchAll(new RegExp(`^${key}=(.*)$`, 'gmu'))].map((match) => match[1]);
}
const fieldOf = (output, key) => fieldsOf(output, key)[0];

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function waitFor(probe, { timeoutMs = 10000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('waitFor：条件在限定时间内没有成立');
    await sleep(intervalMs);
  }
}

// 僵尸进程会让 kill(pid, 0) 暂时成功，所以死亡检查必须轮询而不是一次判断。
async function assertAllDead(pids) {
  for (const pid of pids) {
    await waitFor(() => !isAlive(pid)).catch(() => { throw new Error(`进程 ${pid} 在限定时间内仍然存活`); });
  }
}

function readPids(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.endsWith('\n')) return null; // 还没写完整
  const pids = text.split('\n').filter(Boolean).map(Number);
  return pids.length === 2 && pids.every(Number.isInteger) ? pids : null;
}

// 等待桩套件写出 pid 文件；超时给出明确原因，而不是笼统的 waitFor 报错。
function waitForPids(pidFile) {
  return waitFor(() => readPids(pidFile), { timeoutMs: WAIT_CEILING_MS })
    .catch(() => { throw new Error(`桩套件在 ${WAIT_CEILING_MS}ms 内没有写出 pid 文件：${pidFile}`); });
}

// 在兜底上限内等待 promise；超过上限以 message 失败，让用例的 finally 有机会回收进程，而不是无限挂起。
function withinCeiling(promise, message) {
  let timer = null;
  const expired = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${message}（等待超过 ${WAIT_CEILING_MS}ms）`)), WAIT_CEILING_MS);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

function reap(pids) {
  for (const pid of pids || []) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 已经退出
    }
  }
}

// 截获库为套件创建的超时计时器：计时器不真正计时，调用 fire() 才触发超时回调。
// 只截获延迟恰为 timeoutSeconds 秒的第一个计时器，轮询、宽限等待等其他计时器照常工作；用例结束后由 t.mock 还原。
function holdSuiteTimeout(t, timeoutSeconds) {
  const realSetTimeout = globalThis.setTimeout;
  let captured = false;
  let held = null;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (captured || delay !== timeoutSeconds * 1000) return realSetTimeout(callback, delay, ...args);
    captured = true;
    held = callback;
    // 库在套件结束时会 clearTimeout 它拿到的句柄，所以返回一个真实但不会触发的占位计时器。
    return realSetTimeout(() => {}, 2 ** 31 - 1).unref();
  });
  return {
    get armed() { return captured; },
    // 可以重复调用，只有第一次触发回调；用例的 finally 用它兜底，避免遗留挂起的套件。
    fire() {
      const callback = held;
      held = null;
      if (callback) callback();
    },
  };
}

function runCli(project, args = []) {
  return runNodeScript(SCRIPT, { cwd: project.repo, args });
}

test('CLI 子进程无法启动时，断言消息里带出 signal/error', () => {
  const missingCwd = path.join(SUITES, `missing-${process.pid}`);
  const result = runNodeScript(SCRIPT, { cwd: missingCwd });
  assert.ok(result.error, 'spawnSync 应当报告启动错误');
  assert.match(result.stderr, /\[runNodeScript\] signal=- error=ENOENT /u);
});

function startCli(project) {
  const child = spawn(process.execPath, [SCRIPT], {
    cwd: project.repo,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, closed };
}

function symlinkOrSkip(t, target, linkPath, type) {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip('当前环境不允许创建符号链接');
      return false;
    }
    throw error;
  }
}

// 场景：项目、仓库外的辅助目录（源报告、启动标记）、套件配置的构造器。
function createScenario({ files = {}, shop = true, git = true } = {}) {
  const project = shop
    ? shopProject(files, { git })
    : createProject({ 'README.md': '# 空项目\n', ...files }, { git });
  const aux = path.join(project.root, 'aux');
  fs.mkdirSync(aux, { recursive: true });
  const marker = path.join(aux, 'markers.log');
  const resultsDir = resultsDirectory(DEFAULT_CONFIG, project.repo, project.repo);

  return {
    project,
    aux,
    marker,
    resultsDir,
    resultsFile: path.join(resultsDir, RESULTS_FILE),

    // 把预置报告复制到 target 并以 code 退出的套件；没有 cases/xml 时不产出报告。
    suite(name, {
      platform = '-', cases, xml, code = 0, report = `reports/${name}.xml`, target = report, probe, timeoutSeconds, prefix = '',
    } = {}) {
      let source = '-';
      const content = xml !== undefined ? xml : (cases ? junitReport(cases, { suite: name }) : undefined);
      if (content !== undefined) {
        source = path.join(aux, `${name}.source.xml`);
        fs.writeFileSync(source, content);
      }
      const args = [EMIT, name, source, target, code, marker];
      if (probe) args.push(probe);
      const entry = { name, platform, command: `${prefix}${quote(process.execPath)} ${args.map(quote).join(' ')}`, report };
      if (timeoutSeconds !== undefined) entry.timeoutSeconds = timeoutSeconds;
      return entry;
    },

    // 启动孙进程后一直挂起的套件，用来验证超时与中断。
    hang(name, {
      platform = '-', pidFile, ignoreTerm = false, startupDelayMs = 0, report = `reports/${name}.xml`, timeoutSeconds = HANG_TIMEOUT_SECONDS,
    } = {}) {
      const args = [HANG, pidFile, ...(ignoreTerm ? ['ignore-term'] : []), ...(startupDelayMs ? [`delay=${startupDelayMs}`] : [])];
      return { name, platform, command: `${quote(process.execPath)} ${args.map(quote).join(' ')}`, report, timeoutSeconds };
    },

    // 写入 qa.business 配置并提交，返回提交后的 HEAD；没有 .git 时只写文件。
    configure(suites, business = {}) {
      project.write({ 'agent.config.json': `${JSON.stringify({ qa: { business: { enabled: true, ...business, suites } } }, null, 2)}\n` });
      return fs.existsSync(path.join(project.repo, '.git')) ? commitAll(project.repo, 'configure business suites') : null;
    },

    libraryOptions(extra = {}) {
      return {
        repoRoot: project.repo,
        mainRoot: project.repo,
        config: loadConfig({ repoRoot: project.repo, env: {}, cli: {} }),
        handleSignals: false,
        ...extra,
      };
    },

    markers() {
      if (!fs.existsSync(marker)) return [];
      return fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    },

    results() {
      return readResults(resultsDir);
    },

    cleanup() {
      project.cleanup();
    },
  };
}

// 进程内运行单个挂起套件并持有库的超时计时器：用例先用 ready() 等桩套件写出 pid 文件、确认进程树存活，
// 再用 timeout() 触发超时。超时不依赖真实计时，所以不受“机器负载高、套件启动变慢”的影响。
function startHungSuite(t, scenario, { startupDelayMs, ignoreTerm, killGraceMs } = {}) {
  const held = holdSuiteTimeout(t, HELD_TIMEOUT_SECONDS);
  const pidFile = path.join(scenario.aux, 'hung.pids');
  scenario.configure([
    scenario.hang('hung', { platform: 'web', pidFile, startupDelayMs, ignoreTerm, timeoutSeconds: HELD_TIMEOUT_SECONDS }),
  ]);
  const running = runBusinessSuites(scenario.libraryOptions(killGraceMs === undefined ? {} : { killGraceMs }));
  let pids = null;
  return {
    async ready() {
      pids = await waitForPids(pidFile);
      assert.ok(held.armed, '库应该已经为套件创建了超时计时器');
      assert.ok(pids.every(isAlive), '触发超时之前整棵进程树应该存活');
      return pids;
    },
    timeout() {
      held.fire();
      return withinCeiling(running, '库在触发超时后没有结束套件运行');
    },
    // 无论用例成败都要调用：触发超时让库终止进程组，再强杀已知的 pid，并等库返回，避免遗留挂起的套件。
    async dispose() {
      held.fire();
      reap(pids);
      await withinCeiling(running, '库没有结束套件运行').catch(() => {});
    },
  };
}

function expectBlocked(result, reason) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(fieldOf(result.stdout, 'STATUS'), 'BLOCKED', result.stdout);
  assert.equal(fieldOf(result.stdout, 'REASON'), reason, result.stdout);
  assert.match(result.stdout, /^SUMMARY=\S/mu);
  assert.match(result.stdout, /^NEXT_ACTION=\S/mu);
}

// 能证明全部必需优先级自动化 AC 的套件组合：web 套件覆盖三条 AC，ios 套件补上 AC-SHOP-001-02 的 iOS 端。
// 与运行状态无关的用例用它配置，避免因为某条 AC 缺端而被 AC_NOT_PROVEN 拦下；overrides 按套件名覆盖选项。
function provingSuites(s, overrides = {}) {
  return [
    s.suite('web', { platform: 'web', cases: WEB_CASES, ...overrides.web }),
    s.suite('ios', { platform: 'ios', cases: IOS_CASES, ...overrides.ios }),
  ];
}

// 套件都正常完成、但必需优先级的自动化 AC 没有被证明：FAILED(AC_NOT_PROVEN)、退出码非零，
// 与 BLOCKED 不同的是套件确实运行过，结果与 AC_OPEN 照常输出；ids 为按标识排序的未证明 AC。
function expectNotProven(result, ids) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(fieldOf(result.stdout, 'STATUS'), 'FAILED', result.stdout);
  assert.equal(fieldOf(result.stdout, 'REASON'), 'AC_NOT_PROVEN', result.stdout);
  assert.match(result.stdout, /^SUMMARY=\S/mu);
  assert.match(result.stdout, /^NEXT_ACTION=\S/mu);
  assert.deepEqual(fieldsOf(result.stdout, 'AC_OPEN').map((line) => line.split('|')[0]), ids, result.stdout);
}

// 被阻断的运行不得产生任何副作用：不建容器 tmp，不启动任何套件。
function expectUntouched(scenario) {
  assert.equal(fs.existsSync(scenario.project.tmp), false, '被阻断时不得创建容器 tmp');
  assert.deepEqual(scenario.markers(), [], '被阻断时不得启动任何套件');
}

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

test('运行中收到 SIGINT 时终止整棵进程树、不写结果、不再启动后续套件', async () => {
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

'use strict';

// qa run 测试的共享 helper：桩套件路径、计时常量、进程与输出断言、场景构造器。
// 套件命令是 fixtures/business-testing/suites 下的桩脚本：emit.js 复制预置报告并按指定退出码结束，hang.js 启动孙进程后挂起。
// 每个场景都在 <root>/repo 下建立真实 git 仓库，结果落在 <root>/tmp 的容器目录。

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { DEFAULT_CONFIG, loadConfig } = require('../../shared/config');
const { RESULTS_FILE, readResults, resultsDirectory } = require('../business-results');
const { runBusinessSuites } = require('../qa-run');
const {
  commitAll,
  createProject,
  junitReport,
  runNodeScript,
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

module.exports = {
  SCRIPT,
  SUITES,
  PATHS_FILE,
  HANG_TIMEOUT_SECONDS,
  SLOW_START_MS,
  HELD_TIMEOUT_SECONDS,
  escapeRegExp,
  sha256Hex,
  statusMap,
  WEB_CASES,
  IOS_CASES,
  fieldsOf,
  fieldOf,
  assertAllDead,
  readPids,
  waitForPids,
  reap,
  runCli,
  startCli,
  symlinkOrSkip,
  createScenario,
  startHungSuite,
  expectBlocked,
  provingSuites,
  expectNotProven,
  expectUntouched,
};

'use strict';

// 业务测试结果模型：JUnit XML 解析、AC/TC 标识绑定、按端聚合，以及容器 tmp 下
// ac-results.json 与报告副本的读写。解析与聚合是纯函数：不访问网络、不执行或展开报告内容、
// 不依赖时钟与随机数，同样的输入逐字节产生同样的输出，qa verify 才能用报告副本重算并与记录比对。
// JUnit 解析位于 business-results-junit.js，标识提取与聚合位于 business-results-aggregate.js，本文件统一导出。

const fs = require('node:fs');
const path = require('node:path');

const { resolveContainerPath } = require('../shared/config');
const { MAX_REPEAT, NO_PLATFORM } = require('./business-config');
const { compareText } = require('./business-spec');
const { worktreeReceiptKey } = require('./qa-verification-state');
const { MAX_REPORT_BYTES, parseJunitReport, toBytes } = require('./business-results-junit');
const {
  CASE_STATUSES,
  aggregateResults,
  evaluateSuiteOutcome,
  extractCaseLabels,
  judgeAc,
} = require('./business-results-aggregate');
const { MISSING, compareRuns } = require('./business-results-repeat');

const SCHEMA_VERSION = 1;
const RESULTS_FILE = 'ac-results.json';
const RESULTS_DIR_NAME = 'qa-business-results';
const REPORTS_DIR_NAME = 'reports';
const MAX_RESULTS_BYTES = 64 * 1024 * 1024;
const MAX_REPORTED_PROBLEMS = 10;
const SUITE_STATUSES = Object.freeze(['ok', 'exit_nonzero', 'spawn_error', 'timeout', 'report_missing', 'report_invalid']);
const REPORT_BEARING = Object.freeze(['ok', 'exit_nonzero']);

const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const HEX_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const TAG_PATTERN = /^[a-z][a-z0-9-]*$/u;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isTimestamp = (value) => typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));
const show = (value) => JSON.stringify(value) ?? String(value);

// ---------------------------------------------------------------------------
// 结果文档
// ---------------------------------------------------------------------------

function reportCopyPath(name) {
  if (typeof name !== 'string' || !TAG_PATTERN.test(name)) {
    throw new Error(`套件名称 ${show(name)} 不合法，须匹配 [a-z][a-z0-9-]*`);
  }
  return `${REPORTS_DIR_NAME}/${name}.xml`;
}

// 第 run 轮（run≥2）的报告副本；第 1 轮仍用 reportCopyPath，旧结果与门禁的主流程不受影响。
function repeatCopyPath(name, run) {
  if (!Number.isInteger(run) || run < 2 || run > MAX_REPEAT) throw new Error(`轮次 ${show(run)} 须为 2 到 ${MAX_REPEAT} 之间的整数`);
  return `${reportCopyPath(name).slice(0, -'.xml'.length)}.run${run}.xml`;
}

function resultsDirectory(config, mainRoot, worktreePath) {
  return path.join(resolveContainerPath(config, mainRoot, 'tmp'), RESULTS_DIR_NAME, worktreeReceiptKey(worktreePath));
}

function assertCases(cases, at) {
  if (!Array.isArray(cases)) throw new Error(`${at}.cases 须为数组或 null`);
  cases.forEach((item, index) => {
    const label = `${at}.cases[${index}]`;
    if (!isObject(item)) throw new Error(`${label} 须为对象`);
    if (typeof item.name !== 'string') throw new Error(`${label}.name 须为字符串`);
    if (typeof item.classname !== 'string') throw new Error(`${label}.classname 须为字符串`);
    if (!CASE_STATUSES.includes(item.status)) throw new Error(`${label}.status 须为 ${CASE_STATUSES.join('/')} 之一`);
  });
}

function suiteRecord(suite, index, counts) {
  const at = `suites[${index}]`;
  if (!isObject(suite)) throw new Error(`${at} 须为对象`);
  if (!SUITE_STATUSES.includes(suite.status)) throw new Error(`${at}.status 须为 ${SUITE_STATUSES.join('/')} 之一`);
  const reported = REPORT_BEARING.includes(suite.status);
  if (reported) assertCases(suite.cases, at);
  else if (suite.cases !== null) throw new Error(`${at}.cases 在状态 ${suite.status} 下须为 null`);
  if (reported && !isObject(suite.report)) throw new Error(`${at}.report 在状态 ${suite.status} 下须带报告记录`);
  if (!reported && suite.report !== null) throw new Error(`${at}.report 在状态 ${suite.status} 下须为 null`);
  return {
    name: suite.name,
    platform: suite.platform ?? NO_PLATFORM,
    command: suite.command,
    exit_code: suite.exitCode ?? null,
    status: suite.status,
    detail: suite.detail ?? null,
    duration_ms: Math.round(suite.durationMs),
    cases: counts.cases,
    failed: counts.failed,
    unlabelled: counts.unlabelled,
    classname_only: counts.classname_only,
    report: reported
      ? { path: suite.report.path, copy: reportCopyPath(suite.name), sha256: suite.report.sha256, bytes: suite.report.bytes }
      : null,
  };
}

// 多轮运行（G6）的记录：rounds 为第 2 轮起各轮的观察 [{ run, suites:[{ name, status, exitCode, report:{sha256,bytes}|null, cases|null }] }]，
// 套件顺序须与第 1 轮一致。第 1 轮即 suites 本身；flaky/unstable_suites/summary 由 compareRuns 按全部轮次计算。
function buildRepeat({ spec, requiredPriorities, suites, rounds }) {
  if (!Array.isArray(rounds)) throw new Error('rounds 须为数组');
  const firstRound = { run: 1, suites: suites.map((suite) => ({ name: suite.name, status: suite.status, cases: suite.cases ?? null })) };
  const later = rounds.map((round, index) => {
    if (!isObject(round) || !Array.isArray(round.suites)) throw new Error(`rounds[${index}] 须带 suites 数组`);
    return {
      run: round.run,
      suites: round.suites.map((suite) => ({
        name: suite.name,
        status: suite.status,
        exit_code: suite.exitCode ?? null,
        report: isObject(suite.report)
          ? { copy: repeatCopyPath(suite.name, round.run), sha256: suite.report.sha256, bytes: suite.report.bytes }
          : null,
      })),
    };
  });
  const compared = compareRuns({
    spec,
    requiredPriorities,
    rounds: [firstRound, ...rounds.map((round) => ({ run: round.run, suites: round.suites.map((suite) => ({ name: suite.name, status: suite.status, cases: suite.cases ?? null })) }))],
  });
  return { runs: rounds.length + 1, rounds: later, ...compared };
}

// suites 为 qa run 的观察：{ name, platform, command, exitCode, status, durationMs, detail, report:{path,sha256,bytes}|null, cases|null }。
// rounds 省略时不写 repeat 段（与旧结果相同）；qa run 总会传入，单轮时为空数组。
// 缺少或非法的输入直接报错，不写出残缺结果。
function buildResults({ spec, headSha, worktreeClean, configDigest, generatedAt, suites, requiredPriorities = [], rounds } = {}) {
  if (typeof headSha !== 'string' || !SHA_PATTERN.test(headSha)) throw new Error('headSha 须为完整的小写十六进制提交 SHA');
  if (typeof worktreeClean !== 'boolean') throw new Error('worktreeClean 须为布尔值');
  if (typeof configDigest !== 'string' || !DIGEST_PATTERN.test(configDigest)) throw new Error('configDigest 须形如 sha256:<64 位小写十六进制>');
  if (!isTimestamp(generatedAt)) throw new Error('generatedAt 须为可解析的时间字符串');
  if (!Array.isArray(suites)) throw new Error('suites 须为数组');

  const aggregate = aggregateResults({
    spec,
    suites: suites.map((suite) => ({ name: suite && suite.name, platform: suite && suite.platform, cases: suite ? suite.cases : null })),
  });
  const results = {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    head_sha: headSha,
    worktree_clean: worktreeClean,
    config_digest: configDigest,
    suites: suites.map((suite, index) => suiteRecord(suite, index, aggregate.suites[index])),
    tcs: aggregate.tcs,
    acs: aggregate.acs,
    paths: aggregate.paths,
    unknown_ids: aggregate.unknown_ids,
    summary: aggregate.summary,
  };
  if (rounds !== undefined) results.repeat = buildRepeat({ spec, requiredPriorities, suites, rounds });
  const problems = validateResults(results);
  if (problems.length > 0) throw new Error(`结果输入无效：${problems.slice(0, MAX_REPORTED_PROBLEMS).join('；')}`);
  return results;
}

function validateSuites(suites, problem) {
  if (!Array.isArray(suites)) {
    problem('suites 须为数组');
    return;
  }
  const names = new Map();
  suites.forEach((suite, index) => {
    const at = `suites[${index}]`;
    if (!isObject(suite)) {
      problem(`${at} 须为对象`);
      return;
    }
    const nameValid = typeof suite.name === 'string' && TAG_PATTERN.test(suite.name);
    if (!nameValid) problem(`${at}.name 须匹配 [a-z][a-z0-9-]*`);
    else if (names.has(suite.name)) problem(`${at}.name「${suite.name}」与 suites[${names.get(suite.name)}] 重复`);
    else names.set(suite.name, index);

    if (suite.platform !== NO_PLATFORM && !(typeof suite.platform === 'string' && TAG_PATTERN.test(suite.platform))) {
      problem(`${at}.platform 须为单个端标签或 ${NO_PLATFORM}`);
    }
    if (typeof suite.command !== 'string') problem(`${at}.command 须为字符串`);
    if (suite.exit_code !== null && !Number.isInteger(suite.exit_code)) problem(`${at}.exit_code 须为整数或 null`);
    const statusValid = SUITE_STATUSES.includes(suite.status);
    if (!statusValid) problem(`${at}.status 须为 ${SUITE_STATUSES.join('/')} 之一，实际为 ${show(suite.status)}`);
    if (suite.status === 'ok' && suite.exit_code !== 0) problem(`${at}.exit_code 在状态 ok 下须为 0`);
    if (suite.status === 'exit_nonzero' && suite.exit_code === 0) problem(`${at}.exit_code 在状态 exit_nonzero 下不能为 0`);
    if (suite.detail !== null && typeof suite.detail !== 'string') problem(`${at}.detail 须为字符串或 null`);
    if (!isCount(suite.duration_ms)) problem(`${at}.duration_ms 须为非负整数`);
    if (!isCount(suite.cases)) problem(`${at}.cases 须为非负整数`);
    // failed 供门禁核对非零退出码能否由报告解释；classname_only 计入 unlabelled 的子集，单独披露。
    for (const field of ['failed', 'unlabelled', 'classname_only']) {
      if (!isCount(suite[field])) problem(`${at}.${field} 须为非负整数`);
      else if (isCount(suite.cases) && suite[field] > suite.cases) problem(`${at}.${field} 不能大于 cases`);
    }

    const needsReport = statusValid && REPORT_BEARING.includes(suite.status);
    if (suite.report === null) {
      if (needsReport) problem(`${at}.report 缺失：状态 ${suite.status} 的套件必须带报告记录`);
    } else if (!isObject(suite.report)) {
      problem(`${at}.report 须为对象或 null`);
    } else {
      if (statusValid && !needsReport) problem(`${at}.report 在状态 ${suite.status} 下须为 null`);
      if (typeof suite.report.path !== 'string' || suite.report.path === '') problem(`${at}.report.path 须为非空字符串`);
      const expectedCopy = nameValid ? reportCopyPath(suite.name) : null;
      if (expectedCopy === null || suite.report.copy !== expectedCopy) {
        problem(`${at}.report.copy 须为 ${expectedCopy ?? 'reports/<套件名>.xml'}，实际为 ${show(suite.report.copy)}`);
      }
      if (typeof suite.report.sha256 !== 'string' || !HEX_DIGEST_PATTERN.test(suite.report.sha256)) {
        problem(`${at}.report.sha256 须为 64 位小写十六进制`);
      }
      if (!isCount(suite.report.bytes)) problem(`${at}.report.bytes 须为非负整数`);
    }
  });
}

function validateRoundSuites(round, at, run, names, problem) {
  if (!Array.isArray(round.suites)) {
    problem(`${at}.suites 须为数组`);
    return;
  }
  const actual = round.suites.map((suite) => (isObject(suite) ? suite.name : undefined));
  if (names !== null && JSON.stringify(actual) !== JSON.stringify(names)) {
    problem(`${at}.suites 的套件须与第 1 轮一致（${names.join('、') || '无'}），实际为 ${show(actual)}`);
  }
  round.suites.forEach((suite, index) => {
    const label = `${at}.suites[${index}]`;
    if (!isObject(suite)) {
      problem(`${label} 须为对象`);
      return;
    }
    const nameValid = typeof suite.name === 'string' && TAG_PATTERN.test(suite.name);
    if (!nameValid) problem(`${label}.name 须匹配 [a-z][a-z0-9-]*`);
    const statusValid = SUITE_STATUSES.includes(suite.status);
    if (!statusValid) problem(`${label}.status 须为 ${SUITE_STATUSES.join('/')} 之一，实际为 ${show(suite.status)}`);
    if (suite.exit_code !== null && !Number.isInteger(suite.exit_code)) problem(`${label}.exit_code 须为整数或 null`);
    if (suite.status === 'ok' && suite.exit_code !== 0) problem(`${label}.exit_code 在状态 ok 下须为 0`);
    if (suite.status === 'exit_nonzero' && suite.exit_code === 0) problem(`${label}.exit_code 在状态 exit_nonzero 下不能为 0`);
    const needsReport = statusValid && REPORT_BEARING.includes(suite.status);
    if (suite.report === null) {
      if (needsReport) problem(`${label}.report 缺失：状态 ${suite.status} 的套件必须带报告记录`);
      return;
    }
    if (!isObject(suite.report)) {
      problem(`${label}.report 须为对象或 null`);
      return;
    }
    if (statusValid && !needsReport) problem(`${label}.report 在状态 ${suite.status} 下须为 null`);
    const expectedCopy = nameValid && Number.isInteger(run) && run >= 2 && run <= MAX_REPEAT ? repeatCopyPath(suite.name, run) : null;
    if (expectedCopy === null || suite.report.copy !== expectedCopy) {
      problem(`${label}.report.copy 须为 ${expectedCopy ?? 'reports/<套件名>.run<轮次>.xml'}，实际为 ${show(suite.report.copy)}`);
    }
    if (typeof suite.report.sha256 !== 'string' || !HEX_DIGEST_PATTERN.test(suite.report.sha256)) {
      problem(`${label}.report.sha256 须为 64 位小写十六进制`);
    }
    if (!isCount(suite.report.bytes)) problem(`${label}.report.bytes 须为非负整数`);
  });
}

const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
const isStatusList = (value, runs, allowed) => Array.isArray(value) && value.length === runs && value.every((item) => allowed.includes(item));

// repeat 段（G6）的结构与自洽检查：轮次连续、各轮套件与第 1 轮一致、不稳定项的状态序列长度等于轮数、
// 汇总与明细相符。不稳定项是否与各轮报告副本一致由门禁重算比对。
function validateRepeat(repeat, problem, suites) {
  if (!isObject(repeat)) {
    problem('repeat 须为对象');
    return;
  }
  const runsValid = Number.isInteger(repeat.runs) && repeat.runs >= 1 && repeat.runs <= MAX_REPEAT;
  if (!runsValid) problem(`repeat.runs 须为 1 到 ${MAX_REPEAT} 之间的整数，实际为 ${show(repeat.runs)}`);
  const runs = runsValid ? repeat.runs : null;
  const names = Array.isArray(suites) && suites.every(isObject) ? suites.map((suite) => suite.name) : null;

  if (!Array.isArray(repeat.rounds)) {
    problem('repeat.rounds 须为数组');
  } else {
    if (runs !== null && repeat.rounds.length !== runs - 1) {
      problem(`repeat.rounds 须恰好记录第 2 到第 ${runs} 轮（${runs - 1} 轮），实际为 ${repeat.rounds.length} 轮`);
    }
    repeat.rounds.forEach((round, index) => {
      const at = `repeat.rounds[${index}]`;
      if (!isObject(round)) {
        problem(`${at} 须为对象`);
        return;
      }
      if (round.run !== index + 2) problem(`${at}.run 须为 ${index + 2}，实际为 ${show(round.run)}`);
      validateRoundSuites(round, at, round.run, names, problem);
    });
  }

  const caseStatuses = [...CASE_STATUSES, MISSING];
  const suiteStatuses = [...SUITE_STATUSES, MISSING];
  let requiredFlaky = 0;
  if (!Array.isArray(repeat.flaky)) {
    problem('repeat.flaky 须为数组');
  } else {
    repeat.flaky.forEach((item, index) => {
      const at = `repeat.flaky[${index}]`;
      if (!isObject(item)) {
        problem(`${at} 须为对象`);
        return;
      }
      for (const field of ['suite', 'classname', 'name']) {
        if (typeof item[field] !== 'string') problem(`${at}.${field} 须为字符串`);
      }
      if (!isStringList(item.ids)) problem(`${at}.ids 须为字符串数组`);
      if (!isStringList(item.priorities)) problem(`${at}.priorities 须为字符串数组`);
      if (typeof item.required !== 'boolean' || (isStringList(item.priorities) && item.required !== item.priorities.length > 0)) {
        problem(`${at}.required 须为布尔值，且仅在 priorities 非空时为 true`);
      }
      if (item.required === true) requiredFlaky += 1;
      if (runs !== null && !isStatusList(item.statuses, runs, caseStatuses)) {
        problem(`${at}.statuses 须为 ${runs} 个 ${caseStatuses.join('/')} 组成的数组`);
      } else if (runs !== null && new Set(item.statuses).size === 1) {
        problem(`${at}.statuses 各轮相同，不是不稳定用例`);
      }
    });
  }

  if (!Array.isArray(repeat.unstable_suites)) {
    problem('repeat.unstable_suites 须为数组');
  } else {
    repeat.unstable_suites.forEach((item, index) => {
      const at = `repeat.unstable_suites[${index}]`;
      if (!isObject(item) || typeof item.name !== 'string') {
        problem(`${at} 须为带 name 的对象`);
        return;
      }
      if (runs !== null && !isStatusList(item.statuses, runs, suiteStatuses)) {
        problem(`${at}.statuses 须为 ${runs} 个 ${suiteStatuses.join('/')} 组成的数组`);
      } else if (runs !== null && new Set(item.statuses).size === 1) {
        problem(`${at}.statuses 各轮相同，不是不稳定套件`);
      }
    });
  }

  const summary = repeat.summary;
  if (!isObject(summary)) {
    problem('repeat.summary 须为对象');
    return;
  }
  if (runs !== null && summary.runs !== runs) problem(`repeat.summary.runs 须等于 repeat.runs（${runs}），实际为 ${show(summary.runs)}`);
  if (!isCount(summary.cases)) problem('repeat.summary.cases 须为非负整数');
  if (Array.isArray(repeat.flaky) && summary.flaky !== repeat.flaky.length) {
    problem(`repeat.summary.flaky 须等于 repeat.flaky 的条数（${repeat.flaky.length}），实际为 ${show(summary.flaky)}`);
  }
  if (Array.isArray(repeat.flaky) && summary.required_flaky !== requiredFlaky) {
    problem(`repeat.summary.required_flaky 须等于必需用例的不稳定条数（${requiredFlaky}），实际为 ${show(summary.required_flaky)}`);
  }
  if (isCount(summary.cases) && isCount(summary.flaky) && summary.flaky > summary.cases) problem('repeat.summary.flaky 不能大于 cases');
  if (typeof summary.rate !== 'number' || !(summary.rate >= 0 && summary.rate <= 1)) problem('repeat.summary.rate 须为 0 到 1 之间的数');
}

// 只做结构与取值检查，返回带字段路径的问题列表；与规格是否一致由门禁用报告副本重算比对。
function validateResults(results) {
  if (!isObject(results)) return ['结果须为 JSON 对象'];
  const problems = [];
  const problem = (message) => problems.push(message);
  if (results.schema_version !== SCHEMA_VERSION) problem(`schema_version 须为 ${SCHEMA_VERSION}，实际为 ${show(results.schema_version)}`);
  if (typeof results.head_sha !== 'string' || !SHA_PATTERN.test(results.head_sha)) problem('head_sha 须为完整的小写十六进制提交 SHA');
  if (typeof results.worktree_clean !== 'boolean') problem('worktree_clean 须为布尔值');
  if (typeof results.config_digest !== 'string' || !DIGEST_PATTERN.test(results.config_digest)) {
    problem('config_digest 须形如 sha256:<64 位小写十六进制>');
  }
  if (!isTimestamp(results.generated_at)) problem('generated_at 须为可解析的时间字符串');
  validateSuites(results.suites, problem);
  for (const key of ['tcs', 'acs', 'paths', 'summary']) {
    if (!isObject(results[key])) problem(`${key} 须为对象`);
  }
  if (!Array.isArray(results.unknown_ids) || results.unknown_ids.some((item) => typeof item !== 'string')) {
    problem('unknown_ids 须为字符串数组');
  }
  // repeat 段可选：旧结果没有它，门禁按 1 轮处理。
  if (results.repeat !== undefined) validateRepeat(results.repeat, problem, results.suites);
  return problems;
}

// ---------------------------------------------------------------------------
// 结果文件读写
// ---------------------------------------------------------------------------

// 同目录临时文件加 rename：读取方只会看到旧文件或完整的新文件。必须以 fs.renameSync 命名空间形式调用。
function atomicWrite(file, data) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

// rename 不能把文件覆盖到目录上；结果文件或报告副本的位置被换成目录时（门禁会以 REPORT_TAMPERED /
// RESULTS_INVALID 阻断并提示重新运行 qa run），先清掉该目录，让重新运行能够自愈。
// 目标路径恒为本结果目录内由校验过的套件名拼出的精确路径；符号链接与普通文件由 rename 直接替换。
function clearDirectoryAt(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
}

// 先写报告副本，最后才原子写入 ac-results.json；写成功后再尽力清理不再被引用的旧副本。
// results 与 reportCopies 都校验通过才会落盘；写失败不覆盖旧的 ac-results.json，也不留临时文件。
// extraCopies 为第 2 轮起各轮的报告副本 [{ name, run, bytes }]，写到 repeatCopyPath。
function writeResults({ directory, results, reportCopies = {}, extraCopies = [] } = {}) {
  if (typeof directory !== 'string' || directory === '') throw new Error('directory 须为非空路径');
  const problems = validateResults(results);
  if (problems.length > 0) throw new Error(`拒绝写入无效结果：${problems.slice(0, MAX_REPORTED_PROBLEMS).join('；')}`);
  const copies = Object.keys(reportCopies || {}).sort(compareText).map((name) => {
    const relative = reportCopyPath(name);
    const bytes = toBytes(reportCopies[name]);
    if (!bytes) throw new Error(`套件 ${name} 的报告副本须为字符串或字节序列`);
    return { relative, bytes };
  });
  if (!Array.isArray(extraCopies)) throw new Error('extraCopies 须为数组');
  for (const extra of extraCopies) {
    const relative = repeatCopyPath(extra && extra.name, extra && extra.run);
    const bytes = toBytes(extra.bytes);
    if (!bytes) throw new Error(`套件 ${extra.name} 第 ${extra.run} 轮的报告副本须为字符串或字节序列`);
    copies.push({ relative, bytes });
  }

  const reportsDirectory = path.join(directory, REPORTS_DIR_NAME);
  fs.mkdirSync(reportsDirectory, { recursive: true });
  if (!fs.lstatSync(reportsDirectory).isDirectory()) throw new Error(`${REPORTS_DIR_NAME} 不是普通目录，拒绝写入`);
  for (const copy of copies) {
    const destination = path.join(directory, copy.relative);
    clearDirectoryAt(destination);
    atomicWrite(destination, copy.bytes);
  }

  const target = path.join(directory, RESULTS_FILE);
  clearDirectoryAt(target);
  atomicWrite(target, `${JSON.stringify(results, null, 2)}\n`);

  const keep = new Set(copies.map((copy) => path.basename(copy.relative)));
  try {
    for (const entry of fs.readdirSync(reportsDirectory)) {
      if (!keep.has(entry)) fs.rmSync(path.join(reportsDirectory, entry), { recursive: true, force: true });
    }
  } catch {
    // 新结果已经提交，清理陈旧副本只是尽力而为。
  }
  return target;
}

function unusable(code, message) {
  return { ok: false, code, message };
}

// 返回 { ok:true, results, file } 或 { ok:false, code:'RESULTS_MISSING'|'RESULTS_INVALID', message }。
// 残留的临时文件不会被读到；目录与符号链接一律视为不可用。
function readResults(directory) {
  const file = path.join(directory, RESULTS_FILE);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return unusable('RESULTS_MISSING', `找不到 ${RESULTS_FILE}，请先运行 qa run`);
    return unusable('RESULTS_INVALID', `无法读取 ${RESULTS_FILE}：${error.message}`);
  }
  if (!stat.isFile()) return unusable('RESULTS_INVALID', `${RESULTS_FILE} 不是普通文件（目录或符号链接不被接受）`);
  if (stat.size > MAX_RESULTS_BYTES) return unusable('RESULTS_INVALID', `${RESULTS_FILE} 超过 ${MAX_RESULTS_BYTES} 字节上限`);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return unusable('RESULTS_INVALID', `${RESULTS_FILE} 不是合法的 JSON：${error.message}`);
  }
  const problems = validateResults(parsed);
  if (problems.length > 0) {
    const more = problems.length > MAX_REPORTED_PROBLEMS ? `（另有 ${problems.length - MAX_REPORTED_PROBLEMS} 项）` : '';
    return unusable('RESULTS_INVALID', `${RESULTS_FILE} 结构无效：${problems.slice(0, MAX_REPORTED_PROBLEMS).join('；')}${more}`);
  }
  return { ok: true, results: parsed, file };
}

module.exports = {
  CASE_STATUSES,
  MAX_REPORT_BYTES,
  RESULTS_DIR_NAME,
  RESULTS_FILE,
  SCHEMA_VERSION,
  SUITE_STATUSES,
  aggregateResults,
  buildResults,
  evaluateSuiteOutcome,
  extractCaseLabels,
  judgeAc,
  parseJunitReport,
  readResults,
  compareRuns,
  repeatCopyPath,
  reportCopyPath,
  resultsDirectory,
  validateResults,
  writeResults,
};

'use strict';

// 业务测试结果模型之聚合：AC/TC 标识提取、套件结果评估与按端聚合。纯函数：不访问网络、
// 不依赖时钟与随机数，所有输出按标识排序，与用例输入顺序无关。

const crypto = require('node:crypto');

const { AC_ID_SOURCE, TEST_CASE_ID_SOURCE, searchPattern } = require('../shared/governance-ids');
const { NO_PLATFORM } = require('./business-config');
const { compareText } = require('./business-spec');
const { MAX_REPORT_BYTES, parseJunitReport, toBytes } = require('./business-results-junit');

const CASE_STATUSES = Object.freeze(['passed', 'failed', 'error', 'skipped']);

const show = (value) => JSON.stringify(value) ?? String(value);
const sortedUnique = (items) => [...new Set(items)].sort(compareText);
const sha256Of = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------
// 标识提取与套件结果评估
// ---------------------------------------------------------------------------

const AC_LABELS = searchPattern(AC_ID_SOURCE);
const TC_LABELS = searchPattern(TEST_CASE_ID_SOURCE);

function collectIds(text, pattern) {
  const found = [];
  for (const id of String(text ?? '').match(pattern) || []) {
    if (!found.includes(id)) found.push(id);
  }
  return found;
}

// 只从用例名（name）提取 AC 与 TC 标识，去重并保持首次出现的顺序。
// classname 是 describe 名或文件路径，同一个 describe 下的全部用例都会带上它；
// 按 classname 绑定会让整组用例扇出到同一 AC，一条无关用例通过就能“证明”该 AC，因此不参与绑定。
function extractCaseLabels({ name = '' } = {}) {
  return { acs: collectIds(name, AC_LABELS), tcs: collectIds(name, TC_LABELS) };
}

// 用例名没有标识、只有 classname 含标识：多半是把编号写在 describe 或文件名上，按无标识计并单独披露。
function classnameOnly({ classname = '' } = {}) {
  return collectIds(classname, AC_LABELS).length > 0 || collectIds(classname, TC_LABELS).length > 0;
}

function exitDetail(exitCode, signal) {
  if (signal) return `被信号 ${signal} 终止`;
  if (Number.isInteger(exitCode)) return `退出码 ${exitCode}`;
  return '未取得退出码';
}

// 把一次套件运行的原始观察归为 SUITE_STATUSES 之一。
// 严重度：spawn_error > timeout > report_missing > report_invalid > exit_nonzero > ok。
// 前四种是硬失败，不绑定用例也不留报告记录；exit_nonzero 只是事实，用例照常绑定，由 AC 状态裁决。
// reportProblem 由调用方在读取报告时给出（例如报告不是普通文件、读取失败）：调用方已判定报告不可信，
// 即使同时读到了字节也不再采信，按 report_invalid 记录；它排在 spawn_error 与 timeout 之后。
function evaluateSuiteOutcome({
  spawnError = null,
  timedOut = false,
  exitCode = null,
  signal = null,
  reportBytes = null,
  reportProblem = null,
  timeoutSeconds,
  maxBytes = MAX_REPORT_BYTES,
} = {}) {
  const hard = (status, detail) => ({ status, detail, cases: null, report: null });
  if (spawnError) return hard('spawn_error', `无法启动套件命令：${spawnError.message ?? spawnError}`);
  if (timedOut) return hard('timeout', timeoutSeconds ? `运行超过 ${timeoutSeconds} 秒被终止` : '运行超时被终止');
  if (reportProblem) return hard('report_invalid', `报告无法使用：${reportProblem}`);
  if (reportBytes === null || reportBytes === undefined) return hard('report_missing', '运行结束后没有找到报告文件');

  const bytes = toBytes(reportBytes);
  if (!bytes) return hard('report_invalid', '报告内容类型无效');
  const parsed = parseJunitReport(bytes, { maxBytes });
  if (!parsed.ok) return hard('report_invalid', `报告无法使用（${parsed.reason}）：${parsed.message}`);

  const report = { sha256: sha256Of(bytes), bytes: bytes.length };
  if (exitCode === 0) return { status: 'ok', detail: null, cases: parsed.cases, report };
  return { status: 'exit_nonzero', detail: exitDetail(exitCode, signal), cases: parsed.cases, report };
}

// ---------------------------------------------------------------------------
// AC/TC/路径聚合
// ---------------------------------------------------------------------------

const emptyCounts = () => ({ total: 0, passed: 0, failed: 0, error: 0, skipped: 0 });

function addCase(counts, status) {
  counts.total += 1;
  counts[status] += 1;
}

// 任一失败（含 error）即 failed；否则任一跳过即 skipped（跳过不算通过，哪怕其余用例都通过）；
// 全部通过才是 passed；没有用例为 missing。
function statusOf(counts) {
  if (counts.failed + counts.error > 0) return 'failed';
  if (counts.skipped > 0) return 'skipped';
  if (counts.passed > 0) return 'passed';
  return 'missing';
}

function sortedObject(entries) {
  const output = {};
  for (const [key, value] of [...entries].sort((left, right) => compareText(left[0], right[0]))) output[key] = value;
  return output;
}

function pathStatus(tcStatuses) {
  if (tcStatuses.includes('failed')) return 'failed';
  if (tcStatuses.length > 0 && tcStatuses.every((status) => status === 'passed')) return 'passed';
  return 'missing';
}

// 单条 AC 是否被证明：qa run 的 AC_OPEN 与 qa verify 的门禁共用，保证两处结论一致。
// record 是结果文件里 acs[id] 的结构。任一失败（含声明范围之外的端）即不通过；
// 未声明端的 AC 看整体状态；声明了端的 AC 要求每个声明的端都通过，没有套件提供的端按 missing 计。
// 无法识别的状态、缺失或畸形的记录一律不通过。
function judgeAc(record) {
  const unproven = (state, reason) => ({ proven: false, state, reason });
  if (!record || typeof record !== 'object' || Array.isArray(record)) return unproven('missing', '没有该 AC 的结果记录');

  const byPlatform = record.by_platform && typeof record.by_platform === 'object' ? record.by_platform : {};
  if (record.status === 'failed' || Object.values(byPlatform).includes('failed')) return unproven('failed', '存在失败用例');

  const declared = Array.isArray(record.platforms) ? record.platforms : [];
  if (declared.length === 0) {
    if (record.status === 'passed') return { proven: true, state: 'passed', reason: null };
    if (record.status === 'skipped') return unproven('skipped', '存在被跳过的用例');
    return unproven('missing', '没有任何用例覆盖');
  }

  const bad = declared
    .map((platform) => [platform, byPlatform[platform] ?? 'missing'])
    .filter(([, status]) => status !== 'passed');
  if (bad.length === 0) return { proven: true, state: 'passed', reason: null };
  const onlySkipped = bad.every(([, status]) => status === 'skipped');
  return unproven(onlySkipped ? 'skipped' : 'missing', `声明的端未通过：${bad.map(([platform, status]) => `${platform}: ${status}`).join(', ')}`);
}

// spec 来自 loadBusinessSpec；suites 为 [{ name, platform, cases }]，cases 为 null 表示硬失败套件。
// 用例绑定到它直接引用的 AC，并经 PRD 原子表的 TC 列绑定到列出该 TC 的全部 AC；
// 同一用例对同一 AC 只计一次。所有输出按标识排序，与用例输入顺序无关。
function aggregateResults({ spec, suites } = {}) {
  if (!spec || !Array.isArray(spec.acs)) throw new Error('spec 须为 loadBusinessSpec 的结果');
  if (!Array.isArray(suites)) throw new Error('suites 须为数组');

  const acById = new Map(spec.acs.map((ac) => [ac.id, ac]));
  const knownAcs = new Set([...(spec.knownAcIds || []), ...acById.keys()]);
  const acsOfTc = new Map();
  const knownTcs = new Set();
  for (const ac of spec.acs) {
    for (const tc of ac.tcs) {
      knownTcs.add(tc);
      if (!acsOfTc.has(tc)) acsOfTc.set(tc, []);
      acsOfTc.get(tc).push(ac.id);
    }
  }
  const pathEntries = [];
  for (const doc of spec.pathsDocs || []) {
    for (const entry of doc.paths || []) {
      pathEntries.push(entry);
      for (const tc of entry.tcs) knownTcs.add(tc);
    }
  }

  const tcCounts = new Map();
  const acStats = new Map();
  const unknown = new Set();
  const caseTotals = emptyCounts();
  const suiteSummaries = [];
  let unlabelled = 0;
  let classnameOnlyTotal = 0;

  for (const suite of suites) {
    const platform = suite.platform || NO_PLATFORM;
    const cases = Array.isArray(suite.cases) ? suite.cases : [];
    let suiteUnlabelled = 0;
    let suiteClassnameOnly = 0;
    let suiteFailed = 0;
    for (const item of cases) {
      if (!CASE_STATUSES.includes(item.status)) throw new Error(`用例 ${show(item.name)} 的状态 ${show(item.status)} 无效`);
      addCase(caseTotals, item.status);
      if (item.status === 'failed' || item.status === 'error') suiteFailed += 1;
      const labels = extractCaseLabels(item);
      if (labels.acs.length === 0 && labels.tcs.length === 0) {
        suiteUnlabelled += 1;
        if (classnameOnly(item)) suiteClassnameOnly += 1;
        continue;
      }
      // 显式标注 AC 的用例只绑定这些 AC；只有未标注 AC 时，才按 TC 展开到列出该 TC 的全部 AC。
      // 否则 "AC-X / TC-1" 失败会连带让仅复用 TC-1 的兄弟 AC 失败。
      const bound = new Set();
      for (const id of labels.acs) {
        if (!knownAcs.has(id)) unknown.add(id);
        else if (acById.has(id)) bound.add(id);
      }
      const explicitAcs = bound.size > 0;
      for (const id of labels.tcs) {
        if (!knownTcs.has(id)) {
          unknown.add(id);
          continue;
        }
        if (!tcCounts.has(id)) tcCounts.set(id, emptyCounts());
        addCase(tcCounts.get(id), item.status);
        if (explicitAcs) continue;
        for (const acId of acsOfTc.get(id) || []) bound.add(acId);
      }
      for (const acId of bound) {
        if (!acStats.has(acId)) acStats.set(acId, { overall: emptyCounts(), platforms: new Map() });
        const stats = acStats.get(acId);
        addCase(stats.overall, item.status);
        if (platform !== NO_PLATFORM) {
          if (!stats.platforms.has(platform)) stats.platforms.set(platform, emptyCounts());
          addCase(stats.platforms.get(platform), item.status);
        }
      }
    }
    unlabelled += suiteUnlabelled;
    classnameOnlyTotal += suiteClassnameOnly;
    // failed 计入失败与错误用例：门禁据此区分“非零退出有失败用例解释”与“非零退出无从解释”。
    suiteSummaries.push({
      name: suite.name,
      cases: cases.length,
      failed: suiteFailed,
      unlabelled: suiteUnlabelled,
      classname_only: suiteClassnameOnly,
    });
  }

  const tcs = sortedObject([...knownTcs].map((id) => {
    const counts = tcCounts.get(id) || emptyCounts();
    return [id, { status: statusOf(counts), cases: counts }];
  }));

  const acs = sortedObject(spec.acs.map((ac) => {
    const stats = acStats.get(ac.id);
    const declared = sortedUnique(ac.platforms.filter((platform) => platform !== NO_PLATFORM));
    const byPlatform = {};
    for (const platform of sortedUnique([...declared, ...(stats ? stats.platforms.keys() : [])])) {
      byPlatform[platform] = statusOf((stats && stats.platforms.get(platform)) || emptyCounts());
    }
    return [ac.id, {
      priority: ac.priority,
      verification: ac.verification,
      platforms: declared,
      status: statusOf(stats ? stats.overall : emptyCounts()),
      by_platform: byPlatform,
      tcs: sortedUnique(ac.tcs),
    }];
  }));

  const paths = sortedObject(pathEntries.map((entry) => {
    const entryTcs = sortedUnique(entry.tcs);
    return [entry.id, { status: pathStatus(entryTcs.map((tc) => tcs[tc].status)), tcs: entryTcs }];
  }));

  const acStatuses = { passed: 0, failed: 0, skipped: 0, missing: 0 };
  let manual = 0;
  for (const record of Object.values(acs)) {
    acStatuses[record.status] += 1;
    if (record.verification === 'manual') manual += 1;
  }
  const acTotal = Object.keys(acs).length;

  return {
    suites: suiteSummaries,
    tcs,
    acs,
    paths,
    unknown_ids: [...unknown].sort(compareText),
    summary: {
      suites: suites.length,
      cases: caseTotals,
      unlabelled,
      classname_only: classnameOnlyTotal,
      acs: { total: acTotal, ...acStatuses, auto: acTotal - manual, manual },
      paths: { total: Object.keys(paths).length, passed: Object.values(paths).filter((record) => record.status === 'passed').length },
    },
  };
}

module.exports = {
  CASE_STATUSES,
  aggregateResults,
  evaluateSuiteOutcome,
  extractCaseLabels,
  judgeAc,
};

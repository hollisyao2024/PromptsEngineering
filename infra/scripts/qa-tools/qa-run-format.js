'use strict';

// qa run 的输出：把运行结果格式化为 stdout 上的 KEY=value 结构化行。

const { oneLine } = require('../shared/result-block');
const { judgeAc } = require('./business-results');
const { compareText } = require('./business-spec');
const { formatViolation } = require('./qa-paths');

function suiteLine(suite) {
  return `SUITE=${[
    suite.name,
    suite.platform,
    suite.status,
    `exit=${suite.exit_code === null ? '-' : suite.exit_code}`,
    `${suite.duration_ms}ms`,
    `${suite.cases} cases`,
    `sha256=${suite.report ? suite.report.sha256 : '-'}`,
    suite.detail ? oneLine(suite.detail) : '-',
  ].join('|')}`;
}

// AC_OPEN 只列必需优先级；其余优先级未证明的自动化 AC 用 AC_UNPROVEN 列出（qa verify 只披露为风险），
// 未通过的路径用 PATH_OPEN 列出其未通过的 TC，便于直接定位失败步骤。
function detailLines(results, openIds) {
  const lines = [];
  for (const id of Object.keys(results.acs || {}).sort(compareText)) {
    const record = results.acs[id];
    if (!record || record.verification !== 'auto' || openIds.has(id)) continue;
    const judged = judgeAc(record);
    if (!judged.proven) lines.push(`AC_UNPROVEN=${id}|${record.priority}|${judged.state}|${oneLine(judged.reason)}`);
  }
  const tcStatus = (tc) => (results.tcs && results.tcs[tc] && results.tcs[tc].status) || 'missing';
  for (const id of Object.keys(results.paths || {}).sort(compareText)) {
    const record = results.paths[id];
    if (!record || record.status === 'passed') continue;
    const bad = (Array.isArray(record.tcs) ? record.tcs : []).filter((tc) => tcStatus(tc) !== 'passed');
    lines.push(`PATH_OPEN=${id}|${record.status}|${bad.map((tc) => `${tc}=${tcStatus(tc)}`).join(',') || '-'}`);
  }
  return lines;
}

// 多轮运行（G6）的摘要与不稳定明细；旧结果没有 repeat 段时不输出。
// FLAKY_CASE=<套件>|<必需优先级或 ->|<各轮状态>|<用例名>；FLAKY_SUITE=<套件>|<各轮套件状态>。
function repeatLines(repeat) {
  if (!repeat) return [];
  return [
    `REPEAT_RUNS=${repeat.runs}`,
    `FLAKY=${repeat.summary.flaky}`,
    `FLAKY_RATE=${repeat.summary.rate.toFixed(4)}`,
    ...repeat.flaky.map((item) => `FLAKY_CASE=${item.suite}|${item.priorities.join(',') || '-'}|${item.statuses.join(',')}|${oneLine(item.name)}`),
    ...repeat.unstable_suites.map((item) => `FLAKY_SUITE=${item.name}|${item.statuses.join(',')}`),
  ];
}

function formatRunReport(outcome) {
  const lines = [
    `STATUS=${outcome.status}`,
    `SUMMARY=${oneLine(outcome.summary)}`,
    `NEXT_ACTION=${oneLine(outcome.nextAction)}`,
  ];
  if (outcome.reason) lines.push(`REASON=${outcome.reason}`);
  if (outcome.headSha) lines.push(`HEAD_SHA=${outcome.headSha}`);
  if (outcome.worktreeClean !== null) lines.push(`WORKTREE_CLEAN=${outcome.worktreeClean}`);
  if (outcome.configDigest) lines.push(`CONFIG_DIGEST=${outcome.configDigest}`);
  lines.push(...outcome.configErrors.map((item) => `CONFIG_ERROR=${item.field}|${oneLine(item.message)}`));
  lines.push(...outcome.violations.map(formatViolation));
  lines.push(...outcome.pathProblems.map((item) => `REPORT_PATH=${item.suite}|${item.path}|${oneLine(item.message)}`));

  const { results } = outcome;
  if (results) {
    const { acs, cases, paths } = results.summary;
    lines.push(
      ...results.suites.map(suiteLine),
      `RESULTS_FILE=${outcome.resultsFile}`,
      `AC_TOTAL=${acs.total}`,
      `AC_PASSED=${acs.passed}`,
      `AC_FAILED=${acs.failed}`,
      `AC_SKIPPED=${acs.skipped}`,
      `AC_MISSING=${acs.missing}`,
      `AC_MANUAL=${acs.manual}`,
      `CASES_TOTAL=${cases.total}`,
      `CASES_PASSED=${cases.passed}`,
      `CASES_FAILED=${cases.failed}`,
      `CASES_ERROR=${cases.error}`,
      `CASES_SKIPPED=${cases.skipped}`,
      `PATH_TOTAL=${paths.total}`,
      `PATH_PASSED=${paths.passed}`,
    );
    lines.push(...repeatLines(results.repeat));
    if (results.unknown_ids.length > 0) lines.push(`UNKNOWN_IDS=${results.unknown_ids.join(',')}`);
  }
  lines.push(...outcome.acOpen.map((item) => `AC_OPEN=${item.id}|${item.priority}|${item.state}|${oneLine(item.reason)}`));
  if (results) lines.push(...detailLines(results, new Set(outcome.acOpen.map((item) => item.id))));
  lines.push(...outcome.warnings.map((warning) => `WARNING=${oneLine(warning)}`));
  return lines;
}

module.exports = { formatRunReport };

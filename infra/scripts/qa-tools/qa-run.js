#!/usr/bin/env node
'use strict';

// qa run：按 qa.business.suites 逐套运行业务测试命令，读取各套件的 JUnit XML 报告，
// 把用例绑定到 PRD 原子 AC / TC / 路径，写出容器 tmp 下的 ac-results.json 与报告副本。
// 只做确定性的运行、解析与记录：不调用模型与网络，不执行也不解释报告里的任何文字。
// stdout 只输出 KEY=value 结构化行；套件自己的输出一律转到 stderr。

const { exitOnHelp } = require('../shared/cli-help');
const { ensureContainerDirectories, getMainRepoRoot, loadConfig, resolveRepoRoot } = require('../shared/config');
const { oneLine } = require('../shared/result-block');
const { resolveBusinessConfig } = require('./business-config');
const { buildResults, evaluateSuiteOutcome, judgeAc, resultsDirectory, writeResults } = require('./business-results');
const { compareText } = require('./business-spec');
const { analyzeSpec } = require('./qa-paths');
const { formatRunReport } = require('./qa-run-format');
const { installSignalHandlers, runCommand } = require('./qa-run-process');
const { checkReportPaths, git, readReport, removeReport, removeResults } = require('./qa-run-reports');

const USAGE = [
  'Usage: pnpm agent -- qa run',
  '',
  '按 agent.config.json 的 qa.business.suites 逐套运行业务测试命令（仓库根目录、经 shell 执行），',
  '读取各套件的 JUnit XML 报告，把用例绑定到 PRD 原子 AC / TC / 路径，',
  '并把结果写入容器 tmp 下的 qa-business-results/<工作区标识>/ac-results.json。',
  '配置非法、没有套件、规格违规、仓库无提交或报告路径不安全时 STATUS=BLOCKED，不运行任何套件；',
  '任一套件未正常完成或存在失败用例时 STATUS=FAILED(REASON=SUITE_FAILED)；套件都正常完成、',
  '但 requiredPriorities 内的自动化 AC 仍有未证明的（AC_OPEN 非空）时 STATUS=FAILED(REASON=AC_NOT_PROVEN)，',
  '结果照常写出，退出码非零，判定与 qa verify 的业务门禁一致。',
  'qa.business.enabled 只决定 qa verify 是否启用门禁，不影响本命令。',
].join('\n');

const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

// ---------------------------------------------------------------------------
// 运行
// ---------------------------------------------------------------------------

const outcomeOf = (fields) => ({
  status: 'OK',
  reason: null,
  summary: '',
  nextAction: '',
  headSha: null,
  worktreeClean: null,
  configDigest: null,
  results: null,
  resultsFile: null,
  configErrors: [],
  violations: [],
  pathProblems: [],
  acOpen: [],
  warnings: [],
  ...fields,
});
const blocked = (reason, summary, nextAction, extra = {}) => outcomeOf({ status: 'BLOCKED', reason, summary, nextAction, ...extra });
const failed = (reason, summary, nextAction, extra = {}) => outcomeOf({ status: 'FAILED', reason, summary, nextAction, ...extra });

// 需要的 AC 里没被证明的那些：判定与 qa verify 的门禁共用 judgeAc。
// 它们既作 AC_OPEN 输出，也决定套件全部正常完成时是否以 AC_NOT_PROVEN 失败。
function openAcs(results, requiredPriorities) {
  const required = new Set(requiredPriorities);
  const open = [];
  for (const id of Object.keys(results.acs).sort(compareText)) {
    const record = results.acs[id];
    if (record.verification !== 'auto' || !required.has(record.priority)) continue;
    const judged = judgeAc(record);
    if (!judged.proven) open.push({ id, priority: record.priority, state: judged.state, reason: judged.reason });
  }
  return open;
}

function describeRun(results, business) {
  const { suites, cases, acs } = results.summary;
  const unfinished = results.suites.filter((suite) => suite.status !== 'ok');
  const failedCases = cases.failed + cases.error;
  const acOpen = openAcs(results, business.requiredPriorities);
  if (unfinished.length === 0 && failedCases === 0) {
    return {
      ok: true,
      summary: `${suites} 个套件全部正常完成：${cases.total} 条用例，${acs.passed}/${acs.total} 条 AC 通过`,
      acOpen,
    };
  }
  const parts = [];
  if (unfinished.length > 0) parts.push(`${unfinished.length} 个套件未正常完成（${unfinished.map((suite) => `${suite.name}: ${suite.status}`).join('，')}）`);
  if (failedCases > 0) parts.push(`${failedCases} 条用例失败`);
  return { ok: false, summary: `${parts.join('，')}；结果已记录`, acOpen };
}

async function runBusinessSuites({
  repoRoot,
  mainRoot,
  config,
  env = process.env,
  shell = true,
  killGraceMs = 5000,
  now = () => new Date(),
  handleSignals = true,
} = {}) {
  const business = resolveBusinessConfig(config);
  if (!business.ok) {
    return blocked(
      'CONFIG_INVALID',
      `qa.business 配置有 ${business.errors.length} 项错误，未运行任何套件`,
      '按 CONFIG_ERROR 修正 agent.config.json 的 qa.business 后重新执行 pnpm agent -- qa run',
      { configErrors: business.errors },
    );
  }
  if (business.suites.length === 0) {
    return blocked(
      'NO_SUITES',
      'qa.business.suites 为空，没有可运行的业务测试套件',
      '在 agent.config.json 的 qa.business.suites 登记套件（name、command、report，可选 platform、timeoutSeconds）后重新执行 pnpm agent -- qa run',
    );
  }

  const analysis = analyzeSpec({ repoRoot });
  if (analysis.status !== 'OK') {
    return blocked(
      'SPEC_INVALID',
      `业务测试规格有 ${analysis.violations.length} 项违规，未运行任何套件`,
      '按 VIOLATION 修正 PRD 原子 AC 表与 PATHS.md（可先执行 pnpm agent -- qa paths 复核）后重新执行 pnpm agent -- qa run',
      { violations: analysis.violations },
    );
  }

  const head = git(repoRoot, ['rev-parse', 'HEAD']);
  const headSha = head.ok ? head.stdout.trim() : '';
  if (!COMMIT_PATTERN.test(headSha)) {
    return blocked(
      'NO_HEAD',
      '仓库还没有任何提交，无法把结果绑定到 HEAD，未运行任何套件',
      '先完成一次提交（pnpm agent -- tdd commit）后重新执行 pnpm agent -- qa run',
    );
  }

  const pathProblems = checkReportPaths({ repoRoot, suites: business.suites });
  if (pathProblems.length > 0) {
    return blocked(
      'REPORT_PATH_INVALID',
      `${pathProblems.length} 个套件的报告路径不安全，未运行任何套件`,
      '按 REPORT_PATH 调整 qa.business.suites[].report；已被跟踪的报告须 git rm --cached 并加入 .gitignore，之后重新执行 pnpm agent -- qa run',
      { pathProblems },
    );
  }

  // 以上全部通过才开始产生副作用：先清掉旧报告与旧结果，再取工作区状态，
  // 这样上次遗留的未跟踪报告不会弄脏工作区，旧结果也不会在本次失败后被误当作新结果。
  let directory;
  let worktreeClean;
  try {
    ensureContainerDirectories(config, mainRoot, ['tmp']);
    directory = resultsDirectory(config, mainRoot, repoRoot);
    for (const suite of business.suites) removeReport(repoRoot, suite.report);
    const status = git(repoRoot, ['status', '--porcelain', '--untracked-files=normal']);
    worktreeClean = status.ok && status.stdout === '';
    removeResults(directory);
  } catch (error) {
    return failed(
      'WRITE_FAILED',
      `无法准备业务测试运行环境：${oneLine(error.message)}`,
      '检查容器 tmp 目录与报告路径的权限后重新执行 pnpm agent -- qa run',
      { headSha, configDigest: business.digest },
    );
  }

  const known = { headSha, worktreeClean, configDigest: business.digest };
  const controller = { current: null, interrupted: null };
  const removeHandlers = handleSignals ? installSignalHandlers(controller) : () => {};
  const observations = [];
  try {
    for (const suite of business.suites) {
      if (controller.interrupted) break;
      removeReport(repoRoot, suite.report);
      const ran = await runCommand({
        command: suite.command,
        cwd: repoRoot,
        env,
        shell,
        timeoutMs: suite.timeoutSeconds * 1000,
        killGraceMs,
        controller,
      });
      if (controller.interrupted) break;
      const report = ran.spawnError || ran.timedOut ? { bytes: null, problem: null } : readReport(repoRoot, suite.report);
      const evaluated = evaluateSuiteOutcome({
        spawnError: ran.spawnError,
        timedOut: ran.timedOut,
        exitCode: ran.exitCode,
        signal: ran.signal,
        reportBytes: report.bytes,
        reportProblem: report.problem,
        timeoutSeconds: suite.timeoutSeconds,
      });
      observations.push({ suite, ran, report, evaluated });
    }
  } catch (error) {
    return failed(
      'WRITE_FAILED',
      `运行套件时无法清理旧报告：${oneLine(error.message)}`,
      '检查报告路径的权限后重新执行 pnpm agent -- qa run',
      known,
    );
  } finally {
    removeHandlers();
  }
  if (controller.interrupted) {
    return failed(
      'INTERRUPTED',
      `收到 ${controller.interrupted}，已终止正在运行的套件，未写入结果`,
      '确认中断原因后重新执行 pnpm agent -- qa run',
      known,
    );
  }

  let results;
  let resultsFile;
  try {
    results = buildResults({
      spec: analysis.spec,
      headSha,
      worktreeClean,
      configDigest: business.digest,
      generatedAt: now().toISOString(),
      suites: observations.map(({ suite, ran, evaluated }) => ({
        name: suite.name,
        platform: suite.platform,
        command: suite.command,
        exitCode: ran.exitCode,
        status: evaluated.status,
        durationMs: ran.durationMs,
        detail: evaluated.detail,
        report: evaluated.report ? { path: suite.report, sha256: evaluated.report.sha256, bytes: evaluated.report.bytes } : null,
        cases: evaluated.cases,
      })),
    });
    const reportCopies = {};
    for (const { suite, report, evaluated } of observations) {
      if (evaluated.report) reportCopies[suite.name] = report.bytes;
    }
    resultsFile = writeResults({ directory, results, reportCopies });
  } catch (error) {
    return failed(
      'WRITE_FAILED',
      `无法写入业务测试结果：${oneLine(error.message)}`,
      '检查容器 tmp 目录的权限与剩余空间后重新执行 pnpm agent -- qa run',
      known,
    );
  }

  const described = describeRun(results, business);
  const warnings = worktreeClean
    ? []
    : ['工作区存在未提交改动，qa verify 会以 RESULTS_DIRTY_WORKTREE 拒绝这份结果；请把报告路径加入 .gitignore，或提交/清理改动后重新执行 pnpm agent -- qa run'];
  const written = { ...known, results, resultsFile, acOpen: described.acOpen, warnings };
  // 套件失败的原因优先：它已经说明了为什么有 AC 没被证明，不再叠加第二个原因。
  if (!described.ok) {
    return failed(
      'SUITE_FAILED',
      described.summary,
      '按 SUITE 与 AC_OPEN 定位失败原因（套件的原始输出在 stderr），修复并提交后重新执行 pnpm agent -- qa run',
      written,
    );
  }
  // 套件都正常完成，但必需优先级的自动化 AC 仍没被证明：与 qa verify 同一判定，这里同样不放行，
  // 否则 STATUS=OK 会让调用方以为业务验收已经过关。结果照常写出，仍可交给 qa verify 复验。
  if (described.acOpen.length > 0) {
    return failed(
      'AC_NOT_PROVEN',
      `${described.summary}；但有 ${described.acOpen.length} 条必需优先级（${business.requiredPriorities.join('/')}）的自动化 AC 未证明`,
      '按 AC_OPEN 为未证明的 AC 补写自动化用例（用例名带上 AC-…/TC-… 标识）或修复被跳过的用例，提交后重新执行 pnpm agent -- qa run；确属无法自动化的 AC 须在 PRD 原子 AC 表中标为 manual',
      written,
    );
  }
  return outcomeOf({
    status: 'OK',
    summary: described.summary,
    nextAction: `结果已绑定 HEAD ${headSha.slice(0, 12)}；若还会提交新改动，须在最终提交后重新执行 pnpm agent -- qa run，再执行 pnpm agent -- qa verify`,
    ...written,
  });
}

async function main() {
  const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
  const config = loadConfig({ repoRoot });
  const mainRoot = getMainRepoRoot(repoRoot);
  const outcome = await runBusinessSuites({ repoRoot, mainRoot, config });
  console.log(formatRunReport(outcome).join('\n'));
  // 不调用 process.exit：输出较大时管道写入可能尚未排空。
  process.exitCode = outcome.status === 'OK' ? 0 : 1;
}

if (require.main === module) {
  exitOnHelp(USAGE);
  main().catch((error) => {
    console.log([
      'STATUS=FAILED',
      `SUMMARY=qa run 执行失败：${oneLine(error.message)}`,
      'NEXT_ACTION=检查 agent.config.json、docs/prd-modules 与容器 tmp 是否可读写后重试',
    ].join('\n'));
    process.exit(1);
  });
}

module.exports = { checkReportPaths, formatRunReport, runBusinessSuites };

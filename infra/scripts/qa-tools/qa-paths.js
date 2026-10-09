#!/usr/bin/env node
'use strict';

// qa paths：校验 PRD 原子 AC 表与 docs/qa-modules/<域>/PATHS.md 路径模型，
// 输出 AC → 转移 → 路径 → TC 的覆盖矩阵。只读：不创建目录、不运行任何测试。

const { exitOnHelp } = require('../shared/cli-help');
const { resolveRepoRoot } = require('../shared/config');
const { oneLine } = require('../shared/result-block');
const {
  AC_TABLE_HEADER,
  PRD_MODULES_DIR,
  QA_MODULES_DIR,
  compareText,
  compareViolations,
  loadBusinessSpec,
} = require('./business-spec');

const USAGE = [
  'Usage: pnpm agent -- qa paths',
  '',
  '只读校验 PRD 原子 AC 表与 docs/qa-modules/<域>/PATHS.md 路径模型，输出 AC → 转移 → 路径 → TC 覆盖矩阵。',
  '存在任何违规时 STATUS=BLOCKED 并以非零退出码结束；不创建目录，不运行测试。',
].join('\n');

const unique = (values) => [...new Set(values)];
const shown = (value) => value || '（空）';

// 路径集合覆盖的转移与状态：include 选出参与统计的路径（门禁只统计已通过的路径）。
// 序列里指向未定义转移的条目忽略；状态覆盖取已覆盖转移的起止状态。
function computeCoverage(doc, include = () => true) {
  const transitions = new Map(doc.transitions.map((item) => [item.id, item]));
  const coveredTransitions = new Set();
  for (const item of doc.paths) {
    if (!include(item)) continue;
    for (const id of item.sequence) {
      if (transitions.has(id)) coveredTransitions.add(id);
    }
  }
  const coveredStates = new Set();
  for (const id of coveredTransitions) {
    coveredStates.add(transitions.get(id).from);
    coveredStates.add(transitions.get(id).to);
  }
  return {
    coveredTransitions,
    coveredStates,
    uncoveredTransitions: doc.transitions.filter((item) => !coveredTransitions.has(item.id)),
    uncoveredStates: doc.states.filter((item) => !coveredStates.has(item.id)),
  };
}

function checkDocument(doc, { knownAcIds, linkedAcIds, acs }) {
  // 缺表时只报告缺表本身，不再产生由此衍生的引用噪声。
  if (doc.missingTables.length > 0) return [];

  const violations = [];
  const report = (code, line, message) => violations.push({ code, file: doc.file, line, message });
  const screenIds = new Set(doc.screens.map((item) => item.id));
  const stateIds = new Set(doc.states.map((item) => item.id));
  const transitions = new Map(doc.transitions.map((item) => [item.id, item]));

  for (const state of doc.states) {
    if (!screenIds.has(state.screen)) report('REF_UNKNOWN', state.line, `状态 ${state.id} 引用了未定义的界面 ${shown(state.screen)}`);
  }

  for (const transition of doc.transitions) {
    if (!stateIds.has(transition.from)) {
      report('REF_UNKNOWN', transition.line, `转移 ${transition.id} 的起始状态 ${shown(transition.from)} 未在状态表定义`);
    }
    if (!stateIds.has(transition.to)) {
      report('REF_UNKNOWN', transition.line, `转移 ${transition.id} 的目标状态 ${shown(transition.to)} 未在状态表定义`);
    }
    for (const ac of transition.acs) {
      if (!knownAcIds.has(ac)) report('REF_UNKNOWN', transition.line, `转移 ${transition.id} 关联的 ${ac} 未在任何 PRD 原子 AC 表定义`);
    }
  }

  for (const item of doc.paths) {
    if (item.sequence.length === 0) {
      report('PATH_EMPTY', item.line, `路径 ${item.id} 的转移序列为空`);
      continue;
    }
    for (const id of unique(item.sequence)) {
      if (!transitions.has(id)) report('REF_UNKNOWN', item.line, `路径 ${item.id} 引用了未定义的转移 ${id}`);
    }
    for (let index = 1; index < item.sequence.length; index += 1) {
      const previous = transitions.get(item.sequence[index - 1]);
      const next = transitions.get(item.sequence[index]);
      // 转移或其端点状态本身未定义时，根因已作为 REF_UNKNOWN 报告，不再叠加衔接违规。
      if (!previous || !next || !stateIds.has(previous.to) || !stateIds.has(next.from)) continue;
      if (previous.to !== next.from) {
        report('PATH_DISCONNECTED', item.line, `路径 ${item.id} 中 ${previous.id} 的目标状态 ${previous.to} 与 ${next.id} 的起始状态 ${next.from} 不衔接`);
      }
    }
  }

  if (doc.criteria.includes('none')) return violations;

  const coverage = computeCoverage(doc);
  if (doc.criteria.includes('all-transitions')) {
    for (const item of coverage.uncoveredTransitions) {
      report('COVERAGE_GAP', item.line, `转移 ${item.id} 未被任何路径覆盖（覆盖准则 all-transitions）`);
    }
  }
  if (doc.criteria.includes('all-states')) {
    for (const item of coverage.uncoveredStates) {
      report('COVERAGE_GAP', item.line, `状态 ${item.id} 未被任何路径覆盖（覆盖准则 all-states）`);
    }
  }
  for (const ac of acs) {
    if (ac.domain !== doc.domain || ac.priority !== 'P0' || ac.verification !== 'auto' || linkedAcIds.has(ac.id)) continue;
    violations.push({
      code: 'AC_UNLINKED',
      file: ac.file,
      line: ac.line,
      message: `${ac.id}（P0，自动化）未被任何转移关联，而 ${doc.file} 已声明覆盖准则`,
    });
  }
  return violations;
}

// 同一文件内的重复标识已在解析时报告并丢弃；这里只查不同 PATHS.md 之间的重复，
// 否则复制模型到新域却没改标识时，ac-results.json 的 paths 键会互相覆盖。
function checkCrossDocumentIds(docs) {
  const violations = [];
  const first = new Map();
  for (const doc of docs) {
    for (const item of [...doc.screens, ...doc.states, ...doc.transitions, ...doc.paths]) {
      const seen = first.get(item.id);
      if (!seen) {
        first.set(item.id, { file: doc.file, line: item.line });
      } else if (seen.file !== doc.file) {
        violations.push({
          code: 'ID_DUPLICATE',
          file: doc.file,
          line: item.line,
          message: `${item.id} 重复，首次定义于 ${seen.file}:${seen.line}`,
        });
      }
    }
  }
  return violations;
}

function buildMatrix(spec) {
  const transitions = spec.pathsDocs.flatMap((doc) => doc.transitions);
  const paths = spec.pathsDocs.flatMap((doc) => doc.paths);
  const byId = (left, right) => compareText(left.id, right.id);

  const acs = [...spec.acs].sort(byId).map((ac) => {
    const linked = unique(transitions.filter((item) => item.acs.includes(ac.id)).map((item) => item.id)).sort(compareText);
    const via = unique(paths.filter((item) => item.sequence.some((id) => linked.includes(id))).map((item) => item.id)).sort(compareText);
    return {
      id: ac.id,
      priority: ac.priority,
      verification: ac.verification,
      platforms: ac.platforms,
      transitions: linked,
      paths: via,
      tcs: ac.tcs,
    };
  });

  return {
    acs,
    paths: [...paths].sort(byId).map((item) => ({ id: item.id, transitions: item.sequence, tcs: item.tcs })),
    counts: {
      modules: spec.modules.length,
      acTotal: spec.acs.length,
      acAuto: spec.acs.filter((ac) => ac.verification === 'auto').length,
      acManual: spec.acs.filter((ac) => ac.verification === 'manual').length,
      transitions: transitions.length,
      paths: paths.length,
      tcs: unique([...spec.acs.flatMap((ac) => ac.tcs), ...paths.flatMap((item) => item.tcs)]).length,
    },
  };
}

function analyzeSpec({ repoRoot }) {
  const spec = loadBusinessSpec({ repoRoot });
  const violations = [...spec.violations];

  const noAtomicAc = spec.acRowCount === 0;
  if (noAtomicAc) {
    violations.push({
      code: 'NO_ATOMIC_AC',
      file: PRD_MODULES_DIR,
      line: 0,
      message: `未找到任何原子 AC：${PRD_MODULES_DIR}/<域>/ 下的 Markdown 须包含表头为「${AC_TABLE_HEADER.join(' | ')}」的表格`,
    });
  }

  // 有 auto AC 的域必须有路径模型；只有 manual AC 的域不要求 PATHS.md。缺文档本身就是违规，而不是"无文档可检查"。
  const domainsWithPaths = new Set(spec.pathsDocs.map((doc) => doc.domain));
  const autoDomains = [...new Set(spec.acs.filter((ac) => ac.verification === 'auto').map((ac) => ac.domain))];
  for (const domain of autoDomains.sort(compareText)) {
    if (domainsWithPaths.has(domain)) continue;
    violations.push({
      code: 'PATHS_MISSING',
      file: `${QA_MODULES_DIR}/${domain}/PATHS.md`,
      line: 0,
      message: `域 ${domain} 含 auto AC 但缺少 ${QA_MODULES_DIR}/${domain}/PATHS.md 路径模型`,
    });
  }

  const context = {
    acs: spec.acs,
    knownAcIds: new Set(spec.knownAcIds),
    linkedAcIds: new Set(spec.pathsDocs.flatMap((doc) => doc.transitions.flatMap((item) => item.acs))),
  };
  violations.push(...checkCrossDocumentIds(spec.pathsDocs));
  for (const doc of spec.pathsDocs) violations.push(...checkDocument(doc, context));
  violations.sort(compareViolations);

  const { acs, paths, counts } = buildMatrix(spec);
  return {
    status: violations.length === 0 ? 'OK' : 'BLOCKED',
    violations,
    spec,
    noAtomicAc,
    counts,
    matrix: { acs, paths },
  };
}

const list = (values) => (values.length > 0 ? values.join(',') : '-');

// 与 qa run 共用：两条命令对同一类规格违规必须给出同一种输出行。
function formatViolation(violation) {
  const location = violation.line > 0 ? `${violation.file}:${violation.line}` : violation.file;
  return `VIOLATION=${violation.code}|${location}|${oneLine(violation.message)}`;
}

function formatPathsReport(analysis) {
  const { counts, matrix, violations } = analysis;
  const ok = analysis.status === 'OK';
  return [
    `STATUS=${analysis.status}`,
    ok
      ? `SUMMARY=路径模型校验通过：${counts.modules} 个模块，${counts.acTotal} 条原子 AC，${counts.transitions} 个转移，${counts.paths} 条路径`
      : `SUMMARY=发现 ${violations.length} 项违规，业务测试规格尚未通过校验`,
    ok
      ? 'NEXT_ACTION=按覆盖矩阵为每条路径编写自动化用例，经 pnpm agent -- qa run 执行并取得 ac-results.json'
      : 'NEXT_ACTION=按 VIOLATION 逐项修正 PRD 原子 AC 表与 PATHS.md 后重新执行 pnpm agent -- qa paths',
    `MODULES=${counts.modules}`,
    `AC_TOTAL=${counts.acTotal}  AC_AUTO=${counts.acAuto}  AC_MANUAL=${counts.acManual}`,
    `TRANSITION_TOTAL=${counts.transitions}  PATH_TOTAL=${counts.paths}  TC_TOTAL=${counts.tcs}`,
    ...matrix.acs.map((row) => `MATRIX_AC=${[
      row.id,
      row.priority,
      row.verification,
      list(row.platforms),
      list(row.transitions),
      list(row.paths),
      list(row.tcs),
    ].join('|')}`),
    ...matrix.paths.map((row) => `MATRIX_PATH=${[row.id, list(row.transitions), list(row.tcs)].join('|')}`),
    ...violations.map(formatViolation),
  ];
}

function main() {
  const analysis = analyzeSpec({ repoRoot: resolveRepoRoot({ scriptDir: __dirname }) });
  console.log(formatPathsReport(analysis).join('\n'));
  // 不调用 process.exit：输出较大时管道写入可能尚未排空。
  process.exitCode = analysis.status === 'OK' ? 0 : 1;
}

if (require.main === module) {
  exitOnHelp(USAGE);
  try {
    main();
  } catch (error) {
    console.log([
      'STATUS=FAILED',
      `SUMMARY=qa paths 执行失败：${oneLine(error.message)}`,
      'NEXT_ACTION=检查 docs/prd-modules 与 docs/qa-modules 是否可读后重试',
    ].join('\n'));
    process.exit(1);
  }
}

module.exports = { analyzeSpec, buildMatrix, computeCoverage, formatPathsReport, formatViolation };

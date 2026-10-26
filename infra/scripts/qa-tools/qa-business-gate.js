'use strict';

// 业务验收门禁（BIZTEST-SVC-006）：只读复验 `qa run` 写出的 ac-results.json，给出 PASS / BLOCKED 与风险披露。
// 不执行套件、不调用模型、不联网、不写任何文件；同样的输入得到逐字节相同的输出。
//
// 判定顺序（ARCH §3）：1 配置 → 2 规格 → 3 结果存在 → 4 新鲜度 → 5 套件 → 6 完整性 → 7 验收 → 8 路径覆盖 → 9 披露。
// 第 1–6 步任一失败即停止（结果不可信时，后面的清单只会误导），同一步内的违规全部列出；
// 第 7、8 步相互独立，同时失败时都列出；第 9 步的风险披露只在结果可信（第 3–6 步通过）时给出。
// 工作区是否干净取自 qa run 记录的 worktree_clean：门禁不再运行 git，结果与 HEAD 的绑定已由 head_sha 保证。
// 第 6 步（完整性）位于 qa-business-gate-integrity.js；多轮结果（qa run --repeat）的完整性复核与 FLAKY 判定位于 qa-business-gate-repeat.js。

const { resolveBusinessConfig } = require('./business-config');
const {
  RESULTS_FILE,
  judgeAc,
  readResults,
  resultsDirectory,
} = require('./business-results');
const { compareText } = require('./business-spec');
const { SHORT_SHA_LENGTH, integrityBlocks } = require('./qa-business-gate-integrity');
const { repeatBlocks, repeatFacts, repeatIntegrityBlocks, repeatRisks } = require('./qa-business-gate-repeat');
const { analyzeSpec, computeCoverage } = require('./qa-paths');

const BLOCK_CODES = Object.freeze([
  'CONFIG_INVALID',
  'NO_ATOMIC_AC',
  'SPEC_INVALID',
  'RESULTS_MISSING',
  'RESULTS_INVALID',
  'RESULTS_STALE_HEAD',
  'RESULTS_DIRTY_WORKTREE',
  'RESULTS_CONFIG_DRIFT',
  'SUITE_HARD_FAILURE',
  'SUITE_EXIT_UNEXPLAINED',
  'REPORT_TAMPERED',
  'RESULTS_MISMATCH',
  'AC_NOT_PROVEN',
  'PATH_COVERAGE_GAP',
  'FLAKY',
  'REPEAT_INSUFFICIENT',
  'GATE_ERROR',
]);

const RISK_CODES = Object.freeze([
  'RISK_MANUAL_AC',
  'RISK_LOWER_PRIORITY',
  'RISK_UNLABELLED_CASES',
  'RISK_CLASSNAME_ONLY',
  'RISK_UNKNOWN_IDS',
  'RISK_SUITE_EXIT_NONZERO',
  'RISK_MODULE_WITHOUT_TABLE',
  'RISK_FLAKY',
]);

const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const UNSAFE_RUN = /[\s\u0000-\u001f\u007f-\u009f]+/gu;
const SOUND_SUITE_STATUSES = new Set(['ok', 'exit_nonzero']);

const MAX_LISTED = 20;
const MAX_TEXT_CODE_POINTS = 400;

const RERUN = '提交全部改动后运行 pnpm agent -- qa run 重新生成结果，再重新运行 pnpm agent -- qa verify';

const HINTS = Object.freeze({
  CONFIG_INVALID: '修正 agent.config.json 的 qa.business 配置（启用时至少声明一个套件）后重新运行 pnpm agent -- qa verify',
  NO_ATOMIC_AC: '在 docs/prd-modules/<域>/ 的 PRD 中按模板补写原子 AC 表，或把 qa.business.enabled 设为 false，然后重新运行 pnpm agent -- qa verify',
  SPEC_INVALID: '运行 pnpm agent -- qa paths 查看全部 VIOLATION，修正 PRD 原子 AC 表与 PATHS.md 后重新运行 pnpm agent -- qa verify',
  RESULTS_MISSING: RERUN,
  RESULTS_INVALID: RERUN,
  RESULTS_STALE_HEAD: RERUN,
  RESULTS_DIRTY_WORKTREE: '把报告输出路径加入 .gitignore（已被跟踪的报告先 git rm --cached），或提交/清理工作区的其余改动，再运行 pnpm agent -- qa run 并重新运行 pnpm agent -- qa verify',
  RESULTS_CONFIG_DRIFT: RERUN,
  SUITE_HARD_FAILURE: `先按 SUITE_HARD_FAILURE 的原因修复套件命令或报告路径；${RERUN}`,
  SUITE_EXIT_UNEXPLAINED: `套件以非零退出码结束，但报告里没有失败用例，报告不能解释这次失败（常见于 globalSetup/teardown 出错或报告不完整）：修复套件命令或报告配置使两者一致；${RERUN}`,
  REPORT_TAMPERED: RERUN,
  RESULTS_MISMATCH: RERUN,
  AC_NOT_PROVEN: '修复失败用例，或为未覆盖的 AC 补写自动化用例（用例名带上 AC-…/TC-… 标识）后重新运行 pnpm agent -- qa run；确属无法自动化的 AC 须在 PRD 中标为 manual',
  PATH_COVERAGE_GAP: '路径按关联 TC 全有或全无判定，任一 TC 未通过会使整条路径经过的全部转移失去覆盖：修复明细中列出的未通过 TC，或补写覆盖该转移的自动化用例；若长路径中只有部分步骤未实现，可在 PATHS.md 把路径拆成更短的路径（各自关联 TC）使已通过部分独立计入覆盖，或修正覆盖准则，然后重新运行 pnpm agent -- qa run',
  FLAKY: '同一 HEAD 上多轮运行结果不一致，结果不能证明 AC：按 FLAKY 明细排查用例或套件的不确定来源（时间、随机数、顺序依赖、共享状态、外部依赖），修复后提交并运行 pnpm agent -- qa run --repeat N（N 不低于 qa.business.repeat）重新生成结果；不得放宽断言或跳过用例',
  REPEAT_INSUFFICIENT: '结果的运行轮数低于 qa.business.repeat：运行 pnpm agent -- qa run --repeat N（N 不低于 qa.business.repeat，或省略 --repeat 使用配置值）重新生成结果，再重新运行 pnpm agent -- qa verify',
  GATE_ERROR: '业务验收门禁自身出错：带着该错误信息排查后重新运行 pnpm agent -- qa verify',
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const shortSha = (sha) => String(sha).slice(0, SHORT_SHA_LENGTH);
const block = (code, subject, detail) => ({ code, subject, detail });
const risk = (code, detail) => ({ code, detail });

function list(items, limit = MAX_LISTED) {
  if (items.length <= limit) return items.join('、');
  return `${items.slice(0, limit).join('、')}…等共 ${items.length} 项`;
}

// ---------------------------------------------------------------------------
// 输入与结果结构
// ---------------------------------------------------------------------------

function checkOptions(options) {
  if (!isObject(options)) throw new TypeError('evaluateBusinessGate 需要选项对象 { repoRoot, config, headSha }');
  const { repoRoot, config, headSha, directory } = options;
  const mainRoot = options.mainRoot === undefined ? repoRoot : options.mainRoot;
  if (typeof repoRoot !== 'string' || repoRoot === '') throw new TypeError('repoRoot 须为非空路径字符串');
  if (typeof mainRoot !== 'string' || mainRoot === '') throw new TypeError('mainRoot 须为非空路径字符串');
  if (!isObject(config)) throw new TypeError('config 须为 loadConfig 的结果对象');
  if (typeof headSha !== 'string' || !SHA_PATTERN.test(headSha)) throw new TypeError('headSha 须为完整的小写十六进制提交 SHA');
  if (directory !== undefined && (typeof directory !== 'string' || directory === '')) throw new TypeError('directory 须为非空路径字符串');
  return { repoRoot, mainRoot, config, headSha, directory };
}

function blocked(blocks, { headSha, resultsFile = null, risks = [] }) {
  const counts = new Map();
  for (const item of blocks) counts.set(item.code, (counts.get(item.code) || 0) + 1);
  const hints = [...new Set(blocks.map((item) => HINTS[item.code]).filter(Boolean))];
  return {
    status: 'BLOCKED',
    blocks,
    risks,
    nextAction: hints.join('；'),
    summary: `业务验收被阻断：${blocks.length} 项（${[...counts].map(([code, count]) => `${code}×${count}`).join('、')}）`,
    headSha,
    resultsFile,
  };
}

// ---------------------------------------------------------------------------
// 第 1–2 步：配置与规格
// ---------------------------------------------------------------------------

function configBlocks(business) {
  const blocks = business.errors.map((item) => block('CONFIG_INVALID', item.field, item.message));
  if (business.ok && business.suites.length === 0) {
    blocks.push(block('CONFIG_INVALID', 'qa.business.suites', '没有声明任何业务测试套件，门禁无从取得结果'));
  }
  return blocks;
}

function specBlocks(analysis) {
  return analysis.violations.map((violation) => {
    const location = violation.line > 0 ? `${violation.file}:${violation.line}` : violation.file;
    if (violation.code === 'NO_ATOMIC_AC') return block('NO_ATOMIC_AC', location, violation.message);
    return block('SPEC_INVALID', location, `${violation.code}: ${violation.message}`);
  });
}

// ---------------------------------------------------------------------------
// 第 4–5 步：新鲜度与套件
// ---------------------------------------------------------------------------

function freshnessBlocks(results, business, headSha) {
  const blocks = [];
  if (results.head_sha !== headSha) {
    blocks.push(block(
      'RESULTS_STALE_HEAD',
      'head_sha',
      `结果绑定的 HEAD 为 ${shortSha(results.head_sha)}，当前 HEAD 为 ${shortSha(headSha)}：结果不是针对当前提交生成的`,
    ));
  }
  if (results.worktree_clean !== true) {
    blocks.push(block(
      'RESULTS_DIRTY_WORKTREE',
      'worktree_clean',
      'qa run 时工作区存在未提交改动（报告文件若在仓库内，须加入 .gitignore，或提交/清理改动），这份结果不能证明 HEAD',
    ));
  }
  if (results.config_digest !== business.digest) {
    blocks.push(block(
      'RESULTS_CONFIG_DRIFT',
      'config_digest',
      'qa.business 的套件或必需优先级在 qa run 之后发生了变化，结果与当前配置不对应',
    ));
  }
  return blocks;
}

// 非零退出码只有在报告里确有失败用例时才算被报告解释；否则报告可能遗漏了失败，整套结果不可信。
function suiteBlocks(results) {
  const blocks = [];
  for (const suite of results.suites) {
    if (!SOUND_SUITE_STATUSES.has(suite.status)) {
      blocks.push(block('SUITE_HARD_FAILURE', suite.name, suite.detail ? `${suite.status}: ${suite.detail}` : suite.status));
    } else if (suite.status === 'exit_nonzero' && suite.failed === 0) {
      blocks.push(block(
        'SUITE_EXIT_UNEXPLAINED',
        suite.name,
        `套件以 exit ${suite.exit_code} 结束，但报告中 ${suite.cases} 个用例没有任何失败：退出码无法由报告解释`,
      ));
    }
  }
  return blocks;
}


// ---------------------------------------------------------------------------
// 第 7–8 步：验收与路径覆盖
// ---------------------------------------------------------------------------

function acceptanceBlocks(results, required) {
  const blocks = [];
  let checked = 0;
  for (const id of Object.keys(results.acs).sort(compareText)) {
    const record = results.acs[id];
    if (!isObject(record) || record.verification !== 'auto' || !required.has(record.priority)) continue;
    checked += 1;
    const verdict = judgeAc(record);
    if (!verdict.proven) blocks.push(block('AC_NOT_PROVEN', id, `${record.priority} ${verdict.state}: ${verdict.reason}`));
  }
  return { blocks, checked };
}

function coverageBlocks(spec, results) {
  const blocks = [];
  const statusOf = (id) => (hasOwn(results.paths, id) && isObject(results.paths[id]) && results.paths[id].status) || 'missing';
  for (const doc of spec.pathsDocs || []) {
    const criteria = Array.isArray(doc.criteria) ? doc.criteria : [];
    const byTransitions = criteria.includes('all-transitions');
    const byStates = criteria.includes('all-states');
    if (!byTransitions && !byStates) continue;

    const coverage = computeCoverage(doc, (entry) => statusOf(entry.id) === 'passed');
    const describe = (transitionIds) => {
      const wanted = new Set(transitionIds);
      const through = doc.paths.filter((entry) => entry.sequence.some((id) => wanted.has(id)));
      if (through.length === 0) return '没有任何路径经过它';
      // 路径按其关联 TC 全有或全无判定：列出未通过的 TC，定位是哪一步让整条路径失效。
      const badTcs = (pathId) => {
        const record = hasOwn(results.paths, pathId) && isObject(results.paths[pathId]) ? results.paths[pathId] : {};
        const tcIds = Array.isArray(record.tcs) ? record.tcs : [];
        const tcStatus = (tc) => (isObject(results.tcs) && isObject(results.tcs[tc]) && results.tcs[tc].status) || 'missing';
        const bad = tcIds.filter((tc) => tcStatus(tc) !== 'passed').map((tc) => `${tc}=${tcStatus(tc)}`);
        return bad.length ? `，未通过 TC：${bad.join(',')}` : '';
      };
      return `含它的路径：${through.map((entry) => `${entry.id}(${statusOf(entry.id)}${statusOf(entry.id) === 'passed' ? '' : badTcs(entry.id)})`).join('、')}`;
    };
    if (byTransitions) {
      for (const item of coverage.uncoveredTransitions) {
        blocks.push(block(
          'PATH_COVERAGE_GAP',
          item.id,
          `转移未被任何通过的路径覆盖（准则 all-transitions）；${describe([item.id])}；声明于 ${doc.file}:${item.line}`,
        ));
      }
    }
    if (byStates) {
      for (const item of coverage.uncoveredStates) {
        const touching = doc.transitions.filter((transition) => transition.from === item.id || transition.to === item.id).map((transition) => transition.id);
        blocks.push(block(
          'PATH_COVERAGE_GAP',
          item.id,
          `状态未被任何通过的路径覆盖（准则 all-states）；经过它的转移：${touching.join('、') || '无'}；${describe(touching)}；声明于 ${doc.file}:${item.line}`,
        ));
      }
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// 第 9 步：风险披露（按 ARCH 表格顺序）
// ---------------------------------------------------------------------------

function collectRisks({ results, spec, required }) {
  const risks = [];
  const records = Object.keys(results.acs).sort(compareText).map((id) => ({ id, record: results.acs[id] }));

  const manual = records.filter(({ record }) => record.verification === 'manual' && required.has(record.priority));
  if (manual.length > 0) {
    risks.push(risk(
      'RISK_MANUAL_AC',
      `${manual.length} 条必需优先级内的 AC 标为 manual，门禁不验证它们，须人工验收：${list(manual.map(({ id, record }) => `${id}(${record.priority})`))}`,
    ));
  }

  const lower = records.filter(({ record }) => record.verification === 'auto' && !required.has(record.priority) && !judgeAc(record).proven);
  if (lower.length > 0) {
    risks.push(risk(
      'RISK_LOWER_PRIORITY',
      `${lower.length} 条低于必需优先级（${[...required].join('/')}）的自动化 AC 未通过，不阻断：${list(lower.map(({ id, record }) => `${id}(${record.priority} ${judgeAc(record).state})`))}`,
    ));
  }

  const unlabelled = results.summary.unlabelled;
  if (Number.isInteger(unlabelled) && unlabelled > 0) {
    risks.push(risk('RISK_UNLABELLED_CASES', `${unlabelled} 个用例的名称不含任何 AC/TC 标识，不计入任何验收`));
  }

  const classnameOnly = results.summary.classname_only;
  if (Number.isInteger(classnameOnly) && classnameOnly > 0) {
    risks.push(risk(
      'RISK_CLASSNAME_ONLY',
      `${classnameOnly} 个用例只有 classname（describe/文件名）带 AC/TC 标识，用例名不含标识，不计入任何验收：把标识写进用例名`,
    ));
  }

  if (results.unknown_ids.length > 0) {
    risks.push(risk('RISK_UNKNOWN_IDS', `${results.unknown_ids.length} 个用例引用了规格中不存在的标识：${list(results.unknown_ids)}`));
  }

  // 没有失败用例的非零退出已在套件检查中阻断；走到这里的非零退出都由报告中的失败用例解释。
  const nonzero = results.suites.filter((suite) => suite.status === 'exit_nonzero' && suite.failed > 0);
  if (nonzero.length > 0) {
    risks.push(risk(
      'RISK_SUITE_EXIT_NONZERO',
      `${nonzero.length} 个套件以非零退出码结束，报告中有失败用例，结果以报告为准：${list(nonzero.map((suite) => `${suite.name}(exit ${suite.exit_code})`))}`,
    ));
  }

  const uncovered = Array.isArray(spec.modulesWithoutTable) ? spec.modulesWithoutTable : [];
  if (uncovered.length > 0) {
    risks.push(risk('RISK_MODULE_WITHOUT_TABLE', `${uncovered.length} 个模块没有原子 AC 表，其验收不受本门禁约束：${list(uncovered)}`));
  }
  return risks;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function evaluate(options) {
  const { repoRoot, mainRoot, config, headSha, directory: override } = checkOptions(options);

  const business = resolveBusinessConfig(config);
  const configProblems = configBlocks(business);
  if (configProblems.length > 0) return blocked(configProblems, { headSha });

  const analysis = analyzeSpec({ repoRoot });
  const specProblems = specBlocks(analysis);
  if (specProblems.length > 0) return blocked(specProblems, { headSha });

  const directory = override === undefined ? resultsDirectory(config, mainRoot, repoRoot) : override;
  const read = readResults(directory);
  if (!read.ok) return blocked([block(read.code, RESULTS_FILE, read.message)], { headSha });
  const { results, file: resultsFile } = read;

  const untrusted = freshnessBlocks(results, business, headSha);
  if (untrusted.length === 0) untrusted.push(...suiteBlocks(results));
  if (untrusted.length === 0) untrusted.push(...integrityBlocks({ results, business, directory, spec: analysis.spec }));
  if (untrusted.length === 0) untrusted.push(...repeatIntegrityBlocks({ results, business, directory, spec: analysis.spec }));
  if (untrusted.length > 0) return blocked(untrusted, { headSha, resultsFile });

  // 结果可信后才据 repeat 段判定：多轮不一致的 P0 用例即使第 1 轮通过，也不能算已证明。
  const facts = repeatFacts(results);
  const required = new Set(business.requiredPriorities);
  const acceptance = acceptanceBlocks(results, required);
  const gaps = coverageBlocks(analysis.spec, results);
  const risks = [...collectRisks({ results, spec: analysis.spec, required }), ...repeatRisks(results)];
  const blocks = [...repeatBlocks(results, business), ...acceptance.blocks, ...gaps];
  if (blocks.length > 0) return { ...blocked(blocks, { headSha, resultsFile, risks }), ...facts };

  // 放行的判定同时携带回执要记录的业务摘要：必需优先级、已证明的自动化 AC 条数、披露风险数与配置摘要。
  return {
    status: 'PASS',
    blocks: [],
    risks,
    nextAction: null,
    summary: `业务验收通过：${acceptance.checked} 条必需优先级（${[...required].join('/')}）的自动化 AC 全部证明，运行 ${facts.repeatRuns} 轮、不稳定用例 ${facts.flakyCount} 个，披露风险 ${risks.length} 项`,
    requiredPriorities: [...business.requiredPriorities],
    provenCount: acceptance.checked,
    riskCount: risks.length,
    ...facts,
    configDigest: business.digest,
    headSha,
    resultsFile,
  };
}

// 门禁自身出错不能被当成通过：任何内部异常都折成 GATE_ERROR 阻断。
function gateErrorOutcome(error) {
  const name = error && error.name ? error.name : 'Error';
  const message = error && error.message ? error.message : String(error);
  return {
    status: 'BLOCKED',
    blocks: [block('GATE_ERROR', '-', `${name}: ${message}`)],
    risks: [],
    nextAction: HINTS.GATE_ERROR,
    summary: '业务验收门禁自身执行出错，已按阻断处理',
    headSha: null,
    resultsFile: null,
  };
}

// 任何内部异常都按阻断处理并给出 GATE_ERROR，绝不向调用方抛出。
function evaluateBusinessGate(options = {}) {
  try {
    return evaluate(options);
  } catch (error) {
    return gateErrorOutcome(error);
  }
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

// 输出按行解析：控制字符与换行折成单个空格，过长截断，避免文档或报告内容伪造 BUSINESS_* 行。
function clean(value, limit = MAX_TEXT_CODE_POINTS) {
  const text = String(value ?? '').replace(UNSAFE_RUN, ' ').trim();
  const points = Array.from(text);
  return points.length > limit ? `${points.slice(0, limit - 1).join('')}…` : text;
}

const cleanField = (value) => clean(value).replace(/\|/gu, '/') || '-';

function formatBusinessGate(outcome) {
  const source = isObject(outcome) ? outcome : {};
  const passed = source.status === 'PASS';
  const blocks = Array.isArray(source.blocks) ? source.blocks : [];
  const risks = Array.isArray(source.risks) ? source.risks : [];
  const lines = [`BUSINESS_GATE=${passed ? 'PASS' : 'BLOCKED'}`, `BUSINESS_SUMMARY=${clean(source.summary) || '-'}`];
  for (const item of blocks) {
    const entry = isObject(item) ? item : {};
    lines.push(`BUSINESS_BLOCK=${cleanField(entry.code)}|${cleanField(entry.subject)}|${clean(entry.detail) || '-'}`);
  }
  for (const item of risks) {
    const entry = isObject(item) ? item : {};
    lines.push(`BUSINESS_RISK=${cleanField(entry.code)}|${clean(entry.detail) || '-'}`);
  }
  if (!passed) lines.push(`BUSINESS_NEXT_ACTION=${clean(source.nextAction) || '-'}`);
  return lines;
}

// ---------------------------------------------------------------------------
// qa verify 接入
// ---------------------------------------------------------------------------

// qa.business 缺省或 enabled=false 时返回静默结果：不读规格与结果，也不产生任何输出行，行为同接入前一致。
// 启用后复验并返回可直接打印的 BUSINESS_* 输出行与判定（blocked 为 true 时调用方不得签发回执）。
// enabled 不是布尔值，或 qa.business 下出现未知键（如拼错的 enable），按启用处理（由 CONFIG_INVALID 阻断）；
// 入参不合法、配置不可读等内部错误一律是 GATE_ERROR，不向调用方抛出。
function verifyBusinessAcceptance(options) {
  try {
    if (!isObject(options)) throw new TypeError('verifyBusinessAcceptance 需要选项对象 { repoRoot, config, headSha }');
    if (!isObject(options.config)) throw new TypeError('config 须为 loadConfig 的结果对象');
    if (!resolveBusinessConfig(options.config).enabled) return { enabled: false, blocked: false, lines: [], outcome: null };
    const outcome = evaluate(options);
    return { enabled: true, blocked: outcome.status !== 'PASS', lines: formatBusinessGate(outcome), outcome };
  } catch (error) {
    const outcome = gateErrorOutcome(error);
    return { enabled: true, blocked: true, lines: formatBusinessGate(outcome), outcome };
  }
}

module.exports = { BLOCK_CODES, RISK_CODES, evaluateBusinessGate, formatBusinessGate, verifyBusinessAcceptance };

'use strict';

// 业务验收门禁（BIZTEST-SVC-006）：只读复验 `qa run` 写出的 ac-results.json，给出 PASS / BLOCKED 与风险披露。
// 不执行套件、不调用模型、不联网、不写任何文件；同样的输入得到逐字节相同的输出。
//
// 判定顺序（ARCH §3）：1 配置 → 2 规格 → 3 结果存在 → 4 新鲜度 → 5 套件 → 6 完整性 → 7 验收 → 8 路径覆盖 → 9 披露。
// 第 1–6 步任一失败即停止（结果不可信时，后面的清单只会误导），同一步内的违规全部列出；
// 第 7、8 步相互独立，同时失败时都列出；第 9 步的风险披露只在结果可信（第 3–6 步通过）时给出。
// 工作区是否干净取自 qa run 记录的 worktree_clean：门禁不再运行 git，结果与 HEAD 的绑定已由 head_sha 保证。

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { resolveBusinessConfig } = require('./business-config');
const {
  MAX_REPORT_BYTES,
  RESULTS_FILE,
  aggregateResults,
  judgeAc,
  parseJunitReport,
  readResults,
  reportCopyPath,
  resultsDirectory,
} = require('./business-results');
const { compareText } = require('./business-spec');
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
  'REPORT_TAMPERED',
  'RESULTS_MISMATCH',
  'AC_NOT_PROVEN',
  'PATH_COVERAGE_GAP',
  'GATE_ERROR',
]);

const RISK_CODES = Object.freeze([
  'RISK_MANUAL_AC',
  'RISK_LOWER_PRIORITY',
  'RISK_UNLABELLED_CASES',
  'RISK_UNKNOWN_IDS',
  'RISK_SUITE_EXIT_NONZERO',
  'RISK_MODULE_WITHOUT_TABLE',
]);

const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const UNSAFE_RUN = /[\s\u0000-\u001f\u007f-\u009f]+/gu;
const SOUND_SUITE_STATUSES = new Set(['ok', 'exit_nonzero']);
const SECTIONS = Object.freeze(['suites', 'tcs', 'acs', 'paths', 'unknown_ids', 'summary']);

const MAX_MISMATCHES = 10;
const MAX_LISTED = 20;
const MAX_TEXT_CODE_POINTS = 400;
const MAX_RENDERED_CODE_POINTS = 80;
const SHORT_SHA_LENGTH = 12;
const READ_CHUNK_BYTES = 64 * 1024;

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
  REPORT_TAMPERED: RERUN,
  RESULTS_MISMATCH: RERUN,
  AC_NOT_PROVEN: '修复失败用例，或为未覆盖的 AC 补写自动化用例（用例名带上 AC-…/TC-… 标识）后重新运行 pnpm agent -- qa run；确属无法自动化的 AC 须在 PRD 中标为 manual',
  PATH_COVERAGE_GAP: '路径按关联 TC 全有或全无判定，任一 TC 未通过会使整条路径经过的全部转移失去覆盖：修复明细中列出的未通过 TC，或补写覆盖该转移的自动化用例；若长路径中只有部分步骤未实现，可在 PATHS.md 把路径拆成更短的路径（各自关联 TC）使已通过部分独立计入覆盖，或修正覆盖准则，然后重新运行 pnpm agent -- qa run',
  GATE_ERROR: '业务验收门禁自身出错：带着该错误信息排查后重新运行 pnpm agent -- qa verify',
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const shortSha = (sha) => String(sha).slice(0, SHORT_SHA_LENGTH);
const block = (code, subject, detail) => ({ code, subject, detail });
const risk = (code, detail) => ({ code, detail });

function list(items, limit = MAX_LISTED) {
  if (items.length <= limit) return items.join('、');
  return `${items.slice(0, limit).join('、')}…等共 ${items.length} 项`;
}

function render(value) {
  if (value === undefined) return '（无）';
  const points = Array.from(JSON.stringify(value));
  return points.length > MAX_RENDERED_CODE_POINTS ? `${points.slice(0, MAX_RENDERED_CODE_POINTS - 1).join('')}…` : points.join('');
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

function suiteBlocks(results) {
  return results.suites
    .filter((suite) => !SOUND_SUITE_STATUSES.has(suite.status))
    .map((suite) => block('SUITE_HARD_FAILURE', suite.name, suite.detail ? `${suite.status}: ${suite.detail}` : suite.status));
}

// ---------------------------------------------------------------------------
// 第 6 步：完整性
// ---------------------------------------------------------------------------

function readAtMost(descriptor, limit) {
  const chunks = [];
  const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  let total = 0;
  while (total <= limit) {
    const count = fs.readSync(descriptor, chunk, 0, Math.min(chunk.length, limit + 1 - total), null);
    if (count === 0) break;
    chunks.push(Buffer.from(chunk.subarray(0, count)));
    total += count;
  }
  return Buffer.concat(chunks, total);
}

// 只接受普通文件：目录与符号链接（含指向相同内容的链接）一律视为被改动。
function readCopy(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    return { error: error.code === 'ENOENT' || error.code === 'ENOTDIR' ? '报告副本不存在' : `报告副本无法读取（${error.code || 'unknown'}）` };
  }
  if (!stat.isFile()) return { error: '报告副本不是普通文件（目录或符号链接不被接受）' };
  if (stat.size > MAX_REPORT_BYTES) return { error: `报告副本超过 ${MAX_REPORT_BYTES} 字节上限` };

  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const buffer = readAtMost(descriptor, MAX_REPORT_BYTES);
    if (buffer.length > MAX_REPORT_BYTES) return { error: `报告副本超过 ${MAX_REPORT_BYTES} 字节上限` };
    return { buffer };
  } catch (error) {
    return { error: `报告副本无法读取（${error.code || 'unknown'}）` };
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // 内容已读完，关闭失败不影响判定。
      }
    }
  }
}

// 叶子级比较：对象逐键递归，数组与标量整体比较；字段路径形如 acs.AC-SHOP-001-02.status。
function collectDifferences(recorded, computed, field, output) {
  if (isObject(recorded) && isObject(computed)) {
    const keys = [...new Set([...Object.keys(recorded), ...Object.keys(computed)])].sort(compareText);
    for (const key of keys) {
      const next = field === '' ? key : `${field}.${key}`;
      if (!hasOwn(recorded, key)) output.push({ field: next, detail: `结果记录缺少该字段，按报告重算应为 ${render(computed[key])}` });
      else if (!hasOwn(computed, key)) output.push({ field: next, detail: `结果记录多出该字段：${render(recorded[key])}` });
      else collectDifferences(recorded[key], computed[key], next, output);
    }
    return;
  }
  if (JSON.stringify(recorded) !== JSON.stringify(computed)) {
    output.push({ field, detail: `结果记录为 ${render(recorded)}，按报告副本与当前规格重算为 ${render(computed)}` });
  }
}

function suiteView(suites) {
  return Object.fromEntries(suites.map((suite) => [suite.name, { cases: suite.cases, unlabelled: suite.unlabelled }]));
}

function integrityBlocks({ results, business, directory, spec }) {
  const tampered = [];
  const reports = [];
  for (const suite of results.suites) {
    const record = suite.report;
    if (!isObject(record)) {
      tampered.push(block('REPORT_TAMPERED', suite.name, '结果记录缺少报告摘要'));
      continue;
    }
    const copy = readCopy(path.join(directory, reportCopyPath(suite.name)));
    if (copy.error) {
      tampered.push(block('REPORT_TAMPERED', suite.name, copy.error));
      continue;
    }
    const digest = sha256(copy.buffer);
    if (digest !== record.sha256 || copy.buffer.length !== record.bytes) {
      tampered.push(block(
        'REPORT_TAMPERED',
        suite.name,
        `报告副本与结果记录不符：副本为 ${digest.slice(0, SHORT_SHA_LENGTH)}… / ${copy.buffer.length} 字节，记录为 ${record.sha256.slice(0, SHORT_SHA_LENGTH)}… / ${record.bytes} 字节`,
      ));
      continue;
    }
    reports.push({ suite, buffer: copy.buffer });
  }
  if (tampered.length > 0) return tampered;

  const mismatches = [];
  const configured = business.suites.map((suite) => `${suite.name}:${suite.platform}`).sort(compareText);
  const recorded = results.suites.map((suite) => `${suite.name}:${suite.platform}`).sort(compareText);
  if (JSON.stringify(configured) !== JSON.stringify(recorded)) {
    mismatches.push(block(
      'RESULTS_MISMATCH',
      'suites',
      `结果记录的套件（${recorded.join('、') || '无'}）与当前配置的套件（${configured.join('、') || '无'}）不一致`,
    ));
  }

  const parsed = [];
  for (const { suite, buffer } of reports) {
    const outcome = parseJunitReport(buffer, { maxBytes: MAX_REPORT_BYTES });
    if (outcome.ok) parsed.push({ name: suite.name, platform: suite.platform, cases: outcome.cases });
    else mismatches.push(block('RESULTS_MISMATCH', `suites.${suite.name}.report`, `报告副本无法再次解析（${outcome.message}），与结果记录不符`));
  }
  if (parsed.length < reports.length) return mismatches;

  let computed;
  try {
    computed = aggregateResults({ spec, suites: parsed });
  } catch (error) {
    mismatches.push(block('RESULTS_MISMATCH', '-', `无法按报告副本与当前规格重算结果：${error.message}`));
    return mismatches;
  }

  const differences = [];
  const recordedView = { ...results, suites: suiteView(results.suites) };
  const computedView = { ...computed, suites: suiteView(computed.suites) };
  for (const section of SECTIONS) collectDifferences(recordedView[section], computedView[section], section, differences);

  const listed = differences.slice(0, MAX_MISMATCHES);
  mismatches.push(...listed.map((item) => block('RESULTS_MISMATCH', item.field, item.detail)));
  if (differences.length > listed.length) {
    mismatches.push(block('RESULTS_MISMATCH', '-', `另有 ${differences.length - listed.length} 项差异未列出`));
  }
  return mismatches;
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

  if (results.unknown_ids.length > 0) {
    risks.push(risk('RISK_UNKNOWN_IDS', `${results.unknown_ids.length} 个用例引用了规格中不存在的标识：${list(results.unknown_ids)}`));
  }

  const nonzero = results.suites.filter((suite) => suite.status === 'exit_nonzero');
  if (nonzero.length > 0) {
    risks.push(risk(
      'RISK_SUITE_EXIT_NONZERO',
      `${nonzero.length} 个套件以非零退出码结束但报告有效，结果以报告中的用例为准：${list(nonzero.map((suite) => `${suite.name}(exit ${suite.exit_code})`))}`,
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
  if (untrusted.length > 0) return blocked(untrusted, { headSha, resultsFile });

  const required = new Set(business.requiredPriorities);
  const acceptance = acceptanceBlocks(results, required);
  const gaps = coverageBlocks(analysis.spec, results);
  const risks = collectRisks({ results, spec: analysis.spec, required });
  const blocks = [...acceptance.blocks, ...gaps];
  if (blocks.length > 0) return blocked(blocks, { headSha, resultsFile, risks });

  // 放行的判定同时携带回执要记录的业务摘要：必需优先级、已证明的自动化 AC 条数、披露风险数与配置摘要。
  return {
    status: 'PASS',
    blocks: [],
    risks,
    nextAction: null,
    summary: `业务验收通过：${acceptance.checked} 条必需优先级（${[...required].join('/')}）的自动化 AC 全部证明，披露风险 ${risks.length} 项`,
    requiredPriorities: [...business.requiredPriorities],
    provenCount: acceptance.checked,
    riskCount: risks.length,
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

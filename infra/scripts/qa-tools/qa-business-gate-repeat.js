'use strict';

// 业务验收门禁的多轮段（G6）：复核 qa run --repeat N 写出的 repeat 段，再据其判定不稳定用例。
// - repeatIntegrityBlocks：第 6 步完整性之后执行。逐轮复核报告副本的摘要与大小，再用各轮副本与当前规格
//   重算 flaky / unstable_suites / summary 并与记录比对；不符时结果不可信，门禁随即停止。
// - repeatBlocks / repeatRisks：结果可信后的判定与披露。必需优先级用例或套件状态在各轮之间不一致阻断为 FLAKY；
//   实际轮数低于 qa.business.repeat 阻断为 REPEAT_INSUFFICIENT；非必需优先级的不一致只披露为 RISK_FLAKY。
// 只读：不执行套件、不写任何文件。缺少 repeat 段的旧结果按 1 轮处理。

const path = require('node:path');

const {
  MAX_REPORT_BYTES,
  compareRuns,
  parseJunitReport,
  repeatCopyPath,
  reportCopyPath,
} = require('./business-results');
const { compareText } = require('./business-spec');
const { SHORT_SHA_LENGTH, readCopy, sha256 } = require('./qa-business-gate-integrity');

const SECTIONS = Object.freeze(['flaky', 'unstable_suites', 'summary']);
const MAX_LISTED = 20;
const MAX_RENDERED_CODE_POINTS = 80;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const block = (code, subject, detail) => ({ code, subject, detail });
const risk = (code, detail) => ({ code, detail });

// 键按字典序输出的 JSON：记录与重算只比较内容，不受对象键顺序影响。
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort(compareText).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function list(items) {
  if (items.length <= MAX_LISTED) return items.join('、');
  return `${items.slice(0, MAX_LISTED).join('、')}…等共 ${items.length} 项`;
}

function render(value) {
  if (value === undefined) return '（无）';
  const points = Array.from(canonical(value));
  return points.length > MAX_RENDERED_CODE_POINTS ? `${points.slice(0, MAX_RENDERED_CODE_POINTS - 1).join('')}…` : points.join('');
}

const runsOf = (results) => (isObject(results.repeat) ? results.repeat.runs : 1);
const caseLabel = (item) => `${item.suite}:${item.name}`;

// 读出并复核一份报告副本：摘要与大小须与记录一致，再按 JUnit 解析出用例。
// 返回 { cases } 或 { tampered: block } / { mismatch: block }。
function loadCopy({ directory, relative, record, subject }) {
  const copy = readCopy(path.join(directory, relative));
  if (copy.error) return { tampered: block('REPORT_TAMPERED', subject, copy.error) };
  const digest = sha256(copy.buffer);
  if (digest !== record.sha256 || copy.buffer.length !== record.bytes) {
    return {
      tampered: block(
        'REPORT_TAMPERED',
        subject,
        `报告副本与结果记录不符：副本为 ${digest.slice(0, SHORT_SHA_LENGTH)}… / ${copy.buffer.length} 字节，记录为 ${String(record.sha256).slice(0, SHORT_SHA_LENGTH)}… / ${record.bytes} 字节`,
      ),
    };
  }
  const outcome = parseJunitReport(copy.buffer, { maxBytes: MAX_REPORT_BYTES });
  if (!outcome.ok) return { mismatch: block('RESULTS_MISMATCH', subject, `报告副本无法再次解析（${outcome.message}），与结果记录不符`) };
  return { cases: outcome.cases };
}

// 第 1 轮取主结果的套件与副本（第 6 步已复核过摘要，这里只为取得用例），其余轮取 repeat.rounds 的记录与 .run<k> 副本。
function repeatIntegrityBlocks({ results, business, directory, spec }) {
  const repeat = results.repeat;
  if (repeat === undefined) return [];

  const tampered = [];
  const mismatches = [];
  const load = (relative, record, subject) => {
    if (!isObject(record)) return null;
    const loaded = loadCopy({ directory, relative, record, subject });
    if (loaded.tampered) tampered.push(loaded.tampered);
    if (loaded.mismatch) mismatches.push(loaded.mismatch);
    return loaded.cases || null;
  };

  const rounds = [{
    run: 1,
    suites: results.suites.map((suite) => ({
      name: suite.name,
      status: suite.status,
      cases: load(reportCopyPath(suite.name), suite.report, suite.name),
    })),
  }];
  for (const round of repeat.rounds) {
    rounds.push({
      run: round.run,
      suites: round.suites.map((suite) => ({
        name: suite.name,
        status: suite.status,
        cases: load(repeatCopyPath(suite.name, round.run), suite.report, `${suite.name}#run${round.run}`),
      })),
    });
  }
  if (tampered.length > 0) return tampered;
  if (mismatches.length > 0) return mismatches;

  let computed;
  try {
    computed = compareRuns({ spec, requiredPriorities: business.requiredPriorities, rounds });
  } catch (error) {
    return [block('RESULTS_MISMATCH', 'repeat', `无法按各轮报告副本与当前规格重算多轮比较：${error.message}`)];
  }
  for (const section of SECTIONS) {
    if (canonical(repeat[section]) !== canonical(computed[section])) {
      mismatches.push(block(
        'RESULTS_MISMATCH',
        `repeat.${section}`,
        `多轮比较记录为 ${render(repeat[section])}，按各轮报告副本与当前规格重算为 ${render(computed[section])}`,
      ));
    }
  }
  return mismatches;
}

// 套件状态不一致在前（根因通常在套件层面），其后是必需优先级的不稳定用例，最后是轮数不足。
function repeatBlocks(results, business) {
  const blocks = [];
  const repeat = isObject(results.repeat) ? results.repeat : null;
  if (repeat) {
    for (const suite of repeat.unstable_suites) {
      blocks.push(block('FLAKY', suite.name, `套件状态在 ${repeat.runs} 轮之间不一致：${suite.statuses.join(',')}`));
    }
    for (const item of repeat.flaky.filter((entry) => entry.required)) {
      blocks.push(block('FLAKY', caseLabel(item), `${item.priorities.join('/')} 用例在 ${repeat.runs} 轮之间结果不一致：${item.statuses.join(',')}（绑定 ${item.ids.join('、')}）`));
    }
  }
  const runs = runsOf(results);
  if (runs < business.repeat) {
    blocks.push(block('REPEAT_INSUFFICIENT', 'repeat.runs', `结果只运行了 ${runs} 轮，qa.business.repeat 要求至少 ${business.repeat} 轮`));
  }
  return blocks;
}

function repeatRisks(results) {
  if (!isObject(results.repeat)) return [];
  const loose = results.repeat.flaky.filter((entry) => !entry.required);
  if (loose.length === 0) return [];
  return [risk(
    'RISK_FLAKY',
    `${loose.length} 个非必需优先级用例在 ${results.repeat.runs} 轮之间结果不一致，不阻断：${list(loose.map((item) => `${caseLabel(item)}(${item.statuses.join(',')})`))}`,
  )];
}

// 回执与输出共用的多轮摘要；旧结果按 1 轮、0 个不稳定用例处理。
function repeatFacts(results) {
  const repeat = isObject(results.repeat) ? results.repeat : null;
  return {
    repeatRuns: runsOf(results),
    flakyCount: repeat ? repeat.summary.flaky : 0,
    flakyRate: repeat ? repeat.summary.rate : 0,
  };
}

module.exports = { repeatBlocks, repeatFacts, repeatIntegrityBlocks, repeatRisks };

#!/usr/bin/env node
'use strict';

/**
 * qa integrity — 测试完整性门禁（G4）
 *
 * 对比 base..HEAD 中匹配 qa.integrity.testGlobs 的测试文件：
 * - 新增 skip/only、删除测试文件、用例数或断言数下降 → 阻断（enforce）或风险（warn）；
 * - 已有断言行被改写 → 风险 TEST_EXPECTATION_CHANGED（预期值变化须人工复核出处）；
 * - 删除/下降类发现可用 `qa integrity waive` 生成绑定文件 blob 的豁免行，写入当前任务证据后降为风险。
 *
 * 计数逐行进行，注释行（// # * /*）不计；正则可被刻意绕过（如 if (false)），由变异门禁兜底。
 */

const path = require('path');
const { spawnSync } = require('child_process');

const BLOCK_CODES = Object.freeze([
  'TEST_SKIP_ADDED',
  'TEST_ONLY_ADDED',
  'TEST_CASES_DECREASED',
  'TEST_ASSERTS_DECREASED',
  'TEST_FILE_DELETED',
  'TEST_WAIVER_INVALID',
]);
const RISK_CODES = Object.freeze(['TEST_EXPECTATION_CHANGED']);
// 只有“少了”的发现可豁免：新增 skip/only 必须直接改回，豁免格式错误本身也不能再被豁免。
const WAIVABLE_CODES = Object.freeze(['TEST_CASES_DECREASED', 'TEST_ASSERTS_DECREASED', 'TEST_FILE_DELETED']);

const MODES = new Set(['enforce', 'warn']);
const CONFIG_KEYS = new Set(['mode', 'testGlobs', 'patterns']);
const PATTERN_GROUPS = Object.freeze(['skip', 'only', 'case', 'assert']);
const WAIVER_PREFIX = 'TEST_INTEGRITY_WAIVER=';
const BLOB_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const COMMENT_PREFIXES = ['//', '#', '*', '/*'];

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function configError(message) {
  const error = new Error(message);
  error.code = 'INTEGRITY_CONFIG_INVALID';
  return error;
}

// glob → 锚定正则：`**/` 可匹配零或多级目录，`*`/`?` 不跨 `/`，其余字符按字面匹配。
function globToRegExp(glob) {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      if (glob[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
    }
  }
  return new RegExp(`^${source}$`, 'u');
}

function compilePatterns(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw configError('qa.integrity.patterns must be an object with skip/only/case/assert lists');
  }
  for (const key of Object.keys(raw)) {
    if (!PATTERN_GROUPS.includes(key)) {
      throw configError(`qa.integrity.patterns.${key} is not a recognised pattern group (skip|only|case|assert)`);
    }
  }
  const patterns = {};
  for (const group of PATTERN_GROUPS) {
    const list = raw[group];
    if (!Array.isArray(list) || list.length === 0 || !list.every(nonempty)) {
      throw configError(`qa.integrity.patterns.${group} must be a non-empty list of regular expressions`);
    }
    patterns[group] = list.map((source, index) => {
      try {
        return new RegExp(source, 'gu');
      } catch (error) {
        throw configError(`qa.integrity.patterns.${group}[${index}] is not a valid regular expression: ${error.message}`);
      }
    });
  }
  return patterns;
}

// 配置 fail-closed：缺节、未知键、非法模式或正则都在门禁运行前抛错，不静默退回默认值。
function resolveIntegrityConfig(config) {
  const raw = config && config.qa && config.qa.integrity;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw configError('qa.integrity must be an object (defaults live in infra/templates/agent/config.example.json)');
  }
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.has(key)) throw configError(`qa.integrity.${key} is not a recognised key`);
  }
  if (!MODES.has(raw.mode)) throw configError('qa.integrity.mode must be enforce|warn');
  if (!Array.isArray(raw.testGlobs) || raw.testGlobs.length === 0 || !raw.testGlobs.every(nonempty)) {
    throw configError('qa.integrity.testGlobs must be a non-empty list of globs');
  }
  return {
    mode: raw.mode,
    testGlobs: [...raw.testGlobs],
    testMatchers: raw.testGlobs.map(globToRegExp),
    patterns: compilePatterns(raw.patterns),
  };
}

function isTestFile(file, integrity) {
  return integrity.testMatchers.some((matcher) => matcher.test(file));
}

function isCommentLine(trimmed) {
  return COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

// 一行内多个模式命中同一位置只算一次（如 Python `assert (x)` 同时命中两条断言模式）。
function lineMatches(line, patterns) {
  const starts = new Set();
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) starts.add(match.index);
  }
  return starts.size;
}

function countSignals(content, integrity) {
  const counts = { skip: 0, only: 0, case: 0, assert: 0 };
  const assertLines = new Map();
  for (const line of String(content).split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || isCommentLine(trimmed)) continue;
    for (const group of PATTERN_GROUPS) counts[group] += lineMatches(line, integrity.patterns[group]);
    if (lineMatches(line, integrity.patterns.assert) > 0) {
      assertLines.set(trimmed, (assertLines.get(trimmed) || 0) + 1);
    }
  }
  return { ...counts, assertLines };
}

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) {
    if (allowFailure) return null;
    const error = new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.error?.message || '').trim()}`);
    error.code = 'INTEGRITY_GIT_FAILED';
    throw error;
  }
  return result.stdout;
}

function readBlob(cwd, sha, file) {
  return git(cwd, ['cat-file', 'blob', `${sha}:${file}`]);
}

function blobId(cwd, sha, file) {
  return git(cwd, ['rev-parse', '--verify', `${sha}:${file}`]).trim();
}

// `git diff --name-status -z`：每条为 状态\0路径\0，重命名/复制多一个新路径。
function diffEntries(cwd, baseSha, headSha) {
  const raw = git(cwd, ['diff', '--name-status', '-z', '--find-renames', '--no-ext-diff', baseSha, headSha]);
  const parts = raw.split('\0');
  const entries = [];
  for (let index = 0; index < parts.length;) {
    const status = parts[index];
    if (!status) break;
    const letter = status[0];
    if (letter === 'R' || letter === 'C') {
      entries.push({ letter, from: parts[index + 1], to: parts[index + 2] });
      index += 3;
    } else {
      entries.push({ letter, from: parts[index + 1], to: parts[index + 1] });
      index += 2;
    }
  }
  return entries;
}

function countChange(findings, { code, file, before, after, blob }) {
  if (after < before && (code === 'TEST_CASES_DECREASED' || code === 'TEST_ASSERTS_DECREASED')) {
    findings.push({ code, path: file, detail: `${before} → ${after}`, blob });
  }
  if (after > before && (code === 'TEST_SKIP_ADDED' || code === 'TEST_ONLY_ADDED')) {
    findings.push({ code, path: file, detail: `${before} → ${after}`, blob });
  }
}

// 被删掉的断言行若多于断言行净减少数，多出的部分就是“原地改写”的断言，即预期值被改动。
function rewrittenAssertions(before, after) {
  let vanished = 0;
  let beforeTotal = 0;
  let afterTotal = 0;
  for (const [line, count] of before.assertLines) {
    beforeTotal += count;
    vanished += Math.max(0, count - (after.assertLines.get(line) || 0));
  }
  for (const count of after.assertLines.values()) afterTotal += count;
  return Math.max(0, vanished - Math.max(0, beforeTotal - afterTotal));
}

// `it.only(`/`it.skip(`/`xit(` 不命中 case 模式：把用例改成聚焦或跳过只应报 ONLY/SKIP，不应同时报用例减少。
function caseTotal(counts) {
  return counts.case + counts.skip + counts.only;
}

function compareFile(findings, { file, beforeContent, afterContent, blob, integrity }) {
  const before = beforeContent === null ? null : countSignals(beforeContent, integrity);
  const after = countSignals(afterContent, integrity);
  const prior = before || { skip: 0, only: 0, case: 0, assert: 0, assertLines: new Map() };
  countChange(findings, { code: 'TEST_SKIP_ADDED', file, before: prior.skip, after: after.skip, blob });
  countChange(findings, { code: 'TEST_ONLY_ADDED', file, before: prior.only, after: after.only, blob });
  if (!before) return;
  countChange(findings, { code: 'TEST_CASES_DECREASED', file, before: caseTotal(before), after: caseTotal(after), blob });
  countChange(findings, { code: 'TEST_ASSERTS_DECREASED', file, before: before.assert, after: after.assert, blob });
  const rewritten = rewrittenAssertions(before, after);
  if (rewritten > 0) {
    findings.push({ code: 'TEST_EXPECTATION_CHANGED', path: file, detail: `${rewritten} 行断言被改写`, blob });
  }
}

// 原始发现（未套用模式与豁免）：每条带当前内容的 blob，删除类绑定 base 侧 blob。
function analyzeIntegrity({ cwd, baseSha, headSha, integrity }) {
  const findings = [];
  let files = 0;
  for (const { letter, from, to } of diffEntries(cwd, baseSha, headSha)) {
    const fromTest = isTestFile(from, integrity);
    const toTest = isTestFile(to, integrity);
    const deleted = letter === 'D' || (letter === 'R' && fromTest && !toTest);
    if (deleted) {
      if (!fromTest) continue;
      files += 1;
      findings.push({ code: 'TEST_FILE_DELETED', path: from, detail: '测试文件被删除', blob: blobId(cwd, baseSha, from) });
      continue;
    }
    if (!toTest || !['A', 'C', 'M', 'T', 'R'].includes(letter)) continue;
    files += 1;
    const added = letter === 'A' || letter === 'C' || (letter === 'R' && !fromTest);
    compareFile(findings, {
      file: to,
      beforeContent: added ? null : readBlob(cwd, baseSha, from),
      afterContent: readBlob(cwd, headSha, to),
      blob: blobId(cwd, headSha, to),
      integrity,
    });
  }
  return { files, findings };
}

function parseWaivers(records) {
  const waivers = [];
  const invalid = [];
  for (const record of records || []) {
    if (typeof record !== 'string' || !record.startsWith(WAIVER_PREFIX)) continue;
    let value;
    try {
      value = JSON.parse(record.slice(WAIVER_PREFIX.length));
    } catch {
      invalid.push({ code: 'TEST_WAIVER_INVALID', path: '(waiver)', detail: '豁免行不是合法 JSON' });
      continue;
    }
    const target = value && typeof value === 'object' && nonempty(value.path) ? value.path : '(waiver)';
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !nonempty(value.path) || !nonempty(value.reason) || !BLOB_PATTERN.test(value.blob || '')) {
      invalid.push({ code: 'TEST_WAIVER_INVALID', path: target, detail: '豁免须含 path、code、blob 与非空 reason' });
      continue;
    }
    if (!WAIVABLE_CODES.includes(value.code)) {
      invalid.push({ code: 'TEST_WAIVER_INVALID', path: target, detail: `${value.code} 不可豁免` });
      continue;
    }
    waivers.push({ path: value.path, code: value.code, blob: value.blob, reason: value.reason.trim() });
  }
  return { waivers, invalid };
}

function statusOf(blocks, risks) {
  if (blocks.length > 0) return 'BLOCKED';
  return risks.length > 0 ? 'PASS_WITH_RISK' : 'PASS';
}

// 判定：豁免只对“同路径、同代码、同 blob”的发现生效；warn 模式把所有阻断降为风险。
function evaluateIntegrity({ cwd, baseSha, headSha, integrity, waiverRecords = [] }) {
  const { files, findings } = analyzeIntegrity({ cwd, baseSha, headSha, integrity });
  const { waivers, invalid } = parseWaivers(waiverRecords);
  const blocks = [];
  const risks = [];
  let waived = 0;
  for (const finding of findings) {
    const item = { code: finding.code, path: finding.path, detail: finding.detail };
    if (RISK_CODES.includes(finding.code)) {
      risks.push(item);
      continue;
    }
    const waiver = WAIVABLE_CODES.includes(finding.code) && waivers.find((entry) => (
      entry.path === finding.path && entry.code === finding.code && entry.blob === finding.blob
    ));
    if (waiver) {
      waived += 1;
      risks.push({ ...item, detail: `${item.detail}；已豁免：${waiver.reason}` });
    } else {
      blocks.push(item);
    }
  }
  blocks.push(...invalid);
  if (integrity.mode === 'warn') {
    risks.push(...blocks.splice(0));
  }
  return { status: statusOf(blocks, risks), files, blocks, risks, waivers: waived };
}

function integrityLines(result) {
  const field = (text) => String(text).replace(/\s*[\r\n]+\s*/gu, ' ');
  return [
    `TEST_INTEGRITY=${result.status} FILES=${result.files} WAIVERS=${result.waivers}`,
    ...result.blocks.map((item) => `TEST_INTEGRITY_BLOCK=${item.code}|${item.path}|${field(item.detail)}`),
    ...result.risks.map((item) => `TEST_INTEGRITY_RISK=${item.code}|${item.path}|${field(item.detail)}`),
  ];
}

// 生成豁免行：只为当前 diff 中确实存在的可豁免发现签发，并绑定该文件当前 blob；文件再变即失效。
function buildWaiver({ cwd, baseSha, headSha, integrity, path: file, code, reason }) {
  if (!WAIVABLE_CODES.includes(code)) {
    throw new Error(`${code} 不可豁免；可豁免：${WAIVABLE_CODES.join('|')}`);
  }
  if (!nonempty(reason)) throw new Error('waive 需要非空的 --reason');
  const { findings } = analyzeIntegrity({ cwd, baseSha, headSha, integrity });
  const finding = findings.find((item) => item.path === file && item.code === code);
  if (!finding) throw new Error(`当前 diff 中没有 ${file} 的 ${code} 发现，无需豁免`);
  const waiver = { path: file, code, blob: finding.blob, reason: reason.trim() };
  return { line: `${WAIVER_PREFIX}${JSON.stringify(waiver)}`, waiver };
}

function parseCliArgs(argv) {
  const [action, ...rest] = argv;
  if (action !== 'check' && action !== 'waive') {
    throw new Error('用法：pnpm agent -- qa integrity <check|waive> [--base <ref>] [--path <file> --code <code> --reason <text>]');
  }
  const allowed = action === 'check' ? ['base'] : ['base', 'path', 'code', 'reason'];
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const match = /^--([a-z-]+)(?:=(.*))?$/su.exec(token);
    if (!match || !allowed.includes(match[1])) throw new Error(`qa integrity ${action} 不支持参数：${token}`);
    let value = match[2];
    if (value === undefined) {
      value = rest[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`--${match[1]} 需要一个值`);
      index += 1;
    }
    values[match[1]] = value;
  }
  const base = values.base || null;
  if (action === 'check') return { action, base };
  for (const key of ['path', 'code', 'reason']) {
    if (!nonempty(values[key])) throw new Error(`qa integrity waive 需要 --${key}`);
  }
  return { action, base, path: values.path, code: values.code, reason: values.reason };
}

// 豁免行只从与当前 worktree/分支唯一匹配的任务证据中读取；无任务或多任务时视为没有豁免。
function collectWaiverRecords(cwd) {
  const { listTaskStates, runtimeContext } = require('../agent-runner/agent-task');
  const { orderedStepEvidence } = require('../shared/task-evidence');
  const { matchQaTasks } = require('./qa-test-scope');
  const context = runtimeContext(cwd);
  const matches = matchQaTasks({ states: listTaskStates({ runsRoot: context.runsRoot }), context });
  if (matches.length !== 1) return { taskId: null, records: [] };
  const records = orderedStepEvidence(matches[0]).filter((item) => typeof item === 'string' && item.startsWith(WAIVER_PREFIX));
  return { taskId: matches[0].task_id, records };
}

function resolveRange(cwd, config, baseRef) {
  const headSha = git(cwd, ['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  if (baseRef) return { baseSha: git(cwd, ['rev-parse', '--verify', `${baseRef}^{commit}`]).trim(), headSha };
  const baseBranch = config.baseBranch || 'main';
  const remote = `refs/remotes/origin/${baseBranch}`;
  const mergeBase = git(cwd, ['merge-base', remote, headSha], { allowFailure: true });
  if (!mergeBase) {
    const error = new Error(`无法解析 ${remote} 与 HEAD 的 merge-base`);
    error.code = 'INTEGRITY_BASE_MISSING';
    throw error;
  }
  return { baseSha: mergeBase.trim(), headSha };
}

function main(argv) {
  const { loadConfig, resolveRepoRoot } = require('../shared/config');
  const args = parseCliArgs(argv);
  const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
  const config = loadConfig({ repoRoot });
  const integrity = resolveIntegrityConfig(config);
  const { baseSha, headSha } = resolveRange(repoRoot, config, args.base);
  console.log(`TEST_INTEGRITY_RANGE=${baseSha}..${headSha}`);

  if (args.action === 'waive') {
    const { line } = buildWaiver({ cwd: repoRoot, baseSha, headSha, integrity, path: args.path, code: args.code, reason: args.reason });
    console.log(line);
    return {
      status: 'OK',
      summary: `已生成 ${args.path} 的 ${args.code} 豁免行，绑定当前文件 blob`,
      nextAction: '把上面的 TEST_INTEGRITY_WAIVER= 行原样写入当前任务 checkpoint 的 --evidence，再重跑 pnpm agent -- qa integrity check',
    };
  }

  const { taskId, records } = collectWaiverRecords(repoRoot);
  console.log(`TEST_INTEGRITY_WAIVER_TASK=${taskId || 'NONE'}`);
  const result = evaluateIntegrity({ cwd: repoRoot, baseSha, headSha, integrity, waiverRecords: records });
  for (const line of integrityLines(result)) console.log(line);
  if (result.status === 'BLOCKED') {
    return {
      status: 'BLOCKED',
      reason: 'TEST_INTEGRITY_BLOCKED',
      summary: `测试完整性门禁阻断 ${result.blocks.length} 项`,
      nextAction: '按 TEST_INTEGRITY_BLOCK 行修复；删除/下降类确属有意时执行 pnpm agent -- qa integrity waive --path <file> --code <code> --reason <理由> 并把输出行写入任务证据',
    };
  }
  return {
    status: 'OK',
    summary: result.status === 'PASS' ? '测试完整性门禁通过' : `测试完整性门禁通过，附 ${result.risks.length} 项风险`,
    nextAction: result.status === 'PASS' ? '继续 TDD/QA 流程' : '在交付报告中披露 TEST_INTEGRITY_RISK 行并复核被改写断言的出处',
  };
}

if (require.main === module) {
  const { exitOnHelp } = require('../shared/cli-help');
  const { resultBlockLines, resultExitCode } = require('../shared/result-block');
  exitOnHelp([
    'Usage: pnpm agent -- qa integrity check [--base <ref>]',
    '       pnpm agent -- qa integrity waive --path <file> --code <code> --reason <text> [--base <ref>]',
    '',
    'Compare test files between the base (default: merge-base with origin/<baseBranch>) and HEAD.',
    'Added skip/only markers, deleted test files and fewer cases or assertions block;',
    'rewritten assertion lines are reported as risks. waive prints a blob-bound waiver line',
    `for ${WAIVABLE_CODES.join('|')} that must be recorded in the current task evidence.`,
  ].join('\n'));
  let outcome;
  try {
    outcome = main(process.argv.slice(2));
  } catch (error) {
    outcome = {
      status: error.code === 'INTEGRITY_GIT_FAILED' ? 'FAILED' : 'BLOCKED',
      reason: error.code || 'TEST_INTEGRITY_INVALID',
      summary: error.message,
      nextAction: '按提示修正参数、配置或基线引用后重跑 pnpm agent -- qa integrity check',
    };
  }
  for (const line of resultBlockLines(outcome)) console.log(line);
  process.exit(resultExitCode(outcome.status));
}

module.exports = {
  BLOCK_CODES,
  RISK_CODES,
  WAIVABLE_CODES,
  WAIVER_PREFIX,
  analyzeIntegrity,
  buildWaiver,
  collectWaiverRecords,
  countSignals,
  evaluateIntegrity,
  globToRegExp,
  integrityLines,
  parseCliArgs,
  parseWaivers,
  resolveRange,
  resolveIntegrityConfig,
};

'use strict';

// 业务验收门禁第 6 步（完整性）：按结果记录复核报告副本的摘要与大小，再用报告副本与当前规格重算结果并与记录逐项比对。
// 只读：不执行套件、不写任何文件。由 qa-business-gate.js 调用。

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  MAX_REPORT_BYTES,
  aggregateResults,
  parseJunitReport,
  reportCopyPath,
} = require('./business-results');
const { compareText } = require('./business-spec');

const SECTIONS = Object.freeze(['suites', 'tcs', 'acs', 'paths', 'unknown_ids', 'summary']);

const MAX_MISMATCHES = 10;
const MAX_RENDERED_CODE_POINTS = 80;
const SHORT_SHA_LENGTH = 12;
const READ_CHUNK_BYTES = 64 * 1024;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const block = (code, subject, detail) => ({ code, subject, detail });

function render(value) {
  if (value === undefined) return '（无）';
  const points = Array.from(JSON.stringify(value));
  return points.length > MAX_RENDERED_CODE_POINTS ? `${points.slice(0, MAX_RENDERED_CODE_POINTS - 1).join('')}…` : points.join('');
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
  return Object.fromEntries(suites.map((suite) => [suite.name, {
    cases: suite.cases,
    failed: suite.failed,
    unlabelled: suite.unlabelled,
    classname_only: suite.classname_only,
  }]));
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

module.exports = { SHORT_SHA_LENGTH, integrityBlocks };

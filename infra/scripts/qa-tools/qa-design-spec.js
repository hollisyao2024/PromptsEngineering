'use strict';

// 测试设计规格的读取与语法校验：
//   - docs/qa-modules/<domain>/TEST-DESIGN.md 的头部声明与规则/反例/缺陷/变更四张表；
//   - docs/prd-modules/<domain>/*.md 中可选的“不变量与禁止行为”表（INV）。
// 只做语法层：出处是否存在、TC 是否通过、维度是否齐全由 qa-design.js 判定。
// 本模块不得 require business-spec.js（后者反向依赖 collectDesignTcs），避免循环引用。

const fs = require('node:fs');
const path = require('node:path');
const {
  ADV_ID,
  BUG_ID,
  BUG_ORIGINS,
  CHANGE_KINDS,
  DESIGN_FILE_NAME,
  DESIGN_TABLES,
  DIMENSIONS,
  INV_ID,
  INV_TABLE,
  INV_TYPES,
  PRD_MODULES_DIR,
  PRIORITIES,
  QA_MODULES_DIR,
  RULE_TYPES,
  RULE_VERIFICATIONS,
  RUL_ID,
  STORY_ID,
  TEST_CASE_ID,
} = require('./business-spec-schema');
const {
  compareText,
  compareViolations,
  parseList,
  scanMarkdown,
  splitTableRow,
} = require('./business-spec-markdown');
const {
  AC_ID_SOURCE,
  INV_ID_SOURCE,
  TEST_CASE_ID_SOURCE,
  exactPattern,
  extractIds,
} = require('../shared/governance-ids');

const ISOLATIONS = Object.freeze(['subagent', 'commit-order']);
const SHA256_PATTERN = /^sha256=([0-9a-f]{64})$/u;
const FIX_COMMIT = /^[0-9a-f]{7,40}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const SOURCE_SEPARATOR = /[,，、;；]/u;
const INFERRED_SOURCE = /^推断\s*[：:]\s*(.*)$/su;
const AMENDMENT_MARK = /新出处\s*[：:]\s*(.*)$/su;
const NOT_APPLICABLE = /^不适用\s*[：:]\s*(.*)$/su;
const HEADER_FIELDS = Object.freeze([
  { key: 'bundleSha', label: '设计材料包' },
  { key: 'isolation', label: '设计隔离' },
]);
const AC_ID = exactPattern(AC_ID_SOURCE);
const RULE_OR_ADV_ID = { test: (token) => RUL_ID.test(token) || ADV_ID.test(token) };
const DESIGN_ROW_ID = { test: (token) => RUL_ID.test(token) || ADV_ID.test(token) || BUG_ID.test(token) };
const TC_LIST = { allowBlank: false };

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// ---------------------------------------------------------------- 出处

// 出处单元格按逗号/顿号/分号切分；“推断：<理由>”整格独占，不与其他出处混写。
// path 项拆出 # 后的锚点：无 # 时 anchor 为 null，# 后为空时为 ''，由判定层区分“无锚点”与“锚点为空”。
function parseSources(text) {
  const value = String(text ?? '').trim();
  if (!value) return { inferred: false, reason: null, items: [] };
  const inferred = INFERRED_SOURCE.exec(value);
  if (inferred) return { inferred: true, reason: inferred[1].trim(), items: [] };
  const items = [];
  for (const token of value.split(SOURCE_SEPARATOR)) {
    const raw = token.trim();
    if (!raw) continue;
    if (AC_ID.test(raw)) {
      items.push({ kind: 'ac', id: raw, raw });
      continue;
    }
    if (exactPattern(INV_ID_SOURCE).test(raw)) {
      items.push({ kind: 'inv', id: raw, raw });
      continue;
    }
    const hash = raw.indexOf('#');
    const target = hash === -1 ? raw : raw.slice(0, hash);
    if (/^[^\s#]*[/.][^\s#]*$/u.test(target) && target.length > 0) {
      items.push({ kind: 'path', path: target, anchor: hash === -1 ? null : raw.slice(hash + 1).trim(), raw });
      continue;
    }
    items.push({ kind: 'other', raw });
  }
  return { inferred: false, reason: null, items };
}

// 变更记录“原因与新出处”列：取“新出处：”之后的文本；没有标记时整格即出处。
function amendmentSource(text) {
  const value = String(text ?? '');
  const match = AMENDMENT_MARK.exec(value);
  return (match ? match[1] : value).trim();
}

// ---------------------------------------------------------------- 行解析

function invalidRow(file, line, label, id, reasons) {
  return {
    code: 'ROW_INVALID',
    file,
    line,
    message: `${label}第 ${line} 行${id ? ` ${id}` : ''}：${reasons.join('；')}`,
  };
}

function checkEnum(value, allowed, field, reasons) {
  if (!allowed.includes(value)) reasons.push(`${field}「${value}」不合法，取值为 ${allowed.join('|')}`);
}

function checkText(value, field, reasons) {
  if (!nonempty(value)) reasons.push(`${field}不能为空`);
}

function checkTcs(text, reasons) {
  const parsed = parseList(text, TEST_CASE_ID, TC_LIST);
  if (!parsed.ok) {
    reasons.push(parsed.blank
      ? 'TC 不能为空（无则写 -）'
      : `TC「${parsed.invalid.join('、')}」须形如 TC-{模块}-NNN（无则写 -）`);
  }
  return parsed.items;
}

function checkIdList(text, pattern, field, hint, reasons) {
  const parsed = parseList(text, pattern, TC_LIST);
  if (!parsed.ok || parsed.items.length === 0) {
    reasons.push(parsed.invalid.length > 0
      ? `${field}「${parsed.invalid.join('、')}」须为 ${hint}`
      : `${field}至少列出一个 ${hint}`);
  }
  return parsed.items;
}

const ROW_BUILDERS = {
  rules(cells, reasons) {
    const [id, type, statement, source, priority, verification, tc] = cells;
    if (!RUL_ID.test(id)) reasons.push(`ID「${id}」须形如 RUL-{模块}-NNN`);
    checkEnum(type, RULE_TYPES, '类型', reasons);
    checkText(statement, '陈述', reasons);
    const sources = parseSources(source);
    if (sources.inferred && !nonempty(sources.reason)) reasons.push('推断出处须写明理由（推断：<理由>）');
    if (!sources.inferred && sources.items.length === 0) reasons.push('出处不能为空（AC、INV、docs/**.md#锚点 或 推断：<理由>）');
    checkEnum(priority, PRIORITIES, '优先级', reasons);
    checkEnum(verification, RULE_VERIFICATIONS, '验证方式', reasons);
    const tcs = checkTcs(tc, reasons);
    return { id, type, statement, source, priority, verification, tcs };
  },
  advs(cells, reasons) {
    const [id, ruleCell, dimension, scenario, expected, tc] = cells;
    if (!ADV_ID.test(id)) reasons.push(`ID「${id}」须形如 ADV-{模块}-NNN`);
    const rules = checkIdList(ruleCell, RUL_ID, '规则', 'RUL-{模块}-NNN', reasons);
    checkEnum(dimension, DIMENSIONS, '维度', reasons);
    checkText(scenario, '场景', reasons);
    const notApplicable = NOT_APPLICABLE.exec(String(scenario));
    let tcs = [];
    if (notApplicable) {
      if (!nonempty(notApplicable[1])) reasons.push('不适用须写明理由（不适用：<理由>）');
      if (expected !== '-' || tc !== '-') reasons.push('不适用的反例预期与 TC 须为 -');
    } else {
      if (!nonempty(expected) || expected === '-') reasons.push('预期不能为空（维度确不适用时场景写“不适用：<理由>”）');
      tcs = checkTcs(tc, reasons);
    }
    return { id, rules, dimension, scenario, expected, tcs, notApplicable: Boolean(notApplicable) };
  },
  bugs(cells, reasons) {
    const [id, symptom, ruleCell, origin, tc, fix] = cells;
    if (!BUG_ID.test(id)) reasons.push(`ID「${id}」须形如 BUG-{模块}-NNN`);
    checkText(symptom, '现象', reasons);
    const rules = checkIdList(ruleCell, RULE_OR_ADV_ID, '关联规则', 'RUL/ADV 编号', reasons);
    checkEnum(origin, BUG_ORIGINS, '来源', reasons);
    const tcs = checkTcs(tc, reasons);
    if (fix !== '-' && !FIX_COMMIT.test(fix)) reasons.push(`修复提交「${fix}」须为 7–40 位十六进制提交号（未修复写 -）`);
    return { id, symptom, rules, origin, tcs, fix: fix === '-' ? null : fix };
  },
  changes(cells, reasons) {
    const [date, id, change, reason, reviewer] = cells;
    if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      reasons.push(`日期「${date}」须为 YYYY-MM-DD`);
    }
    if (!DESIGN_ROW_ID.test(id)) reasons.push(`行 ID「${id}」须为 RUL/ADV/BUG 编号`);
    checkEnum(change, CHANGE_KINDS, '变更', reasons);
    checkText(reason, '原因与新出处', reasons);
    checkText(reviewer, '评审人', reasons);
    return { date, id, change, reason, reviewer };
  },
};

// 解析一张表的全部行：列数不符或任一字段非法记 ROW_INVALID，该行不进入结果。
function parseRows(table, { file, violations }) {
  const { definition } = table;
  const rows = [];
  for (const { line, text } of table.rows) {
    const cells = splitTableRow(text);
    if (!cells || cells.length !== definition.header.length) {
      violations.push(invalidRow(file, line, definition.label, null, [cells
        ? `列数应为 ${definition.header.length}，实际为 ${cells.length}（单元格内的竖线须写作 \\|）`
        : '无法解析为表格行（行首行尾须有竖线，单元格内的竖线须写作 \\|）']));
      continue;
    }
    const reasons = [];
    const row = ROW_BUILDERS[definition.name](cells, reasons);
    if (reasons.length > 0) {
      violations.push(invalidRow(file, line, definition.label, definition.idPattern ? cells[0] : cells[1], reasons));
      continue;
    }
    rows.push({ line, ...row });
  }
  return rows;
}

// ---------------------------------------------------------------- 头部声明

function headerPattern(label) {
  return new RegExp(`^\\s*(?:[-*+]\\s+)?\\*\\*${label}\\*\\*\\s*[：:]\\s*(.*)$`, 'u');
}

// 头部两项只取首次声明：材料包须为 sha256=<64 位十六进制>，隔离方式须为 subagent|commit-order。
function parseHeader(prose) {
  const header = { bundleSha: null, isolation: null, issues: [] };
  for (const { key, label } of HEADER_FIELDS) {
    const pattern = headerPattern(label);
    const declared = prose.find(({ text }) => pattern.test(text));
    if (!declared) {
      header.issues.push(`缺少 **${label}** 声明`);
      continue;
    }
    const value = pattern.exec(declared.text)[1].replace(/`/gu, '').trim();
    if (key === 'bundleSha') {
      const match = SHA256_PATTERN.exec(value);
      if (match) header.bundleSha = match[1];
      else header.issues.push(`${label}「${value}」不合法，须为 sha256=<qa design context 输出的 64 位十六进制>`);
    } else if (ISOLATIONS.includes(value)) {
      header.isolation = value;
    } else {
      header.issues.push(`${label}「${value}」不合法，取值为 ${ISOLATIONS.join('|')}`);
    }
  }
  return header;
}

// ---------------------------------------------------------------- 文档

function parseDesignDocument(content, { file = '' } = {}) {
  const { tables, prose } = scanMarkdown(content, DESIGN_TABLES);
  const violations = [];
  const doc = { header: parseHeader(prose), tables: {}, rules: [], advs: [], bugs: [], changes: [], violations };
  for (const definition of DESIGN_TABLES) {
    const matches = tables.filter((table) => table.definition === definition);
    doc.tables[definition.name] = matches[0] || null;
    if (matches.length === 0) {
      violations.push({
        code: 'TABLE_MISSING',
        file,
        line: 1,
        message: `缺少${definition.label}（表头须为 | ${definition.header.join(' | ')} |）`,
      });
      continue;
    }
    for (const extra of matches.slice(1)) {
      violations.push({
        code: 'TABLE_DUPLICATE',
        file,
        line: extra.rows.length > 0 ? extra.rows[0].line - 2 : extra.endIndex,
        message: `${definition.label}只能出现一次，重复的表不参与判定`,
      });
    }
    doc[definition.name] = parseRows(matches[0], { file, violations });
  }
  violations.sort(compareViolations);
  return doc;
}

// 宽松收集规则/反例/缺陷三张表 TC 列中的编号（含非法行），供结果聚合把设计登记的 TC 视为已知。
function collectDesignTcs(content) {
  const definitions = DESIGN_TABLES.filter((definition) => definition.header.includes('TC'));
  const tcs = [];
  for (const table of scanMarkdown(content, definitions).tables) {
    const index = table.definition.header.indexOf('TC');
    for (const { text } of table.rows) {
      const cells = splitTableRow(text);
      if (!cells || cells[index] === undefined) continue;
      for (const id of extractIds(cells[index], TEST_CASE_ID_SOURCE)) {
        if (!tcs.includes(id)) tcs.push(id);
      }
    }
  }
  return tcs;
}

// ---------------------------------------------------------------- PRD 不变量表

function parseInvTables(content, { file = '' } = {}) {
  const entries = [];
  const violations = [];
  for (const table of scanMarkdown(content, [INV_TABLE]).tables) {
    for (const { line, text } of table.rows) {
      const cells = splitTableRow(text);
      if (!cells || cells.length !== INV_TABLE.header.length) {
        violations.push(invalidRow(file, line, INV_TABLE.label, null, [`列数应为 ${INV_TABLE.header.length}`]));
        continue;
      }
      const [id, type, statement, storyCell, priority] = cells;
      const reasons = [];
      if (!INV_ID.test(id)) reasons.push(`ID「${id}」须形如 INV-{模块}-NNN`);
      checkEnum(type, INV_TYPES, '类型', reasons);
      checkText(statement, '陈述', reasons);
      const stories = storyCell === '*' ? ['*'] : checkIdList(storyCell, STORY_ID, '适用 Story', 'US-{模块}-NNN 或 *', reasons);
      checkEnum(priority, PRIORITIES, '优先级', reasons);
      if (reasons.length > 0) {
        violations.push(invalidRow(file, line, INV_TABLE.label, id, reasons));
        continue;
      }
      entries.push({ id, type, statement, stories, priority, file, line });
    }
  }
  return { entries, violations };
}

// ---------------------------------------------------------------- 仓库级加载

// Dirent 不跟随符号链接：设计规格只来自仓库内的真实文件（与 business-spec.js 一致）。
function listEntries(directory, accept) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
  return entries.filter(accept).map((entry) => entry.name).sort(compareText);
}

const isDirectory = (entry) => entry.isDirectory();
const isMarkdownFile = (entry) => entry.isFile() && entry.name.endsWith('.md');
const isDesignFile = (entry) => entry.isFile() && entry.name === DESIGN_FILE_NAME;

function duplicateViolation(id, at, first) {
  return {
    code: 'ID_DUPLICATE',
    file: at.file,
    line: at.line,
    id,
    message: `${id} 重复，首次定义于 ${first.file}:${first.line}`,
  };
}

// 按功能域字典序加载；RUL/ADV/BUG 共用一个全局 ID 空间，INV 单独一个，重复行保留首次定义、移除后续。
function loadDesignSpec({ repoRoot }) {
  const root = path.resolve(repoRoot);
  const violations = [];
  const invs = [];
  const invSeen = new Map();
  const prdRoot = path.join(root, PRD_MODULES_DIR);
  for (const domain of listEntries(prdRoot, isDirectory)) {
    for (const name of listEntries(path.join(prdRoot, domain), isMarkdownFile)) {
      const file = `${PRD_MODULES_DIR}/${domain}/${name}`;
      const parsed = parseInvTables(fs.readFileSync(path.join(prdRoot, domain, name), 'utf8'), { file });
      violations.push(...parsed.violations);
      for (const entry of parsed.entries) {
        const first = invSeen.get(entry.id);
        if (first) {
          violations.push(duplicateViolation(entry.id, entry, first));
          continue;
        }
        invSeen.set(entry.id, entry);
        invs.push({ ...entry, domain });
      }
    }
  }

  const docs = [];
  const rowSeen = new Map();
  const qaRoot = path.join(root, QA_MODULES_DIR);
  for (const domain of listEntries(qaRoot, isDirectory)) {
    if (listEntries(path.join(qaRoot, domain), isDesignFile).length === 0) continue;
    const file = `${QA_MODULES_DIR}/${domain}/${DESIGN_FILE_NAME}`;
    const { violations: documentViolations, ...doc } = parseDesignDocument(
      fs.readFileSync(path.join(qaRoot, domain, DESIGN_FILE_NAME), 'utf8'),
      { file },
    );
    violations.push(...documentViolations);
    for (const name of ['rules', 'advs', 'bugs']) {
      doc[name] = doc[name].filter((row) => {
        const first = rowSeen.get(row.id);
        if (first) {
          violations.push(duplicateViolation(row.id, { file, line: row.line }, first));
          return false;
        }
        rowSeen.set(row.id, { file, line: row.line });
        return true;
      });
    }
    docs.push({ domain, file, ...doc });
  }

  violations.sort(compareViolations);
  return { docs, invs, violations };
}

module.exports = {
  ISOLATIONS,
  amendmentSource,
  collectDesignTcs,
  loadDesignSpec,
  parseDesignDocument,
  parseInvTables,
  parseSources,
};

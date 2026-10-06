'use strict';

// 业务测试规格的读取与语法校验：
//   - docs/prd-modules/<domain>/*.md 中的原子 AC 表（唯一的验收来源）；
//   - docs/qa-modules/<domain>/PATHS.md 中的界面/状态/转移/路径模型。
// 全部解析确定性完成，不依赖大模型、随机数或网络；引用与覆盖关系的校验在 qa-paths.js。

const fs = require('node:fs');
const path = require('node:path');
const {
  AC_ID_SOURCE,
  MODULE_ID_SOURCE,
  STORY_ID_SOURCE,
  TEST_CASE_ID_SOURCE,
  exactPattern,
} = require('../shared/governance-ids');

const PRD_MODULES_DIR = 'docs/prd-modules';
const QA_MODULES_DIR = 'docs/qa-modules';
const PATHS_FILE_NAME = 'PATHS.md';

const AC_TABLE_HEADER = Object.freeze(['AC ID', 'Story', '优先级', '验证', '端', 'Given', 'When', 'Then', 'TC']);
const PRIORITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);
const VERIFICATIONS = Object.freeze(['auto', 'manual']);
const CRITERIA = Object.freeze(['all-transitions', 'all-states', 'none']);

const AC_ID = exactPattern(AC_ID_SOURCE);
const STORY_ID = exactPattern(STORY_ID_SOURCE);
const TEST_CASE_ID = exactPattern(TEST_CASE_ID_SOURCE);
const PLATFORM_TAG = /^[a-z][a-z0-9-]*$/u;

const PATHS_TABLES = Object.freeze([
  { name: 'screens', label: '界面', header: ['ID', '名称', '端', '说明'], idPattern: exactPattern(`SCR-${MODULE_ID_SOURCE}-\\d{3}`) },
  { name: 'states', label: '状态', header: ['ID', '界面', '名称', '说明'], idPattern: exactPattern(`STA-${MODULE_ID_SOURCE}-\\d{3}`) },
  {
    name: 'transitions',
    label: '转移',
    header: ['ID', '起始状态', '操作', '守卫', '目标状态', '关联 AC'],
    idPattern: exactPattern(`TRN-${MODULE_ID_SOURCE}-\\d{3}`),
  },
  { name: 'paths', label: '路径', header: ['ID', '转移序列', '关联 TC', '说明'], idPattern: exactPattern(`PTH-${MODULE_ID_SOURCE}-\\d{3}`) },
]);

const AC_TABLE = Object.freeze({ name: 'acs', label: '原子 AC', header: AC_TABLE_HEADER });

const SEPARATOR_CELL = /^:?-+:?$/u;
const LIST_SEPARATOR = /[,，、\s]+/u;
const SEQUENCE_SEPARATOR = /\s*(?:→|->|[,，、])\s*/u;
const CRITERION_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*)?覆盖准则(?:\*\*)?\s*[:：]\s*(.*)$/u;
const FENCE_OPEN = /^\s*(`{3,}|~{3,})(.*)$/u;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/u;

function compareText(left, right) {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function compareViolations(left, right) {
  return compareText(left.file, right.file)
    || left.line - right.line
    || compareText(left.code, right.code)
    || compareText(left.message, right.message);
}

// 按未转义的竖线切分一行表格；单元格内的 \| 还原为 |。
// 行首必须是竖线，行尾必须是未转义的竖线，否则不是表格行。
function splitTableRow(line) {
  const text = String(line).trim();
  if (text.length < 2 || text[0] !== '|') return null;
  const cells = [];
  let current = '';
  let closed = false;
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\' && text[index + 1] === '|') {
      current += '|';
      index += 1;
      closed = false;
    } else if (char === '|') {
      cells.push(current.trim());
      current = '';
      closed = true;
    } else {
      current += char;
      closed = false;
    }
  }
  return closed ? cells : null;
}

function splitList(text) {
  const tokens = [];
  for (const token of String(text).split(LIST_SEPARATOR)) {
    if (token && !tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

// "-" 表示无；allowBlank 为 false 时空单元格也算违规（原子 AC 表要求显式填写）。
function parseList(text, pattern, { allowBlank }) {
  const tokens = splitList(text);
  if (tokens.length === 0) return { ok: allowBlank, blank: true, items: [], invalid: [] };
  if (tokens.length === 1 && tokens[0] === '-') return { ok: true, blank: false, items: [], invalid: [] };
  const invalid = tokens.filter((token) => !pattern.test(token));
  return { ok: invalid.length === 0, blank: false, items: tokens.filter((token) => pattern.test(token)), invalid };
}

function openingFence(line) {
  const match = FENCE_OPEN.exec(line);
  if (!match) return null;
  if (match[1][0] === '`' && match[2].includes('`')) return null;
  return { char: match[1][0], length: match[1].length };
}

function closesFence(line, fence) {
  const match = FENCE_CLOSE.exec(line);
  return Boolean(match) && match[1][0] === fence.char && match[1].length >= fence.length;
}

function sameCells(left, right) {
  return left.length === right.length && left.every((cell, index) => cell === right[index]);
}

function matchTableAt(lines, index, definitions) {
  const header = splitTableRow(lines[index]);
  if (!header) return null;
  const definition = definitions.find((item) => sameCells(item.header, header));
  if (!definition) return null;
  const separator = splitTableRow(lines[index + 1] || '');
  if (!separator || separator.length !== header.length || !separator.every((cell) => SEPARATOR_CELL.test(cell))) return null;
  const rows = [];
  let cursor = index + 2;
  while (cursor < lines.length && lines[cursor].trim().startsWith('|')) {
    rows.push({ line: cursor + 1, text: lines[cursor] });
    cursor += 1;
  }
  return { definition, rows, endIndex: cursor - 1 };
}

// 围栏代码块内的内容一律忽略；表头必须与定义逐列一致才识别为表。
// prose 为围栏之外、表格之外的正文行（供读取 覆盖准则 声明）。
function scanMarkdown(content, definitions) {
  const lines = String(content).replace(/^﻿/u, '').split(/\r?\n/u);
  const tables = [];
  const prose = [];
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    fence = openingFence(line);
    if (fence) continue;
    const table = matchTableAt(lines, index, definitions);
    if (table) {
      tables.push(table);
      index = table.endIndex;
    } else {
      prose.push({ line: index + 1, text: line });
    }
  }
  return { tables, prose };
}

function rowColumnsViolation(cells, expected, { file, line }) {
  return {
    code: 'ROW_COLUMNS',
    file,
    line,
    message: cells
      ? `列数应为 ${expected}，实际为 ${cells.length}（单元格内的竖线须写作 \\|）`
      : '无法解析为表格行（行首行尾须有竖线，单元格内的竖线须写作 \\|）',
  };
}

// ---------------------------------------------------------------- 原子 AC 表

function validateAcRow(cells, { file, line }) {
  const [id, story, priority, verification, platform, given, when, then, tc] = cells;
  const violations = [];
  const report = (code, message) => violations.push({ code, file, line, message });

  const idValid = AC_ID.test(id);
  if (!idValid) report('AC_ID_INVALID', `AC ID「${id}」须形如 AC-{模块}-NNN-NN`);

  if (!STORY_ID.test(story)) {
    report('STORY_INVALID', `Story「${story}」须形如 US-{模块}-NNN`);
  } else if (idValid && story.slice(3) !== id.slice(3, -3)) {
    report('STORY_MISMATCH', `${id} 须归属 US-${id.slice(3, -3)}，实际为 ${story}`);
  }

  if (!PRIORITIES.includes(priority)) report('PRIORITY_INVALID', `优先级「${priority}」须为 ${PRIORITIES.join('/')} 之一`);
  if (!VERIFICATIONS.includes(verification)) report('VERIFICATION_INVALID', `验证「${verification}」须为 ${VERIFICATIONS.join('/')} 之一`);

  const platforms = parseList(platform, PLATFORM_TAG, { allowBlank: false });
  if (!platforms.ok) {
    report('PLATFORM_INVALID', platforms.blank
      ? '端不能为空；不区分端请写 -'
      : `端「${platforms.invalid.join('、')}」不是合法标签（小写字母开头，如 web、ios；多个用逗号分隔，不区分写 -）`);
  }

  for (const [label, value] of [['Given', given], ['When', when], ['Then', then]]) {
    if (!value) report('FIELD_EMPTY', `${label} 不能为空`);
  }

  const tcs = parseList(tc, TEST_CASE_ID, { allowBlank: false });
  if (!tcs.ok) {
    report('TC_INVALID', tcs.blank
      ? 'TC 不能为空；暂无对应用例请写 -'
      : `TC「${tcs.invalid.join('、')}」须形如 TC-{模块}-NNN（多个用逗号分隔，无则写 -）`);
  }

  const ac = violations.length > 0 ? null : {
    id,
    module: id.slice(3, -7),
    story,
    priority,
    verification,
    platforms: platforms.items,
    given,
    when,
    then,
    tcs: tcs.items,
    file,
    line,
  };
  return { idValid, violations, ac };
}

function parseAcTables(content, { file = '' } = {}) {
  const { tables } = scanMarkdown(content, [AC_TABLE]);
  const acs = [];
  const entries = [];
  const violations = [];
  let rows = 0;
  for (const table of tables) {
    for (const row of table.rows) {
      rows += 1;
      const cells = splitTableRow(row.text);
      if (!cells || cells.length !== AC_TABLE_HEADER.length) {
        violations.push(rowColumnsViolation(cells, AC_TABLE_HEADER.length, { file, line: row.line }));
        continue;
      }
      const result = validateAcRow(cells, { file, line: row.line });
      violations.push(...result.violations);
      if (result.ac) acs.push(result.ac);
      if (result.idValid) entries.push({ id: cells[0], line: row.line, ac: result.ac });
    }
  }
  return { acs, entries, violations, tables: tables.length, rows };
}

// ---------------------------------------------------------------- PATHS.md

function parseCriterion(prose, doc, violations, file) {
  for (const { line, text } of prose) {
    const match = CRITERION_LINE.exec(text);
    if (!match) continue;
    if (doc.criterionLine !== null) {
      violations.push({
        code: 'CRITERION_INVALID',
        file,
        line,
        message: `覆盖准则只能声明一次（首次声明在第 ${doc.criterionLine} 行）`,
      });
      continue;
    }
    doc.criterionLine = line;
    const tokens = splitList(match[1].replace(/[`*]/gu, ''));
    const unknown = tokens.filter((token) => !CRITERIA.includes(token));
    if (tokens.length === 0 || unknown.length > 0 || (tokens.includes('none') && tokens.length > 1)) {
      violations.push({
        code: 'CRITERION_INVALID',
        file,
        line,
        message: tokens.length === 0
          ? `覆盖准则不能为空，取值为 ${CRITERIA.join('/')}（all-* 可逗号组合，none 不与其他并存）`
          : `覆盖准则「${tokens.join('、')}」不合法，取值为 ${CRITERIA.join('/')}（all-* 可逗号组合，none 不与其他并存）`,
      });
    } else {
      doc.criteria = tokens;
    }
  }
}

function listCell(text, pattern, report) {
  const parsed = parseList(text, pattern, { allowBlank: true });
  if (parsed.invalid.length > 0) report(parsed.invalid);
  return parsed.items;
}

const PATHS_ROW_BUILDERS = {
  screens([id, name, platform, description], { file, line, violations }) {
    const platforms = listCell(platform, PLATFORM_TAG, (invalid) => violations.push({
      code: 'PLATFORM_INVALID',
      file,
      line,
      message: `界面 ${id} 的端「${invalid.join('、')}」不是合法标签（小写字母开头，如 web、ios）`,
    }));
    return { id, name, platforms, description, file, line };
  },
  states([id, screen, name, description], { file, line }) {
    return { id, screen, name, description, file, line };
  },
  transitions([id, from, action, guard, to, acs], { file, line }) {
    return { id, from, action, guard, to, acs: splitList(acs).filter((token) => token !== '-'), file, line };
  },
  paths([id, sequence, tcs, description], { file, line, violations }) {
    const parts = sequence.split(SEQUENCE_SEPARATOR).map((part) => part.trim()).filter(Boolean);
    const items = listCell(tcs, TEST_CASE_ID, (invalid) => violations.push({
      code: 'TC_INVALID',
      file,
      line,
      message: `路径 ${id} 的关联 TC「${invalid.join('、')}」须形如 TC-{模块}-NNN（无则写 -）`,
    }));
    return {
      id,
      sequence: parts.length === 1 && parts[0] === '-' ? [] : parts,
      tcs: items,
      description,
      file,
      line,
    };
  },
};

function parsePathsDocument(content, { file = '' } = {}) {
  const { tables, prose } = scanMarkdown(content, PATHS_TABLES);
  const violations = [];
  const doc = {
    criteria: ['none'],
    criterionLine: null,
    screens: [],
    states: [],
    transitions: [],
    paths: [],
    missingTables: [],
  };

  parseCriterion(prose, doc, violations, file);

  const firstLine = new Map();
  for (const { definition, rows } of tables) {
    for (const row of rows) {
      const cells = splitTableRow(row.text);
      const where = { file, line: row.line };
      if (!cells || cells.length !== definition.header.length) {
        violations.push(rowColumnsViolation(cells, definition.header.length, where));
        continue;
      }
      const id = cells[0];
      if (!definition.idPattern.test(id)) {
        violations.push({ code: 'ID_INVALID', ...where, message: `${definition.label} ID「${id}」格式不合法` });
      } else if (firstLine.has(id)) {
        violations.push({ code: 'ID_DUPLICATE', ...where, message: `${id} 重复，首次定义于第 ${firstLine.get(id)} 行` });
      } else {
        firstLine.set(id, row.line);
        doc[definition.name].push(PATHS_ROW_BUILDERS[definition.name](cells, { ...where, violations }));
      }
    }
  }

  for (const definition of PATHS_TABLES) {
    if (tables.some((table) => table.definition === definition)) continue;
    doc.missingTables.push(definition.name);
    violations.push({
      code: 'PATHS_TABLE_MISSING',
      file,
      line: 0,
      message: `缺少“${definition.label}”表（表头须为 ${definition.header.join(' | ')}）`,
    });
  }

  violations.sort(compareViolations);
  return { ...doc, violations };
}

// ---------------------------------------------------------------- 仓库级加载

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

// Dirent 不跟随符号链接：链接目录与链接文件都不会被读取，规格只来自仓库内的真实文件。
const isDirectory = (entry) => entry.isDirectory();
const isMarkdownFile = (entry) => entry.isFile() && entry.name.endsWith('.md');

function loadBusinessSpec({ repoRoot }) {
  const root = path.resolve(repoRoot);
  const acs = [];
  const modules = [];
  const modulesWithoutTable = [];
  const knownAcIds = [];
  const pathsDocs = [];
  const violations = [];
  const firstDeclared = new Map();
  let acRowCount = 0;

  const prdRoot = path.join(root, PRD_MODULES_DIR);
  for (const domain of listEntries(prdRoot, isDirectory)) {
    const directory = path.join(prdRoot, domain);
    const names = listEntries(directory, isMarkdownFile);
    if (names.length === 0) continue;
    let tables = 0;
    let acCount = 0;
    for (const name of names) {
      const file = `${PRD_MODULES_DIR}/${domain}/${name}`;
      const parsed = parseAcTables(fs.readFileSync(path.join(directory, name), 'utf8'), { file });
      tables += parsed.tables;
      acRowCount += parsed.rows;
      violations.push(...parsed.violations);
      for (const entry of parsed.entries) {
        const first = firstDeclared.get(entry.id);
        if (first) {
          violations.push({
            code: 'AC_ID_DUPLICATE',
            file,
            line: entry.line,
            message: `${entry.id} 重复，首次定义于 ${first.file}:${first.line}`,
          });
          continue;
        }
        firstDeclared.set(entry.id, { file, line: entry.line });
        knownAcIds.push(entry.id);
        if (entry.ac) {
          acs.push({ ...entry.ac, domain });
          acCount += 1;
        }
      }
    }
    if (tables > 0) modules.push({ domain, acCount });
    else modulesWithoutTable.push(domain);
  }

  const qaRoot = path.join(root, QA_MODULES_DIR);
  for (const domain of listEntries(qaRoot, isDirectory)) {
    const directory = path.join(qaRoot, domain);
    if (!listEntries(directory, (entry) => entry.isFile() && entry.name === PATHS_FILE_NAME).length) continue;
    const file = `${QA_MODULES_DIR}/${domain}/${PATHS_FILE_NAME}`;
    const { violations: documentViolations, ...doc } = parsePathsDocument(
      fs.readFileSync(path.join(directory, PATHS_FILE_NAME), 'utf8'),
      { file },
    );
    pathsDocs.push({ domain, file, ...doc });
    violations.push(...documentViolations);
  }

  violations.sort(compareViolations);
  return { acs, modules, modulesWithoutTable, pathsDocs, knownAcIds, acRowCount, violations };
}

module.exports = {
  AC_TABLE_HEADER,
  CRITERIA,
  PATHS_TABLES,
  PRIORITIES,
  PRD_MODULES_DIR,
  QA_MODULES_DIR,
  VERIFICATIONS,
  compareText,
  compareViolations,
  loadBusinessSpec,
  parseAcTables,
  parsePathsDocument,
  splitList,
  splitTableRow,
};

'use strict';

// docs/qa-modules/<domain>/PATHS.md 的解析：覆盖准则声明与界面/状态/转移/路径四张表。

const { CRITERIA, PATHS_TABLES, PLATFORM_TAG, TEST_CASE_ID } = require('./business-spec-schema');
const {
  compareViolations,
  parseList,
  rowColumnsViolation,
  scanMarkdown,
  splitList,
  splitTableRow,
} = require('./business-spec-markdown');

const SEQUENCE_SEPARATOR = /\s*(?:→|->|[,，、])\s*/u;
const CRITERION_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*)?覆盖准则(?:\*\*)?\s*[:：]\s*(.*)$/u;

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
  // 不声明就默认 none 会让路径覆盖静默失效；不检查覆盖须显式写「覆盖准则：none」。
  if (doc.criterionLine === null) {
    violations.push({
      code: 'CRITERION_MISSING',
      file,
      line: 1,
      message: `未声明覆盖准则：在正文写一行「覆盖准则：<${CRITERIA.join('|')}>」；确实不检查路径覆盖时显式写 none`,
    });
  }

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

module.exports = {
  parsePathsDocument,
};

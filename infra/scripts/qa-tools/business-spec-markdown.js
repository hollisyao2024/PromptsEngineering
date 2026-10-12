'use strict';

// 业务测试规格的 Markdown 表格扫描：表格行切分、列表单元格、围栏代码块与违规排序。

const SEPARATOR_CELL = /^:?-+:?$/u;
const LIST_SEPARATOR = /[,，、\s]+/u;
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
  const lines = String(content).replace(/^\uFEFF/u, '').split(/\r?\n/u);
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

module.exports = {
  closesFence,
  compareText,
  compareViolations,
  openingFence,
  parseList,
  rowColumnsViolation,
  scanMarkdown,
  splitList,
  splitTableRow,
};

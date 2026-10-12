// 缺陷阻塞检查的共享基础：路径配置、彩色日志、ID 形状与 Markdown 表格单元格解析。

const path = require('path');

// 配置
const CONFIG = {
  qaPath: path.join(__dirname, '../../../docs/QA.md'),
  qaModulesDir: path.join(__dirname, '../../../docs/qa-modules'),
  nfrTrackingPath: path.join(__dirname, '../../../docs/data/nfr-tracking.md'),
  releaseGateReportPath: path.join(__dirname, '../../../docs/data/qa-reports/release-gate-{date}.md'),
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

const MODULE_ID_SOURCE = '[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*';
const BUG_ID_SOURCE = `BUG-${MODULE_ID_SOURCE}-\\d{3}`;
const NFR_ID_SOURCE = `NFR-${MODULE_ID_SOURCE}-\\d{3}`;
const STORY_ID_SOURCE = `US-${MODULE_ID_SOURCE}-\\d{3}`;

function cleanMarkdownCell(value) {
  return String(value || '')
    .trim()
    .replace(/^`+|`+$/g, '')
    .replace(/\*\*/g, '')
    .trim();
}

function markdownTableCells(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('|')) return null;
  const body = trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed.slice(1);
  return body.split('|').map(cleanMarkdownCell);
}

function isMarkdownSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function normalizedHeader(value) {
  return cleanMarkdownCell(value).toLowerCase().replace(/[\s_/-]+/g, '');
}

function findHeaderIndex(headers, candidates) {
  const normalizedCandidates = candidates.map(normalizedHeader);
  return headers.findIndex((header) => normalizedCandidates.includes(normalizedHeader(header)));
}

module.exports = {
  BUG_ID_SOURCE,
  CONFIG,
  NFR_ID_SOURCE,
  STORY_ID_SOURCE,
  cleanMarkdownCell,
  findHeaderIndex,
  isMarkdownSeparatorRow,
  log,
  markdownTableCells,
};

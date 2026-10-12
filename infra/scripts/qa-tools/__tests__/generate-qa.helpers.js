'use strict';

// generate-qa 各主题测试共用的 Story 表 / 原子 AC 表 PRD 构造器与生成结果读取工具。

const assert = require('node:assert/strict');

const { parsePRD } = require('../generate-qa');
const { splitTableRow } = require('../business-spec');
const {
  AC_COLUMNS,
  acRowCells,
  mdTable,
} = require('./fixtures/business-testing/builders');

const STORY_TABLE_HEADER = ['Story ID', '用户故事', '优先级', '依赖', '预估工时'];

// A PRD the way a real project writes it: a banner naming another module's Story, a
// Story table whose dependency column does the same, the atomic AC table, and prose
// that keeps repeating this module's own Story ids.
function shopPrd(acs, storyIds = ['US-SHOP-001', 'US-SHOP-002', 'US-SHOP-003']) {
  const storyRows = storyIds.map((id, index) => [
    id, `作为买家完成第 ${index + 1} 项购物`, 'P0', index === 0 ? '依赖 US-USER-001' : '-', '3d',
  ]);
  return [
    '# 购物模块 PRD',
    '',
    '> 登录态由 US-USER-001 提供（见用户模块 PRD）。',
    '',
    '## 用户故事',
    '',
    mdTable(STORY_TABLE_HEADER, storyRows),
    '',
    '### 原子 AC 清单',
    '',
    mdTable(AC_COLUMNS, acs.map((ac) => acRowCells(ac))),
    '',
    '正文反复提到 US-SHOP-001、US-SHOP-002、US-SHOP-001。',
    '',
  ].join('\n');
}

// What buildModuleEntries hands to generateModuleQA, built from parsePRD output.
function shopEntry(content) {
  const parsed = parsePRD(content);
  return {
    moduleDir: 'shop',
    moduleName: '购物模块',
    qaPath: 'docs/qa-modules/shop/QA.md',
    prdPath: 'docs/prd-modules/shop/PRD.md',
    stories: parsed.stories,
    acs: parsed.acs,
    moduleId: parsed.moduleId,
  };
}

function tcIds(markdown) {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('| TC-'))
    .map((line) => splitTableRow(line)[0]);
}

function rowFor(markdown, tcId) {
  const line = markdown.split('\n').find((value) => value.startsWith(`| ${tcId} |`));
  assert.ok(line, `no table row for ${tcId}`);
  return splitTableRow(line);
}

function sectionBetween(markdown, start, end) {
  const from = markdown.indexOf(start);
  assert.notEqual(from, -1, `missing section ${start}`);
  const to = markdown.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section end ${end}`);
  return markdown.slice(from, to);
}

// TC-SHOP-010 is shared by two ACs, TC-SHOP-011 by two ACs of different Stories, and
// the manual AC has no test case yet.
const GROUPED_ACS = [
  { id: 'AC-SHOP-001-01', story: 'US-SHOP-001', priority: 'P1', given: '购物车内有商品', tc: 'TC-SHOP-010' },
  { id: 'AC-SHOP-001-02', story: 'US-SHOP-001', priority: 'P0', given: '位于支付页', tc: 'TC-SHOP-010, TC-SHOP-011' },
  { id: 'AC-SHOP-002-01', story: 'US-SHOP-002', priority: 'P2', tc: 'TC-SHOP-011' },
  { id: 'AC-SHOP-002-02', story: 'US-SHOP-002', priority: 'P1', verification: 'manual', platform: '-', tc: '-' },
];

module.exports = {
  GROUPED_ACS,
  STORY_TABLE_HEADER,
  rowFor,
  sectionBetween,
  shopEntry,
  shopPrd,
  tcIds,
};

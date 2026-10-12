'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { generateModuleQA, parsePRD } = require('../generate-qa');
const { mdTable } = require('./fixtures/business-testing/builders');
const {
  GROUPED_ACS,
  STORY_TABLE_HEADER,
  rowFor,
  sectionBetween,
  shopEntry,
  shopPrd,
  tcIds,
} = require('./generate-qa.helpers');

// ---- Story table / AC table awareness

test('parsePRD takes Stories from the Story table and the AC table, not from every mention', () => {
  const parsed = parsePRD(shopPrd(GROUPED_ACS));

  assert.deepEqual(parsed.stories.map((story) => story.id), ['US-SHOP-001', 'US-SHOP-002', 'US-SHOP-003']);
  assert.deepEqual(parsed.stories[0], { id: 'US-SHOP-001', domain: 'SHOP', number: 1 });
  assert.deepEqual(parsed.domains, ['SHOP']);
  assert.equal(parsed.moduleId, 'SHOP');
  assert.deepEqual(parsed.acs.map((ac) => ac.id), GROUPED_ACS.map((ac) => ac.id));
});

test('parsePRD keeps module ids that contain digits or several segments', () => {
  const multiSegment = parsePRD([
    '# 多段模块 PRD',
    '',
    mdTable(STORY_TABLE_HEADER, [
      ['US-MODEL-CONFIG-001', '模型配置', 'P0', '-', '1d'],
      ['US-MODEL-CONFIG-002', '模型切换', 'P1', '-', '1d'],
    ]),
    '',
  ].join('\n'));
  assert.deepEqual(multiSegment.stories.map((story) => story.id), ['US-MODEL-CONFIG-001', 'US-MODEL-CONFIG-002']);
  assert.deepEqual(multiSegment.domains, ['MODEL-CONFIG']);
  assert.equal(multiSegment.moduleId, 'MODEL-CONFIG');

  const withDigits = parsePRD(['# 端到端 PRD', '', mdTable(STORY_TABLE_HEADER, [['US-E2E-001', '端到端', 'P0', '-', '1d']]), ''].join('\n'));
  assert.deepEqual(withDigits.stories.map((story) => story.id), ['US-E2E-001']);
  assert.equal(withDigits.moduleId, 'E2E');
});

test('parsePRD leaves Stories of other modules listed in the first column out of the module', () => {
  const parsed = parsePRD([
    '# 模型配置 PRD',
    '',
    mdTable(STORY_TABLE_HEADER, [
      ['US-MODEL-CONFIG-001', '模型配置', 'P0', '依赖 US-E2E-001', '1d'],
      ['US-MODEL-CONFIG-002', '模型切换', 'P1', '-', '1d'],
    ]),
    '',
    mdTable(['依赖 Story', '提供方'], [['US-E2E-001', '端到端模块']]),
    '',
  ].join('\n'));

  assert.deepEqual(parsed.stories.map((story) => story.id), ['US-MODEL-CONFIG-001', 'US-MODEL-CONFIG-002']);
  assert.equal(parsed.moduleId, 'MODEL-CONFIG');
});

test('parsePRD falls back to distinct Story mentions when the PRD has neither table', () => {
  const content = '# 登录模块 PRD\n\n- US-AUTH-001 登录\n- US-AUTH-002 登出\n\n回顾 US-AUTH-001，并见 US-AUTH-001。\n';

  const parsed = parsePRD(content);

  assert.deepEqual(parsed.stories.map((story) => story.id), ['US-AUTH-001', 'US-AUTH-002']);
  assert.deepEqual(parsed.acs, []);
  assert.equal(parsed.moduleId, null);
});

test('parsePRD returns an empty result for empty content', () => {
  for (const content of ['', null, undefined]) {
    assert.deepEqual(parsePRD(content), { stories: [], domains: [], acs: [], moduleId: null });
  }
});

test('module QA takes its test cases from the AC table TC column instead of inventing ids', () => {
  const markdown = generateModuleQA(shopEntry(shopPrd(GROUPED_ACS)));

  assert.match(markdown, /\| 用例 ID \| 用例名称 \| 关联 Story \| 优先级 \| 前置条件 \| 状态 \| 执行人 \|/u);
  assert.deepEqual(tcIds(markdown), ['TC-SHOP-010', 'TC-SHOP-011']);
  assert.doesNotMatch(markdown, /TC-SHOP-00\d/u);
  assert.doesNotMatch(markdown, /（更多）/u);

  const first = rowFor(markdown, 'TC-SHOP-010');
  assert.equal(first.length, 7);
  assert.match(first[1], /AC-SHOP-001-01/u);
  assert.match(first[1], /AC-SHOP-001-02/u);
  assert.equal(first[2], 'US-SHOP-001');
  assert.equal(first[3], 'P0');
  assert.equal(first[4], '购物车内有商品');
  assert.equal(first[5], '📝 待执行');
  assert.equal(first[6], 'TBD');

  const second = rowFor(markdown, 'TC-SHOP-011');
  assert.equal(second.length, 7);
  assert.equal(second[2], 'US-SHOP-001、US-SHOP-002');
  assert.equal(second[3], 'P0');
  assert.equal(second[4], '位于支付页');
});

test('module QA counts the distinct test cases the AC table names', () => {
  const markdown = generateModuleQA(shopEntry(shopPrd(GROUPED_ACS)));

  assert.match(markdown, /包含 3 个用户故事/u);
  assert.match(markdown, /测试用例总数：2 条/u);
  assert.match(markdown, /\*\*总用例数\*\*：2 条/u);
  assert.doesNotMatch(markdown, /（预估）/u);
});

test('module QA lists the acceptance criteria and Stories that have no registered test case', () => {
  const markdown = generateModuleQA(shopEntry(shopPrd(GROUPED_ACS)));
  const gaps = sectionBetween(markdown, '### 3.2 尚未登记用例的验收标准', '\n---');

  assert.match(gaps, /AC-SHOP-002-02/u);
  assert.match(gaps, /US-SHOP-003/u);
  assert.doesNotMatch(gaps, /AC-SHOP-001-01/u);
  assert.doesNotMatch(gaps, /AC-SHOP-001-02/u);
  assert.doesNotMatch(gaps, /AC-SHOP-002-01/u);
  assert.ok(markdown.indexOf('### 3.2') > markdown.indexOf('### 3.1'));
  assert.ok(markdown.indexOf('### 3.2') < markdown.indexOf('## 4. 缺陷列表'));
});

test('module QA omits the gap section when every AC has a test case and every Story has ACs', () => {
  const acs = [
    { id: 'AC-SHOP-001-01', story: 'US-SHOP-001', tc: 'TC-SHOP-001' },
    { id: 'AC-SHOP-002-01', story: 'US-SHOP-002', tc: 'TC-SHOP-002' },
  ];

  const markdown = generateModuleQA(shopEntry(shopPrd(acs, ['US-SHOP-001', 'US-SHOP-002'])));

  assert.deepEqual(tcIds(markdown), ['TC-SHOP-001', 'TC-SHOP-002']);
  assert.doesNotMatch(markdown, /### 3\.2/u);
});

test('module QA escapes pipes copied from the AC table so every row keeps seven cells', () => {
  const acs = [{ id: 'AC-SHOP-001-01', story: 'US-SHOP-001', given: '输入 a\\|b', tc: 'TC-SHOP-001' }];
  const entry = shopEntry(shopPrd(acs, ['US-SHOP-001']));
  assert.equal(entry.acs[0].given, '输入 a|b');

  const row = rowFor(generateModuleQA(entry), 'TC-SHOP-001');

  assert.equal(row.length, 7);
  assert.equal(row[4], '输入 a|b');
});

test('module QA lists every test case the AC table names, without the ten-row cap', () => {
  const acs = Array.from({ length: 12 }, (_, index) => ({
    id: `AC-SHOP-001-${String(index + 1).padStart(2, '0')}`,
    story: 'US-SHOP-001',
    tc: `TC-SHOP-${101 + index}`,
  }));

  const markdown = generateModuleQA(shopEntry(shopPrd(acs, ['US-SHOP-001'])));

  assert.deepEqual(tcIds(markdown), acs.map((ac) => ac.tc));
  assert.doesNotMatch(markdown, /（更多）/u);
});

test('test-case prefix follows the module id, not the first Story mentioned', () => {
  const entry = {
    moduleDir: 'shop',
    moduleName: '购物模块',
    qaPath: 'docs/qa-modules/shop/QA.md',
    prdPath: 'docs/prd-modules/shop/PRD.md',
    stories: [{ id: 'US-USER-001', domain: 'USER' }, { id: 'US-SHOP-001', domain: 'SHOP' }],
    moduleId: 'SHOP',
  };

  assert.deepEqual(tcIds(generateModuleQA(entry)), ['TC-SHOP-001', 'TC-SHOP-002']);
});

test('a Story-table-only PRD that quotes another module first still gets its own prefix', () => {
  const content = [
    '# 购物模块 PRD',
    '',
    '> 登录态由 US-USER-001 提供。',
    '',
    mdTable(STORY_TABLE_HEADER, [
      ['US-SHOP-001', '结算', 'P0', '依赖 US-USER-001', '3d'],
      ['US-SHOP-002', '退款', 'P1', '-', '2d'],
    ]),
    '',
  ].join('\n');

  const entry = shopEntry(content);

  assert.equal(entry.stories.length, 2);
  assert.deepEqual(tcIds(generateModuleQA(entry)), ['TC-SHOP-001', 'TC-SHOP-002']);
});

test('without an AC table the generated test cases keep the legacy skeleton', () => {
  const entry = {
    moduleDir: 'auth',
    moduleName: 'Auth',
    qaPath: 'docs/qa-modules/auth/QA.md',
    prdPath: 'docs/prd-modules/auth/PRD.md',
    stories: [{ id: 'US-AUTH-001', domain: 'AUTH' }, { id: 'US-AUTH-002', domain: 'AUTH' }],
  };

  const markdown = generateModuleQA(entry);
  assert.deepEqual(tcIds(markdown), ['TC-AUTH-001', 'TC-AUTH-002']);
  assert.match(markdown, /测试用例总数：6 条（预估）/u);
  assert.doesNotMatch(markdown, /### 3\.2/u);

  const many = generateModuleQA({
    ...entry,
    stories: Array.from({ length: 11 }, (_, index) => ({
      id: `US-AUTH-${String(index + 1).padStart(3, '0')}`,
      domain: 'AUTH',
    })),
  });
  assert.equal(tcIds(many).length, 10);
  assert.match(many, /\| （更多） \|/u);
});

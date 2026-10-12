'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const spec = require('../business-spec');
const { SHOP_ACS, mdTable, prdDocument } = require('./fixtures/business-testing/builders');
const { PRD_FILE } = require('./business-spec.helpers');

// ---------------------------------------------------------------- parsePrdStories

// PRD 模板 MODULE-EXAMPLE.md §2.1 的 Story 表头：第一列是 Story 的唯一登记处，
// 「依赖」一列可以提到别的模块的 Story。
const STORY_TABLE_HEADER = ['Story ID', '用户故事', '优先级', '依赖', '预估工时'];

function storyTable(rows) {
  return mdTable(STORY_TABLE_HEADER, rows);
}

const SHOP_STORY_ROWS = [
  ['US-SHOP-001', '作为买家，我要结算购物车', 'P0', '依赖 US-USER-001', '3d'],
  ['US-SHOP-002', '作为买家，我要查看隐私条款', 'P1', '-', '1d'],
];

test('parsePrdStories 取 Story 表第一列作为本模块的 Story，重复登记与正文提及都不重复计数', () => {
  const content = [
    '# 购物模块 PRD',
    '',
    '> 登录态由 US-USER-001 提供，参见用户模块。',
    '',
    '## 用户故事',
    '',
    storyTable([...SHOP_STORY_ROWS, ['US-SHOP-001', '重复登记的一行', 'P0', '-', '1d']]),
    '',
    '正文再次提到 US-SHOP-001、US-SHOP-002 与 US-SHOP-001。',
  ].join('\n');

  const result = spec.parsePrdStories(content);

  assert.deepEqual(result.stories, ['US-SHOP-001', 'US-SHOP-002']);
  assert.equal(result.defined, true);
  assert.equal(result.moduleId, 'SHOP');
  assert.deepEqual(result.acs, []);
});

test('parsePrdStories 只认第一格恰为 Story ID 的行', () => {
  const content = storyTable([
    ['US-SHOP-001 结算', '第一格带了说明文字', 'P0', '-', '1d'],
    ['见 US-SHOP-002', '第一格不是纯 ID', 'P0', '-', '1d'],
    ['US-SHOP-003', '正常登记', 'P0', 'US-SHOP-009', '1d'],
  ]);

  assert.deepEqual(spec.parsePrdStories(content, { file: PRD_FILE }).stories, ['US-SHOP-003']);
});

test('parsePrdStories 把 AC 表 Story 列里没有登记行的 Story 补在定义行之后', () => {
  const content = [
    storyTable([['US-SHOP-003', '作为运营，我要导出报表', 'P2', '-', '2d'], SHOP_STORY_ROWS[0]]),
    '',
    prdDocument(),
  ].join('\n');

  const result = spec.parsePrdStories(content, { file: PRD_FILE });

  assert.deepEqual(result.stories, ['US-SHOP-003', 'US-SHOP-001', 'US-SHOP-002']);
  assert.equal(result.defined, true);
  assert.equal(result.moduleId, 'SHOP');
  assert.deepEqual(result.acs.map((ac) => ac.id), SHOP_ACS.map((ac) => ac.id));
});

test('parsePrdStories 在只有 AC 表时以 AC 表的 Story 列为准，非法 AC 行不贡献 Story', () => {
  const content = prdDocument([
    ...SHOP_ACS,
    // 优先级非法：整行被 parseAcTables 丢弃，其 Story 不应进入结果
    { id: 'AC-SHOP-003-01', story: 'US-SHOP-003', priority: 'P9', tc: 'TC-SHOP-009' },
  ]);

  const result = spec.parsePrdStories(content, { file: PRD_FILE });

  assert.deepEqual(result.stories, ['US-SHOP-001', 'US-SHOP-002']);
  assert.equal(result.defined, true);
  assert.deepEqual(result.acs, spec.parseAcTables(content, { file: PRD_FILE }).acs);
});

test('parsePrdStories 忽略围栏代码块里的表格，并且 BOM 与 CRLF 不改变结果', () => {
  const lines = [
    '# 购物模块 PRD',
    '',
    '示例（不是真实规格）：',
    '',
    '```markdown',
    storyTable([['US-GHOST-001', '围栏内的示例 Story', 'P0', '-', '1d']]),
    '```',
    '',
    storyTable(SHOP_STORY_ROWS),
  ].join('\n');

  const plain = spec.parsePrdStories(lines, { file: PRD_FILE });
  const crlf = spec.parsePrdStories(`\uFEFF${lines.replace(/\n/gu, '\r\n')}`, { file: PRD_FILE });

  assert.deepEqual(plain.stories, ['US-SHOP-001', 'US-SHOP-002']);
  assert.deepEqual(crlf, plain);
});

test('parsePrdStories 完整保留含数字与多段的模块标识', () => {
  const multi = storyTable([
    ['US-MODEL-CONFIG-001', '路由配置', 'P0', '-', '2d'],
    ['US-MODEL-CONFIG-002', '路由回退', 'P0', '-', '2d'],
  ]);
  const digit = storyTable([['US-E2E-001', '夜间覆盖', 'P1', '-', '1d']]);

  const multiResult = spec.parsePrdStories(multi, { file: PRD_FILE });
  const digitResult = spec.parsePrdStories(digit, { file: PRD_FILE });

  assert.deepEqual(multiResult.stories, ['US-MODEL-CONFIG-001', 'US-MODEL-CONFIG-002']);
  assert.equal(multiResult.moduleId, 'MODEL-CONFIG');
  assert.deepEqual(digitResult.stories, ['US-E2E-001']);
  assert.equal(digitResult.moduleId, 'E2E');
});

test('parsePrdStories 不把其他表格首列里的外模块 Story 算作本模块', () => {
  const content = [
    storyTable(SHOP_STORY_ROWS),
    '',
    '## 跨模块依赖',
    '',
    mdTable(['Story', '提供方'], [['US-USER-001', '用户模块'], ['US-PAY-002', '支付模块']]),
  ].join('\n');

  const result = spec.parsePrdStories(content, { file: PRD_FILE });

  assert.deepEqual(result.stories, ['US-SHOP-001', 'US-SHOP-002']);
  assert.equal(result.moduleId, 'SHOP');
});

test('parsePrdStories 以 AC 表确定模块时同样剔除外模块的登记行', () => {
  const content = [
    mdTable(['Story', '提供方'], [['US-USER-001', '用户模块']]),
    '',
    prdDocument(),
  ].join('\n');

  const result = spec.parsePrdStories(content, { file: PRD_FILE });

  assert.deepEqual(result.stories, ['US-SHOP-001', 'US-SHOP-002']);
  assert.equal(result.moduleId, 'SHOP');
});

test('parsePrdStories 在有 Story 表时也收录以 Story ID 开头的标题，并按出现顺序排列', () => {
  const content = [
    storyTable([SHOP_STORY_ROWS[0]]),
    '',
    '## US-SHOP-005 退款申请',
    '',
    '### US-SHOP-006：商品评价',
    '',
    '## US-USER-009 外模块标题不计入',
    '',
    '## 关于 US-SHOP-007 的说明',
    '',
    '## US-SHOP-0081 编号不完整',
    '',
    '```markdown',
    '## US-SHOP-099 围栏内的标题',
    '```',
  ].join('\n');

  const result = spec.parsePrdStories(content, { file: PRD_FILE });

  assert.deepEqual(result.stories, ['US-SHOP-001', 'US-SHOP-005', 'US-SHOP-006']);
  assert.equal(result.defined, true);
});

test('parsePrdStories 在只有标题登记时也视为已定义', () => {
  const content = ['# PRD', '', '## US-SHOP-001 结算', '', '正文提到 US-USER-001。', '', '## US-SHOP-002 条款'].join('\n');

  const result = spec.parsePrdStories(content, { file: PRD_FILE });

  assert.deepEqual(result.stories, ['US-SHOP-001', 'US-SHOP-002']);
  assert.equal(result.defined, true);
  assert.equal(result.moduleId, 'SHOP');
});

test('parsePrdStories 没有 Story 表也没有 AC 表时退化为按首次出现顺序去重的提及', () => {
  const content = [
    '# PRD',
    '',
    '## Stories',
    '- US-E2E-001: nightly coverage',
    '- US-MODEL-CONFIG-001: routing config',
    '- 回看 US-E2E-001，并注意 US-MODEL-CONFIG-001',
  ].join('\n');

  assert.deepEqual(spec.parsePrdStories(content, { file: PRD_FILE }), {
    stories: ['US-E2E-001', 'US-MODEL-CONFIG-001'],
    defined: false,
    moduleId: null,
    acs: [],
  });
});

test('parsePrdStories 的 moduleId 取 AC 编号里出现最多的模块，并列取先出现者，无 AC 时看登记行', () => {
  const moduleIdOf = (rows) => spec.parsePrdStories(prdDocument(rows), { file: PRD_FILE }).moduleId;

  assert.equal(moduleIdOf([
    { id: 'AC-USER-001-01', story: 'US-USER-001', tc: 'TC-USER-001' },
    { id: 'AC-SHOP-001-01', story: 'US-SHOP-001', tc: 'TC-SHOP-001' },
    { id: 'AC-SHOP-001-02', story: 'US-SHOP-001', tc: 'TC-SHOP-002' },
    { id: 'AC-USER-001-02', story: 'US-USER-001', tc: 'TC-USER-002' },
    { id: 'AC-SHOP-002-01', story: 'US-SHOP-002', tc: 'TC-SHOP-003' },
  ]), 'SHOP');
  assert.equal(moduleIdOf([
    { id: 'AC-USER-001-01', story: 'US-USER-001', tc: 'TC-USER-001' },
    { id: 'AC-SHOP-001-01', story: 'US-SHOP-001', tc: 'TC-SHOP-001' },
    { id: 'AC-USER-001-02', story: 'US-USER-001', tc: 'TC-USER-002' },
    { id: 'AC-SHOP-001-02', story: 'US-SHOP-001', tc: 'TC-SHOP-002' },
  ]), 'USER');

  const definitionsOnly = storyTable([
    ['US-USER-001', '登录', 'P0', '-', '1d'],
    ['US-SHOP-001', '结算', 'P0', '-', '1d'],
    ['US-SHOP-002', '隐私条款', 'P1', '-', '1d'],
  ]);
  assert.equal(spec.parsePrdStories(definitionsOnly, { file: PRD_FILE }).moduleId, 'SHOP');
});

test('parsePrdStories 对空输入与没有任何 Story 的文档返回空结果', () => {
  const empty = { stories: [], defined: false, moduleId: null, acs: [] };

  for (const value of ['', undefined, null]) {
    assert.deepEqual(spec.parsePrdStories(value, { file: PRD_FILE }), empty);
  }
  assert.deepEqual(spec.parsePrdStories('# 只有标题\n\n没有任何 Story。', { file: PRD_FILE }), empty);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const spec = require('../business-spec');
const {
  AC_COLUMNS,
  SHOP_ACS,
  acRowCells,
  lineOf,
  mdTable,
  pathsDocument,
  prdDocument,
  shopPaths,
} = require('./fixtures/business-testing/builders');
const { PATHS_FILE, PRD_FILE, codes, withProject } = require('./business-spec.helpers');

// ---------------------------------------------------------------- 原子 AC 表

test('表头常量与 ARCH 约定逐列一致', () => {
  assert.deepEqual(spec.AC_TABLE_HEADER, AC_COLUMNS);
});

test('splitTableRow 按未转义竖线切分并还原 \\|', () => {
  assert.deepEqual(spec.splitTableRow('| a | b\\|c | d |'), ['a', 'b|c', 'd']);
  assert.deepEqual(spec.splitTableRow('| a | |'), ['a', '']);
  assert.equal(spec.splitTableRow('不是表格行'), null);
  assert.equal(spec.splitTableRow('| 缺少收尾竖线'), null);
});

test('合法原子 AC 表解析出全部 AC 与字段', () => {
  const content = prdDocument();
  const result = spec.parseAcTables(content, { file: PRD_FILE });

  assert.deepEqual(result.violations, []);
  assert.equal(result.tables, 1);
  assert.deepEqual(result.acs.map((ac) => ac.id), SHOP_ACS.map((ac) => ac.id));
  assert.deepEqual(result.acs[0], {
    id: 'AC-SHOP-001-01',
    module: 'SHOP',
    story: 'US-SHOP-001',
    priority: 'P0',
    verification: 'auto',
    platforms: ['web'],
    given: '购物车内有商品',
    when: '点击结算',
    then: '进入支付页',
    tcs: ['TC-SHOP-001'],
    file: PRD_FILE,
    line: lineOf(content, 'AC-SHOP-001-01'),
  });
  assert.deepEqual(result.acs[1].platforms, ['web', 'ios']);
  assert.deepEqual(result.acs[2].platforms, []);
  assert.equal(result.acs[3].verification, 'manual');
  assert.deepEqual(result.acs[3].tcs, []);
});

test('转义竖线被还原，TC 与端列表接受多种分隔符', () => {
  const content = prdDocument([
    { then: '显示 a\\|b 选项', tc: 'TC-SHOP-001, TC-SHOP-002', platform: 'web, ios' },
    { id: 'AC-SHOP-001-02', tc: 'TC-SHOP-001、TC-SHOP-002' },
    { id: 'AC-SHOP-001-03', tc: 'TC-SHOP-001 TC-SHOP-002' },
  ]);
  const result = spec.parseAcTables(content, { file: PRD_FILE });

  assert.deepEqual(result.violations, []);
  assert.equal(result.acs[0].then, '显示 a|b 选项');
  assert.deepEqual(result.acs[0].platforms, ['web', 'ios']);
  for (const ac of result.acs) assert.deepEqual(ac.tcs, ['TC-SHOP-001', 'TC-SHOP-002']);
});

test('表头不符的表与围栏代码块内的表一律不识别', () => {
  const legacy = mdTable(['AC ID', '描述'], [['AC-SHOP-009-01', '旧写法']]);
  const missingColumn = mdTable(spec.AC_TABLE_HEADER.slice(0, 8), [acRowCells().slice(0, 8)]);
  const fenced = `${'```'}text\n${prdDocument()}${'```'}\n\n~~~\n${prdDocument()}~~~\n`;
  const result = spec.parseAcTables([legacy, missingColumn, fenced].join('\n\n'), { file: PRD_FILE });

  assert.equal(result.tables, 0);
  assert.deepEqual(result.acs, []);
  assert.deepEqual(result.violations, []);
});

test('同一文件内多张原子 AC 表合并，行号逐行对应', () => {
  const content = [
    prdDocument([SHOP_ACS[0]]),
    '## 另一节\n\n正文。\n',
    prdDocument([SHOP_ACS[1]], { intro: '' }),
  ].join('\n');
  const result = spec.parseAcTables(content, { file: PRD_FILE });

  assert.equal(result.tables, 2);
  assert.deepEqual(result.acs.map((ac) => [ac.id, ac.line]), [
    ['AC-SHOP-001-01', lineOf(content, 'AC-SHOP-001-01')],
    ['AC-SHOP-001-02', lineOf(content, 'AC-SHOP-001-02')],
  ]);
});

const VIOLATION_CASES = [
  { code: 'AC_ID_INVALID', row: { id: 'AC-shop-1' } },
  { code: 'AC_ID_INVALID', row: { id: 'AC-SHOP-001' } },
  { code: 'STORY_INVALID', row: { story: 'US-1' } },
  { code: 'STORY_MISMATCH', row: { story: 'US-SHOP-002' } },
  { code: 'STORY_MISMATCH', row: { story: 'US-CART-001' } },
  { code: 'PRIORITY_INVALID', row: { priority: 'P9' } },
  { code: 'PRIORITY_INVALID', row: { priority: '高' } },
  { code: 'VERIFICATION_INVALID', row: { verification: 'semi' } },
  { code: 'PLATFORM_INVALID', row: { platform: 'Web' } },
  { code: 'PLATFORM_INVALID', row: { platform: 'web;ios' } },
  { code: 'PLATFORM_INVALID', row: { platform: '-,web' } },
  { code: 'PLATFORM_INVALID', row: { platform: '' } },
  { code: 'FIELD_EMPTY', row: { given: '' } },
  { code: 'FIELD_EMPTY', row: { when: ' ' } },
  { code: 'FIELD_EMPTY', row: { then: '' } },
  { code: 'TC_INVALID', row: { tc: 'TC-1' } },
  { code: 'TC_INVALID', row: { tc: 'QA-1' } },
  { code: 'TC_INVALID', row: { tc: '' } },
];

for (const { code, row } of VIOLATION_CASES) {
  test(`${code} ← ${JSON.stringify(row)}`, () => {
    const content = prdDocument([row]);
    const result = spec.parseAcTables(content, { file: PRD_FILE });

    assert.deepEqual(codes(result.violations), [code]);
    const [violation] = result.violations;
    assert.equal(violation.file, PRD_FILE);
    assert.equal(violation.line, lineOf(content, '| AC-'));
    assert.ok(violation.message.length > 0);
  });
}

test('一行多处违规逐项列出且按列顺序', () => {
  const content = prdDocument([{ priority: 'P9', verification: 'semi', platform: 'Web', given: '' }]);
  const result = spec.parseAcTables(content, { file: PRD_FILE });

  assert.deepEqual(codes(result.violations), [
    'PRIORITY_INVALID',
    'VERIFICATION_INVALID',
    'PLATFORM_INVALID',
    'FIELD_EMPTY',
  ]);
});

test('ROW_COLUMNS 列数与表头不符的行被报告且不产出 AC', () => {
  const short = acRowCells().slice(0, 8);
  const long = [...acRowCells({ id: 'AC-SHOP-001-02', tc: 'TC-SHOP-002' }), '多余'];
  const content = prdDocument([short, long]);
  const result = spec.parseAcTables(content, { file: PRD_FILE });

  assert.deepEqual(codes(result.violations), ['ROW_COLUMNS', 'ROW_COLUMNS']);
  assert.deepEqual(result.violations.map((violation) => violation.line), [
    lineOf(content, 'AC-SHOP-001-01'),
    lineOf(content, '多余'),
  ]);
  assert.deepEqual(result.acs, []);
});

// ---------------------------------------------------------------- loadBusinessSpec

test('loadBusinessSpec 只读取 docs/prd-modules/<domain>/ 的直接子级 Markdown', () => {
  withProject({
    'docs/prd-modules/MODULE-TEMPLATE.md': prdDocument([{ id: 'AC-TPL-001-01', story: 'US-TPL-001', tc: 'TC-TPL-001' }]),
    'docs/prd-modules/shop/PRD.md': prdDocument([SHOP_ACS[0]]),
    'docs/prd-modules/shop/extra.md': prdDocument([SHOP_ACS[1]], { intro: '' }),
    'docs/prd-modules/shop/notes.txt': prdDocument([SHOP_ACS[2]]),
    'docs/prd-modules/shop/nested/deep.md': prdDocument([SHOP_ACS[3]]),
    'docs/prd-modules/empty/PRD.md': '# 没有原子 AC 表\n\n| AC ID | 描述 |\n| --- | --- |\n| AC-OLD-001-01 | 旧写法 |\n',
  }, (project) => {
    const loaded = spec.loadBusinessSpec({ repoRoot: project.repo });

    assert.deepEqual(loaded.violations, []);
    assert.deepEqual(loaded.acs.map((ac) => ac.id), ['AC-SHOP-001-01', 'AC-SHOP-001-02']);
    assert.deepEqual(loaded.acs.map((ac) => ac.domain), ['shop', 'shop']);
    assert.deepEqual(loaded.acs.map((ac) => ac.file), [PRD_FILE, 'docs/prd-modules/shop/extra.md']);
    assert.deepEqual(loaded.modules.map((module) => [module.domain, module.acCount]), [['shop', 2]]);
    assert.deepEqual(loaded.modulesWithoutTable, ['empty']);
  });
});

test('AC_ID_DUPLICATE 跨模块与同文件重复均被报告，指向首次位置', () => {
  withProject({
    'docs/prd-modules/shop/PRD.md': prdDocument([SHOP_ACS[0], SHOP_ACS[0]]),
    'docs/prd-modules/cart/PRD.md': prdDocument([SHOP_ACS[0]]),
  }, (project) => {
    const loaded = spec.loadBusinessSpec({ repoRoot: project.repo });

    assert.deepEqual(codes(loaded.violations), ['AC_ID_DUPLICATE', 'AC_ID_DUPLICATE']);
    assert.deepEqual(loaded.violations.map((violation) => violation.file), [PRD_FILE, PRD_FILE]);
    assert.match(loaded.violations[0].message, /docs\/prd-modules\/cart\/PRD\.md:\d+/);
  });
});

test('缺少 docs 目录时返回空规格而不抛错', () => {
  withProject({}, (project) => {
    const loaded = spec.loadBusinessSpec({ repoRoot: project.repo });

    assert.deepEqual(loaded.acs, []);
    assert.deepEqual(loaded.modules, []);
    assert.deepEqual(loaded.modulesWithoutTable, []);
    assert.deepEqual(loaded.pathsDocs, []);
    assert.deepEqual(loaded.violations, []);
  });
});

test('loadBusinessSpec 的输出与文件创建顺序无关', () => {
  const files = {
    'docs/prd-modules/shop/PRD.md': prdDocument(SHOP_ACS),
    'docs/prd-modules/cart/PRD.md': prdDocument([
      { id: 'AC-CART-001-01', story: 'US-CART-001', tc: 'TC-CART-001' },
    ]),
  };
  const reversed = Object.fromEntries(Object.entries(files).reverse());
  const first = withProject(files, (project) => spec.loadBusinessSpec({ repoRoot: project.repo }));
  const second = withProject(reversed, (project) => spec.loadBusinessSpec({ repoRoot: project.repo }));

  assert.deepEqual(first, second);
  assert.deepEqual(first.acs.map((ac) => ac.id), [
    'AC-CART-001-01',
    'AC-SHOP-001-01',
    'AC-SHOP-001-02',
    'AC-SHOP-001-03',
    'AC-SHOP-002-01',
  ]);
});

test('loadBusinessSpec 读取 docs/qa-modules/<domain>/PATHS.md 并合并语法违规', () => {
  withProject({
    [PRD_FILE]: prdDocument(),
    [PATHS_FILE]: pathsDocument(shopPaths((model) => { model.screens[0][0] = 'SCR-1'; })),
    'docs/qa-modules/cart/NOTES.md': '# 非 PATHS 文件不被读取\n',
  }, (project) => {
    const loaded = spec.loadBusinessSpec({ repoRoot: project.repo });

    assert.deepEqual(loaded.pathsDocs.map((doc) => [doc.domain, doc.file]), [['shop', PATHS_FILE]]);
    assert.deepEqual(codes(loaded.violations), ['ID_INVALID']);
  });
});

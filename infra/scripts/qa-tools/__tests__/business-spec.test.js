'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const spec = require('../business-spec');
const {
  AC_COLUMNS,
  SHOP_ACS,
  acRowCells,
  createProject,
  lineOf,
  mdTable,
  pathsDocument,
  prdDocument,
  shopPaths,
} = require('./fixtures/business-testing/builders');

const PRD_FILE = 'docs/prd-modules/shop/PRD.md';
const PATHS_FILE = 'docs/qa-modules/shop/PATHS.md';

const codes = (violations) => violations.map((violation) => violation.code);

function withProject(files, run) {
  const project = createProject(files);
  try {
    return run(project);
  } finally {
    project.cleanup();
  }
}

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

// ---------------------------------------------------------------- PATHS.md

test('PATHS.md 的界面、状态、转移、路径与覆盖准则被解析', () => {
  const content = pathsDocument();
  const doc = spec.parsePathsDocument(content, { file: PATHS_FILE });

  assert.deepEqual(doc.violations, []);
  assert.deepEqual(doc.criteria, ['all-transitions']);
  assert.equal(doc.criterionLine, lineOf(content, '覆盖准则'));
  assert.deepEqual(doc.screens[1], {
    id: 'SCR-SHOP-002',
    name: '支付页',
    platforms: ['web', 'ios'],
    description: '填写卡号',
    file: PATHS_FILE,
    line: lineOf(content, 'SCR-SHOP-002'),
  });
  assert.deepEqual(doc.states[1], {
    id: 'STA-SHOP-002',
    screen: 'SCR-SHOP-002',
    name: '待支付',
    description: '',
    file: PATHS_FILE,
    line: lineOf(content, 'STA-SHOP-002'),
  });
  assert.deepEqual(doc.transitions[0], {
    id: 'TRN-SHOP-001',
    from: 'STA-SHOP-001',
    action: '点击结算',
    guard: '购物车非空',
    to: 'STA-SHOP-002',
    acs: ['AC-SHOP-001-01'],
    file: PATHS_FILE,
    line: lineOf(content, 'TRN-SHOP-001'),
  });
  assert.deepEqual(doc.paths[0], {
    id: 'PTH-SHOP-001',
    sequence: ['TRN-SHOP-001', 'TRN-SHOP-002'],
    tcs: ['TC-SHOP-001', 'TC-SHOP-002'],
    description: '支付成功主路径',
    file: PATHS_FILE,
    line: lineOf(content, 'PTH-SHOP-001'),
  });
  assert.deepEqual([doc.screens.length, doc.states.length, doc.transitions.length, doc.paths.length], [2, 4, 3, 2]);
});

const SEQUENCE_CASES = [
  ['→', 'TRN-SHOP-001 → TRN-SHOP-002'],
  ['->', 'TRN-SHOP-001 -> TRN-SHOP-002'],
  ['逗号', 'TRN-SHOP-001, TRN-SHOP-002'],
  ['无空格混用', 'TRN-SHOP-001→TRN-SHOP-002'],
];

for (const [label, sequence] of SEQUENCE_CASES) {
  test(`转移序列接受分隔符 ${label}`, () => {
    const content = pathsDocument(shopPaths((model) => { model.paths[0][1] = sequence; }));
    const doc = spec.parsePathsDocument(content, { file: PATHS_FILE });

    assert.deepEqual(doc.violations, []);
    assert.deepEqual(doc.paths[0].sequence, ['TRN-SHOP-001', 'TRN-SHOP-002']);
  });
}

test('关联 AC 与关联 TC 接受逗号、顿号与空格，- 表示无', () => {
  const content = pathsDocument(shopPaths((model) => {
    model.transitions[0][5] = 'AC-SHOP-001-01、AC-SHOP-001-02';
    model.transitions[1][5] = '-';
    model.paths[0][2] = 'TC-SHOP-001 TC-SHOP-002';
    model.paths[1][2] = '-';
  }));
  const doc = spec.parsePathsDocument(content, { file: PATHS_FILE });

  assert.deepEqual(doc.violations, []);
  assert.deepEqual(doc.transitions[0].acs, ['AC-SHOP-001-01', 'AC-SHOP-001-02']);
  assert.deepEqual(doc.transitions[1].acs, []);
  assert.deepEqual(doc.paths[0].tcs, ['TC-SHOP-001', 'TC-SHOP-002']);
  assert.deepEqual(doc.paths[1].tcs, []);
});

test('覆盖准则缺省为 none，可逗号组合，接受全角与半角冒号', () => {
  const missing = spec.parsePathsDocument(pathsDocument(shopPaths((model) => { delete model.criterion; })), { file: PATHS_FILE });
  assert.deepEqual(missing.violations, []);
  assert.deepEqual(missing.criteria, ['none']);

  const combined = spec.parsePathsDocument(
    pathsDocument(shopPaths((model) => { model.criterion = 'all-transitions, all-states'; })),
    { file: PATHS_FILE },
  );
  assert.deepEqual(combined.violations, []);
  assert.deepEqual(combined.criteria, ['all-transitions', 'all-states']);

  const ascii = spec.parsePathsDocument(
    pathsDocument(shopPaths((model) => { delete model.criterion; })).replace('# 购物模块路径模型\n', '# 购物模块路径模型\n\n覆盖准则: all-states\n'),
    { file: PATHS_FILE },
  );
  assert.deepEqual(ascii.violations, []);
  assert.deepEqual(ascii.criteria, ['all-states']);
});

test('覆盖准则的取值允许用反引号包裹，全角逗号等同逗号', () => {
  const content = pathsDocument(shopPaths((model) => { model.criterion = '`all-transitions`，`all-states`'; }));
  const doc = spec.parsePathsDocument(content, { file: PATHS_FILE });

  assert.deepEqual(doc.violations, []);
  assert.deepEqual(doc.criteria, ['all-transitions', 'all-states']);
});

test('CRITERION_INVALID ← 覆盖准则声明了两次，指向第二处', () => {
  const content = pathsDocument(shopPaths(), { extra: '覆盖准则：all-states\n' });
  const doc = spec.parsePathsDocument(content, { file: PATHS_FILE });

  assert.deepEqual(codes(doc.violations), ['CRITERION_INVALID']);
  assert.equal(doc.violations[0].line, lineOf(content, '覆盖准则', 2));
  assert.deepEqual(doc.criteria, ['all-transitions']);
});

test('围栏代码块内的覆盖准则声明不生效', () => {
  const content = pathsDocument(shopPaths((model) => { delete model.criterion; }), {
    extra: '```text\n覆盖准则：all-states\n```\n',
  });
  const doc = spec.parsePathsDocument(content, { file: PATHS_FILE });

  assert.deepEqual(doc.violations, []);
  assert.deepEqual(doc.criteria, ['none']);
  assert.equal(doc.criterionLine, null);
});

for (const [label, criterion] of [['未知取值', 'all-things'], ['空取值', ''], ['none 与其他并存', 'none, all-states']]) {
  test(`CRITERION_INVALID ← ${label}`, () => {
    const content = pathsDocument(shopPaths((model) => { model.criterion = criterion; }));
    const doc = spec.parsePathsDocument(content, { file: PATHS_FILE });

    assert.deepEqual(codes(doc.violations), ['CRITERION_INVALID']);
    assert.equal(doc.violations[0].line, lineOf(content, '覆盖准则'));
  });
}

test('PATHS_TABLE_MISSING 缺少任一张表即报告，且不连带产生其他违规', () => {
  const missingOne = spec.parsePathsDocument(pathsDocument(shopPaths(), { omit: ['transitions'] }), { file: PATHS_FILE });
  assert.deepEqual(codes(missingOne.violations), ['PATHS_TABLE_MISSING']);
  assert.match(missingOne.violations[0].message, /转移/);

  const missingTwo = spec.parsePathsDocument(pathsDocument(shopPaths(), { omit: ['screens', 'paths'] }), { file: PATHS_FILE });
  assert.deepEqual(codes(missingTwo.violations), ['PATHS_TABLE_MISSING', 'PATHS_TABLE_MISSING']);
});

test('表头列顺序不符的表不被识别，视为缺表', () => {
  const content = pathsDocument().replace('| ID | 转移序列 | 关联 TC | 说明 |', '| ID | 关联 TC | 转移序列 | 说明 |');
  const doc = spec.parsePathsDocument(content, { file: PATHS_FILE });

  assert.deepEqual(codes(doc.violations), ['PATHS_TABLE_MISSING']);
  assert.match(doc.violations[0].message, /路径/);
});

test('表格按表头识别，不依赖标题', () => {
  const content = pathsDocument().replace(/^## .*$/gmu, '');
  const doc = spec.parsePathsDocument(content, { file: PATHS_FILE });

  assert.deepEqual(doc.violations, []);
  assert.equal(doc.transitions.length, 3);
});

const ID_INVALID_CASES = [
  ['界面', (model) => { model.screens[0][0] = 'SCR-1'; }, 'SCR-1'],
  ['状态', (model) => { model.states[0][0] = 'STA-SHOP-1'; }, 'STA-SHOP-1'],
  ['转移', (model) => { model.transitions[0][0] = 'TRN-shop-001'; }, 'TRN-shop-001'],
  ['路径', (model) => { model.paths[0][0] = 'PTH-SHOP-0001'; }, 'PTH-SHOP-0001'],
  ['错用前缀', (model) => { model.states[0][0] = 'TRN-SHOP-009'; }, 'TRN-SHOP-009'],
];

for (const [label, mutate, needle] of ID_INVALID_CASES) {
  test(`ID_INVALID ← ${label}`, () => {
    const content = pathsDocument(shopPaths(mutate));
    const doc = spec.parsePathsDocument(content, { file: PATHS_FILE });

    assert.deepEqual(codes(doc.violations), ['ID_INVALID']);
    assert.equal(doc.violations[0].line, lineOf(content, needle));
  });
}

test('ID_DUPLICATE 同一文件内重复的标识在后出现的行报告', () => {
  const content = pathsDocument(shopPaths((model) => { model.states[3][0] = 'STA-SHOP-002'; }));
  const doc = spec.parsePathsDocument(content, { file: PATHS_FILE });

  assert.deepEqual(codes(doc.violations), ['ID_DUPLICATE']);
  assert.equal(doc.violations[0].line, lineOf(content, 'STA-SHOP-002', 2));
});

test('TC_INVALID 路径的关联 TC 格式非法', () => {
  const content = pathsDocument(shopPaths((model) => { model.paths[0][2] = 'TC-SHOP-001, TC-2'; }));
  const doc = spec.parsePathsDocument(content, { file: PATHS_FILE });

  assert.deepEqual(codes(doc.violations), ['TC_INVALID']);
  assert.equal(doc.violations[0].line, lineOf(content, 'PTH-SHOP-001'));
});

test('ROW_COLUMNS 列数不符的行被报告且不产出条目', () => {
  const content = pathsDocument(shopPaths((model) => {
    model.paths[1] = ['PTH-SHOP-002', 'TRN-SHOP-001 → TRN-SHOP-003', 'TC-SHOP-003'];
  }));
  const doc = spec.parsePathsDocument(content, { file: PATHS_FILE });

  assert.deepEqual(codes(doc.violations), ['ROW_COLUMNS']);
  assert.equal(doc.violations[0].line, lineOf(content, 'PTH-SHOP-002'));
  assert.deepEqual(doc.paths.map((entry) => entry.id), ['PTH-SHOP-001']);
});

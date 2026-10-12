'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const spec = require('../business-spec');
const { lineOf, pathsDocument, shopPaths } = require('./fixtures/business-testing/builders');
const { PATHS_FILE, codes } = require('./business-spec.helpers');

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

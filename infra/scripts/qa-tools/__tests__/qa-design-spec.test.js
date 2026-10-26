'use strict';

// TEST-DESIGN.md 与 PRD 不变量表的解析：表结构、行级校验、出处切分、TC 收集与跨文件加载。
// 引用与覆盖关系（出处是否存在、TC 是否通过）由 qa-design.js 判定，这里只验证语法层。

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  amendmentSource,
  collectDesignTcs,
  loadDesignSpec,
  parseDesignDocument,
  parseInvTables,
  parseSources,
} = require('../qa-design-spec');
const { SHA, compliantDesign, designDoc, makeProject, prdDoc } = require('./qa-design.helpers');

const FILE = 'docs/qa-modules/user/TEST-DESIGN.md';
const PRD_FILE = 'docs/prd-modules/user/PRD.md';

const codes = (violations) => violations.map((violation) => violation.code);

test('合规文档解析出头部、四张表与行字段', () => {
  const doc = parseDesignDocument(designDoc(compliantDesign()), { file: FILE });
  assert.deepEqual(doc.violations, []);
  assert.deepEqual(doc.header, { bundleSha: SHA, isolation: 'subagent', issues: [] });
  for (const name of ['rules', 'advs', 'bugs', 'changes']) assert.ok(doc.tables[name], name);
  assert.deepEqual(doc.rules[0], {
    line: doc.rules[0].line,
    id: 'RUL-USER-001',
    type: 'rule',
    statement: '第 5 次失败锁定',
    source: 'AC-USER-001-01, INV-USER-001',
    priority: 'P0',
    verification: 'example',
    tcs: ['TC-USER-010'],
  });
  assert.equal(doc.advs.length, 5);
  assert.deepEqual(doc.advs[0], {
    line: doc.advs[0].line,
    id: 'ADV-USER-001',
    rules: ['RUL-USER-001'],
    dimension: 'auth',
    scenario: 'auth 场景',
    expected: '返回 2002',
    tcs: ['TC-USER-011'],
    notApplicable: false,
  });
  assert.deepEqual(doc.bugs, []);
  assert.deepEqual(doc.changes, []);
});

test('变更行还原转义竖线，不适用反例与缺陷行字段齐全', () => {
  const content = designDoc(compliantDesign({
    advs: [['ADV-USER-001', 'RUL-USER-001, RUL-USER-002', 'concurrency', '不适用：单用户串行', '-', '-']],
    bugs: [['BUG-USER-001', '并发锁定失效', 'RUL-USER-001, ADV-USER-001', 'qa-redteam', 'TC-USER-030', 'abc1234']],
    changes: [['2026-10-26', 'RUL-USER-001', '修改', 'a\\|b；新出处：AC-USER-001-01', '张三']],
  }));
  const doc = parseDesignDocument(content, { file: FILE });
  assert.deepEqual(doc.violations, []);
  assert.equal(doc.advs[0].notApplicable, true);
  assert.deepEqual(doc.advs[0].rules, ['RUL-USER-001', 'RUL-USER-002']);
  assert.deepEqual(doc.advs[0].tcs, []);
  assert.deepEqual(doc.bugs[0], {
    line: doc.bugs[0].line,
    id: 'BUG-USER-001',
    symptom: '并发锁定失效',
    rules: ['RUL-USER-001', 'ADV-USER-001'],
    origin: 'qa-redteam',
    tcs: ['TC-USER-030'],
    fix: 'abc1234',
  });
  const open = parseDesignDocument(designDoc(compliantDesign({
    bugs: [['BUG-USER-001', '现象', 'RUL-USER-001', 'user', '-', '-']],
  })), { file: FILE });
  assert.equal(open.bugs[0].fix, null);
  assert.deepEqual(open.bugs[0].tcs, []);
  assert.deepEqual(doc.changes[0], {
    line: doc.changes[0].line,
    date: '2026-10-26',
    id: 'RUL-USER-001',
    change: '修改',
    reason: 'a|b；新出处：AC-USER-001-01',
    reviewer: '张三',
  });
});

test('非法行记 ROW_INVALID 且不进入行列表；缺表记 TABLE_MISSING', () => {
  const content = designDoc(compliantDesign({
    rules: [
      ['RUL-USER-001', 'guess', '陈述', 'AC-USER-001-01', 'P0', 'example', 'TC-USER-010'],
      ['RUL-USER-002', 'rule', '陈述', '推断：', 'P0', 'example', 'TC-USER-010'],
      ['RUL-USER-003', 'rule', '陈述', 'AC-USER-001-01', 'P0', 'example', 'TC-1'],
    ],
    advs: [
      ['ADV-USER-001', 'RUL-USER-001', 'concurrency', '不适用：单用户', '返回 200', '-'],
      ['ADV-USER-002', '-', 'auth', '越权', '返回 403', 'TC-USER-011'],
      ['ADV-USER-003', 'RUL-USER-001', 'auth', '越权', '-', 'TC-USER-011'],
    ],
    bugs: [['BUG-USER-001', '现象', 'TC-USER-001', 'user', 'TC-USER-030', 'abc1234']],
    changes: [['2026-10-26', 'AC-USER-001-01', '修改', '原因', '张三'], ['2026-10-26', 'RUL-USER-001', '修改', '原因', '']],
  }));
  const doc = parseDesignDocument(content, { file: FILE });
  assert.equal(doc.rules.length, 0);
  assert.equal(doc.advs.length, 0);
  assert.equal(doc.bugs.length, 0);
  assert.equal(doc.changes.length, 0);
  assert.equal(codes(doc.violations).filter((code) => code === 'ROW_INVALID').length, 9);
  for (const violation of doc.violations) {
    assert.equal(violation.file, FILE);
    assert.ok(violation.line > 0);
  }

  const missing = parseDesignDocument(designDoc(compliantDesign()).replace(/## 5\. 缺陷复现[\s\S]*?(?=## 6\.)/u, ''), { file: FILE });
  assert.deepEqual(codes(missing.violations), ['TABLE_MISSING']);
  assert.match(missing.violations[0].message, /缺陷/u);
  assert.equal(missing.tables.bugs, null);
});

test('列数不符与围栏内的表格不被当作设计行', () => {
  const content = designDoc(compliantDesign())
    .replace('| RUL-USER-001 | rule |', '| RUL-USER-001 | rule | 多一列 |')
    .concat('\n```\n| ID | 类型 | 陈述 | 出处 | 优先级 | 验证方式 | TC |\n|----|----|----|----|----|----|----|\n| RUL-USER-009 | rule | x | AC-USER-001-01 | P0 | example | TC-USER-099 |\n```\n');
  const doc = parseDesignDocument(content, { file: FILE });
  assert.deepEqual(codes(doc.violations), ['ROW_INVALID']);
  assert.equal(doc.rules.length, 0);
});

test('头部缺失或非法时值为空并说明原因', () => {
  const missing = parseDesignDocument(designDoc({ ...compliantDesign(), header: { 设计材料包: null, 设计隔离: null } }), { file: FILE });
  assert.equal(missing.header.bundleSha, null);
  assert.equal(missing.header.isolation, null);
  assert.equal(missing.header.issues.length, 2);

  const invalid = parseDesignDocument(designDoc({ ...compliantDesign(), header: { 设计材料包: 'sha256=xyz', 设计隔离: 'magic' } }), { file: FILE });
  assert.equal(invalid.header.bundleSha, null);
  assert.equal(invalid.header.isolation, null);
  assert.match(invalid.header.issues.join(' '), /magic/u);

  const halfWidth = parseDesignDocument(
    designDoc(compliantDesign()).replace('**设计隔离**：subagent', '**设计隔离**: commit-order'),
    { file: FILE },
  );
  assert.equal(halfWidth.header.isolation, 'commit-order');
});

test('parseSources 切分 AC、INV、文档锚点与其他文本，识别推断出处', () => {
  const parsed = parseSources('AC-USER-001-01, INV-USER-001、docs/data/dictionary.md#邮箱；src/login.js；docs/a.md#；随便写');
  assert.equal(parsed.inferred, false);
  assert.deepEqual(parsed.items.map((item) => [item.kind, item.id || item.path || item.raw]), [
    ['ac', 'AC-USER-001-01'],
    ['inv', 'INV-USER-001'],
    ['path', 'docs/data/dictionary.md'],
    ['path', 'src/login.js'],
    ['path', 'docs/a.md'],
    ['other', '随便写'],
  ]);
  assert.equal(parsed.items[2].anchor, '邮箱');
  assert.equal(parsed.items[3].anchor, null);
  assert.equal(parsed.items[4].anchor, '');

  assert.deepEqual(parseSources('推断：同类接口惯例'), { inferred: true, reason: '同类接口惯例', items: [] });
  assert.deepEqual(parseSources('推断: 惯例'), { inferred: true, reason: '惯例', items: [] });
  assert.deepEqual(parseSources('  '), { inferred: false, reason: null, items: [] });
});

test('amendmentSource 取“新出处”标记之后的文本，无标记时整格即出处', () => {
  assert.equal(amendmentSource('口径调整；新出处：AC-USER-001-01'), 'AC-USER-001-01');
  assert.equal(amendmentSource('口径调整；新出处: docs/a.md#b'), 'docs/a.md#b');
  assert.equal(amendmentSource('AC-USER-001-01'), 'AC-USER-001-01');
});

test('collectDesignTcs 宽松收集三张表 TC 列中的编号', () => {
  const content = designDoc(compliantDesign({
    rules: [
      ['RUL-USER-001', 'rule', '陈述提到 TC-USER-900', 'AC-USER-001-01', 'P0', 'example', 'TC-USER-010, TC-USER-020'],
      ['RUL-USER-002', 'guess', '非法行', 'AC-USER-001-01', 'P0', 'example', 'TC-USER-021'],
    ],
    bugs: [['BUG-USER-001', '现象', 'RUL-USER-001', 'user', 'TC-USER-030', '-']],
  })).concat('\n```\n| ID | 类型 | 陈述 | 出处 | 优先级 | 验证方式 | TC |\n|----|----|----|----|----|----|----|\n| RUL-USER-009 | rule | x | y | P0 | example | TC-USER-099 |\n```\n');
  const tcs = collectDesignTcs(content);
  for (const id of ['TC-USER-010', 'TC-USER-020', 'TC-USER-021', 'TC-USER-011', 'TC-USER-015', 'TC-USER-030']) {
    assert.ok(tcs.includes(id), id);
  }
  assert.ok(!tcs.includes('TC-USER-900'));
  assert.ok(!tcs.includes('TC-USER-099'));
  assert.equal(new Set(tcs).size, tcs.length);
  assert.deepEqual(collectDesignTcs('# 空文档\n'), []);
});

test('parseInvTables 解析不变量表并校验类型、Story 与优先级', () => {
  const content = [
    '# PRD',
    '',
    '| INV ID | 类型 | 陈述 | 适用 Story | 优先级 |',
    '|----|----|----|----|----|',
    '| INV-USER-001 | invariant | 余额非负 | * | P0 |',
    '| INV-USER-002 | forbidden | 禁止明文存储密码 | US-USER-001, US-USER-002 | P1 |',
    '| INV-USER-003 | maybe | x | * | P0 |',
    '| INV-USER-004 | pre | x | USER-1 | P0 |',
    '| INV-USER-005 | post | x | * | P7 |',
    '| INV-1 | post | x | * | P0 |',
    '| INV-USER-006 | post |  | * | P0 |',
    '',
  ].join('\n');
  const parsed = parseInvTables(content, { file: PRD_FILE });
  assert.deepEqual(parsed.entries.map((entry) => entry.id), ['INV-USER-001', 'INV-USER-002']);
  assert.deepEqual(parsed.entries[1].stories, ['US-USER-001', 'US-USER-002']);
  assert.deepEqual(parsed.entries[0].stories, ['*']);
  assert.equal(parsed.entries[0].priority, 'P0');
  assert.equal(parsed.entries[0].type, 'invariant');
  assert.equal(parsed.violations.length, 5);
  assert.ok(parsed.violations.every((violation) => violation.code === 'ROW_INVALID' && violation.file === PRD_FILE));
});

test('loadDesignSpec 按功能域加载设计文档与不变量，跨文件重复 ID 报 ID_DUPLICATE 并保留首次定义', (t) => {
  const order = compliantDesign({ advs: [], rules: [['RUL-USER-001', 'rule', '重复', 'AC-USER-001-01', 'P1', 'example', '-']] });
  const root = makeProject(t, {
    files: {
      'docs/qa-modules/order/TEST-DESIGN.md': designDoc(order),
      'docs/qa-modules/empty/PATHS.md': '# 只有路径\n',
      'docs/prd-modules/order/PRD.md': prdDoc({ acs: [['AC-ORDER-001-01', 'P0']], invs: [['INV-USER-001', 'P1']] }),
    },
  });
  const spec = loadDesignSpec({ repoRoot: root });
  assert.deepEqual(spec.docs.map((doc) => [doc.domain, doc.file]), [
    ['order', 'docs/qa-modules/order/TEST-DESIGN.md'],
    ['user', 'docs/qa-modules/user/TEST-DESIGN.md'],
  ]);
  assert.deepEqual(spec.invs.map((inv) => [inv.id, inv.domain, inv.priority]), [['INV-USER-001', 'order', 'P1']]);
  const duplicates = spec.violations.filter((violation) => violation.code === 'ID_DUPLICATE');
  assert.deepEqual(duplicates.map((violation) => violation.id).sort(), ['INV-USER-001', 'RUL-USER-001']);
  assert.equal(spec.docs[0].rules.length, 1);
  assert.equal(spec.docs[1].rules.length, 0);
  assert.equal(spec.docs[1].advs.length, 5);
});

test('loadDesignSpec 在没有设计文档与 PRD 时返回空结构', (t) => {
  const root = makeProject(t, { prd: null, design: null });
  assert.deepEqual(loadDesignSpec({ repoRoot: root }), { docs: [], invs: [], violations: [] });
});

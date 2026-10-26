'use strict';

// qa design 门禁：G1 设计完整性（表结构、出处、TC 证明、维度反例）、G2 设计先于源码提交、
// G3 已有预期改动须有变更记录；以及 amend / context 命令与 CLI 参数解析。
// 除 G2/G3/amend/context 使用临时 git 仓库外，其余均为临时目录内的纯文件夹具。

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  applyAmendment,
  buildContext,
  designLines,
  evaluateDesign,
  parseCliArgs,
  resolveDesignConfig,
} = require('../qa-design');
const { parseDesignDocument } = require('../qa-design-spec');
const {
  COMPLIANT_PRD,
  DEFAULT_DESIGN,
  DEFAULT_INTEGRITY,
  DIMENSIONS,
  allTcs,
  compliantDesign,
  design,
  designDoc,
  git,
  makeHistory,
  makeProject,
  passedResults,
  prdDoc,
  writeFiles,
} = require('./qa-design.helpers');

const DESIGN_FILE = 'docs/qa-modules/user/TEST-DESIGN.md';
const PRD_FILE = 'docs/prd-modules/user/PRD.md';
const DICTIONARY = { 'docs/data/dictionary.md': '# 数据字典\n\n## 邮箱\n' };
const NOW = new Date('2026-10-26T12:00:00Z');
const TODAY = '2026-10-26';

const codes = (items) => items.map((item) => item.code);
const enforce = (overrides = {}) => design({ mode: 'enforce', ...overrides });

function findItem(items, code, subject) {
  return items.find((item) => item.code === code && (subject === undefined || item.subject === subject));
}

function rule(overrides = {}) {
  const base = ['RUL-USER-001', 'rule', '第 5 次失败锁定', 'AC-USER-001-01, INV-USER-001', 'P0', 'example', 'TC-USER-010'];
  const columns = ['id', 'type', 'statement', 'source', 'priority', 'verification', 'tc'];
  return columns.map((column, index) => (column in overrides ? overrides[column] : base[index]));
}

function withRule(overrides) {
  return compliantDesign({ rules: [rule(overrides)] });
}

function replaceAdv(doc, dimension, row) {
  return { ...doc, advs: doc.advs.map((adv) => (adv[2] === dimension ? row : adv)) };
}

// G1 夹具：写出项目并判定；results 缺省为“文档里出现的 TC 全部通过”。
function evaluate(t, { prd = COMPLIANT_PRD, doc = compliantDesign(), files = {}, results, config = enforce() } = {}) {
  const root = makeProject(t, { prd, design: doc, files });
  const resolvedResults = results === undefined ? passedResults(doc ? allTcs(root) : []) : results;
  return { root, result: evaluateDesign({ repoRoot: root, design: config, results: resolvedResults }) };
}

// ---------------------------------------------------------------------------
// G1：合规基线与指标
// ---------------------------------------------------------------------------

test('合规设计通过并输出规则验证数与反例覆盖', (t) => {
  const { result } = evaluate(t);
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.blocks, []);
  assert.deepEqual(result.risks, []);
  assert.equal(result.docs, 1);
  assert.equal(result.isolation, 'subagent');
  assert.deepEqual(result.metrics, { rulesTotal: 1, rulesVerified: 1, advCovered: 5, advTotal: 5, amendments: 0 });
  assert.deepEqual(designLines(result), [
    'DESIGN_GATE=PASS MODE=enforce DOCS=1',
    'RULES_TOTAL=1',
    'RULES_VERIFIED=1',
    'ADV_COVERED=5/5',
    'DESIGN_AMENDMENTS=0',
    'DESIGN_ISOLATION=subagent',
  ]);
});

test('没有任何必需规格与设计文档时通过且隔离为 NONE', (t) => {
  const { result } = evaluate(t, { prd: { acs: [['AC-USER-001-01', 'P1']] }, doc: null });
  assert.equal(result.status, 'PASS');
  assert.equal(result.docs, 0);
  assert.equal(result.isolation, 'NONE');
  assert.deepEqual(result.metrics, { rulesTotal: 0, rulesVerified: 0, advCovered: 0, advTotal: 0, amendments: 0 });
});

// ---------------------------------------------------------------------------
// G1：出处
// ---------------------------------------------------------------------------

test('出处指向源码或测试文件即阻断', (t) => {
  for (const extra of ['src/login.js#L10', 'packages/auth/lock.test.js#case']) {
    const { result } = evaluate(t, { doc: withRule({ source: `AC-USER-001-01, INV-USER-001, ${extra}` }) });
    assert.equal(result.status, 'BLOCKED', extra);
    assert.ok(findItem(result.blocks, 'DESIGN_SOURCE_CODE', 'RUL-USER-001'), extra);
  }
});

test('文档锚点出处须为 docs 下存在的 Markdown 且带锚点', (t) => {
  const ok = evaluate(t, { doc: withRule({ source: 'AC-USER-001-01, INV-USER-001, docs/data/dictionary.md#邮箱' }) });
  assert.equal(ok.result.status, 'PASS');

  const cases = [
    ['docs/data/dictionary.md', 'DESIGN_SOURCE_INVALID'],
    ['docs/data/dictionary.md#', 'DESIGN_SOURCE_INVALID'],
    ['docs/../src/login.js#L1', 'DESIGN_SOURCE_INVALID'],
    ['README.md#intro', 'DESIGN_SOURCE_INVALID'],
    ['随便写的出处', 'DESIGN_SOURCE_INVALID'],
    ['docs/data/missing.md#x', 'DESIGN_SOURCE_UNKNOWN'],
    ['AC-USER-009-01', 'DESIGN_SOURCE_UNKNOWN'],
    ['INV-USER-009', 'DESIGN_SOURCE_UNKNOWN'],
  ];
  for (const [extra, code] of cases) {
    const { result } = evaluate(t, { doc: withRule({ source: `AC-USER-001-01, INV-USER-001, ${extra}` }) });
    assert.ok(findItem(result.blocks, code, 'RUL-USER-001'), `${extra} → ${code}: ${JSON.stringify(result.blocks)}`);
  }
});

test('推断出处只记风险，但不计入对 AC 与不变量的覆盖', (t) => {
  const doc = compliantDesign({
    rules: [rule(), ['RUL-USER-002', 'rule', '登录接口幂等', '推断：同类接口惯例', 'P1', 'example', '-']],
  });
  const { result } = evaluate(t, { doc });
  assert.equal(result.status, 'PASS_WITH_RISK');
  assert.ok(findItem(result.risks, 'DESIGN_SOURCE_INFERRED', 'RUL-USER-002'));

  const inferredOnly = evaluate(t, { doc: withRule({ source: '推断：同类接口惯例' }) });
  assert.ok(findItem(inferredOnly.result.blocks, 'DESIGN_SOURCE_UNCOVERED', 'AC-USER-001-01'));
  assert.ok(findItem(inferredOnly.result.blocks, 'DESIGN_SOURCE_UNCOVERED', 'INV-USER-001'));
});

test('必需优先级的 AC 与不变量未被任何规则引用即阻断，低优先级不要求', (t) => {
  const prd = {
    acs: [...COMPLIANT_PRD.acs, ['AC-USER-002-01', 'P0']],
    invs: [...COMPLIANT_PRD.invs, ['INV-USER-002', 'P0'], ['INV-USER-003', 'P2']],
  };
  const { result } = evaluate(t, { prd });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(findItem(result.blocks, 'DESIGN_SOURCE_UNCOVERED', 'AC-USER-002-01'));
  assert.ok(findItem(result.blocks, 'DESIGN_SOURCE_UNCOVERED', 'INV-USER-002'));
  assert.equal(findItem(result.blocks, 'DESIGN_SOURCE_UNCOVERED', 'AC-USER-001-02'), undefined);
  assert.equal(findItem(result.blocks, 'DESIGN_SOURCE_UNCOVERED', 'INV-USER-003'), undefined);
});

test('规则优先级低于出处最高优先级即阻断', (t) => {
  const { result } = evaluate(t, { doc: withRule({ priority: 'P1' }) });
  assert.ok(findItem(result.blocks, 'DESIGN_PRIORITY_LOWER', 'RUL-USER-001'));
});

// ---------------------------------------------------------------------------
// G1：TC 证明
// ---------------------------------------------------------------------------

test('必需规则的 TC 未在结果中通过即阻断，且不计入已验证', (t) => {
  for (const status of ['failed', 'skipped', null]) {
    const root = makeProject(t);
    const results = passedResults(allTcs(root), { 'TC-USER-010': status });
    const result = evaluateDesign({ repoRoot: root, design: enforce(), results });
    assert.ok(findItem(result.blocks, 'DESIGN_TC_UNPROVEN', 'RUL-USER-001'), String(status));
    assert.equal(result.metrics.rulesVerified, 0);
    assert.equal(result.metrics.rulesTotal, 1);
  }
});

test('必需规则与有效反例缺少 TC 即阻断', (t) => {
  const missingRuleTc = evaluate(t, { doc: withRule({ tc: '-' }) });
  assert.ok(findItem(missingRuleTc.result.blocks, 'DESIGN_TC_MISSING', 'RUL-USER-001'));

  const doc = replaceAdv(compliantDesign(), 'auth', ['ADV-USER-001', 'RUL-USER-001', 'auth', '越权访问', '返回 403', '-']);
  const missingAdvTc = evaluate(t, { doc });
  assert.ok(findItem(missingAdvTc.result.blocks, 'DESIGN_TC_MISSING', 'ADV-USER-001'));
  assert.equal(missingAdvTc.result.metrics.advCovered, 4);
});

test('结果不可用时整体记一条阻断，不逐行报未证明', (t) => {
  const { result } = evaluate(t, { results: { available: false, reason: 'RESULTS_MISSING' } });
  assert.deepEqual(codes(result.blocks), ['DESIGN_RESULTS_UNAVAILABLE']);
  assert.match(result.blocks[0].detail, /RESULTS_MISSING/u);
  assert.equal(result.metrics.rulesVerified, 0);
  assert.equal(result.metrics.advCovered, 0);
});

test('manual 规则计入总数但不计已验证，只记风险', (t) => {
  const { result } = evaluate(t, { doc: withRule({ verification: 'manual', tc: '-' }) });
  assert.equal(result.status, 'PASS_WITH_RISK');
  assert.ok(findItem(result.risks, 'DESIGN_MANUAL', 'RUL-USER-001'));
  assert.equal(findItem(result.blocks, 'DESIGN_TC_MISSING'), undefined);
  assert.equal(result.metrics.rulesTotal, 1);
  assert.equal(result.metrics.rulesVerified, 0);
});

test('undefined 类型规则照常要求 TC 与反例，另记风险', (t) => {
  const { result } = evaluate(t, { doc: withRule({ type: 'undefined' }) });
  assert.equal(result.status, 'PASS_WITH_RISK');
  assert.ok(findItem(result.risks, 'DESIGN_RULE_UNDEFINED', 'RUL-USER-001'));
  assert.equal(result.metrics.rulesVerified, 1);
});

// ---------------------------------------------------------------------------
// G1：维度反例
// ---------------------------------------------------------------------------

test('必需规则缺少某个必需维度的反例即阻断', (t) => {
  const doc = compliantDesign();
  doc.advs = doc.advs.filter((adv) => adv[2] !== 'concurrency');
  const { result } = evaluate(t, { doc });
  const item = findItem(result.blocks, 'DESIGN_DIMENSION_MISSING', 'RUL-USER-001');
  assert.ok(item);
  assert.match(item.detail, /concurrency/u);
  assert.equal(result.metrics.advCovered, 4);
  assert.equal(result.metrics.advTotal, 5);
});

test('写明不适用的维度视为已覆盖；不适用行的预期与 TC 必须为 -', (t) => {
  const notApplicable = ['ADV-USER-004', 'RUL-USER-001', 'concurrency', '不适用：单用户串行流程', '-', '-'];
  const ok = evaluate(t, { doc: replaceAdv(compliantDesign(), 'concurrency', notApplicable) });
  assert.equal(ok.result.status, 'PASS');
  assert.equal(ok.result.metrics.advCovered, 5);

  const withExpectation = ['ADV-USER-004', 'RUL-USER-001', 'concurrency', '不适用：单用户串行流程', '返回 200', '-'];
  const bad = evaluate(t, { doc: replaceAdv(compliantDesign(), 'concurrency', withExpectation) });
  assert.ok(findItem(bad.result.blocks, 'DESIGN_ROW_INVALID'));
});

test('一条反例可同时挑战多条规则', (t) => {
  const doc = compliantDesign({
    rules: [rule(), ['RUL-USER-002', 'rule', '锁定期间拒绝登录', 'AC-USER-001-01', 'P0', 'example', 'TC-USER-020']],
  });
  doc.advs = doc.advs.map((adv) => [adv[0], 'RUL-USER-001, RUL-USER-002', ...adv.slice(2)]);
  const { result } = evaluate(t, { doc });
  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.metrics, { rulesTotal: 2, rulesVerified: 2, advCovered: 10, advTotal: 10, amendments: 0 });
});

test('必需维度可配置为空，此时不要求反例', (t) => {
  const doc = compliantDesign({ advs: [] });
  const { result } = evaluate(t, { doc, config: enforce({ requiredDimensions: [] }) });
  assert.equal(result.status, 'PASS');
  assert.equal(result.metrics.advTotal, 0);
});

// ---------------------------------------------------------------------------
// G1：引用、行格式、ID 与表结构
// ---------------------------------------------------------------------------

test('反例与缺陷引用未知规则即阻断；缺陷可关联反例', (t) => {
  const advDoc = replaceAdv(compliantDesign(), 'auth', ['ADV-USER-001', 'RUL-USER-009', 'auth', '越权访问', '返回 403', 'TC-USER-011']);
  const adv = evaluate(t, { doc: advDoc });
  assert.ok(findItem(adv.result.blocks, 'DESIGN_REFERENCE_UNKNOWN', 'ADV-USER-001'));

  const bugs = [
    ['BUG-USER-001', '并发锁定失效', 'ADV-USER-004', 'qa-audit', 'TC-USER-030', 'abc1234'],
    ['BUG-USER-002', '锁定提示错误', 'ADV-USER-099', 'user', 'TC-USER-031', 'abc1234'],
  ];
  const bug = evaluate(t, { doc: compliantDesign({ bugs }) });
  assert.equal(findItem(bug.result.blocks, 'DESIGN_REFERENCE_UNKNOWN', 'BUG-USER-001'), undefined);
  assert.ok(findItem(bug.result.blocks, 'DESIGN_REFERENCE_UNKNOWN', 'BUG-USER-002'));
});

test('枚举、ID、日期或修复提交非法的行即阻断', (t) => {
  const cases = [
    withRule({ type: 'guess' }),
    withRule({ verification: 'fuzz' }),
    withRule({ priority: 'P9' }),
    withRule({ id: 'RULE-1' }),
    withRule({ source: '' }),
    replaceAdv(compliantDesign(), 'auth', ['ADV-USER-001', 'RUL-USER-001', 'network', '断网', '返回 503', 'TC-USER-011']),
    compliantDesign({ bugs: [['BUG-USER-001', '现象', 'RUL-USER-001', 'someone', 'TC-USER-030', 'abc1234']] }),
    compliantDesign({ bugs: [['BUG-USER-001', '现象', 'RUL-USER-001', 'user', 'TC-USER-030', 'xyz']] }),
    compliantDesign({ changes: [['2026/10/26', 'RUL-USER-001', '修改', '原因；新出处：AC-USER-001-01', '张三']] }),
    compliantDesign({ changes: [[TODAY, 'RUL-USER-001', '更新', '原因；新出处：AC-USER-001-01', '张三']] }),
  ];
  for (const [index, doc] of cases.entries()) {
    const { result } = evaluate(t, { doc });
    assert.ok(findItem(result.blocks, 'DESIGN_ROW_INVALID'), `case ${index}: ${JSON.stringify(result.blocks)}`);
  }
});

test('同一 ID 在文档内或跨文档重复即阻断', (t) => {
  const doc = compliantDesign({ rules: [rule(), rule({ statement: '另一条陈述' })] });
  const within = evaluate(t, { doc });
  assert.ok(findItem(within.result.blocks, 'DESIGN_ID_DUPLICATE', 'RUL-USER-001'));

  const other = designDoc(compliantDesign({ advs: [] }));
  const across = evaluate(t, { files: { 'docs/qa-modules/order/TEST-DESIGN.md': other } });
  assert.ok(findItem(across.result.blocks, 'DESIGN_ID_DUPLICATE', 'RUL-USER-001'));
});

test('缺少任一设计表即阻断', (t) => {
  const content = designDoc(compliantDesign()).replace(/## 4\. 反例目录[\s\S]*?(?=## 5\.)/u, '');
  const { result } = evaluate(t, { files: { [DESIGN_FILE]: content } });
  const item = findItem(result.blocks, 'DESIGN_TABLE_MISSING', DESIGN_FILE);
  assert.ok(item);
  assert.match(item.detail, /反例/u);
});

test('PRD 功能域有必需 AC 或不变量却没有测试设计即阻断', (t) => {
  const order = prdDoc({ acs: [['AC-ORDER-001-01', 'P0']] });
  const { result } = evaluate(t, { files: { 'docs/prd-modules/order/PRD.md': order } });
  assert.ok(findItem(result.blocks, 'DESIGN_ABSENT', 'order'));
  assert.equal(findItem(result.blocks, 'DESIGN_ABSENT', 'user'), undefined);

  const none = evaluate(t, { doc: null });
  assert.ok(findItem(none.result.blocks, 'DESIGN_ABSENT', 'user'));
  assert.equal(none.result.isolation, 'NONE');
});

// ---------------------------------------------------------------------------
// G1：缺陷、变更记录与头部
// ---------------------------------------------------------------------------

test('未修复缺陷记风险；已修复缺陷的复现 TC 须存在且通过', (t) => {
  const open = evaluate(t, { doc: compliantDesign({ bugs: [['BUG-USER-001', '现象', 'RUL-USER-001', 'qa-audit', 'TC-USER-030', '-']] }) });
  assert.equal(open.result.status, 'PASS_WITH_RISK');
  assert.ok(findItem(open.result.risks, 'DESIGN_BUG_OPEN', 'BUG-USER-001'));

  const fixedNoTc = evaluate(t, { doc: compliantDesign({ bugs: [['BUG-USER-001', '现象', 'RUL-USER-001', 'user', '-', 'abc1234']] }) });
  assert.ok(findItem(fixedNoTc.result.blocks, 'DESIGN_TC_MISSING', 'BUG-USER-001'));

  const root = makeProject(t, { design: compliantDesign({ bugs: [['BUG-USER-001', '现象', 'RUL-USER-001', 'user', 'TC-USER-030', 'abc1234']] }) });
  const result = evaluateDesign({ repoRoot: root, design: enforce(), results: passedResults(allTcs(root), { 'TC-USER-030': 'failed' }) });
  assert.ok(findItem(result.blocks, 'DESIGN_TC_UNPROVEN', 'BUG-USER-001'));
});

test('待评审的变更行记风险；无基线时修改与删除行计入变更数', (t) => {
  const changes = [
    [TODAY, 'RUL-USER-001', '修改', '口径调整；新出处：AC-USER-001-01', '待评审'],
    [TODAY, 'ADV-USER-009', '删除', '规则已移除', '张三'],
    [TODAY, 'ADV-USER-005', '新增', '补充依赖维度；新出处：AC-USER-001-01', '张三'],
  ];
  const { result } = evaluate(t, { doc: compliantDesign({ changes }) });
  assert.ok(findItem(result.risks, 'DESIGN_REVIEW_PENDING', 'RUL-USER-001'));
  assert.equal(result.metrics.amendments, 2);
});

test('缺少或非法的设计头部记风险，隔离方式取声明值', (t) => {
  const missing = evaluate(t, { doc: { ...compliantDesign(), header: { 设计材料包: null } } });
  assert.ok(findItem(missing.result.risks, 'DESIGN_HEADER_MISSING', DESIGN_FILE));
  assert.equal(missing.result.isolation, 'subagent');

  const badIsolation = evaluate(t, { doc: { ...compliantDesign(), header: { 设计隔离: 'magic' } } });
  assert.ok(findItem(badIsolation.result.risks, 'DESIGN_HEADER_MISSING', DESIGN_FILE));
  assert.equal(badIsolation.result.isolation, 'UNDECLARED');

  const badSha = evaluate(t, { doc: { ...compliantDesign(), header: { 设计材料包: 'sha256=xyz' } } });
  assert.ok(findItem(badSha.result.risks, 'DESIGN_HEADER_MISSING', DESIGN_FILE));

  const commitOrder = evaluate(t, { doc: { ...compliantDesign(), header: { 设计隔离: 'commit-order' } } });
  assert.equal(commitOrder.result.isolation, 'commit-order');
});

test('多份文档的隔离方式不一致时输出 mixed', (t) => {
  const other = compliantDesign({
    rules: [['RUL-ORDER-001', 'rule', '订单金额非负', 'AC-USER-001-01', 'P0', 'example', 'TC-ORDER-001']],
    advs: DIMENSIONS.map((dimension, index) => [`ADV-ORDER-00${index + 1}`, 'RUL-ORDER-001', dimension, '场景', '拒绝', `TC-ORDER-01${index}`]),
    header: { 设计隔离: 'commit-order' },
  });
  const root = makeProject(t, { files: { 'docs/qa-modules/order/TEST-DESIGN.md': designDoc(other) } });
  const tcs = [...allTcs(root), 'TC-ORDER-001', ...DIMENSIONS.map((_, index) => `TC-ORDER-01${index}`)];
  const result = evaluateDesign({ repoRoot: root, design: enforce(), results: passedResults(tcs) });
  assert.equal(result.status, 'PASS');
  assert.equal(result.docs, 2);
  assert.equal(result.isolation, 'mixed');
});

test('warn 模式把全部阻断降为风险', (t) => {
  const { result } = evaluate(t, { doc: withRule({ source: 'AC-USER-001-01, INV-USER-001, src/login.js#L10' }), config: design({ mode: 'warn' }) });
  assert.equal(result.status, 'PASS_WITH_RISK');
  assert.deepEqual(result.blocks, []);
  assert.ok(findItem(result.risks, 'DESIGN_SOURCE_CODE', 'RUL-USER-001'));
  assert.equal(designLines(result)[0], 'DESIGN_GATE=PASS_WITH_RISK MODE=warn DOCS=1');
});

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

test('配置解析：默认值、未知键与非法取值均 fail-closed', () => {
  assert.equal(DEFAULT_DESIGN.mode, 'warn');
  const resolved = design();
  assert.deepEqual(resolved.requiredPriorities, ['P0']);
  assert.deepEqual(resolved.requiredDimensions, [...DIMENSIONS]);
  assert.ok(resolved.sourceMatchers.some((matcher) => matcher.test('src/login.js')));
  assert.ok(resolved.testMatchers.some((matcher) => matcher.test('src/login.test.js')));

  const invalid = [
    { qa: { integrity: DEFAULT_INTEGRITY } },
    { qa: { design: { ...DEFAULT_DESIGN, extra: true }, integrity: DEFAULT_INTEGRITY } },
    { qa: { design: { ...DEFAULT_DESIGN, mode: 'strict' }, integrity: DEFAULT_INTEGRITY } },
    { qa: { design: { ...DEFAULT_DESIGN, requiredPriorities: [] }, integrity: DEFAULT_INTEGRITY } },
    { qa: { design: { ...DEFAULT_DESIGN, requiredPriorities: ['P9'] }, integrity: DEFAULT_INTEGRITY } },
    { qa: { design: { ...DEFAULT_DESIGN, requiredDimensions: ['network'] }, integrity: DEFAULT_INTEGRITY } },
    { qa: { design: { ...DEFAULT_DESIGN, sourceGlobs: [] }, integrity: DEFAULT_INTEGRITY } },
    { qa: { design: { ...DEFAULT_DESIGN, contextGlobs: [''] }, integrity: DEFAULT_INTEGRITY } },
    { qa: { design: DEFAULT_DESIGN } },
  ];
  for (const [index, config] of invalid.entries()) {
    assert.throws(() => resolveDesignConfig(config), (error) => error.code === 'DESIGN_CONFIG_INVALID', `case ${index}`);
  }
});

// ---------------------------------------------------------------------------
// G2：设计先于源码提交
// ---------------------------------------------------------------------------

function baseFiles() {
  return { ...DICTIONARY, [PRD_FILE]: prdDoc(COMPLIANT_PRD) };
}

function historyResult(repo, config = enforce()) {
  return evaluateDesign({
    repoRoot: repo.root,
    design: config,
    results: passedResults(allTcs(repo.root)),
    baseSha: repo.baseSha,
    headSha: repo.headSha,
  });
}

test('设计行与源码在同一提交引入即阻断', (t) => {
  const repo = makeHistory(t, [
    { files: baseFiles() },
    { files: { [DESIGN_FILE]: designDoc(compliantDesign()), 'src/login.js': 'module.exports = 1;\n' } },
  ]);
  const result = historyResult(repo);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(findItem(result.blocks, 'DESIGN_ORDER', 'RUL-USER-001'));
  assert.ok(findItem(result.blocks, 'DESIGN_ORDER', 'ADV-USER-001'));
});

test('设计先于源码提交时通过', (t) => {
  const repo = makeHistory(t, [
    { files: baseFiles() },
    { files: { [DESIGN_FILE]: designDoc(compliantDesign()) } },
    { files: { 'src/login.js': 'module.exports = 1;\n' } },
  ]);
  const result = historyResult(repo);
  assert.equal(result.status, 'PASS', JSON.stringify(result.blocks));
});

test('只改测试文件的提交不算源码提交', (t) => {
  const repo = makeHistory(t, [
    { files: baseFiles() },
    { files: { 'src/login.test.js': 'test\n' } },
    { files: { [DESIGN_FILE]: designDoc(compliantDesign()) } },
    { files: { 'src/login.js': 'module.exports = 1;\n' } },
  ]);
  assert.equal(findItem(historyResult(repo).blocks, 'DESIGN_ORDER'), undefined);
});

test('源码提交之后补充的设计行须有“新增”变更行，有则只记风险', (t) => {
  const initial = compliantDesign();
  const added = ['ADV-USER-006', 'RUL-USER-001', 'time', '锁定到期前 1 秒登录', '返回 2002', 'TC-USER-016'];
  const amendRow = [TODAY, 'ADV-USER-006', '新增', '审计补充时间维度；新出处：AC-USER-001-01', '张三'];

  const withAmend = makeHistory(t, [
    { files: baseFiles() },
    { files: { [DESIGN_FILE]: designDoc(initial) } },
    { files: { 'src/login.js': 'module.exports = 1;\n' } },
    { files: { [DESIGN_FILE]: designDoc({ ...initial, advs: [...initial.advs, added], changes: [amendRow] }) } },
  ]);
  const ok = historyResult(withAmend);
  assert.equal(findItem(ok.blocks, 'DESIGN_ORDER'), undefined, JSON.stringify(ok.blocks));
  assert.ok(findItem(ok.risks, 'DESIGN_ADDED_AFTER_SOURCE', 'ADV-USER-006'));

  const withoutAmend = makeHistory(t, [
    { files: baseFiles() },
    { files: { [DESIGN_FILE]: designDoc(initial) } },
    { files: { 'src/login.js': 'module.exports = 1;\n' } },
    { files: { [DESIGN_FILE]: designDoc({ ...initial, advs: [...initial.advs, added] }) } },
  ]);
  assert.ok(findItem(historyResult(withoutAmend).blocks, 'DESIGN_ORDER', 'ADV-USER-006'));
});

test('基线已有的设计行不受源码提交时序约束', (t) => {
  const repo = makeHistory(t, [
    { files: { ...baseFiles(), [DESIGN_FILE]: designDoc(compliantDesign()) } },
    { files: { 'src/login.js': 'module.exports = 1;\n' } },
  ]);
  assert.equal(historyResult(repo).status, 'PASS');
});

// ---------------------------------------------------------------------------
// G3：已有预期的修改与删除
// ---------------------------------------------------------------------------

function changedHistory(t, head) {
  return makeHistory(t, [
    { files: { ...baseFiles(), [DESIGN_FILE]: designDoc(compliantDesign()) } },
    { files: { [DESIGN_FILE]: designDoc(head) } },
  ]);
}

test('未记变更就改写规则陈述或反例预期即阻断', (t) => {
  const statement = historyResult(changedHistory(t, withRule({ statement: '第 6 次失败锁定' })));
  assert.ok(findItem(statement.blocks, 'DESIGN_EXPECTATION_CHANGED', 'RUL-USER-001'));

  const expectation = replaceAdv(compliantDesign(), 'auth', ['ADV-USER-001', 'RUL-USER-001', 'auth', 'auth 场景', '返回 200', 'TC-USER-011']);
  const adv = historyResult(changedHistory(t, expectation));
  assert.ok(findItem(adv.blocks, 'DESIGN_EXPECTATION_CHANGED', 'ADV-USER-001'));
});

test('有合法出处的“修改”变更行放行改写并计数', (t) => {
  const head = withRule({ statement: '第 6 次失败锁定' });
  head.changes = [[TODAY, 'RUL-USER-001', '修改', 'PRD 口径调整；新出处：AC-USER-001-01', '张三']];
  const result = historyResult(changedHistory(t, head));
  assert.equal(findItem(result.blocks, 'DESIGN_EXPECTATION_CHANGED'), undefined, JSON.stringify(result.blocks));
  assert.equal(result.metrics.amendments, 1);
});

test('变更行的新出处为推断或源码时仍阻断', (t) => {
  for (const source of ['推断：实现如此', 'src/login.js#L3']) {
    const head = withRule({ statement: '第 6 次失败锁定' });
    head.changes = [[TODAY, 'RUL-USER-001', '修改', `按实现调整；新出处：${source}`, '张三']];
    const result = historyResult(changedHistory(t, head));
    assert.ok(findItem(result.blocks, 'DESIGN_EXPECTATION_CHANGED', 'RUL-USER-001'), source);
  }
});

test('删除已有行须有“删除”变更行', (t) => {
  const removed = compliantDesign();
  removed.advs = removed.advs.filter((adv) => adv[0] !== 'ADV-USER-005');
  const config = enforce({ requiredDimensions: ['auth', 'state', 'boundary', 'concurrency'] });

  const blocked = historyResult(changedHistory(t, removed), config);
  const item = findItem(blocked.blocks, 'DESIGN_EXPECTATION_CHANGED', 'ADV-USER-005');
  assert.ok(item);
  assert.match(item.detail, /删除/u);

  const amended = { ...removed, changes: [[TODAY, 'ADV-USER-005', '删除', '依赖维度改由 ADV-USER-004 覆盖', '张三']] };
  const ok = historyResult(changedHistory(t, amended), config);
  assert.equal(ok.status, 'PASS', JSON.stringify(ok.blocks));
  assert.equal(ok.metrics.amendments, 1);
});

test('只改 TC 列或修复提交列不算改写预期', (t) => {
  const result = historyResult(changedHistory(t, withRule({ tc: 'TC-USER-010, TC-USER-020' })));
  assert.equal(findItem(result.blocks, 'DESIGN_EXPECTATION_CHANGED'), undefined);
});

test('删除基线中的变更行即阻断；只更新评审人不算删除', (t) => {
  const row = [TODAY, 'RUL-USER-001', '修改', '口径调整；新出处：AC-USER-001-01', '待评审'];
  const baseDoc = compliantDesign({ changes: [row] });
  const removed = makeHistory(t, [
    { files: { ...baseFiles(), [DESIGN_FILE]: designDoc(baseDoc) } },
    { files: { [DESIGN_FILE]: designDoc(compliantDesign()) } },
  ]);
  assert.ok(findItem(historyResult(removed).blocks, 'DESIGN_AMENDMENT_REMOVED', 'RUL-USER-001'));

  const reviewed = makeHistory(t, [
    { files: { ...baseFiles(), [DESIGN_FILE]: designDoc(baseDoc) } },
    { files: { [DESIGN_FILE]: designDoc(compliantDesign({ changes: [[...row.slice(0, 4), '张三']] })) } },
  ]);
  const result = historyResult(reviewed);
  assert.equal(findItem(result.blocks, 'DESIGN_AMENDMENT_REMOVED'), undefined);
  assert.equal(result.metrics.amendments, 0);
});

// ---------------------------------------------------------------------------
// amend：按基线与工作区差异追加变更行
// ---------------------------------------------------------------------------

function amendRepo(t, working) {
  const repo = makeHistory(t, [{ files: { ...baseFiles(), [DESIGN_FILE]: designDoc(compliantDesign()) } }]);
  if (working) writeFiles(repo.root, { [DESIGN_FILE]: designDoc(working) });
  return repo;
}

function changeRows(root) {
  const content = fs.readFileSync(path.join(root, DESIGN_FILE), 'utf8');
  return parseDesignDocument(content, { file: DESIGN_FILE }).changes;
}

test('amend 对改写的行追加“修改”变更行，随后 G3 放行', (t) => {
  const repo = amendRepo(t, withRule({ statement: '第 6 次失败锁定' }));
  // 修改也必须给出新出处，否则改写的预期无从追溯。
  assert.throws(
    () => applyAmendment({ repoRoot: repo.root, baseSha: repo.baseSha, id: 'RUL-USER-001', reason: 'x', now: NOW }),
    /--source/u,
  );
  const outcome = applyAmendment({
    repoRoot: repo.root,
    baseSha: repo.baseSha,
    id: 'RUL-USER-001',
    reason: 'PRD 口径调整',
    source: 'AC-USER-001-01',
    reviewer: '张三',
    now: NOW,
  });
  assert.equal(outcome.change, '修改');
  assert.equal(outcome.file, DESIGN_FILE);
  assert.equal(outcome.row, `| ${TODAY} | RUL-USER-001 | 修改 | PRD 口径调整；新出处：AC-USER-001-01 | 张三 |`);
  const rows = changeRows(repo.root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'RUL-USER-001');

  git(repo.root, ['add', '-A']);
  git(repo.root, ['commit', '-q', '-m', 'amend']);
  const result = historyResult({ ...repo, headSha: git(repo.root, ['rev-parse', 'HEAD']) });
  assert.equal(findItem(result.blocks, 'DESIGN_EXPECTATION_CHANGED'), undefined, JSON.stringify(result.blocks));
});

test('amend 对新增行要求出处，对删除行可省略出处并默认待评审', (t) => {
  const added = compliantDesign();
  added.advs = [...added.advs, ['ADV-USER-006', 'RUL-USER-001', 'time', '锁定到期前 1 秒', '返回 2002', 'TC-USER-016']];
  const addRepo = amendRepo(t, added);
  assert.throws(
    () => applyAmendment({ repoRoot: addRepo.root, baseSha: addRepo.baseSha, id: 'ADV-USER-006', reason: '补充', now: NOW }),
    /--source/u,
  );
  const addOutcome = applyAmendment({
    repoRoot: addRepo.root, baseSha: addRepo.baseSha, id: 'ADV-USER-006', reason: '补充', source: 'AC-USER-001-01', now: NOW,
  });
  assert.equal(addOutcome.change, '新增');
  assert.equal(addOutcome.row, `| ${TODAY} | ADV-USER-006 | 新增 | 补充；新出处：AC-USER-001-01 | 待评审 |`);

  const removed = compliantDesign();
  removed.advs = removed.advs.filter((adv) => adv[0] !== 'ADV-USER-005');
  const removeRepo = amendRepo(t, removed);
  const removeOutcome = applyAmendment({
    repoRoot: removeRepo.root, baseSha: removeRepo.baseSha, id: 'ADV-USER-005', reason: '不再适用', now: NOW,
  });
  assert.equal(removeOutcome.change, '删除');
  assert.equal(removeOutcome.row, `| ${TODAY} | ADV-USER-005 | 删除 | 不再适用 | 待评审 |`);
  assert.equal(changeRows(removeRepo.root)[0].change, '删除');
});

test('amend 转义竖线，并拒绝无变化、未知 ID、非法出处与缺少变更表', (t) => {
  const repo = amendRepo(t, withRule({ statement: '第 6 次失败锁定' }));
  const outcome = applyAmendment({
    repoRoot: repo.root, baseSha: repo.baseSha, id: 'RUL-USER-001', reason: 'a|b', source: 'AC-USER-001-01', now: NOW,
  });
  assert.match(outcome.row, /a\\\|b/u);
  assert.equal(changeRows(repo.root)[0].reason, 'a|b；新出处：AC-USER-001-01');

  const unchanged = amendRepo(t, null);
  const call = (overrides) => () => applyAmendment({
    repoRoot: unchanged.root, baseSha: unchanged.baseSha, reason: '原因', source: 'AC-USER-001-01', now: NOW, ...overrides,
  });
  assert.throws(call({ id: 'RUL-USER-001' }), /没有变化/u);
  assert.throws(call({ id: 'RUL-USER-099' }), /找不到/u);
  assert.throws(call({ id: 'RUL-USER-001', reason: '' }), /--reason/u);

  const badSource = amendRepo(t, withRule({ statement: '第 6 次失败锁定' }));
  assert.throws(() => applyAmendment({
    repoRoot: badSource.root, baseSha: badSource.baseSha, id: 'RUL-USER-001', reason: '原因', source: 'src/login.js#L1', now: NOW,
  }), /出处/u);

  const noTable = amendRepo(t, null);
  const content = designDoc(withRule({ statement: '第 6 次失败锁定' })).replace(/## 6\. 变更记录[\s\S]*$/u, '');
  writeFiles(noTable.root, { [DESIGN_FILE]: content });
  assert.throws(() => applyAmendment({
    repoRoot: noTable.root, baseSha: noTable.baseSha, id: 'RUL-USER-001', reason: '原因', source: 'AC-USER-001-01', now: NOW,
  }), /变更记录/u);
});

// ---------------------------------------------------------------------------
// context：只打包规格，排除源码与测试
// ---------------------------------------------------------------------------

function contextProject(t, extra = {}) {
  const root = makeProject(t, {
    files: {
      'docs/prd-modules/order/PRD.md': prdDoc({ acs: [['AC-ORDER-001-01', 'P0']] }),
      'docs/prd-modules/user/flow.spec.md': '# 用例草稿\n',
      'docs/arch-modules/user/API.md': '# 接口契约\n',
      'docs/arch-modules/user/secret.md': '# 忽略\n',
      'src/app.js': 'module.exports = 1;\n',
      '.gitignore': 'docs/arch-modules/user/secret.md\n',
      ...extra,
    },
  });
  git(root, ['init', '-q', '-b', 'main']);
  return root;
}

test('context 按功能域打包规格文件，排除源码、测试与忽略文件', (t) => {
  const root = contextProject(t);
  const context = buildContext({ repoRoot: root, design: design(), domain: 'user' });
  assert.deepEqual(context.files, [
    'docs/arch-modules/user/API.md',
    'docs/data/dictionary.md',
    'docs/prd-modules/user/PRD.md',
    'docs/qa-modules/user/TEST-DESIGN.md',
  ]);
  assert.equal(context.sha256, crypto.createHash('sha256').update(context.content).digest('hex'));
  assert.match(context.content, /==== FILE: docs\/prd-modules\/user\/PRD\.md sha256=[0-9a-f]{64} ====/u);
  assert.equal(buildContext({ repoRoot: root, design: design(), domain: 'user' }).sha256, context.sha256);

  const all = buildContext({ repoRoot: root, design: design(), domain: null });
  assert.ok(all.files.includes('docs/prd-modules/order/PRD.md'));
  assert.ok(!all.files.includes('docs/prd-modules/user/flow.spec.md'));
});

test('context 即使配置放宽也不纳入源码与测试文件', (t) => {
  const root = contextProject(t);
  const context = buildContext({ repoRoot: root, design: design({ contextGlobs: ['docs/**', 'src/**'] }), domain: 'user' });
  assert.ok(!context.files.includes('src/app.js'));
  assert.ok(!context.files.includes('docs/prd-modules/user/flow.spec.md'));
  assert.ok(context.files.includes('docs/prd-modules/order/PRD.md'));
});

test('context 拒绝非法功能域并在无匹配文件时报错', (t) => {
  const root = contextProject(t);
  assert.throws(() => buildContext({ repoRoot: root, design: design(), domain: '../user' }), /功能域/u);
  assert.throws(
    () => buildContext({ repoRoot: root, design: design({ contextGlobs: ['nothing/**'] }), domain: 'user' }),
    (error) => error.code === 'DESIGN_CONTEXT_EMPTY',
  );
});

// ---------------------------------------------------------------------------
// CLI 参数与输出
// ---------------------------------------------------------------------------

test('parseCliArgs 解析三个动作并拒绝未知参数', () => {
  assert.deepEqual(parseCliArgs(['check']), { action: 'check', base: null });
  assert.deepEqual(parseCliArgs(['check', '--base=origin/main']), { action: 'check', base: 'origin/main' });
  assert.deepEqual(parseCliArgs(['context']), { action: 'context', domain: null });
  assert.deepEqual(parseCliArgs(['context', '--domain', 'user']), { action: 'context', domain: 'user' });
  assert.deepEqual(parseCliArgs(['amend', '--id', 'RUL-USER-001', '--reason', '口径调整']), {
    action: 'amend', id: 'RUL-USER-001', reason: '口径调整', source: null, reviewer: null, base: null,
  });
  assert.deepEqual(
    parseCliArgs(['amend', '--id=RUL-USER-001', '--reason=r', '--source', 'AC-USER-001-01', '--reviewer', '张三', '--base', 'abc']),
    { action: 'amend', id: 'RUL-USER-001', reason: 'r', source: 'AC-USER-001-01', reviewer: '张三', base: 'abc' },
  );
  assert.throws(() => parseCliArgs([]), /用法/u);
  assert.throws(() => parseCliArgs(['verify']), /用法/u);
  assert.throws(() => parseCliArgs(['check', '--id', 'x']), /不支持/u);
  assert.throws(() => parseCliArgs(['amend', '--reason', 'r']), /--id/u);
  assert.throws(() => parseCliArgs(['amend', '--id', 'RUL-USER-001']), /--reason/u);
  assert.throws(() => parseCliArgs(['context', '--domain']), /需要一个值/u);
});

test('designLines 截断过长的阻断与风险列表并折叠换行', () => {
  const item = (index) => ({ code: 'DESIGN_TC_MISSING', subject: `RUL-USER-${String(index).padStart(3, '0')}`, detail: '第一行\n第二行' });
  const lines = designLines({
    status: 'BLOCKED',
    mode: 'enforce',
    docs: 1,
    isolation: 'subagent',
    metrics: { rulesTotal: 65, rulesVerified: 0, advCovered: 0, advTotal: 0, amendments: 0 },
    blocks: Array.from({ length: 65 }, (_, index) => item(index)),
    risks: Array.from({ length: 61 }, (_, index) => ({ ...item(index), code: 'DESIGN_MANUAL' })),
  });
  const blockLines = lines.filter((line) => line.startsWith('DESIGN_BLOCK='));
  const riskLines = lines.filter((line) => line.startsWith('DESIGN_RISK='));
  assert.equal(blockLines.length, 60);
  assert.equal(riskLines.length, 60);
  assert.ok(lines.includes('DESIGN_BLOCK_TRUNCATED=5'));
  assert.ok(lines.includes('DESIGN_RISK_TRUNCATED=1'));
  assert.equal(blockLines[0], 'DESIGN_BLOCK=DESIGN_TC_MISSING|RUL-USER-000|第一行 第二行');
});

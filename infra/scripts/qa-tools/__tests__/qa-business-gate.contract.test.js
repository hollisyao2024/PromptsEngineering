'use strict';

// 业务验收门禁（qa verify 的业务测试段）的判定测试：配置与规格、输出契约与只读、qa verify 接入（verifyBusinessAcceptance）。
// 结果文件由真实的 `qa run` 针对桩套件生成，门禁读到的因此是生产代码写出的数据；各用例再改动仓库、
// 结果文件或报告副本来制造“陈旧、被改动、失败、缺失”等状态，核对门禁给出的阻断代码、披露项与判定顺序。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { evaluateBusinessGate, formatBusinessGate, verifyBusinessAcceptance } = require('../qa-business-gate');
const { WEB_CASES, withStatus } = require('./fixtures/business-testing/scenario');
const { pathsDocument, shopPaths } = require('./fixtures/business-testing/builders');
const {
  HEAD_FOREIGN,
  PATHS_FILE,
  blocksOf,
  codesOf,
  evaluate,
  prepare,
  scenarioFor,
  show,
  snapshot,
} = require('./qa-business-gate.helpers');

// ---------------------------------------------------------------------------
// 配置与规格（第 1、2 步）
// ---------------------------------------------------------------------------

test('配置非法时第一步阻断，逐项报告字段，不读取规格与结果', (t) => {
  const s = scenarioFor(t);
  s.configure([{ name: 'Bad Name', platform: 'web', command: 'true', report: 'reports/x.xml' }]);
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.ok(outcome.blocks.length >= 1);
  assert.deepEqual([...new Set(codesOf(outcome.blocks))], ['CONFIG_INVALID']);
  assert.ok(outcome.blocks.every((block) => block.subject.startsWith('qa.business')), show(outcome));
  assert.ok(outcome.blocks.some((block) => /name/u.test(block.subject)), show(outcome));
  assert.match(outcome.nextAction, /qa\.business|agent\.config\.json/u);
  assert.equal(fs.existsSync(s.project.tmp), false);
});

test('开启业务测试但没有配置任何套件时同样按配置非法处理', (t) => {
  const s = scenarioFor(t);
  s.configure([]);
  const outcome = evaluate(s);

  assert.deepEqual(codesOf(outcome.blocks), ['CONFIG_INVALID'], show(outcome));
  assert.equal(outcome.blocks[0].subject, 'qa.business.suites');
});

test('enabled 无法判读时按已开启并阻断（失败即关闭）', (t) => {
  const s = scenarioFor(t);
  const outcome = evaluate(s, { config: { qa: { business: { enabled: 'yes', suites: [] } } } });

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.ok(outcome.blocks.some((block) => block.code === 'CONFIG_INVALID' && block.subject === 'qa.business.enabled'), show(outcome));
});

test('项目没有任何原子 AC 表时阻断为 NO_ATOMIC_AC，不再追问结果文件', (t) => {
  const s = scenarioFor(t, { shop: false });
  s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES })]);
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual(codesOf(outcome.blocks), ['NO_ATOMIC_AC']);
  assert.equal(fs.existsSync(s.project.tmp), false);
});

test('路径模型违规时阻断为 SPEC_INVALID，附原始违规代码与位置', (t) => {
  const s = scenarioFor(t, {
    files: {
      [PATHS_FILE]: pathsDocument(shopPaths((model) => { model.paths[0][1] = 'TRN-SHOP-001 → TRN-SHOP-099'; })),
    },
  });
  s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES })]);
  const outcome = evaluate(s);

  assert.equal(outcome.status, 'BLOCKED', show(outcome));
  assert.deepEqual([...new Set(codesOf(outcome.blocks))], ['SPEC_INVALID']);
  const unknown = outcome.blocks.find((block) => /^REF_UNKNOWN: /u.test(block.detail));
  assert.ok(unknown, show(outcome));
  assert.match(unknown.subject, /^docs\/qa-modules\/shop\/PATHS\.md(:\d+)?$/u);
});

test('运行后规格被改坏时，SPEC_INVALID 先于结果比对阻断', (t) => {
  const s = scenarioFor(t);
  prepare(s);
  s.project.write({
    [PATHS_FILE]: pathsDocument(shopPaths((model) => { model.paths[0][1] = 'TRN-SHOP-001 → TRN-SHOP-099'; })),
  });
  const outcome = evaluate(s);

  assert.deepEqual([...new Set(codesOf(outcome.blocks))], ['SPEC_INVALID'], show(outcome));
});

// ---------------------------------------------------------------------------
// 输出契约、确定性、只读与失败即关闭
// ---------------------------------------------------------------------------

test('判定结果与输出文本在重复调用时逐字节一致', (t) => {
  const s = scenarioFor(t);
  prepare(s, { web: withStatus(WEB_CASES, 'TC-SHOP-002', 'failed'), webCode: 1 });
  const first = evaluate(s);
  const second = evaluate(s);

  assert.deepEqual(second, first);
  assert.equal(formatBusinessGate(second).join('\n'), formatBusinessGate(first).join('\n'));
});

test('门禁是只读的：不创建、不修改任何文件（含阻断与放行两种结果）', (t) => {
  const s = scenarioFor(t);
  prepare(s, { web: withStatus(WEB_CASES, 'TC-SHOP-002', 'failed') });
  const before = snapshot(s.project.root);
  const blocked = evaluate(s);
  assert.equal(blocked.status, 'BLOCKED');
  assert.deepEqual(snapshot(s.project.root), before);

  const clean = scenarioFor(t);
  prepare(clean);
  const cleanBefore = snapshot(clean.project.root);
  assert.equal(evaluate(clean).status, 'PASS');
  assert.deepEqual(snapshot(clean.project.root), cleanBefore);
});

test('输出行不会被多行文本、竖线或控制字符破坏，超长说明被截断', () => {
  const lines = formatBusinessGate({
    status: 'BLOCKED',
    summary: '阻断 1 项\nBUSINESS_GATE=PASS',
    blocks: [{
      code: 'AC_NOT_PROVEN',
      subject: 'AC|X\n注入',
      detail: `第一行\n第二行\r\n\u0007控制字符${'长'.repeat(1000)}`,
    }],
    risks: [{ code: 'RISK_MANUAL_AC', detail: 'a\nb\tc' }],
    nextAction: '重新运行\nBUSINESS_GATE=PASS',
  });

  assert.equal(lines.filter((line) => line.startsWith('BUSINESS_GATE=')).length, 1, lines.join('\n'));
  assert.equal(lines[0], 'BUSINESS_GATE=BLOCKED');
  for (const line of lines) assert.doesNotMatch(line, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u, JSON.stringify(line));

  const block = lines.find((line) => line.startsWith('BUSINESS_BLOCK='));
  const [code, subject, ...rest] = block.slice('BUSINESS_BLOCK='.length).split('|');
  assert.equal(code, 'AC_NOT_PROVEN');
  assert.equal(subject, 'AC/X 注入');
  const detail = rest.join('|');
  assert.ok(Array.from(detail).length <= 400, `detail 长度 ${Array.from(detail).length}`);
  assert.ok(detail.endsWith('…'));
  assert.ok(lines.includes('BUSINESS_RISK=RISK_MANUAL_AC|a b c'), lines.join('\n'));
});

test('入参不合法或内部出错时按阻断处理（GATE_ERROR），不抛出异常', (t) => {
  const s = scenarioFor(t);
  prepare(s);

  const badHead = evaluate(s, { headSha: 'xyz' });
  assert.equal(badHead.status, 'BLOCKED');
  assert.deepEqual(codesOf(badHead.blocks), ['GATE_ERROR']);
  assert.match(badHead.blocks[0].detail, /headSha/u);

  const noConfig = evaluate(s, { config: null });
  assert.deepEqual(codesOf(noConfig.blocks), ['GATE_ERROR']);

  const noOptions = evaluateBusinessGate();
  assert.equal(noOptions.status, 'BLOCKED');
  assert.deepEqual(codesOf(noOptions.blocks), ['GATE_ERROR']);
  assert.match(formatBusinessGate(noOptions).join('\n'), /^BUSINESS_BLOCK=GATE_ERROR\|-\|/mu);
});

// ---------------------------------------------------------------------------
// qa verify 接入：verifyBusinessAcceptance
// ---------------------------------------------------------------------------

const verifyOptions = (s, overrides = {}) => ({
  repoRoot: s.project.repo,
  mainRoot: s.project.repo,
  config: s.config(),
  headSha: s.head(),
  ...overrides,
});

// 沿用场景已加载的配置，只替换 qa.business 的个别字段（如 enabled）。
function withBusiness(s, patch) {
  const config = s.config();
  return { ...config, qa: { ...config.qa, business: { ...config.qa.business, ...patch } } };
}

const SILENT = Object.freeze({ enabled: false, blocked: false, lines: [], outcome: null });

test('qa.business 未启用时接入函数不读规格与结果、不输出任何行', (t) => {
  const absent = path.resolve('business-gate-nonexistent-root');
  const disabledConfigs = [
    {},
    { qa: {} },
    { qa: { business: {} } },
    { qa: { business: { enabled: false } } },
    { qa: { business: { enabled: false, suites: 'not-a-list' } } },
  ];
  for (const config of disabledConfigs) {
    const result = verifyBusinessAcceptance({ repoRoot: absent, mainRoot: absent, config, headSha: 'not-a-sha' });
    assert.deepEqual(result, SILENT, JSON.stringify(config));
  }
  assert.equal(fs.existsSync(absent), false);

  // 结果文件已损坏时，关闭状态仍然什么都不读；同一份数据在启用状态下才被读到并阻断。
  const s = scenarioFor(t);
  prepare(s);
  fs.writeFileSync(s.resultsFile, '损坏的结果文件，未启用时不得被读取');
  const before = snapshot(s.project.root);

  assert.deepEqual(verifyBusinessAcceptance(verifyOptions(s, { config: withBusiness(s, { enabled: false }) })), SILENT);
  assert.deepEqual(snapshot(s.project.root), before);

  const enabled = verifyBusinessAcceptance(verifyOptions(s));
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.blocked, true);
  assert.deepEqual(codesOf(enabled.outcome.blocks), ['RESULTS_INVALID']);
});

test('启用后接入函数在必需 AC 都被证明时放行，返回可直接打印的输出行并披露风险', (t) => {
  const s = scenarioFor(t);
  prepare(s);
  const result = verifyBusinessAcceptance(verifyOptions(s));

  assert.equal(result.enabled, true);
  assert.equal(result.blocked, false, result.lines.join('\n'));
  assert.equal(result.outcome.status, 'PASS');
  assert.deepEqual(result.lines, formatBusinessGate(evaluate(s)));
  assert.equal(result.lines[0], 'BUSINESS_GATE=PASS');
  assert.ok(result.lines.some((line) => /^BUSINESS_RISK=RISK_MANUAL_AC\|.*AC-SHOP-002-01/u.test(line)), result.lines.join('\n'));
});

test('启用后接入函数在 AC 未被证明时阻断，输出行与门禁判定一致', (t) => {
  const s = scenarioFor(t);
  prepare(s, { web: withStatus(WEB_CASES, 'TC-SHOP-002', 'failed') });
  const result = verifyBusinessAcceptance(verifyOptions(s));

  assert.equal(result.enabled, true);
  assert.equal(result.blocked, true);
  assert.equal(result.outcome.status, 'BLOCKED');
  assert.deepEqual(result.lines, formatBusinessGate(evaluate(s)));
  assert.equal(result.lines[0], 'BUSINESS_GATE=BLOCKED');
  assert.ok(result.lines.some((line) => /^BUSINESS_BLOCK=AC_NOT_PROVEN\|AC-SHOP-001-02\|/u.test(line)), result.lines.join('\n'));
  assert.ok(result.lines.some((line) => line.startsWith('BUSINESS_NEXT_ACTION=')), result.lines.join('\n'));
});

test('启用后 HEAD 不符或结果缺失时接入函数阻断，并提示重新运行 qa run', (t) => {
  const s = scenarioFor(t);
  prepare(s);

  const stale = verifyBusinessAcceptance(verifyOptions(s, { headSha: HEAD_FOREIGN }));
  assert.equal(stale.blocked, true);
  assert.deepEqual(codesOf(stale.outcome.blocks), ['RESULTS_STALE_HEAD']);
  assert.match(stale.lines.join('\n'), /^BUSINESS_NEXT_ACTION=.*qa run/mu);

  fs.rmSync(s.resultsDir, { recursive: true, force: true });
  const missing = verifyBusinessAcceptance(verifyOptions(s));
  assert.equal(missing.blocked, true);
  assert.deepEqual(codesOf(missing.outcome.blocks), ['RESULTS_MISSING']);
  assert.match(missing.lines.join('\n'), /^BUSINESS_NEXT_ACTION=.*qa run/mu);
});

test('enabled 不是布尔值时按启用处理并阻断，不会悄悄关闭门禁', (t) => {
  const s = scenarioFor(t);
  prepare(s);

  for (const enabled of ['false', 0, null, 'yes']) {
    const result = verifyBusinessAcceptance(verifyOptions(s, { config: withBusiness(s, { enabled }) }));
    assert.equal(result.enabled, true, JSON.stringify(enabled));
    assert.equal(result.blocked, true, JSON.stringify(enabled));
    const [invalid] = blocksOf(result.outcome, 'CONFIG_INVALID');
    assert.ok(invalid, result.lines.join('\n'));
    assert.equal(invalid.subject, 'qa.business.enabled');
  }
});

test('开关键拼错时（合并默认值后 enabled 仍为 false）按启用处理并阻断，不会悄悄关闭门禁', (t) => {
  const s = scenarioFor(t);
  prepare(s);

  for (const [key, patch] of [['enable', { enable: true }], ['requiredPriority', { requiredPriority: ['P0', 'P1'] }]]) {
    const result = verifyBusinessAcceptance(verifyOptions(s, { config: withBusiness(s, { enabled: false, ...patch }) }));
    assert.equal(result.enabled, true, key);
    assert.equal(result.blocked, true, key);
    const [invalid] = blocksOf(result.outcome, 'CONFIG_INVALID');
    assert.ok(invalid, result.lines.join('\n'));
    assert.equal(invalid.subject, `qa.business.${key}`);
  }
});

test('入参不合法或读取配置出错时接入函数按阻断处理（GATE_ERROR），不抛出异常', () => {
  const gateError = (result) => {
    assert.equal(result.enabled, true);
    assert.equal(result.blocked, true);
    assert.deepEqual(codesOf(result.outcome.blocks), ['GATE_ERROR']);
    assert.equal(result.lines[0], 'BUSINESS_GATE=BLOCKED');
    assert.match(result.lines.join('\n'), /^BUSINESS_BLOCK=GATE_ERROR\|-\|/mu);
    assert.match(result.lines.join('\n'), /^BUSINESS_NEXT_ACTION=\S/mu);
    return result;
  };
  const absent = path.resolve('business-gate-nonexistent-root');

  gateError(verifyBusinessAcceptance());
  gateError(verifyBusinessAcceptance(null));
  gateError(verifyBusinessAcceptance({ repoRoot: absent, headSha: HEAD_FOREIGN }));
  gateError(verifyBusinessAcceptance({ repoRoot: absent, config: null, headSha: HEAD_FOREIGN }));
  gateError(verifyBusinessAcceptance({ repoRoot: absent, config: 'qa.business', headSha: HEAD_FOREIGN }));
  gateError(verifyBusinessAcceptance({ repoRoot: absent, config: [], headSha: HEAD_FOREIGN }));

  const unreadable = { get qa() { throw new Error('配置读取失败'); } };
  const result = gateError(verifyBusinessAcceptance({ repoRoot: absent, config: unreadable, headSha: HEAD_FOREIGN }));
  assert.match(result.outcome.blocks[0].detail, /配置读取失败/u);
  assert.equal(fs.existsSync(absent), false);
});

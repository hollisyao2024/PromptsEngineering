'use strict';

// AC 验收判定（judgeAc）及其与聚合输出的配合。
// 全部为纯数据或容器 tmp 下的临时目录测试，不启动任何套件。

const assert = require('node:assert/strict');
const test = require('node:test');

const { aggregateResults, judgeAc } = require('../business-results');
const { prdDocument } = require('./fixtures/business-testing/builders');
const { kase, web, withShop, withSpec } = require('./business-results.helpers');

// ---------------------------------------------------------------------------
// AC 验收判定：qa run 的 AC_OPEN 与 qa verify 门禁共用
// ---------------------------------------------------------------------------

const acRecord = (overrides = {}) => ({
  priority: 'P0',
  verification: 'auto',
  platforms: [],
  status: 'passed',
  by_platform: {},
  tcs: ['TC-SHOP-001'],
  ...overrides,
});

test('judgeAc 对未限定端的 AC 按整体状态裁决：passed 通过，failed、skipped、missing 不通过', () => {
  assert.deepEqual(judgeAc(acRecord({ status: 'passed' })), { proven: true, state: 'passed', reason: null });
  assert.deepEqual(judgeAc(acRecord({ status: 'failed' })), { proven: false, state: 'failed', reason: '存在失败用例' });
  assert.deepEqual(judgeAc(acRecord({ status: 'skipped' })), { proven: false, state: 'skipped', reason: '用例全部被跳过' });
  assert.deepEqual(judgeAc(acRecord({ status: 'missing' })), { proven: false, state: 'missing', reason: '没有任何用例覆盖' });
});

test('judgeAc 对缺失或畸形的记录一律判为不通过而不抛出', () => {
  for (const value of [undefined, null, 1, 'x', []]) {
    const verdict = judgeAc(value);
    assert.equal(verdict.proven, false);
    assert.equal(verdict.state, 'missing');
    assert.match(verdict.reason, /\S/u);
  }
  assert.equal(judgeAc(acRecord({ status: 'unknown' })).proven, false, '无法识别的状态不得被当作通过');
});

test('judgeAc 要求每个声明的端都通过', () => {
  const declared = { platforms: ['ios', 'web'] };
  assert.deepEqual(
    judgeAc(acRecord({ ...declared, by_platform: { ios: 'passed', web: 'passed' } })),
    { proven: true, state: 'passed', reason: null },
  );

  const missing = judgeAc(acRecord({ ...declared, by_platform: { web: 'passed' } }));
  assert.equal(missing.proven, false);
  assert.equal(missing.state, 'missing');
  assert.match(missing.reason, /ios: missing/u);
  assert.doesNotMatch(missing.reason, /web/u, '已通过的端不列入原因');

  const skipped = judgeAc(acRecord({ ...declared, by_platform: { ios: 'skipped', web: 'passed' } }));
  assert.equal(skipped.proven, false);
  assert.equal(skipped.state, 'skipped');
  assert.match(skipped.reason, /ios: skipped/u);
});

test('judgeAc 多个端不通过时逐端列出，任一端缺失则整体为 missing', () => {
  const verdict = judgeAc(acRecord({ platforms: ['android', 'ios', 'web'], by_platform: { android: 'skipped', web: 'passed' } }));
  assert.equal(verdict.proven, false);
  assert.equal(verdict.state, 'missing');
  assert.match(verdict.reason, /android: skipped/u);
  assert.match(verdict.reason, /ios: missing/u);
});

test('judgeAc 任一端失败即不通过，包括声明范围之外的端', () => {
  const declared = judgeAc(acRecord({ platforms: ['ios', 'web'], status: 'failed', by_platform: { ios: 'failed', web: 'passed' } }));
  assert.deepEqual(declared, { proven: false, state: 'failed', reason: '存在失败用例' });

  const outside = judgeAc(acRecord({ platforms: ['web'], status: 'failed', by_platform: { android: 'failed', web: 'passed' } }));
  assert.deepEqual(outside, { proven: false, state: 'failed', reason: '存在失败用例' });

  const inconsistent = judgeAc(acRecord({ platforms: ['web'], status: 'passed', by_platform: { android: 'failed', web: 'passed' } }));
  assert.equal(inconsistent.proven, false, '整体状态与分端状态不一致时以失败为准');
  assert.equal(inconsistent.state, 'failed');
});

test('judgeAc 声明范围之外的端被跳过或缺失不影响判定', () => {
  const verdict = judgeAc(acRecord({ platforms: ['web'], by_platform: { android: 'skipped', web: 'passed' } }));
  assert.deepEqual(verdict, { proven: true, state: 'passed', reason: null });
});

test('judgeAc 与 aggregateResults 的真实输出配合：端为 - 的套件不能代替声明的端', () => withShop(({ spec }) => {
  const anyPlatform = aggregateResults({
    spec,
    suites: [{ name: 'any', platform: '-', cases: [kase('TC-SHOP-001 a'), kase('TC-SHOP-002 b')] }],
  });
  assert.equal(judgeAc(anyPlatform.acs['AC-SHOP-001-01']).proven, false, '声明了 web 端的 AC 不能由未标端的套件证明');
  assert.equal(judgeAc(anyPlatform.acs['AC-SHOP-001-02']).proven, false);

  const both = aggregateResults({
    spec,
    suites: [web([kase('TC-SHOP-001 a'), kase('TC-SHOP-002 b')]), { name: 'ios-e2e', platform: 'ios', cases: [kase('TC-SHOP-002 b')] }],
  });
  assert.equal(judgeAc(both.acs['AC-SHOP-001-01']).proven, true);
  assert.equal(judgeAc(both.acs['AC-SHOP-001-02']).proven, true);
  assert.equal(judgeAc(both.acs['AC-SHOP-001-03']).proven, false, '没有任何用例覆盖');
  assert.equal(judgeAc(both.acs['AC-SHOP-001-03']).state, 'missing');
}));

// A case that names its AC explicitly is bound to that AC only. Expanding its TC to every AC listing the TC made a
// failing "AC-X / TC-1" case fail sibling ACs that merely reuse TC-1 (business-test trial defect D).
test('用例显式标注 AC 时只绑定该 AC，TC 仍计数，不扩散到共用同一 TC 的其他 AC', () => withSpec({
  'docs/prd-modules/shop/PRD.md': prdDocument([
    { id: 'AC-SHOP-001-01', tc: 'TC-SHOP-001' },
    { id: 'AC-SHOP-001-02', tc: 'TC-SHOP-001, TC-SHOP-002' },
  ]),
}, ({ spec }) => {
  const aggregate = aggregateResults({ spec, suites: [web([kase('AC-SHOP-001-01 / TC-SHOP-001 结算', 'failed')])] });
  assert.equal(aggregate.acs['AC-SHOP-001-01'].status, 'failed');
  assert.equal(aggregate.acs['AC-SHOP-001-02'].status, 'missing');
  assert.deepEqual(aggregate.tcs['TC-SHOP-001'].cases, { total: 1, passed: 0, failed: 1, error: 0, skipped: 0 });
  assert.deepEqual(aggregate.unknown_ids, []);

  const tcOnly = aggregateResults({ spec, suites: [web([kase('TC-SHOP-001 shared', 'failed')])] });
  assert.equal(tcOnly.acs['AC-SHOP-001-01'].status, 'failed');
  assert.equal(tcOnly.acs['AC-SHOP-001-02'].status, 'failed');
}));

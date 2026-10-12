'use strict';

// AC/TC 绑定与按端聚合。
// 全部为纯数据或容器 tmp 下的临时目录测试，不启动任何套件。

const assert = require('node:assert/strict');
const test = require('node:test');

const { aggregateResults } = require('../business-results');
const { prdDocument } = require('./fixtures/business-testing/builders');
const { kase, web, withShop, withSpec } = require('./business-results.helpers');

// ---------------------------------------------------------------------------
// 聚合：AC/TC 绑定
// ---------------------------------------------------------------------------

test('经 TC 标识把通过的用例绑定到 AC 与路径', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({
    spec,
    suites: [web([
      kase('TC-SHOP-001 结算进入支付页'),
      kase('TC-SHOP-002 有效卡号支付成功'),
      kase('TC-SHOP-003 拒绝卡号提示失败'),
    ])],
  });
  assert.deepEqual(Object.keys(aggregate.tcs), ['TC-SHOP-001', 'TC-SHOP-002', 'TC-SHOP-003']);
  for (const id of Object.keys(aggregate.tcs)) assert.equal(aggregate.tcs[id].status, 'passed', id);
  assert.deepEqual(aggregate.tcs['TC-SHOP-001'].cases, { total: 1, passed: 1, failed: 0, error: 0, skipped: 0 });
  assert.equal(aggregate.acs['AC-SHOP-001-01'].status, 'passed');
  assert.equal(aggregate.acs['AC-SHOP-001-02'].status, 'passed');
  assert.equal(aggregate.acs['AC-SHOP-001-03'].status, 'passed');
  assert.equal(aggregate.acs['AC-SHOP-002-01'].status, 'missing');
  assert.deepEqual(aggregate.paths['PTH-SHOP-001'], { status: 'passed', tcs: ['TC-SHOP-001', 'TC-SHOP-002'] });
  assert.deepEqual(aggregate.paths['PTH-SHOP-002'], { status: 'passed', tcs: ['TC-SHOP-003'] });
  assert.deepEqual(aggregate.unknown_ids, []);
}));

test('AC 记录携带优先级、验证方式、声明的端与关联 TC', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({ spec, suites: [web([kase('TC-SHOP-002 pay')])] });
  assert.deepEqual(aggregate.acs['AC-SHOP-001-02'], {
    priority: 'P0',
    verification: 'auto',
    platforms: ['ios', 'web'],
    status: 'passed',
    by_platform: { ios: 'missing', web: 'passed' },
    tcs: ['TC-SHOP-002'],
  });
  assert.deepEqual(aggregate.acs['AC-SHOP-002-01'], {
    priority: 'P0',
    verification: 'manual',
    platforms: [],
    status: 'missing',
    by_platform: {},
    tcs: [],
  });
}));

test('用例名直接含 AC 标识时绑定到该 AC，不影响 TC 状态', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({ spec, suites: [web([kase('AC-SHOP-001-01 点击结算')])] });
  assert.equal(aggregate.acs['AC-SHOP-001-01'].status, 'passed');
  assert.equal(aggregate.tcs['TC-SHOP-001'].status, 'missing');
  assert.equal(aggregate.paths['PTH-SHOP-001'].status, 'missing');
}));

test('classname 中的标识同样参与绑定', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({ spec, suites: [web([kase('支付成功', 'passed', 'TC-SHOP-002')])] });
  assert.equal(aggregate.tcs['TC-SHOP-002'].status, 'passed');
  assert.equal(aggregate.acs['AC-SHOP-001-02'].status, 'passed');
}));

test('同一用例同时含 AC 与其 TC 标识时，对该 AC 只计一个用例', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({ spec, suites: [web([kase('AC-SHOP-001-01 / TC-SHOP-001 结算')])] });
  assert.equal(aggregate.summary.cases.total, 1);
  assert.deepEqual(aggregate.tcs['TC-SHOP-001'].cases, { total: 1, passed: 1, failed: 0, error: 0, skipped: 0 });
  assert.equal(aggregate.acs['AC-SHOP-001-01'].status, 'passed');
}));

test('一个 TC 被多条 AC 列出时，其用例绑定到列出它的全部 AC', () => withSpec({
  'docs/prd-modules/shop/PRD.md': prdDocument([
    { id: 'AC-SHOP-001-01', tc: 'TC-SHOP-001' },
    { id: 'AC-SHOP-001-02', tc: 'TC-SHOP-001, TC-SHOP-002' },
  ]),
}, ({ spec }) => {
  const failed = aggregateResults({ spec, suites: [web([kase('TC-SHOP-001 shared', 'failed')])] });
  assert.equal(failed.acs['AC-SHOP-001-01'].status, 'failed');
  assert.equal(failed.acs['AC-SHOP-001-02'].status, 'failed');

  const passed = aggregateResults({ spec, suites: [web([kase('TC-SHOP-001 shared')])] });
  assert.equal(passed.acs['AC-SHOP-001-01'].status, 'passed');
  assert.equal(passed.acs['AC-SHOP-001-02'].status, 'passed');
  assert.equal(passed.tcs['TC-SHOP-002'].status, 'missing');
}));

test('端与 TC 列表按规范顺序输出，与表格里的书写顺序无关', () => {
  const resultsFor = (platform, tc) => withSpec({
    'docs/prd-modules/shop/PRD.md': prdDocument([{ id: 'AC-SHOP-001-01', platform, tc }]),
  }, ({ spec }) => aggregateResults({ spec, suites: [web([kase('TC-SHOP-001 a')])] }));
  const left = resultsFor('web,ios', 'TC-SHOP-002, TC-SHOP-001');
  const right = resultsFor('ios, web', 'TC-SHOP-001, TC-SHOP-002');
  assert.deepEqual(left.acs['AC-SHOP-001-01'].platforms, ['ios', 'web']);
  assert.deepEqual(left.acs['AC-SHOP-001-01'].tcs, ['TC-SHOP-001', 'TC-SHOP-002']);
  assert.equal(JSON.stringify(left), JSON.stringify(right));
});

test('失败、错误用例使 TC、AC 与路径变为 failed', () => withShop(({ spec }) => {
  const failed = aggregateResults({ spec, suites: [web([kase('TC-SHOP-001 a', 'failed'), kase('TC-SHOP-002 b')])] });
  assert.equal(failed.tcs['TC-SHOP-001'].status, 'failed');
  assert.equal(failed.acs['AC-SHOP-001-01'].status, 'failed');
  assert.equal(failed.paths['PTH-SHOP-001'].status, 'failed');
  assert.equal(failed.acs['AC-SHOP-001-02'].status, 'passed');

  const errored = aggregateResults({ spec, suites: [web([kase('TC-SHOP-001 a', 'error')])] });
  assert.equal(errored.tcs['TC-SHOP-001'].status, 'failed');
  assert.deepEqual(errored.tcs['TC-SHOP-001'].cases, { total: 1, passed: 0, failed: 0, error: 1, skipped: 0 });
  assert.equal(errored.acs['AC-SHOP-001-01'].status, 'failed');
}));

test('全部跳过为 skipped，路径不算通过', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({ spec, suites: [web([kase('TC-SHOP-001 a', 'skipped'), kase('TC-SHOP-002 b')])] });
  assert.equal(aggregate.tcs['TC-SHOP-001'].status, 'skipped');
  assert.equal(aggregate.acs['AC-SHOP-001-01'].status, 'skipped');
  assert.equal(aggregate.paths['PTH-SHOP-001'].status, 'missing');
}));

test('数据驱动的多行用例任一失败即整体失败，跳过加通过为通过', () => withShop(({ spec }) => {
  const rows = (statuses) => aggregateResults({
    spec,
    suites: [web(statuses.map((status, index) => kase(`TC-SHOP-002 card #${index}`, status)))],
  });
  assert.equal(rows(['passed', 'passed', 'failed']).tcs['TC-SHOP-002'].status, 'failed');
  assert.equal(rows(['passed', 'skipped']).tcs['TC-SHOP-002'].status, 'passed');
  assert.equal(rows(['skipped', 'skipped']).tcs['TC-SHOP-002'].status, 'skipped');
  assert.deepEqual(rows(['passed', 'skipped', 'failed', 'error']).tcs['TC-SHOP-002'].cases, { total: 4, passed: 1, failed: 1, error: 1, skipped: 1 });
}));

test('路径状态：任一 TC 失败即失败，全部通过才通过，否则缺失', () => withShop(({ spec }) => {
  const status = (cases) => aggregateResults({ spec, suites: [web(cases)] }).paths['PTH-SHOP-001'].status;
  assert.equal(status([kase('TC-SHOP-001 a'), kase('TC-SHOP-002 b')]), 'passed');
  assert.equal(status([kase('TC-SHOP-001 a'), kase('TC-SHOP-002 b', 'failed')]), 'failed');
  assert.equal(status([kase('TC-SHOP-001 a')]), 'missing');
  assert.equal(status([kase('TC-SHOP-001 a'), kase('TC-SHOP-002 b', 'skipped')]), 'missing');
  assert.equal(status([kase('TC-SHOP-001 a', 'failed')]), 'failed');
  assert.equal(status([]), 'missing');
}));

test('不含任何标识的用例单独计数，不参与绑定也不算未知标识', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({
    spec,
    suites: [web([kase('登录页冒烟', 'failed'), kase('无标识用例'), kase('TC-SHOP-001 a')])],
  });
  assert.deepEqual(aggregate.suites, [{ name: 'web-e2e', cases: 3, unlabelled: 2 }]);
  assert.equal(aggregate.summary.unlabelled, 2);
  assert.equal(aggregate.summary.cases.total, 3);
  assert.equal(aggregate.summary.cases.failed, 1);
  assert.equal(aggregate.acs['AC-SHOP-001-01'].status, 'passed');
  assert.deepEqual(aggregate.unknown_ids, []);
}));

test('规格中不存在的标识记入 unknown_ids（去重、排序），已知标识仍然绑定', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({
    spec,
    suites: [web([
      kase('TC-SHOP-001 a / AC-SHOP-009-01'),
      kase('TC-SHOP-099 ghost'),
      kase('TC-SHOP-099 ghost again / AC-SHOP-009-01'),
      kase('AC-ZZZ-001-01 other module'),
    ])],
  });
  assert.deepEqual(aggregate.unknown_ids, ['AC-SHOP-009-01', 'AC-ZZZ-001-01', 'TC-SHOP-099']);
  assert.equal(aggregate.acs['AC-SHOP-001-01'].status, 'passed');
  assert.equal(aggregate.summary.unlabelled, 0);
}));

test('硬失败的套件（cases 为 null）不参与绑定，但计入套件数', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({
    spec,
    suites: [web([kase('TC-SHOP-001 a')]), { name: 'ios-e2e', platform: 'ios', cases: null }],
  });
  assert.deepEqual(aggregate.suites, [
    { name: 'web-e2e', cases: 1, unlabelled: 0 },
    { name: 'ios-e2e', cases: 0, unlabelled: 0 },
  ]);
  assert.equal(aggregate.summary.suites, 2);
  assert.equal(aggregate.summary.cases.total, 1);
}));

test('summary 含套件数、用例各状态数、无标识数、AC 各状态数与人工自动数、路径数', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({
    spec,
    suites: [web([
      kase('TC-SHOP-001 a'),
      kase('TC-SHOP-002 b', 'failed'),
      kase('TC-SHOP-003 c', 'skipped'),
      kase('随手写的用例', 'error'),
    ])],
  });
  assert.deepEqual(aggregate.summary, {
    suites: 1,
    cases: { total: 4, passed: 1, failed: 1, error: 1, skipped: 1 },
    unlabelled: 1,
    acs: { total: 4, passed: 1, failed: 1, skipped: 1, missing: 1, auto: 3, manual: 1 },
    paths: { total: 2, passed: 0 },
  });
}));

test('同样的用例以不同顺序输入，聚合结果逐字节一致', () => withShop(({ spec }) => {
  const cases = [kase('TC-SHOP-002 b'), kase('AC-SHOP-001-01 a', 'failed'), kase('TC-SHOP-003 c', 'skipped'), kase('TC-SHOP-404 ghost'), kase('无标识')];
  const forward = aggregateResults({ spec, suites: [web(cases)] });
  const reverse = aggregateResults({ spec, suites: [web([...cases].reverse())] });
  assert.equal(JSON.stringify(reverse), JSON.stringify(forward));
  assert.deepEqual(Object.keys(forward.acs), [...Object.keys(forward.acs)].sort());
  assert.deepEqual(Object.keys(forward.tcs), [...Object.keys(forward.tcs)].sort());
}));

// ---------------------------------------------------------------------------
// 按端聚合
// ---------------------------------------------------------------------------

test('多端 AC 的状态按端分别记录，总体失败优先', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({
    spec,
    suites: [
      web([kase('TC-SHOP-002 pay')], 'web-e2e'),
      { name: 'ios-e2e', platform: 'ios', cases: [kase('TC-SHOP-002 pay', 'failed')] },
    ],
  });
  assert.equal(aggregate.acs['AC-SHOP-001-02'].status, 'failed');
  assert.deepEqual(aggregate.acs['AC-SHOP-001-02'].by_platform, { ios: 'failed', web: 'passed' });
}));

test('声明了的端没有提供套件时记为 missing', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({ spec, suites: [web([kase('TC-SHOP-002 pay')])] });
  assert.equal(aggregate.acs['AC-SHOP-001-02'].status, 'passed');
  assert.deepEqual(aggregate.acs['AC-SHOP-001-02'].by_platform, { ios: 'missing', web: 'passed' });
}));

test('端为 - 的套件只计入总体，不产生端记录', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({
    spec,
    suites: [{ name: 'any', platform: '-', cases: [kase('TC-SHOP-001 a'), kase('TC-SHOP-002 b')] }],
  });
  assert.equal(aggregate.acs['AC-SHOP-001-01'].status, 'passed');
  assert.deepEqual(aggregate.acs['AC-SHOP-001-01'].by_platform, { web: 'missing' });
  assert.equal(aggregate.acs['AC-SHOP-001-03'].status, 'missing');
  assert.deepEqual(aggregate.acs['AC-SHOP-001-03'].by_platform, {});
}));

test('AC 未限定端（-）时，运行用例的各端都如实记录', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({
    spec,
    suites: [
      web([kase('TC-SHOP-003 reject')]),
      { name: 'android-e2e', platform: 'android', cases: [kase('TC-SHOP-003 reject', 'skipped')] },
    ],
  });
  assert.equal(aggregate.acs['AC-SHOP-001-03'].status, 'passed');
  assert.deepEqual(aggregate.acs['AC-SHOP-001-03'].by_platform, { android: 'skipped', web: 'passed' });
}));

test('声明范围之外的端失败同样使总体失败', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({
    spec,
    suites: [web([kase('TC-SHOP-001 a')]), { name: 'android-e2e', platform: 'android', cases: [kase('TC-SHOP-001 a', 'failed')] }],
  });
  assert.equal(aggregate.acs['AC-SHOP-001-01'].status, 'failed');
  assert.deepEqual(aggregate.acs['AC-SHOP-001-01'].by_platform, { android: 'failed', web: 'passed' });
}));

test('同一端的多个套件合并计算该端状态', () => withShop(({ spec }) => {
  const aggregate = aggregateResults({
    spec,
    suites: [
      web([kase('TC-SHOP-001 a')], 'web-smoke'),
      web([kase('TC-SHOP-001 a', 'failed')], 'web-regression'),
    ],
  });
  assert.equal(aggregate.acs['AC-SHOP-001-01'].by_platform.web, 'failed');
}));


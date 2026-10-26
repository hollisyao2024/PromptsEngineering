'use strict';

// qa run --repeat（G6）：同一 HEAD 上把全部套件运行 N 轮，逐用例比较结果。
// 必需优先级的自动化 AC 绑定的用例在各轮之间不一致即 FAILED(FLAKY)；其余不一致只给 WARNING。
// 套件均为桩：emit.js 每轮产出相同报告，alternate.js 按启动次数轮换变体。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveBusinessConfig } = require('../business-config');
const { IOS_CASES, WEB_CASES, createScenario, withStatus } = require('./fixtures/business-testing/scenario');

const fieldOf = (stdout, key) => {
  const line = stdout.split('\n').find((item) => item.startsWith(`${key}=`));
  return line === undefined ? undefined : line.slice(key.length + 1);
};
const fieldsOf = (stdout, key) => stdout.split('\n').filter((item) => item.startsWith(`${key}=`)).map((item) => item.slice(key.length + 1));

function scenarioFor(t) {
  const scenario = createScenario();
  t.after(() => scenario.cleanup());
  return scenario;
}

// web 套件按 variants 轮换，ios 套件每轮相同。
function configureAlternating(s, variants, business = {}) {
  s.configure([
    s.alternating('web', { platform: 'web', variants }),
    s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
  ], business);
}

function configureStable(s, business = {}) {
  s.configure([
    s.suite('web', { platform: 'web', cases: WEB_CASES }),
    s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
  ], business);
}

function launches(s, label) {
  return s.markers().filter((marker) => marker.label === label).length;
}

test('--repeat 2 且两轮一致：OK，输出 REPEAT_RUNS/FLAKY/FLAKY_RATE，并保留第 2 轮报告副本', (t) => {
  const s = scenarioFor(t);
  configureStable(s);
  const result = s.run({ args: ['--repeat', '2'] });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fieldOf(result.stdout, 'STATUS'), 'OK', result.stdout);
  assert.equal(fieldOf(result.stdout, 'REPEAT_RUNS'), '2', result.stdout);
  assert.equal(fieldOf(result.stdout, 'FLAKY'), '0', result.stdout);
  assert.equal(fieldOf(result.stdout, 'FLAKY_RATE'), '0.0000', result.stdout);
  assert.deepEqual(fieldsOf(result.stdout, 'FLAKY_CASE'), []);
  assert.equal(launches(s, 'web'), 2, '每个套件应运行 2 轮');
  assert.equal(launches(s, 'ios'), 2, '每个套件应运行 2 轮');

  const read = s.results();
  assert.equal(read.ok, true, read.message);
  assert.equal(read.results.repeat.runs, 2);
  assert.deepEqual(read.results.repeat.flaky, []);
  assert.deepEqual(read.results.repeat.unstable_suites, []);
  assert.deepEqual(read.results.repeat.summary, { runs: 2, cases: 4, flaky: 0, required_flaky: 0, rate: 0 });
  assert.equal(read.results.repeat.rounds.length, 1, '只记录第 2 轮起的轮次');
  assert.equal(read.results.repeat.rounds[0].run, 2);
  assert.ok(fs.existsSync(s.copyFile('web', 2)), '应保留 web 第 2 轮报告副本');
  assert.ok(fs.existsSync(s.copyFile('ios', 2)), '应保留 ios 第 2 轮报告副本');
});

test('未指定 --repeat 时只运行 1 轮，结果仍记录 repeat.runs=1，且不留多余副本', (t) => {
  const s = scenarioFor(t);
  configureStable(s);
  const first = s.run({ args: ['--repeat', '2'] });
  assert.equal(first.status, 0, first.stdout + first.stderr);

  const result = s.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fieldOf(result.stdout, 'REPEAT_RUNS'), '1', result.stdout);
  assert.equal(fieldOf(result.stdout, 'FLAKY'), '0', result.stdout);
  const read = s.results();
  assert.equal(read.results.repeat.runs, 1);
  assert.deepEqual(read.results.repeat.rounds, []);
  assert.equal(fs.existsSync(s.copyFile('web', 2)), false, '上一次运行留下的第 2 轮副本应被清除');
});

test('qa.business.repeat 设置默认轮数，--repeat 可覆盖', (t) => {
  const s = scenarioFor(t);
  configureStable(s, { repeat: 3 });
  const configured = s.run();
  assert.equal(configured.status, 0, configured.stdout + configured.stderr);
  assert.equal(fieldOf(configured.stdout, 'REPEAT_RUNS'), '3', configured.stdout);
  assert.equal(launches(s, 'web'), 3);

  const overridden = s.run({ args: ['--repeat=1'] });
  assert.equal(overridden.status, 0, overridden.stdout + overridden.stderr);
  assert.equal(fieldOf(overridden.stdout, 'REPEAT_RUNS'), '1', overridden.stdout);
  assert.equal(launches(s, 'web'), 4);
});

test('P0 用例两轮结果不一致：FAILED(FLAKY)，列出 FLAKY_CASE，第 1 轮仍作为主结果', (t) => {
  const s = scenarioFor(t);
  configureAlternating(s, [
    { cases: WEB_CASES },
    { cases: withStatus(WEB_CASES, 'TC-SHOP-002', 'failed') },
  ]);
  const result = s.run({ args: ['--repeat', '2'] });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(fieldOf(result.stdout, 'STATUS'), 'FAILED', result.stdout);
  assert.equal(fieldOf(result.stdout, 'REASON'), 'FLAKY', result.stdout);
  assert.match(fieldOf(result.stdout, 'NEXT_ACTION'), /\S/u);
  assert.equal(fieldOf(result.stdout, 'FLAKY'), '1', result.stdout);
  assert.equal(fieldOf(result.stdout, 'FLAKY_RATE'), '0.2500', result.stdout);
  assert.deepEqual(fieldsOf(result.stdout, 'FLAKY_CASE'), ['web|P0|passed,failed|AC-SHOP-001-02 / TC-SHOP-002 web 支付成功']);

  const read = s.results();
  assert.equal(read.ok, true, read.message);
  assert.equal(read.results.acs['AC-SHOP-001-02'].status, 'passed', '主结果取第 1 轮');
  assert.equal(read.results.repeat.summary.required_flaky, 1);
  assert.deepEqual(read.results.repeat.flaky.map((item) => [item.suite, item.required, item.statuses]), [['web', true, ['passed', 'failed']]]);
});

test('第 1 轮失败、第 2 轮通过同样判为 FLAKY（优先于 AC_NOT_PROVEN）', (t) => {
  const s = scenarioFor(t);
  configureAlternating(s, [
    { cases: withStatus(WEB_CASES, 'TC-SHOP-001', 'failed') },
    { cases: WEB_CASES },
  ]);
  const result = s.run({ args: ['--repeat', '2'] });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(fieldOf(result.stdout, 'REASON'), 'FLAKY', result.stdout);
  assert.deepEqual(fieldsOf(result.stdout, 'FLAKY_CASE'), ['web|P0|failed,passed|AC-SHOP-001-01 / TC-SHOP-001 结算进入支付页']);
});

test('某轮缺少用例记为 missing，同样判为 FLAKY', (t) => {
  const s = scenarioFor(t);
  configureAlternating(s, [
    { cases: WEB_CASES },
    { cases: WEB_CASES.filter((item) => !item.name.includes('TC-SHOP-001')) },
  ]);
  const result = s.run({ args: ['--repeat', '2'] });

  assert.equal(fieldOf(result.stdout, 'REASON'), 'FLAKY', result.stdout);
  assert.deepEqual(fieldsOf(result.stdout, 'FLAKY_CASE'), ['web|P0|passed,missing|AC-SHOP-001-01 / TC-SHOP-001 结算进入支付页']);
});

test('套件状态在各轮之间不一致（第 2 轮未产出报告）：FAILED(FLAKY) 并列出 FLAKY_SUITE', (t) => {
  const s = scenarioFor(t);
  configureAlternating(s, [{ cases: WEB_CASES }, { code: 1 }]);
  const result = s.run({ args: ['--repeat', '2'] });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(fieldOf(result.stdout, 'REASON'), 'FLAKY', result.stdout);
  const suites = fieldsOf(result.stdout, 'FLAKY_SUITE');
  assert.equal(suites.length, 1, result.stdout);
  assert.match(suites[0], /^web\|ok,\S+$/u);
  assert.notEqual(suites[0], 'web|ok,ok');
  assert.equal(s.results().results.repeat.unstable_suites.length, 1);
});

test('非必需优先级用例不一致只给 WARNING，STATUS 仍为 OK', (t) => {
  const s = scenarioFor(t);
  configureAlternating(s, [
    { cases: WEB_CASES },
    { cases: withStatus(WEB_CASES, 'TC-SHOP-003', 'failed') },
  ]);
  const result = s.run({ args: ['--repeat', '2'] });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fieldOf(result.stdout, 'STATUS'), 'OK', result.stdout);
  assert.equal(fieldOf(result.stdout, 'FLAKY'), '1', result.stdout);
  assert.deepEqual(fieldsOf(result.stdout, 'FLAKY_CASE'), ['web|-|passed,failed|AC-SHOP-001-03 / TC-SHOP-003 银行拒绝后可重试']);
  assert.ok(fieldsOf(result.stdout, 'WARNING').some((line) => /不稳定|FLAKY/u.test(line)), result.stdout);
  assert.equal(s.results().results.repeat.summary.required_flaky, 0);
});

for (const value of ['0', '21', 'abc', '1.5', '']) {
  test(`--repeat ${JSON.stringify(value)} 非法：BLOCKED(ARGS_INVALID)，不启动任何套件`, (t) => {
    const s = scenarioFor(t);
    configureStable(s);
    const result = s.run({ args: ['--repeat', value] });

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(fieldOf(result.stdout, 'STATUS'), 'BLOCKED', result.stdout);
    assert.equal(fieldOf(result.stdout, 'REASON'), 'ARGS_INVALID', result.stdout);
    assert.deepEqual(s.markers(), []);
    assert.equal(fs.existsSync(s.resultsFile), false);
  });
}

test('--repeat 缺少取值或出现未知参数：BLOCKED(ARGS_INVALID)', (t) => {
  const s = scenarioFor(t);
  configureStable(s);
  for (const args of [['--repeat'], ['--repeats', '2'], ['extra']]) {
    const result = s.run({ args });
    assert.equal(fieldOf(result.stdout, 'REASON'), 'ARGS_INVALID', `${args.join(' ')}\n${result.stdout}`);
  }
  assert.deepEqual(s.markers(), []);
});

for (const value of [0, 21, 1.5, '2', null]) {
  test(`qa.business.repeat=${JSON.stringify(value)} 非法：BLOCKED(CONFIG_INVALID)`, (t) => {
    const s = scenarioFor(t);
    configureStable(s, { repeat: value });
    const result = s.run();

    assert.equal(fieldOf(result.stdout, 'STATUS'), 'BLOCKED', result.stdout);
    assert.equal(fieldOf(result.stdout, 'REASON'), 'CONFIG_INVALID', result.stdout);
    assert.ok(fieldsOf(result.stdout, 'CONFIG_ERROR').some((line) => line.includes('qa.business.repeat')), result.stdout);
    assert.deepEqual(s.markers(), []);
  });
}

test('resolveBusinessConfig：repeat 缺省为 1，合法值原样返回，且不进入配置摘要', () => {
  const suites = [{ name: 'web', platform: 'web', command: 'node a.js', report: 'reports/web.xml' }];
  const plain = resolveBusinessConfig({ qa: { business: { enabled: true, suites } } });
  const repeated = resolveBusinessConfig({ qa: { business: { enabled: true, repeat: 5, suites } } });

  assert.equal(plain.ok, true, JSON.stringify(plain.errors));
  assert.equal(plain.repeat, 1);
  assert.equal(repeated.repeat, 5);
  assert.equal(repeated.digest, plain.digest, '轮数不影响结果绑定的配置摘要');

  const invalid = resolveBusinessConfig({ qa: { business: { enabled: true, repeat: 0, suites } } });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.repeat, 1);
  assert.ok(invalid.errors.some((error) => String(error.field || error).includes('qa.business.repeat')), JSON.stringify(invalid.errors));
});

test('结果中 repeat 段被删除的旧结果仍可读取（向后兼容）', (t) => {
  const s = scenarioFor(t);
  configureStable(s);
  assert.equal(s.run().status, 0);
  s.editResults((results) => { delete results.repeat; });
  const read = s.results();
  assert.equal(read.ok, true, read.message);
  assert.equal(path.basename(read.file), 'ac-results.json');
});

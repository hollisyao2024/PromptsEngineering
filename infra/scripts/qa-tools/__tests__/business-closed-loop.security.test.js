'use strict';

// 业务测试闭环：安全负例（报告路径逃逸、XML 实体、命令注入样式文本、环境变量值）。
// 整条链路当作黑盒：真实的 qa run 写结果，真实的 qa verify 读结果并判定；整体说明见 business-closed-loop.test.js 文件头。
// 共享 helper 见 business-closed-loop.helpers.js。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { analyzeSpec } = require('../qa-paths');
const {
  SHOP_ACS,
  commitAll,
  pathsDocument,
  prdDocument,
  shopPaths,
} = require('./fixtures/business-testing/builders');
const { IOS_CASES, WEB_CASES } = require('./fixtures/business-testing/scenario');
const { runVerify } = require('./fixtures/business-testing/verify');
const {
  PRD_FILE,
  PATHS_FILE,
  output,
  scenarioFor,
  readyWith,
  filesUnder,
  assertRed,
  assertGreen,
} = require('./business-closed-loop.helpers');

// ---------------------------------------------------------------------------
// 4. 安全负例：报告路径逃逸、XML 实体、命令注入样式文本、环境变量值
// ---------------------------------------------------------------------------

test('安全——报告路径越出仓库根或指向 .git 时 qa run 在启动任何套件前阻断，也不会在别处写文件', (t) => {
  const s = scenarioFor(t);
  const marker = path.join(s.aux, 'markers.log');
  const outside = path.join(s.aux, 'outside.xml');
  const hook = path.join(s.project.repo, '.git', 'hooks', 'post-commit');

  for (const report of ['../outside.xml', outside, '.git/hooks/post-commit']) {
    s.configure([s.suite('web', { platform: 'web', cases: WEB_CASES, report })]);
    const run = s.run();
    assert.equal(run.status, 1, `${report}\n${output(run)}`);
    assert.match(run.stdout, /^STATUS=BLOCKED$/mu);
    assert.match(run.stdout, /^REASON=CONFIG_INVALID$/mu);
    assert.match(run.stdout, /^CONFIG_ERROR=qa\.business\.suites\[0\]\.report\|/mu);
    assert.equal(fs.existsSync(marker), false, `${report}：套件不应被启动`);
    assert.equal(fs.existsSync(outside), false, `${report}：不得写到仓库之外`);
    assert.equal(fs.existsSync(path.join(s.project.root, 'outside.xml')), false, `${report}：不得写到仓库之外`);
    assert.equal(fs.existsSync(hook), false, `${report}：不得写进 .git`);
    assert.equal(fs.existsSync(s.resultsFile), false, `${report}：配置无效时不写结果`);
  }
});

test('安全——带 DOCTYPE 与外部实体的报告被拒绝：实体不展开、不读取目标文件，门禁按套件硬失败阻断', (t) => {
  const s = scenarioFor(t);
  const secret = path.join(s.aux, 'xxe-target.txt');
  const canary = 'XXE-CANARY-7f3a91';
  fs.writeFileSync(secret, `${canary}\n`);

  const xxe = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!DOCTYPE testsuites [<!ENTITY id "AC-SHOP-001-01 / TC-SHOP-001"> <!ENTITY secret SYSTEM "file://${secret}">]>`,
    '<testsuites>',
    '  <testsuite name="web" tests="2">',
    '    <testcase name="&id; 结算进入支付页" classname="web"/>',
    '    <testcase name="&secret;" classname="web"/>',
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
  const run = readyWith(s, [
    s.suite('web', { platform: 'web', xml: xxe }),
    s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
  ]);
  assert.equal(run.status, 1, output(run));
  // 拒绝的原因必须是 DOCTYPE 本身，而不是后面某个实体引用碰巧解析失败。
  assert.match(run.stdout, /^SUITE=web\|web\|report_invalid\|.*报告无法使用（doctype）/mu);
  assert.match(run.stdout, /^SUITE=ios\|ios\|ok\|/mu, '其余套件照常运行');

  const verify = runVerify(s);
  assertRed(s, verify, [{ code: 'SUITE_HARD_FAILURE', subject: 'web' }]);

  // 递归展开的实体炸弹同样在 DOCTYPE 处被拒，不会被展开。
  const bomb = [
    '<?xml version="1.0"?>',
    '<!DOCTYPE lolz [',
    '  <!ENTITY lol "lol">',
    `  <!ENTITY lol1 "${'&lol;'.repeat(10)}">`,
    `  <!ENTITY lol2 "${'&lol1;'.repeat(10)}">`,
    `  <!ENTITY lol3 "${'&lol2;'.repeat(10)}">`,
    ']>',
    '<testsuites><testsuite name="web"><testcase name="&lol3;" classname="web"/></testsuite></testsuites>',
    '',
  ].join('\n');
  s.suite('web', { platform: 'web', xml: bomb });
  const bombRun = s.run();
  assert.equal(bombRun.status, 1, output(bombRun));
  assert.match(bombRun.stdout, /^SUITE=web\|web\|report_invalid\|.*报告无法使用（doctype）/mu);

  const everything = [
    run.stdout, run.stderr, verify.stdout, verify.stderr, bombRun.stdout, bombRun.stderr,
    ...filesUnder(s.project.tmp).map((file) => fs.readFileSync(file, 'utf8')),
  ].join('\n');
  assert.equal(everything.includes(canary), false, '外部实体指向的文件内容不得出现在任何输出、结果或副本里');
});

test('安全——PRD、PATHS 与报告里的命令注入样式文本只被当作数据：不执行、不改变判定', (t) => {
  const s = scenarioFor(t);
  const pwned = (name) => path.join(s.aux, `pwned-${name}`);
  const payload = (name) => `$(touch ${pwned(name)}) \`touch ${pwned(name)}\` ; touch ${pwned(name)} && touch ${pwned(name)}`;

  const prd = prdDocument(SHOP_ACS.map((row) => ({
    ...row, given: payload('given'), when: payload('when'), then: payload('then'),
  })));
  const paths = pathsDocument(shopPaths((model) => {
    model.transitions[0][2] = payload('action');
    model.paths[0][3] = payload('note');
  }));
  s.project.write({ [PRD_FILE]: prd, [PATHS_FILE]: paths });
  commitAll(s.project.repo, 'specs with injection-style text');

  const cases = WEB_CASES.map((item, index) => ({ ...item, name: `${item.name} ${payload(`case-${index}`)}` }));
  const run = readyWith(s, [
    s.suite('web', { platform: 'web', cases }),
    s.suite('ios', { platform: 'ios', cases: IOS_CASES }),
  ]);
  assert.equal(run.status, 0, output(run));
  assertGreen(s, runVerify(s));

  assert.deepEqual(fs.readdirSync(s.aux).filter((name) => name.startsWith('pwned-')), [], '文本中的命令不得被执行');
  // 文本确实被当作数据读进来了，而不是被悄悄丢弃。
  const analysis = analyzeSpec({ repoRoot: s.project.repo });
  assert.equal(analysis.status, 'OK', JSON.stringify(analysis.violations));
  assert.equal(analysis.spec.acs.every((ac) => ac.given.includes('$(touch')), true);
  assert.deepEqual(fs.readdirSync(s.aux).filter((name) => name.startsWith('pwned-')), []);
});

test('安全——环境变量的值不进入输出、结果与报告副本；命令字符串按配置原样记录', (t) => {
  const s = scenarioFor(t);
  const token = 'canary-9d2c61';
  const probe = path.join(s.aux, `${token}.txt`);
  fs.writeFileSync(probe, 'probe\n');
  const env = { BIZ_PROBE: probe };

  const web = s.suite('web', { platform: 'web', cases: WEB_CASES });
  // 套件经平台默认 shell 执行：POSIX 为 sh（$VAR），Windows 为 cmd.exe（%VAR%）。
  const probeRef = process.platform === 'win32' ? '"%BIZ_PROBE%"' : '"$BIZ_PROBE"';
  web.command += ` ${probeRef}`;
  const ios = s.suite('ios', { platform: 'ios', cases: IOS_CASES });
  const run = readyWith(s, [web, ios], {}, { env });
  assert.equal(run.status, 0, output(run));
  const verify = runVerify(s, { env });
  assertGreen(s, verify);

  // 变量确实传给了套件，并由 shell 在命令里展开：桩套件观察到探针路径存在。
  const markers = fs.readFileSync(path.join(s.aux, 'markers.log'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(markers.find((item) => item.label === 'web').probeExisted, true);

  // 但变量的值不会出现在任何输出、结果或副本里；结果只按配置原样记录命令文本。
  const results = JSON.parse(fs.readFileSync(s.resultsFile, 'utf8'));
  assert.ok(results.suites.find((suite) => suite.name === 'web').command.endsWith(probeRef));
  const everything = [
    run.stdout, run.stderr, verify.stdout, verify.stderr,
    ...filesUnder(s.project.tmp).map((file) => fs.readFileSync(file, 'utf8')),
  ].join('\n');
  assert.equal(everything.includes(token), false, '环境变量的值不得出现在输出与容器 tmp 的任何文件里');
});

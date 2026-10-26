'use strict';

// `qa verify` 接入缺陷复现门禁（qa.repro，G7）的端到端测试：真实 git 场景 + 真实 qa repro + 真实 qa verify CLI。
// 预期值来自 PR4 验收口径：qa verify 只读复现结果并判定、不重跑；本分支新增的 BUG 行缺少有效复现 PASS 即阻断；
// 模板源跳过；未知配置键 fail-closed；回执携带 repro 摘要（门禁、DEFECT_REPRO、NEW_DEFECTS、风险数）。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { commitAll, runNodeScript } = require('./fixtures/business-testing/builders');
const { createScenario } = require('./fixtures/business-testing/scenario');
const {
  advanceHead,
  attachOrigin,
  pushBranch,
  receiptPath,
  recordTestScope,
  runVerify,
} = require('./fixtures/business-testing/verify');
const { designDoc } = require('./qa-design.helpers');
const { RUNNER, RUNNER_COMMAND, testsModule, userModule } = require('./qa-repro.helpers');

const QA_REPRO = path.join(__dirname, '..', 'qa-repro.js');
const BUG = 'BUG-SHOP-001';

const output = (run) => `${run.stdout}${run.stderr}`;
const has = (run, pattern) => run.lines.some((line) => pattern.test(line));
const indexOfLine = (run, prefix) => run.lines.findIndex((line) => line.startsWith(prefix));
const readReceiptFile = (s) => JSON.parse(fs.readFileSync(receiptPath(s), 'utf8'));

// shop 域设计：一条 P0 规则，本分支新增一条来源为 qa-audit 的缺陷行，绑定 TC-SHOP-020。
const SHOP_RULE = ['RUL-SHOP-001', 'rule', '第 5 次失败锁定', 'AC-SHOP-001-01', 'P0', 'example', 'TC-SHOP-010'];
const SHOP_BUG = [BUG, '第 6 次失败才锁定', 'RUL-SHOP-001', 'qa-audit', 'TC-SHOP-020', '-'];

// 改动 docs/qa-modules/shop/ 会让 qa verify 推断出 shop 模块并校验其 QA.md，因此同时提供合规 QA.md。
const SHOP_QA_DOC = '# QA\n\n## 用例\n\n- US-SHOP-001 -> TC-SHOP-010\n- US-SHOP-001 -> TC-SHOP-020\n';

// TC-SHOP-010 与缺陷无关、两侧都通过；TC-SHOP-020 绑定 BUG-SHOP-001，只在 lockAfter=5（修复后）通过。
const SHOP_TESTS = [
  "{ name: 'TC-SHOP-010 锁定阈值为正数', check: (user) => user.lockAfter > 0 }",
  "{ name: 'TC-SHOP-020 BUG-SHOP-001 第 5 次失败即锁定', check: (user) => user.lockAfter === 5 }",
];

// base（main）：缺陷版本（lockAfter=6）、桩运行器、无测试文件、无 TEST-DESIGN。
function scenarioFor(t) {
  const scenario = createScenario({
    files: {
      'package.json': `${JSON.stringify({ name: 'fixture', private: true })}\n`,
      'tools/run-tests.js': RUNNER,
      'src/user.js': userModule(6),
    },
  });
  t.after(() => scenario.cleanup());
  return scenario;
}

function writeConfig(s, config) {
  s.project.write({ 'agent.config.json': `${JSON.stringify(config, null, 2)}\n` });
}

// 特性分支：先提交设计（含新增 BUG 行），再提交修复与测试文件；config 为 null 时不写 agent.config.json。
function addBugFix(s, config) {
  attachOrigin(s);
  if (config) writeConfig(s, config);
  s.project.write({
    'docs/qa-modules/shop/QA.md': SHOP_QA_DOC,
    'docs/qa-modules/shop/TEST-DESIGN.md': designDoc({ rules: [SHOP_RULE], bugs: [SHOP_BUG] }),
  });
  commitAll(s.project.repo, 'test(design): record BUG-SHOP-001');
  s.project.write({ 'src/user.js': userModule(5), 'tests/user.test.js': testsModule(SHOP_TESTS) });
  commitAll(s.project.repo, 'fix: lock after 5 failures');
}

// 推送并记录绑定当前 HEAD 的测试范围证据：qa verify 先过范围校验，才轮到复现门禁。
function prepare(s) {
  pushBranch(s);
  recordTestScope(s);
}

function runRepro(s) {
  return runNodeScript(QA_REPRO, { cwd: s.project.repo, args: ['--bug', BUG] });
}

test('没有新增 BUG 行：REPRO_GATE=PASS、DEFECT_REPRO=0/0，回执写入 repro 摘要', (t) => {
  const s = scenarioFor(t);
  attachOrigin(s);
  prepare(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 0, output(verify));
  assert.ok(verify.lines.includes('REPRO_GATE=PASS'), verify.text);
  assert.ok(verify.lines.includes('DEFECT_REPRO=0/0'), verify.text);
  assert.ok(verify.lines.includes('NEW_DEFECTS=0'), verify.text);
  assert.equal(has(verify, /^REPRO_(BLOCK|RISK)=/u), false, verify.text);

  // 顺序：设计门禁 → 复现门禁 → 裁决与回执。
  assert.ok(indexOfLine(verify, 'DESIGN_GATE=') >= 0, verify.text);
  assert.ok(indexOfLine(verify, 'DESIGN_GATE=') < indexOfLine(verify, 'REPRO_GATE='), verify.text);
  assert.ok(indexOfLine(verify, 'REPRO_GATE=') < indexOfLine(verify, 'QA_VERDICT='), verify.text);

  assert.deepEqual(readReceiptFile(s).repro, { gate: 'PASS', defect_repro: '0/0', new_defects: 0, risk_count: 0 });
});

test('新增 BUG 行且 qa repro 证明 base 失败、HEAD 通过：放行并记录 DEFECT_REPRO=1/1', (t) => {
  const s = scenarioFor(t);
  addBugFix(s, { qa: { repro: { command: RUNNER_COMMAND } } });
  const repro = runRepro(s);
  assert.equal(repro.status, 0, output(repro));
  assert.match(repro.stdout, /^REPRO_VERDICT=PASS$/mu, output(repro));
  prepare(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 0, output(verify));
  assert.ok(verify.lines.includes('REPRO_GATE=PASS'), verify.text);
  assert.ok(verify.lines.includes('DEFECT_REPRO=1/1'), verify.text);
  assert.ok(verify.lines.includes('NEW_DEFECTS=1'), verify.text);
  assert.equal(has(verify, /^REPRO_BLOCK=/u), false, verify.text);
  assert.equal(has(verify, /^QA_VERIFY_BLOCK=/u), false, verify.text);
  assert.deepEqual(readReceiptFile(s).repro, { gate: 'PASS', defect_repro: '1/1', new_defects: 1, risk_count: 0 });
});

test('复现之后 HEAD 又前进：REPRO_STALE 阻断，不签发回执', (t) => {
  const s = scenarioFor(t);
  addBugFix(s, { qa: { repro: { command: RUNNER_COMMAND } } });
  const repro = runRepro(s);
  assert.equal(repro.status, 0, output(repro));
  advanceHead(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 1, output(verify));
  assert.ok(verify.lines.includes('REPRO_GATE=BLOCKED'), verify.text);
  assert.ok(has(verify, new RegExp(`^REPRO_BLOCK=REPRO_STALE\\|${BUG}\\|.*head_sha`, 'u')), verify.text);
  assert.ok(has(verify, /^QA_VERIFY_BLOCK=REPRO_GATE_BLOCKED\|/u), verify.text);
  assert.equal(fs.existsSync(receiptPath(s)), false, '复现门禁阻断时不得签发回执');
});

test('新增 BUG 行但未配置 qa.repro.command：REPRO_GATE_BLOCKED，退出码 1 且不签发回执', (t) => {
  const s = scenarioFor(t);
  addBugFix(s, null);
  prepare(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 1, output(verify));
  assert.ok(verify.lines.includes('REPRO_GATE=BLOCKED'), verify.text);
  assert.ok(verify.lines.includes('DEFECT_REPRO=0/1'), verify.text);
  assert.ok(has(verify, /^REPRO_BLOCK=REPRO_COMMAND_MISSING\|qa\.repro\.command\|/u), verify.text);
  const blocks = verify.lines.filter((line) => line.startsWith('QA_VERIFY_BLOCK='));
  assert.deepEqual(blocks.map((line) => line.split('|')[0]), ['QA_VERIFY_BLOCK=REPRO_GATE_BLOCKED'], verify.text);
  assert.ok(verify.lines.includes('STATUS=BLOCKED'), verify.text);
  assert.ok(has(verify, /^NEXT_ACTION=.*qa repro/u), verify.text);
  assert.equal(fs.existsSync(receiptPath(s)), false);
});

test('qa.repro.enabled=false：REPRO_GATE=SKIPPED 并以 REPRO_DISABLED 记风险，照常签发回执', (t) => {
  const s = scenarioFor(t);
  addBugFix(s, { qa: { repro: { enabled: false } } });
  prepare(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 0, output(verify));
  assert.ok(verify.lines.includes('REPRO_GATE=SKIPPED'), verify.text);
  assert.ok(has(verify, /^REPRO_RISK=REPRO_DISABLED\|/u), verify.text);
  assert.ok(verify.lines.includes('QA_VERDICT=PASS_WITH_RISK'), verify.text);
  assert.deepEqual(readReceiptFile(s).repro, { gate: 'SKIPPED', defect_repro: '0/1', new_defects: 1, risk_count: 1 });
});

test('模板源仓库跳过缺陷复现门禁：输出 REPRO_GATE=SKIPPED，回执不含 repro', (t) => {
  const s = scenarioFor(t);
  addBugFix(s, { template: { role: 'source' } });
  prepare(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 0, output(verify));
  assert.ok(verify.lines.includes('REPRO_GATE=SKIPPED'), verify.text);
  assert.equal(has(verify, /^(REPRO_(BLOCK|RISK)|DEFECT_REPRO)=/u), false, verify.text);
  assert.equal(Object.hasOwn(readReceiptFile(s), 'repro'), false, '门禁没有运行，回执不得携带 repro 摘要');
});

test('qa.repro 出现未知配置键时 fail-closed：REPRO_CONFIG_INVALID 且不签发回执', (t) => {
  const s = scenarioFor(t);
  attachOrigin(s);
  writeConfig(s, { qa: { repro: { bogus: true } } });
  commitAll(s.project.repo, 'configure qa repro');
  prepare(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 1, output(verify));
  assert.ok(has(verify, /^QA_VERIFY_BLOCK=REPRO_CONFIG_INVALID\|.*qa\.repro\.bogus/u), verify.text);
  assert.ok(verify.lines.includes('STATUS=BLOCKED'), verify.text);
  assert.equal(fs.existsSync(receiptPath(s)), false);
});

test('qa verify --help 说明缺陷复现门禁由 qa.repro 控制', (t) => {
  const s = scenarioFor(t);
  const help = runVerify(s, { args: ['--help'] });
  assert.equal(help.status, 0, output(help));
  assert.match(help.text, /qa\.repro/u);
  assert.match(help.text, /REPRO_BLOCK/u);
});

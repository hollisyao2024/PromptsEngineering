'use strict';

// `qa verify` 接入变异门禁（qa.mutation，G5）的端到端测试：真实 git 场景 + 真实 qa mutate + 真实 qa verify CLI。
// 预期值来自 PR5 验收口径：qa verify 只读变异结果并判定、不重跑；分数低于 minScore、结果过期即阻断；
// 默认关闭时只输出 MUTATION_GATE=DISABLED；模板源跳过；未知配置键 fail-closed；等价变异体经任务证据豁免；
// 回执携带 mutation 摘要（门禁、文件数、分数、阈值、击杀、有效、豁免、P0 测试、风险数）。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { checkpointTask, runtimeContext } = require('../../agent-runner/agent-task');
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
const { MUTATE_COMMAND, STUB, calcModule, mutant, report } = require('./qa-mutate.helpers');

const QA_MUTATE = path.join(__dirname, '..', 'qa-mutate.js');
// 与 verify 夹具 recordTestScope 默认任务一致：qa verify 只从这个任务读取豁免证据。
const TASK_ID = 'accept-check';
const SOURCE = 'src/calc.js';
// shop 规格里 AC-SHOP-001-01 为 P0、绑定 TC-SHOP-001：名字引用它的测试是 P0 测试。
const P0_TEST = 'TC-SHOP-001 下单金额四舍五入';
const OTHER_TEST = 'calc 冒烟用例';

const output = (run) => `${run.stdout}${run.stderr}`;
const has = (run, pattern) => run.lines.some((line) => pattern.test(line));
const indexOfLine = (run, prefix) => run.lines.findIndex((line) => line.startsWith(prefix));
const readReceiptFile = (s) => JSON.parse(fs.readFileSync(receiptPath(s), 'utf8'));

// 4 个变异体：P0 测试（t0）杀死 3 个，1 个 StringLiteral 存活，分数 75。
function mutationReport() {
  return report({
    tests: [P0_TEST, OTHER_TEST],
    files: {
      [SOURCE]: [
        mutant('m1', 'Killed', { line: 2, killedBy: ['t0'], coveredBy: ['t0', 't1'] }),
        mutant('m2', 'Killed', { line: 3, killedBy: ['t0'], coveredBy: ['t0'] }),
        mutant('m3', 'Timeout', { line: 4, killedBy: ['t0'], coveredBy: ['t0'] }),
        mutant('m4', 'Survived', { line: 5, mutator: 'StringLiteral', replacement: '""', coveredBy: ['t0', 't1'] }),
      ],
    },
  });
}

const enabled = (overrides = {}) => ({ qa: { mutation: { enabled: true, command: MUTATE_COMMAND, include: ['src/**'], ...overrides } } });

// base（main）：桩变异命令与初版 src/calc.js。
function scenarioFor(t) {
  const scenario = createScenario({
    files: {
      'package.json': `${JSON.stringify({ name: 'fixture', private: true })}\n`,
      'tools/mutate.js': STUB,
      [SOURCE]: calcModule(1),
    },
  });
  t.after(() => scenario.cleanup());
  return scenario;
}

// 特性分支：写配置并改动 src/calc.js；config 为 null 时不写 agent.config.json。
function changeSource(s, config) {
  attachOrigin(s);
  if (config) s.project.write({ 'agent.config.json': `${JSON.stringify(config, null, 2)}\n` });
  s.project.write({ [SOURCE]: calcModule(2) });
  commitAll(s.project.repo, 'feat: round to cents');
}

// 运行真实的 qa mutate；桩命令把 body 复制到报告目标。
function runMutate(s, args = ['run'], body = mutationReport()) {
  const source = path.join(s.aux, `mutation-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(source, `${JSON.stringify(body, null, 2)}\n`);
  return runNodeScript(QA_MUTATE, { cwd: s.project.repo, args, env: { ...process.env, MUTATE_FIXTURE_SOURCE: source } });
}

// 推送并记录绑定当前 HEAD 的测试范围证据：qa verify 先过范围校验，才轮到变异门禁。
function prepare(s) {
  pushBranch(s);
  recordTestScope(s);
}

// 把 qa mutate accept 生成的证据行写进当前任务，模拟执行器按 NEXT_ACTION 记录豁免。
function recordEvidence(s, line) {
  const context = runtimeContext(s.project.repo);
  checkpointTask({
    runsRoot: context.runsRoot,
    lockDir: context.lockDir,
    taskId: TASK_ID,
    stepId: 'S1',
    status: 'running',
    evidence: [line],
    nextAction: '运行 qa verify',
  });
}

test('变异结果达标：MUTATION_GATE=PASS，回执写入 mutation 摘要，门禁顺序为 repro → mutation → 裁决', (t) => {
  const s = scenarioFor(t);
  changeSource(s, enabled());
  const mutate = runMutate(s);
  assert.equal(mutate.status, 0, output(mutate));
  prepare(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 0, output(verify));
  assert.ok(verify.lines.includes('MUTATION_GATE=PASS'), verify.text);
  assert.ok(verify.lines.includes('MUTATION_SCORE=75.00'), verify.text);
  assert.ok(verify.lines.includes('MUTATION_P0_TESTS=1/1'), verify.text);
  assert.equal(has(verify, /^MUTATION_(BLOCK|RISK)=/u), false, verify.text);

  assert.ok(indexOfLine(verify, 'REPRO_GATE=') >= 0, verify.text);
  assert.ok(indexOfLine(verify, 'REPRO_GATE=') < indexOfLine(verify, 'MUTATION_GATE='), verify.text);
  assert.ok(indexOfLine(verify, 'MUTATION_GATE=') < indexOfLine(verify, 'QA_VERDICT='), verify.text);

  assert.deepEqual(readReceiptFile(s).mutation, {
    gate: 'PASS',
    files: 1,
    score: 75,
    min_score: 60,
    killed: 3,
    valid: 4,
    accepted: 0,
    p0_tests: '1/1',
    risk_count: 0,
  });
});

test('分数低于 minScore：MUTATION_GATE_BLOCKED，退出码 1 且不签发回执', (t) => {
  const s = scenarioFor(t);
  changeSource(s, enabled({ minScore: 80 }));
  const mutate = runMutate(s);
  assert.equal(mutate.status, 1, output(mutate));
  prepare(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 1, output(verify));
  assert.ok(verify.lines.includes('MUTATION_GATE=BLOCKED'), verify.text);
  assert.ok(has(verify, /^MUTATION_BLOCK=MUTATION_SCORE_LOW\|qa\.mutation\.minScore\|/u), verify.text);
  const blocks = verify.lines.filter((line) => line.startsWith('QA_VERIFY_BLOCK='));
  assert.deepEqual(blocks.map((line) => line.split('|')[0]), ['QA_VERIFY_BLOCK=MUTATION_GATE_BLOCKED'], verify.text);
  assert.ok(verify.lines.includes('STATUS=BLOCKED'), verify.text);
  assert.ok(has(verify, /^NEXT_ACTION=.*qa mutate/u), verify.text);
  assert.equal(fs.existsSync(receiptPath(s)), false, '变异门禁阻断时不得签发回执');
});

test('变异之后 HEAD 又前进：MUTATION_RESULT_STALE 阻断，不签发回执', (t) => {
  const s = scenarioFor(t);
  changeSource(s, enabled());
  assert.equal(runMutate(s).status, 0);
  advanceHead(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 1, output(verify));
  assert.ok(verify.lines.includes('MUTATION_GATE=BLOCKED'), verify.text);
  assert.ok(has(verify, /^MUTATION_BLOCK=MUTATION_RESULT_STALE\|result\|.*head_sha/u), verify.text);
  assert.ok(has(verify, /^QA_VERIFY_BLOCK=MUTATION_GATE_BLOCKED\|/u), verify.text);
  assert.equal(fs.existsSync(receiptPath(s)), false);
});

test('启用但从未运行 qa mutate：MUTATION_RESULT_MISSING 阻断', (t) => {
  const s = scenarioFor(t);
  changeSource(s, enabled());
  prepare(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 1, output(verify));
  assert.ok(has(verify, /^MUTATION_BLOCK=MUTATION_RESULT_MISSING\|/u), verify.text);
  assert.equal(fs.existsSync(receiptPath(s)), false);
});

test('等价变异体经 qa mutate accept 写入任务证据后被豁免：回执 accepted=1、分数 100', (t) => {
  const s = scenarioFor(t);
  changeSource(s, enabled());
  assert.equal(runMutate(s).status, 0);
  const accepted = runMutate(s, ['accept', '--mutant', 'm4', '--reason', '等价变异体：空串与原值输出一致']);
  assert.equal(accepted.status, 0, output(accepted));
  const line = accepted.stdout.split('\n').find((item) => item.startsWith('MUTATION_ACCEPT='));
  assert.ok(line, output(accepted));
  prepare(s);
  recordEvidence(s, line);

  const verify = runVerify(s);
  assert.equal(verify.status, 0, output(verify));
  assert.ok(verify.lines.includes('MUTATION_ACCEPTED=1'), verify.text);
  assert.ok(verify.lines.includes('MUTATION_SCORE=100.00'), verify.text);
  assert.equal(has(verify, /^MUTATION_SURVIVOR=/u), false, verify.text);
  const summary = readReceiptFile(s).mutation;
  assert.equal(summary.accepted, 1);
  assert.equal(summary.valid, 3);
  assert.equal(summary.score, 100);
});

test('默认关闭：只输出 MUTATION_GATE=DISABLED，不记风险，回执不含 mutation', (t) => {
  const s = scenarioFor(t);
  changeSource(s, null);
  prepare(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 0, output(verify));
  assert.ok(verify.lines.includes('MUTATION_GATE=DISABLED'), verify.text);
  assert.equal(has(verify, /^MUTATION_(BLOCK|RISK|SCORE|FILES)=/u), false, verify.text);
  assert.equal(Object.hasOwn(readReceiptFile(s), 'mutation'), false);
});

test('模板源仓库跳过变异门禁：输出 MUTATION_GATE=SKIPPED，回执不含 mutation', (t) => {
  const s = scenarioFor(t);
  changeSource(s, { template: { role: 'source' }, ...enabled() });
  prepare(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 0, output(verify));
  assert.ok(verify.lines.includes('MUTATION_GATE=SKIPPED'), verify.text);
  assert.equal(has(verify, /^MUTATION_(BLOCK|RISK|SCORE)=/u), false, verify.text);
  assert.ok(indexOfLine(verify, 'REPRO_GATE=SKIPPED') < indexOfLine(verify, 'MUTATION_GATE=SKIPPED'), verify.text);
  assert.equal(Object.hasOwn(readReceiptFile(s), 'mutation'), false, '门禁没有运行，回执不得携带 mutation 摘要');
});

test('qa.mutation 出现未知配置键时 fail-closed：MUTATION_CONFIG_INVALID 且不签发回执', (t) => {
  const s = scenarioFor(t);
  changeSource(s, { qa: { mutation: { bogus: true } } });
  prepare(s);

  const verify = runVerify(s);
  assert.equal(verify.status, 1, output(verify));
  assert.ok(has(verify, /^QA_VERIFY_BLOCK=MUTATION_CONFIG_INVALID\|.*qa\.mutation\.bogus/u), verify.text);
  assert.ok(verify.lines.includes('STATUS=BLOCKED'), verify.text);
  assert.equal(fs.existsSync(receiptPath(s)), false);
});

test('qa verify --help 说明变异门禁由 qa.mutation 控制', (t) => {
  const s = scenarioFor(t);
  const help = runVerify(s, { args: ['--help'] });
  assert.equal(help.status, 0, output(help));
  assert.match(help.text, /qa\.mutation/u);
  assert.match(help.text, /MUTATION_BLOCK/u);
});

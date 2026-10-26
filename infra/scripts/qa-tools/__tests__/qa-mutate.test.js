'use strict';

// qa mutate（G5）：只对 base..HEAD 的变更源码运行配置的变异命令，解析 mutation-testing-report-schema 报告；
// 分数 = (Killed+Timeout)/(总数−CompileError−RuntimeError−Ignored−已豁免)；requireAcKill 要求绑定 P0 的测试至少杀死一个变异体；
// 结果绑定 HEAD、base、配置摘要、文件摘要与报告 sha256；等价变异体经 qa mutate accept 生成证据行后豁免。
// 预期值来自 PR5 验收口径与 Stryker mutation-testing-report-schema 的状态定义，不取自实现输出。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  OTHER_TEST,
  P0_TEST,
  SOURCE_FILE,
  calcModule,
  defaultReport,
  fields,
  mutant,
  mutateProject,
  mutationConfig,
  report,
  show,
} = require('./qa-mutate.helpers');
const { evaluateMutationGate, mutationLines, resolveMutationConfig } = require('../qa-mutate');
const { DEFAULT_CONFIG, loadConfig } = require('../../shared/config');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const codes = (items) => items.map((item) => item.code);
const lines = (stdout, prefix) => stdout.split('\n').filter((line) => line.startsWith(prefix));

function gate(project, { config, acceptRecords = [] } = {}) {
  return evaluateMutationGate({
    repoRoot: project.repo,
    config: config || loadConfig({ repoRoot: project.repo }),
    mainRoot: project.repo,
    baseSha: project.baseSha,
    headSha: project.head(),
    acceptRecords,
  });
}

// 断言 resolveMutationConfig 以 MUTATION_CONFIG_INVALID 拒绝该 qa.mutation 配置，且消息点名出错的键。
function assertConfigInvalid(mutation, key) {
  assert.throws(
    () => resolveMutationConfig({ ...DEFAULT_CONFIG, qa: { ...DEFAULT_CONFIG.qa, mutation: { ...DEFAULT_CONFIG.qa.mutation, ...mutation } } }),
    (error) => error.code === 'MUTATION_CONFIG_INVALID' && error.message.includes(`qa.mutation.${key}`),
    `qa.mutation.${key} 应被拒绝：${JSON.stringify(mutation)}`,
  );
}

test('默认配置：config.example.json 提供关闭状态的 qa.mutation 节', () => {
  assert.deepEqual(DEFAULT_CONFIG.qa.mutation, {
    enabled: false,
    command: '',
    report: '',
    include: [],
    minScore: 60,
    timeoutSeconds: 1800,
    requireAcKill: true,
  });
  const resolved = resolveMutationConfig(DEFAULT_CONFIG);
  assert.equal(resolved.enabled, false);
  assert.equal(resolved.minScore, 60);
  assert.equal(resolved.requireAcKill, true);
  // include 为空时沿用 qa.design.sourceGlobs。
  assert.ok(resolved.includeMatchers.some((matcher) => matcher.test('src/calc.js')));
  assert.ok(resolved.testMatchers.some((matcher) => matcher.test('src/calc.test.js')));
});

test('配置校验 fail-closed：未知键、越界分数、非数组 include、仓库外报告路径、非正超时、非布尔开关', () => {
  assertConfigInvalid({ bogus: true }, 'bogus');
  assertConfigInvalid({ minScore: 120 }, 'minScore');
  assertConfigInvalid({ minScore: '60' }, 'minScore');
  assertConfigInvalid({ include: 'src/**' }, 'include');
  assertConfigInvalid({ report: '../escape.json' }, 'report');
  assertConfigInvalid({ report: '/abs/report.json' }, 'report');
  assertConfigInvalid({ timeoutSeconds: 0 }, 'timeoutSeconds');
  assertConfigInvalid({ requireAcKill: 'yes' }, 'requireAcKill');
  assertConfigInvalid({ enabled: 'true' }, 'enabled');
});

test('run：只把变更源码交给变异命令，结果绑定 HEAD 并保存报告副本，门禁 PASS', (t) => {
  const project = mutateProject(t);
  const result = project.run();
  const out = fields(result.stdout);

  assert.equal(result.status, 0, show(result));
  assert.equal(out.STATUS, 'OK', show(result));
  assert.equal(out.MUTATION_GATE, 'PASS', show(result));
  assert.equal(out.MUTATION_FILES, '1');
  assert.equal(out.MUTATION_SCORE, '75.00');
  assert.equal(out.MUTATION_KILLED, '3');
  assert.equal(out.MUTATION_VALID, '4');
  assert.equal(out.MUTATION_ACCEPTED, '0');
  assert.equal(out.MUTATION_P0_TESTS, '1/1');
  assert.deepEqual(lines(result.stdout, 'MUTATION_SURVIVOR='), [`MUTATION_SURVIVOR=m4|${SOURCE_FILE}:5|StringLiteral`]);
  assert.equal(lines(result.stdout, 'MUTATION_BLOCK=').length, 0, show(result));
  assert.equal(lines(result.stdout, 'MUTATION_RISK=').length, 0, show(result));

  // 变异命令只拿到变更源码：新增的 src/calc.test.js 命中 include 但属于测试文件，未改动的 tools/ 不在 include 内。
  const probe = project.probed();
  assert.equal(probe.files, SOURCE_FILE);
  assert.equal(probe.base, project.baseSha);
  assert.equal(fs.realpathSync(probe.cwd), project.repo);
  assert.ok(probe.report.startsWith(path.join(project.tmp, 'qa-mutate')), `未配置 report 时报告写到容器 tmp：${probe.report}`);

  const record = readJson(out.MUTATION_RESULT_FILE);
  assert.equal(record.version, 1);
  assert.equal(record.head_sha, project.headSha);
  assert.equal(record.base_sha, project.baseSha);
  assert.deepEqual(record.files.map((item) => item.file), [SOURCE_FILE]);
  assert.match(record.files[0].blob, /^[0-9a-f]{40}$/u);
  assert.match(record.config_digest, /^[0-9a-f]{64}$/u);
  assert.match(record.files_digest, /^[0-9a-f]{64}$/u);
  assert.match(record.report_sha256, /^[0-9a-f]{64}$/u);
  assert.equal(record.exit_code, 0);
  assert.deepEqual(readJson(out.MUTATION_REPORT_FILE), defaultReport());

  const verdict = gate(project);
  assert.equal(verdict.status, 'PASS');
  assert.equal(verdict.score, 75);
  assert.deepEqual(verdict.p0Tests, { killing: 1, evaluated: 1 });
});

test('run：配置 report 时变异命令把报告写到仓库内该路径，qa mutate 复制一份到容器 tmp', (t) => {
  const project = mutateProject(t, { config: { qa: { mutation: mutationConfig({ report: 'reports/mutation.json' }) } } });
  const result = project.run();
  const out = fields(result.stdout);

  assert.equal(out.STATUS, 'OK', show(result));
  assert.equal(project.probed().report, path.join(project.repo, 'reports', 'mutation.json'));
  assert.ok(out.MUTATION_REPORT_FILE.startsWith(path.join(project.tmp, 'qa-mutate')), out.MUTATION_REPORT_FILE);
  assert.deepEqual(readJson(out.MUTATION_REPORT_FILE), defaultReport());
});

test('run：报告含 Pending、JSON 损坏、未知状态或重复 id 时 MUTATION_REPORT_INVALID，不留结果', (t) => {
  const project = mutateProject(t);
  const first = fields(project.run().stdout);
  assert.equal(first.STATUS, 'OK');

  const broken = [
    report({ files: { [SOURCE_FILE]: [mutant('m1', 'Killed', { killedBy: ['t0'] }), mutant('m2', 'Pending')] } }),
    '{"files": oops',
    report({ files: { [SOURCE_FILE]: [mutant('m1', 'Weird')] } }),
    report({ files: { [SOURCE_FILE]: [mutant('m1', 'Killed', { killedBy: ['t0'] }), mutant('m1', 'Survived', { line: 4 })] } }),
    { files: [] },
  ];
  for (const body of broken) {
    const result = project.run({ body });
    const out = fields(result.stdout);
    assert.notEqual(result.status, 0, show(result));
    assert.equal(out.STATUS, 'BLOCKED', show(result));
    assert.equal(out.REASON, 'MUTATION_REPORT_INVALID', show(result));
  }
  // 无效报告不得留下上一轮的结果冒充当前结果。
  assert.equal(fs.existsSync(first.MUTATION_RESULT_FILE), false);
  assert.deepEqual(codes(gate(project).blocks), ['MUTATION_RESULT_MISSING']);
});

test('run：命令没有写出报告 → MUTATION_REPORT_MISSING；超时 → MUTATION_TIMEOUT', (t) => {
  const project = mutateProject(t);
  const missing = fields(project.run({ body: null }).stdout);
  assert.equal(missing.STATUS, 'BLOCKED');
  assert.equal(missing.REASON, 'MUTATION_REPORT_MISSING');

  project.writeConfig({ qa: { mutation: mutationConfig({ timeoutSeconds: 1 }) } });
  project.commit({}, 'chore: shorten mutation timeout');
  const timedOut = project.run({ body: null, sleep: 4000 });
  const out = fields(timedOut.stdout);
  assert.equal(out.STATUS, 'BLOCKED', show(timedOut));
  assert.equal(out.REASON, 'MUTATION_TIMEOUT', show(timedOut));
});

test('run：命令非零退出但报告有效 → 照常判定并记 MUTATION_COMMAND_EXIT 风险', (t) => {
  const project = mutateProject(t);
  const result = project.run({ exit: 3 });
  const out = fields(result.stdout);

  assert.equal(result.status, 0, show(result));
  assert.equal(out.STATUS, 'OK');
  assert.equal(out.MUTATION_GATE, 'PASS_WITH_RISK');
  assert.match(result.stdout, /^MUTATION_RISK=MUTATION_COMMAND_EXIT\|/mu);
  assert.equal(readJson(out.MUTATION_RESULT_FILE).exit_code, 3);
});

test('门禁：分数低于 minScore → MUTATION_SCORE_LOW 阻断，结果仍写盘', (t) => {
  const project = mutateProject(t);
  const body = report({
    files: {
      [SOURCE_FILE]: [
        mutant('m1', 'Killed', { line: 2, killedBy: ['t0'], coveredBy: ['t0'] }),
        mutant('m2', 'Survived', { line: 3, coveredBy: ['t0'] }),
        mutant('m3', 'Survived', { line: 4, coveredBy: ['t0'] }),
        mutant('m4', 'NoCoverage', { line: 5, coveredBy: [] }),
      ],
    },
  });
  const result = project.run({ body });
  const out = fields(result.stdout);

  assert.notEqual(result.status, 0, show(result));
  assert.equal(out.STATUS, 'BLOCKED');
  assert.equal(out.REASON, 'MUTATION_GATE_BLOCKED');
  assert.equal(out.MUTATION_GATE, 'BLOCKED');
  assert.equal(out.MUTATION_SCORE, '25.00');
  assert.match(result.stdout, /^MUTATION_BLOCK=MUTATION_SCORE_LOW\|qa\.mutation\.minScore\|.*25\.00.*60/mu);
  assert.equal(lines(result.stdout, 'MUTATION_SURVIVOR=').length, 3, '存活与未覆盖的变异体都要列出');
  assert.ok(fs.existsSync(out.MUTATION_RESULT_FILE));
  assert.deepEqual(codes(gate(project).blocks), ['MUTATION_SCORE_LOW']);
});

test('门禁：CompileError、RuntimeError、Ignored 不计入分母；全部无效时分数为 NA 并记 MUTATION_NO_MUTANTS', (t) => {
  const project = mutateProject(t, { config: { qa: { mutation: mutationConfig({ minScore: 30, requireAcKill: false }) } } });
  const body = report({
    files: {
      [SOURCE_FILE]: [
        mutant('m1', 'Killed', { line: 2, killedBy: ['t0'] }),
        mutant('m2', 'CompileError', { line: 3 }),
        mutant('m3', 'Ignored', { line: 4 }),
        mutant('m4', 'Survived', { line: 5 }),
        mutant('m5', 'RuntimeError', { line: 6 }),
        mutant('m6', 'NoCoverage', { line: 7 }),
      ],
    },
  });
  const out = fields(project.run({ body }).stdout);
  assert.equal(out.MUTATION_GATE, 'PASS');
  assert.equal(out.MUTATION_VALID, '3');
  assert.equal(out.MUTATION_KILLED, '1');
  assert.equal(out.MUTATION_SCORE, '33.33');
  assert.equal(out.MUTATION_P0_TESTS, 'NA');

  const none = project.run({ body: report({ files: { [SOURCE_FILE]: [mutant('m1', 'CompileError'), mutant('m2', 'Ignored', { line: 3 })] } }) });
  const noneOut = fields(none.stdout);
  assert.equal(noneOut.MUTATION_SCORE, 'NA', show(none));
  assert.equal(noneOut.MUTATION_GATE, 'PASS_WITH_RISK');
  assert.match(none.stdout, /^MUTATION_RISK=MUTATION_NO_MUTANTS\|/mu);
});

test('门禁：有覆盖数据时，覆盖了变更代码却一个变异体都没杀的 P0 测试逐个阻断', (t) => {
  const project = mutateProject(t);
  const body = report({
    files: {
      [SOURCE_FILE]: [
        mutant('m1', 'Killed', { line: 2, killedBy: ['t1'], coveredBy: ['t0', 't1'] }),
        mutant('m2', 'Killed', { line: 3, killedBy: ['t1'], coveredBy: ['t0', 't1'] }),
        mutant('m3', 'Killed', { line: 4, killedBy: ['t1'], coveredBy: ['t1'] }),
      ],
    },
  });
  const result = project.run({ body });
  const out = fields(result.stdout);

  assert.equal(out.MUTATION_SCORE, '100.00');
  assert.equal(out.MUTATION_GATE, 'BLOCKED', show(result));
  assert.equal(out.MUTATION_P0_TESTS, '0/1');
  assert.deepEqual(lines(result.stdout, 'MUTATION_BLOCK=').map((line) => line.split('|').slice(0, 2).join('|')), [
    `MUTATION_BLOCK=MUTATION_P0_NO_KILL|${P0_TEST}`,
  ]);
  assert.equal(lines(result.stdout, 'MUTATION_RISK=MUTATION_COVERAGE_UNKNOWN').length, 0);
});

test('门禁：没有覆盖数据且 P0 测试一个都没杀 → MUTATION_P0_NO_KILL 阻断并记 MUTATION_COVERAGE_UNKNOWN', (t) => {
  const project = mutateProject(t);
  const body = report({
    files: {
      [SOURCE_FILE]: [
        mutant('m1', 'Killed', { line: 2, killedBy: ['t1'] }),
        mutant('m2', 'Killed', { line: 3, killedBy: ['t1'] }),
      ],
    },
  });
  const result = project.run({ body });
  const out = fields(result.stdout);

  assert.equal(out.MUTATION_GATE, 'BLOCKED', show(result));
  assert.equal(out.MUTATION_P0_TESTS, '0/1');
  assert.match(result.stdout, /^MUTATION_BLOCK=MUTATION_P0_NO_KILL\|\*\|/mu);
  assert.match(result.stdout, /^MUTATION_RISK=MUTATION_COVERAGE_UNKNOWN\|/mu);
});

test('门禁：报告里没有绑定 P0 的测试 → MUTATION_P0_UNBOUND 风险；requireAcKill=false 时 P0 统计为 NA', (t) => {
  const project = mutateProject(t);
  const body = report({
    tests: [OTHER_TEST, '另一个普通用例'],
    files: { [SOURCE_FILE]: [mutant('m1', 'Killed', { killedBy: ['t0'], coveredBy: ['t0'] })] },
  });
  const result = project.run({ body });
  const out = fields(result.stdout);
  assert.equal(out.MUTATION_GATE, 'PASS_WITH_RISK', show(result));
  assert.equal(out.MUTATION_P0_TESTS, '0/0');
  assert.match(result.stdout, /^MUTATION_RISK=MUTATION_P0_UNBOUND\|/mu);

  const config = loadConfig({ repoRoot: project.repo });
  config.qa.mutation.requireAcKill = false;
  const verdict = gate(project, { config });
  assert.equal(verdict.p0Tests, null);
  assert.deepEqual(codes(verdict.risks), []);
  assert.ok(mutationLines(verdict).includes('MUTATION_P0_TESTS=NA'));
});

test('门禁：报告路径为绝对路径或反斜杠时归一化；报告不含任何变更文件 → MUTATION_REPORT_EMPTY；只含部分 → MUTATION_REPORT_PARTIAL', (t) => {
  const project = mutateProject(t);
  const absolute = report({ files: { [path.join(project.repo, SOURCE_FILE)]: defaultReport().files[SOURCE_FILE].mutants } });
  const absOut = fields(project.run({ body: absolute }).stdout);
  assert.equal(absOut.MUTATION_SCORE, '75.00');
  assert.equal(absOut.MUTATION_GATE, 'PASS');

  const backslash = report({ files: { 'src\\calc.js': defaultReport().files[SOURCE_FILE].mutants } });
  assert.equal(fields(project.run({ body: backslash }).stdout).MUTATION_SCORE, '75.00');

  const elsewhere = project.run({ body: report({ files: { 'src/other.js': [mutant('m1', 'Killed', { killedBy: ['t0'] })] } }) });
  assert.equal(fields(elsewhere.stdout).MUTATION_GATE, 'BLOCKED', show(elsewhere));
  assert.match(elsewhere.stdout, /^MUTATION_BLOCK=MUTATION_REPORT_EMPTY\|/mu);

  project.commit({ 'src/extra.js': "'use strict';\nmodule.exports = 1;\n" }, 'feat: extra');
  const partial = project.run();
  const partialOut = fields(partial.stdout);
  assert.equal(partialOut.MUTATION_FILES, '2');
  assert.equal(partialOut.MUTATION_GATE, 'PASS_WITH_RISK', show(partial));
  assert.match(partial.stdout, /^MUTATION_RISK=MUTATION_REPORT_PARTIAL\|src\/extra\.js\|/mu);
});

test('门禁：结果缺失、HEAD 前进、配置变化、报告副本被改、结果文件损坏都阻断', (t) => {
  const project = mutateProject(t);
  assert.deepEqual(codes(gate(project).blocks), ['MUTATION_RESULT_MISSING']);

  const out = fields(project.run().stdout);
  assert.equal(gate(project).status, 'PASS');

  // 配置摘要覆盖 command、report、include 与 timeoutSeconds；minScore 只影响判定，不使结果失效。
  const changed = loadConfig({ repoRoot: project.repo });
  changed.qa.mutation.include = ['src/**', 'lib/**'];
  const stale = gate(project, { config: changed });
  assert.deepEqual(codes(stale.blocks), ['MUTATION_RESULT_STALE']);
  assert.match(stale.blocks[0].detail, /config_digest/u);
  const stricter = loadConfig({ repoRoot: project.repo });
  stricter.qa.mutation.minScore = 80;
  assert.deepEqual(codes(gate(project, { config: stricter }).blocks), ['MUTATION_SCORE_LOW']);

  fs.appendFileSync(out.MUTATION_REPORT_FILE, ' ');
  assert.deepEqual(codes(gate(project).blocks), ['MUTATION_RESULT_TAMPERED']);

  fs.writeFileSync(out.MUTATION_RESULT_FILE, '{oops');
  assert.deepEqual(codes(gate(project).blocks), ['MUTATION_RESULT_INVALID']);

  project.run();
  project.commit({ 'docs/notes.md': '# 备注\n' }, 'docs: notes');
  const moved = gate(project);
  assert.deepEqual(codes(moved.blocks), ['MUTATION_RESULT_STALE']);
  assert.match(moved.blocks[0].detail, /head_sha/u);
  assert.match(mutationLines(moved).join('\n'), /^MUTATION_BLOCK=MUTATION_RESULT_STALE\|result\|.*head_sha/mu);
});

test('accept：为存活变异体生成证据行，计入豁免后分母减一；源码再改动后豁免失效', (t) => {
  const project = mutateProject(t);
  project.run();
  const accepted = project.accept('m4');
  const out = fields(accepted.stdout);

  assert.equal(accepted.status, 0, show(accepted));
  assert.equal(out.STATUS, 'OK', show(accepted));
  const [line] = lines(accepted.stdout, 'MUTATION_ACCEPT=');
  const record = JSON.parse(line.slice('MUTATION_ACCEPT='.length));
  assert.equal(record.file, SOURCE_FILE);
  assert.equal(record.mutator, 'StringLiteral');
  assert.equal(record.replacement, '""');
  assert.deepEqual(record.location, { start: { line: 5, column: 3 }, end: { line: 5, column: 9 } });
  assert.match(record.blob, /^[0-9a-f]{40}$/u);
  assert.equal(record.reason, '等价变异体：两种写法输出一致');
  assert.match(out.NEXT_ACTION, /checkpoint/u);

  const verdict = gate(project, { acceptRecords: [line] });
  assert.equal(verdict.status, 'PASS');
  assert.equal(verdict.accepted, 1);
  assert.equal(verdict.valid, 3);
  assert.equal(verdict.score, 100);
  assert.deepEqual(verdict.survivors, []);
  assert.ok(mutationLines(verdict).includes('MUTATION_ACCEPTED=1'));

  // 同一条证据重复出现只计一次；无法解析的证据行记风险。
  assert.equal(gate(project, { acceptRecords: [line, line] }).accepted, 1);
  assert.deepEqual(codes(gate(project, { acceptRecords: ['MUTATION_ACCEPT={oops'] }).risks), ['MUTATION_ACCEPT_INVALID']);

  // 源码改动后 blob 变化：旧豁免不再生效，并披露 MUTATION_ACCEPT_STALE。
  project.commit({ [SOURCE_FILE]: calcModule(3) }, 'feat: round to mills');
  project.run();
  const after = gate(project, { acceptRecords: [line] });
  assert.equal(after.accepted, 0);
  assert.equal(after.score, 75);
  assert.deepEqual(codes(after.risks), ['MUTATION_ACCEPT_STALE']);
});

test('accept：只接受当前有效结果中的存活或未覆盖变异体', (t) => {
  const project = mutateProject(t);
  project.run();

  const killed = fields(project.accept('m1').stdout);
  assert.equal(killed.STATUS, 'BLOCKED');
  assert.equal(killed.REASON, 'MUTATION_ACCEPT_INVALID');

  const unknown = fields(project.accept('m9').stdout);
  assert.equal(unknown.REASON, 'MUTATION_ACCEPT_INVALID');

  const noReason = fields(project.accept('m4', '').stdout);
  assert.equal(noReason.STATUS, 'BLOCKED');
  assert.equal(noReason.REASON, 'MUTATION_INVALID_INPUT');

  project.commit({ 'docs/notes.md': '# 备注\n' }, 'docs: notes');
  const stale = fields(project.accept('m4').stdout);
  assert.equal(stale.STATUS, 'BLOCKED');
  assert.equal(stale.REASON, 'MUTATION_RESULT_STALE');
});

test('run：未启用 → MUTATION_GATE=DISABLED 并阻断为 MUTATION_DISABLED，不执行命令', (t) => {
  const project = mutateProject(t, { config: {} });
  const result = project.run();
  const out = fields(result.stdout);
  assert.equal(out.MUTATION_GATE, 'DISABLED', show(result));
  assert.equal(out.STATUS, 'BLOCKED');
  assert.equal(out.REASON, 'MUTATION_DISABLED');
  assert.equal(project.probed(), null);

  const verdict = gate(project);
  assert.equal(verdict.status, 'DISABLED');
  assert.deepEqual(mutationLines(verdict), ['MUTATION_GATE=DISABLED']);
});

test('run：模板源 → MUTATION_GATE=SKIPPED 并直接通过，不执行命令', (t) => {
  const project = mutateProject(t, { config: { template: { role: 'source' }, qa: { mutation: mutationConfig() } } });
  const result = project.run();
  const out = fields(result.stdout);
  assert.equal(result.status, 0, show(result));
  assert.equal(out.MUTATION_GATE, 'SKIPPED');
  assert.equal(out.STATUS, 'OK');
  assert.equal(project.probed(), null);
  assert.deepEqual(mutationLines(gate(project)), ['MUTATION_GATE=SKIPPED']);
});

test('run：未配置 command、配置含未知键、工作区不干净时阻断且不执行命令', (t) => {
  const missing = mutateProject(t, { config: { qa: { mutation: mutationConfig({ command: '' }) } } });
  assert.equal(fields(missing.run().stdout).REASON, 'MUTATION_COMMAND_MISSING');
  assert.equal(missing.probed(), null);

  const invalid = mutateProject(t, { config: { qa: { mutation: mutationConfig({ bogus: 1 }) } } });
  const invalidOut = fields(invalid.run().stdout);
  assert.equal(invalidOut.STATUS, 'BLOCKED');
  assert.equal(invalidOut.REASON, 'MUTATION_CONFIG_INVALID');
  assert.match(invalidOut.SUMMARY, /qa\.mutation\.bogus/u);

  const dirty = mutateProject(t);
  dirty.write({ 'src/wip.js': '// 未提交\n' });
  assert.equal(fields(dirty.run().stdout).REASON, 'MUTATION_WORKTREE_DIRTY');
  assert.equal(dirty.probed(), null);
});

test('run：base..HEAD 没有变更源码 → MUTATION_FILES=0 直接 PASS，不执行命令', (t) => {
  const project = mutateProject(t, { head: false });
  const result = project.run();
  const out = fields(result.stdout);
  assert.equal(result.status, 0, show(result));
  assert.equal(out.STATUS, 'OK');
  assert.equal(out.MUTATION_GATE, 'PASS');
  assert.equal(out.MUTATION_FILES, '0');
  assert.equal(project.probed(), null);

  const verdict = gate(project);
  assert.equal(verdict.status, 'PASS');
  assert.equal(verdict.files, 0);
  assert.deepEqual(verdict.blocks, []);
});

test('CLI：未知动作与缺少 --mutant 时以 MUTATION_INVALID_INPUT 阻断', (t) => {
  const project = mutateProject(t);
  const unknown = fields(project.run({ args: ['explode'] }).stdout);
  assert.equal(unknown.STATUS, 'BLOCKED');
  assert.equal(unknown.REASON, 'MUTATION_INVALID_INPUT');

  const noMutant = fields(project.run({ args: ['accept', '--reason', '等价'] }).stdout);
  assert.equal(noMutant.REASON, 'MUTATION_INVALID_INPUT');
});

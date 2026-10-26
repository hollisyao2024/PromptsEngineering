'use strict';

// qa repro（G7）：在容器 tmp 的临时 detached worktree（base SHA）上叠加 HEAD 的测试文件，
// 绑定 BUG 的用例须在 base 上失败、在 HEAD 上通过；证据绑定两个 SHA 与测试文件摘要，用完按精确路径清理。
// qa verify 只读结果：本分支新增的 BUG 行缺少有效的复现 PASS 即阻断。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runGit } = require('./fixtures/business-testing/builders');
const { BUG, BUG_ROW, RUNNER_COMMAND, fields, reproProject, show } = require('./qa-repro.helpers');
const { evaluateReproGate, reproLines } = require('../qa-repro');
const { loadConfig } = require('../../shared/config');

const runsRoot = (project) => path.join(project.tmp, 'qa-repro', 'runs');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const codes = (items) => items.map((item) => item.code);

function gate(project) {
  return evaluateReproGate({
    repoRoot: project.repo,
    config: loadConfig({ repoRoot: project.repo }),
    mainRoot: project.repo,
    baseSha: project.baseSha,
    headSha: runGit(project.repo, ['rev-parse', 'HEAD']).trim(),
  });
}

function assertCleaned(project) {
  const leftovers = fs.existsSync(runsRoot(project)) ? fs.readdirSync(runsRoot(project)) : [];
  assert.deepEqual(leftovers, [], '临时运行目录必须清理');
  const worktrees = runGit(project.repo, ['worktree', 'list', '--porcelain']).split('\n').filter((line) => line.startsWith('worktree '));
  assert.equal(worktrees.length, 1, `只应剩主 worktree：${worktrees.join(', ')}`);
}

test('base 有缺陷、HEAD 已修复：PASS，结果绑定两个 SHA 与测试摘要，临时 worktree 已清理', (t) => {
  const project = reproProject(t);
  const result = project.run();
  const out = fields(result.stdout);

  assert.equal(result.status, 0, show(result));
  assert.equal(out.STATUS, 'OK', show(result));
  assert.equal(out.REPRO_VERDICT, 'PASS');
  assert.equal(out.REPRO_BASE, 'failed');
  assert.equal(out.REPRO_HEAD, 'passed');
  assert.equal(out.REPRO_BASE_SHA, project.baseSha);
  assert.equal(out.REPRO_HEAD_SHA, project.headSha);
  assert.match(out.REPRO_TEST_DIGEST, /^[0-9a-f]{64}$/u);
  assert.equal(out.REPRO_CLEANUP, 'DONE');

  const record = readJson(out.REPRO_RESULT_FILE);
  assert.equal(record.bug, BUG);
  assert.equal(record.base_sha, project.baseSha);
  assert.equal(record.head_sha, project.headSha);
  assert.equal(record.test_digest, out.REPRO_TEST_DIGEST);
  assert.equal(record.verdict, 'PASS');
  assert.deepEqual(record.tcs, ['TC-USER-020']);
  assert.equal(record.base.outcome, 'failed');
  assert.equal(record.head.outcome, 'passed');
  // 只统计绑定用例：与缺陷无关的 TC-USER-010 不进入任何一侧。
  assert.deepEqual(record.base.cases.map((item) => item.status), ['failed']);
  assert.ok(record.base.cases.every((item) => item.name.includes('TC-USER-020')));
  assert.ok(record.head.exit_code === 0 && record.base.exit_code !== 0, '退出码只记录、不参与判定');
  assertCleaned(project);

  // base 侧在临时 worktree 运行，HEAD 侧在当前仓库运行；两侧都拿到 BUG、TC 与匹配模式。
  const base = readJson(path.join(project.probe, 'base.json'));
  const head = readJson(path.join(project.probe, 'head.json'));
  assert.equal(fs.realpathSync(head.cwd), project.repo);
  assert.notEqual(base.cwd, project.repo);
  assert.ok(base.cwd.startsWith(runsRoot(project)), `base 侧应在 ${runsRoot(project)} 下运行：${base.cwd}`);
  assert.equal(base.bug, BUG);
  assert.equal(base.tcs, 'TC-USER-020');
  assert.ok(new RegExp(base.pattern, 'u').test('TC-USER-020 something'));
  assert.ok(new RegExp(base.pattern, 'u').test(`${BUG} something`));
  assert.notEqual(base.report, head.report);
});

test('BUG 在 base 上也通过：FAIL 并阻断为 REPRO_BASE_PASSED，结果仍写盘', (t) => {
  const project = reproProject(t, { baseLockAfter: 5 });
  const result = project.run();
  const out = fields(result.stdout);

  assert.notEqual(result.status, 0, show(result));
  assert.equal(out.STATUS, 'BLOCKED', show(result));
  assert.equal(out.REASON, 'REPRO_BASE_PASSED', show(result));
  assert.equal(out.REPRO_VERDICT, 'FAIL');
  assert.equal(out.REPRO_BASE, 'passed');
  assert.equal(readJson(out.REPRO_RESULT_FILE).verdict, 'FAIL');
  assertCleaned(project);
});

test('HEAD 仍有缺陷：FAIL 并阻断为 REPRO_HEAD_NOT_PASSING', (t) => {
  const project = reproProject(t, { headLockAfter: 6 });
  const out = fields(project.run().stdout);

  assert.equal(out.STATUS, 'BLOCKED');
  assert.equal(out.REASON, 'REPRO_HEAD_NOT_PASSING');
  assert.equal(out.REPRO_HEAD, 'failed');
});

test('base 侧绑定用例报错（error）而非断言失败：PASS_WITH_RISK 并披露 REPRO_BASE_ERROR', (t) => {
  const project = reproProject(t, {
    tests: ["{ name: 'TC-USER-020 BUG-USER-001 第 5 次失败即锁定', check: (user) => { if (user.lockAfter !== 5) throw new Error('crash'); return true; } }"],
  });
  const result = project.run();
  const out = fields(result.stdout);

  assert.equal(out.STATUS, 'OK', show(result));
  assert.equal(out.REPRO_VERDICT, 'PASS_WITH_RISK');
  assert.equal(out.REPRO_BASE, 'error');
  assert.match(result.stdout, /^REPRO_RISK=REPRO_BASE_ERROR\|/mu);
});

test('base 侧绑定用例被跳过：FAIL 并阻断为 REPRO_BASE_MISSING', (t) => {
  const project = reproProject(t, {
    tests: ["{ name: 'TC-USER-020 BUG-USER-001 第 5 次失败即锁定', check: (user) => (user.lockAfter === 5 ? true : 'skip') }"],
  });
  const out = fields(project.run().stdout);

  assert.equal(out.REASON, 'REPRO_BASE_MISSING');
  assert.equal(out.REPRO_BASE, 'skipped');
});

test('测试报告里没有绑定用例：两侧都记 missing，HEAD 侧先阻断', (t) => {
  const project = reproProject(t, {
    tests: ["{ name: '第 5 次失败即锁定（未引用任何 ID）', check: (user) => user.lockAfter === 5 }"],
  });
  const out = fields(project.run().stdout);

  assert.equal(out.REASON, 'REPRO_HEAD_NOT_PASSING');
  assert.equal(out.REPRO_HEAD, 'missing');
});

test('qa.repro.command 为空：阻断为 REPRO_COMMAND_MISSING，不创建临时 worktree', (t) => {
  const project = reproProject(t, { config: { qa: { repro: { command: '' } } } });
  const out = fields(project.run().stdout);

  assert.equal(out.STATUS, 'BLOCKED');
  assert.equal(out.REASON, 'REPRO_COMMAND_MISSING');
  assert.equal(fs.existsSync(runsRoot(project)), false);
});

test('qa.repro 含未知键：阻断为 REPRO_CONFIG_INVALID', (t) => {
  const project = reproProject(t, { config: { qa: { repro: { command: RUNNER_COMMAND, retries: 2 } } } });
  const out = fields(project.run().stdout);

  assert.equal(out.STATUS, 'BLOCKED');
  assert.equal(out.REASON, 'REPRO_CONFIG_INVALID');
});

test('qa.repro.enabled=false：阻断为 REPRO_DISABLED', (t) => {
  const project = reproProject(t, { config: { qa: { repro: { enabled: false, command: RUNNER_COMMAND } } } });
  const out = fields(project.run().stdout);

  assert.equal(out.STATUS, 'BLOCKED');
  assert.equal(out.REASON, 'REPRO_DISABLED');
});

test('BUG ID 不在 HEAD 的 TEST-DESIGN 中：REPRO_BUG_UNKNOWN；格式非法：REPRO_INVALID_INPUT', (t) => {
  const project = reproProject(t);
  assert.equal(fields(project.run(['--bug', 'BUG-USER-099', '--base', project.baseSha]).stdout).REASON, 'REPRO_BUG_UNKNOWN');
  assert.equal(fields(project.run(['--bug', 'user-1', '--base', project.baseSha]).stdout).REASON, 'REPRO_INVALID_INPUT');
  assert.equal(fields(project.run(['--base', project.baseSha]).stdout).REASON, 'REPRO_INVALID_INPUT');
});

test('工作区有未提交改动：阻断为 REPRO_WORKTREE_DIRTY', (t) => {
  const project = reproProject(t);
  project.write({ 'notes.txt': 'draft\n' });
  const out = fields(project.run().stdout);

  assert.equal(out.STATUS, 'BLOCKED');
  assert.equal(out.REASON, 'REPRO_WORKTREE_DIRTY');
});

test('模板源：输出 REPRO_GATE=SKIPPED 并直接通过', (t) => {
  const project = reproProject(t, { config: { template: { role: 'source' }, qa: { repro: { command: RUNNER_COMMAND } } } });
  const result = project.run();
  const out = fields(result.stdout);

  assert.equal(out.STATUS, 'OK', show(result));
  assert.equal(out.REPRO_GATE, 'SKIPPED');
  assert.equal(out.REPRO_VERDICT, undefined);
});

test('门禁：新增 BUG 行没有复现结果 → REPRO_MISSING，DEFECT_REPRO=0/1，NEW_DEFECTS=1', (t) => {
  const project = reproProject(t);
  const outcome = gate(project);

  assert.equal(outcome.status, 'BLOCKED');
  assert.deepEqual(codes(outcome.blocks), ['REPRO_MISSING']);
  assert.equal(outcome.blocks[0].subject, BUG);
  const lines = reproLines(outcome);
  assert.ok(lines.includes('REPRO_GATE=BLOCKED'), lines.join('\n'));
  assert.ok(lines.includes('DEFECT_REPRO=0/1'), lines.join('\n'));
  assert.ok(lines.includes('NEW_DEFECTS=1'), lines.join('\n'));
  assert.ok(lines.some((line) => line.startsWith(`REPRO_BLOCK=REPRO_MISSING|${BUG}|`)), lines.join('\n'));
});

test('门禁：复现 PASS 后通过，DEFECT_REPRO=1/1', (t) => {
  const project = reproProject(t);
  assert.equal(fields(project.run().stdout).REPRO_VERDICT, 'PASS');
  const outcome = gate(project);

  assert.equal(outcome.status, 'PASS', JSON.stringify(outcome));
  assert.deepEqual(outcome.defectRepro, { passed: 1, total: 1 });
  assert.equal(outcome.newDefects, 1);
  assert.ok(reproLines(outcome).includes('DEFECT_REPRO=1/1'));
});

test('门禁：复现后又有新提交 → REPRO_STALE', (t) => {
  const project = reproProject(t);
  project.run();
  project.commit({ 'README.md': 'later\n' });
  assert.deepEqual(codes(gate(project).blocks), ['REPRO_STALE']);
});

test('门禁：结果文件被改写（测试摘要不符）→ REPRO_STALE；无法解析 → REPRO_INVALID', (t) => {
  const project = reproProject(t);
  const file = fields(project.run().stdout).REPRO_RESULT_FILE;
  const record = readJson(file);
  fs.writeFileSync(file, JSON.stringify({ ...record, test_digest: '0'.repeat(64) }));
  assert.deepEqual(codes(gate(project).blocks), ['REPRO_STALE']);
  fs.writeFileSync(file, '{ not json');
  assert.deepEqual(codes(gate(project).blocks), ['REPRO_INVALID']);
});

test('门禁：复现结论为 FAIL → REPRO_FAILED', (t) => {
  const project = reproProject(t, { baseLockAfter: 5 });
  project.run();
  assert.deepEqual(codes(gate(project).blocks), ['REPRO_FAILED']);
});

test('门禁：复现结论为 PASS_WITH_RISK → 门禁 PASS_WITH_RISK 并携带 REPRO_BASE_ERROR', (t) => {
  const project = reproProject(t, {
    tests: ["{ name: 'TC-USER-020 BUG-USER-001 第 5 次失败即锁定', check: (user) => { if (user.lockAfter !== 5) throw new Error('crash'); return true; } }"],
  });
  project.run();
  const outcome = gate(project);

  assert.equal(outcome.status, 'PASS_WITH_RISK');
  assert.deepEqual(codes(outcome.risks), ['REPRO_BASE_ERROR']);
  assert.deepEqual(outcome.defectRepro, { passed: 1, total: 1 });
});

test('门禁：来源为 user 的 BUG 计入复现但不计入 NEW_DEFECTS', (t) => {
  const project = reproProject(t, { bugs: [[BUG, BUG_ROW[1], BUG_ROW[2], 'user', BUG_ROW[4], '-']] });
  const outcome = gate(project);

  assert.equal(outcome.newDefects, 0);
  assert.equal(outcome.defectRepro.total, 1);
});

test('门禁：本分支没有新增 BUG 行 → PASS 0/0', (t) => {
  const project = reproProject(t, { bugs: [] });
  const outcome = gate(project);

  assert.equal(outcome.status, 'PASS');
  assert.deepEqual(outcome.defectRepro, { passed: 0, total: 0 });
  assert.ok(reproLines(outcome).includes('DEFECT_REPRO=0/0'));
});

test('门禁：有新增 BUG 行但未配置 qa.repro.command → REPRO_COMMAND_MISSING', (t) => {
  const project = reproProject(t, { config: { qa: { repro: { command: '' } } } });
  assert.deepEqual(codes(gate(project).blocks), ['REPRO_COMMAND_MISSING']);
});

test('门禁：qa.repro.enabled=false → SKIPPED，有新增 BUG 行时披露 REPRO_DISABLED', (t) => {
  const project = reproProject(t, { config: { qa: { repro: { enabled: false, command: RUNNER_COMMAND } } } });
  const outcome = gate(project);

  assert.equal(outcome.status, 'SKIPPED');
  assert.deepEqual(codes(outcome.risks), ['REPRO_DISABLED']);
  assert.ok(reproLines(outcome).includes('REPRO_GATE=SKIPPED'));
});

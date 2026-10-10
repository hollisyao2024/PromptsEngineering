'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { resolveCommand } = require('../../agent-runner/agent-cli');
const { commitAll, createProject, prdDocument } = require('./fixtures/business-testing/builders');
const { createScenario } = require('./fixtures/business-testing/scenario');

const SCRIPT = path.join(__dirname, '..', 'qa-automate.js');
const PRD_FILE = 'docs/prd-modules/shop/PRD.md';

// 用例文件只引用 P0 auto AC（AC-SHOP-001-01/02）；P1 的 AC-SHOP-001-03 不是步骤 3 的完成条件。
const SPEC_FILE = {
  'tests/e2e/shop.spec.ts': [
    "test('AC-SHOP-001-01 / TC-SHOP-001 结算进入支付页', async () => {});",
    "test('AC-SHOP-001-02 / TC-SHOP-002 支付成功', async () => {});",
    '',
  ].join('\n'),
};

function automate(repo, args = ['--module', 'shop']) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const lines = result.stdout.split('\n');
  const value = (key) => (lines.find((line) => line.startsWith(`${key}=`)) || '').slice(key.length + 1);
  const steps = lines.filter((line) => line.startsWith('STEP=')).map((line) => line.slice(5).split('|'));
  return { result, lines, value, steps, state: (n) => (steps.find((step) => step[0] === String(n)) || [])[2] };
}

test('qa automate: 模块没有原子 AC 表时停在步骤 1 并指向 PRD 专家', (t) => {
  const project = createProject({ 'README.md': '# 空项目\n' }, { git: true });
  t.after(() => project.cleanup());

  const run = automate(project.repo);
  assert.equal(run.result.status, 0, run.result.stdout + run.result.stderr);
  assert.equal(run.value('STATUS'), 'PENDING');
  assert.equal(run.value('MODULE'), 'shop');
  assert.equal(run.value('CURRENT_STEP'), '1');
  assert.equal(run.state(1), 'pending');
  assert.equal(run.steps.length, 5);
  assert.match(run.value('ACTIVATE'), /\[\[ACTIVATE: PRD\]\]/);
  assert.match(run.value('READ'), /PRD-WRITER-EXPERT\.md/);
  assert.match(run.value('NEXT_ACTION'), /原子 AC/);
});

test('qa automate: AC 齐全但缺 PATHS.md 时停在步骤 2 并指向 QA 专家', (t) => {
  const project = createProject({ [PRD_FILE]: prdDocument() }, { git: true });
  t.after(() => project.cleanup());

  const run = automate(project.repo);
  assert.equal(run.value('STATUS'), 'PENDING');
  assert.equal(run.state(1), 'done');
  assert.equal(run.value('CURRENT_STEP'), '2');
  assert.equal(run.state(2), 'pending');
  assert.match(run.value('ACTIVATE'), /\[\[ACTIVATE: QA\]\]/);
  assert.ok(run.lines.some((line) => line.startsWith('VIOLATION=PATHS_MISSING|')), run.result.stdout);
});

test('qa automate: 用例已写但 qa.business 未登记套件时停在步骤 4', (t) => {
  const scenario = createScenario({ files: SPEC_FILE });
  t.after(() => scenario.cleanup());

  const run = automate(scenario.project.repo);
  assert.equal(run.value('STATUS'), 'PENDING');
  assert.deepEqual([1, 2, 3].map(run.state), ['done', 'done', 'done']);
  assert.equal(run.value('CURRENT_STEP'), '4');
  assert.equal(run.state(4), 'pending');
  assert.equal(run.state(5), 'pending');
  assert.match(run.value('NEXT_ACTION'), /qa\.business/);
});

test('qa automate: 用例未引用 P0 auto AC 时停在步骤 3 并列出缺口', (t) => {
  const scenario = createScenario({ files: { 'tests/e2e/shop.spec.ts': "test('AC-SHOP-001-01 结算', () => {});\n" } });
  t.after(() => scenario.cleanup());

  const run = automate(scenario.project.repo);
  assert.equal(run.value('CURRENT_STEP'), '3');
  assert.equal(run.state(3), 'pending');
  assert.ok(run.lines.includes('UNREFERENCED_AC=AC-SHOP-001-02'), run.result.stdout);
});

test('qa automate: 规格、用例、套件与新鲜的 qa run 结果齐备时 STATUS=OK', (t) => {
  const scenario = createScenario({ files: SPEC_FILE });
  t.after(() => scenario.cleanup());
  scenario.baseline();

  const run = automate(scenario.project.repo);
  assert.equal(run.result.status, 0, run.result.stdout + run.result.stderr);
  assert.equal(run.value('STATUS'), 'OK', run.result.stdout);
  assert.deepEqual([1, 2, 3, 4, 5].map(run.state), ['done', 'done', 'done', 'done', 'done']);
  assert.equal(run.value('CURRENT_STEP'), '-');

  // 结果之后又有新提交：结果不再证明 HEAD，回到步骤 5。
  scenario.project.write({ 'README.md': '# 新提交\n' });
  commitAll(scenario.project.repo, 'later change');
  const stale = automate(scenario.project.repo);
  assert.equal(stale.value('STATUS'), 'PENDING');
  assert.equal(stale.value('CURRENT_STEP'), '5');
  assert.match(stale.steps.find((step) => step[0] === '5')[3], /HEAD/);
});

test('qa automate: 缺少或非法的 --module 直接 BLOCKED', (t) => {
  const project = createProject({ 'README.md': '# 空项目\n' }, { git: true });
  t.after(() => project.cleanup());

  for (const args of [[], ['--module', '../etc']]) {
    const run = automate(project.repo, args);
    assert.notEqual(run.result.status, 0);
    assert.equal(run.value('STATUS'), 'BLOCKED');
  }
});

test('qa automate: agent CLI 路由到 qa-automate.js 并透传参数', () => {
  const resolved = resolveCommand(['qa', 'automate', '--module', 'shop']);
  assert.match(resolved.script, /qa-tools\/qa-automate\.js$/);
  assert.deepEqual(resolved.args, ['--module', 'shop']);
});

test('qa automate: 模块名大小写不同也解析到已有目录，并输出解析结果', (t) => {
  const scenario = createScenario({ files: SPEC_FILE });
  t.after(() => scenario.cleanup());

  const run = automate(scenario.project.repo, ['--module', 'SHOP']);
  assert.equal(run.value('MODULE'), 'shop', run.result.stdout);
  assert.equal(run.value('MODULE_RESOLVED'), 'SHOP->shop');
  assert.deepEqual([1, 2, 3].map(run.state), ['done', 'done', 'done']);
});

test('qa automate: 模块目录不存在时列出已有模块，避免静默停在步骤 1', (t) => {
  const project = createProject({ [PRD_FILE]: prdDocument() }, { git: true });
  t.after(() => project.cleanup());

  const run = automate(project.repo, ['--module', 'shopx']);
  assert.equal(run.value('STATUS'), 'PENDING');
  assert.equal(run.value('CURRENT_STEP'), '1');
  assert.equal(run.value('AVAILABLE_MODULES'), 'shop');
  assert.match(run.value('SUMMARY'), /docs\/prd-modules\/shopx\/ 不存在/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { resolveCommand } = require('../../agent-runner/agent-cli');
const { loadConfig } = require('../../shared/config');
const { resolveBusinessConfig } = require('../business-config');
const { resolveMutationConfig } = require('../qa-mutate');
const { resolveReproConfig } = require('../qa-repro');
const { SHOP_ACS, createProject, pathsDocument, prdDocument, runGit } = require('./fixtures/business-testing/builders');

const SCRIPT = path.join(__dirname, '..', 'qa-setup.js');
const PRD_FILE = 'docs/prd-modules/shop/PRD.md';
const PATHS_FILE = 'docs/qa-modules/shop/PATHS.md';
const SPEC_FILE = 'tests/e2e/shop.spec.ts';
const SPEC_TEXT = [
  "test('AC-SHOP-001-01 / TC-SHOP-001 结算进入支付页', async () => {});",
  "test('AC-SHOP-001-02 / TC-SHOP-002 支付成功', async () => {});",
  '',
].join('\n');
// SHOP 夹具里 AC-SHOP-001-02 声明了 web,ios；只检测得到 Playwright（web）时，ios 端没有套件可证明。
const WEB_ONLY_ACS = SHOP_ACS.map((row) => (row.platform === 'web,ios' ? { ...row, platform: 'web' } : row));

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const packageJson = (devDependencies) => json({ name: 'fixture', private: true, devDependencies });

// 主 worktree 在 <root>/repo，写入型运行在 <root>/wt 的 linked worktree 中进行。
function linkedProject(files) {
  const project = createProject(files, { git: true });
  const wt = path.join(project.root, 'wt');
  runGit(project.repo, ['worktree', 'add', '--quiet', wt, '-b', 'feature/qa-setup-fixture']);
  return { ...project, wt };
}

function setup(cwd, args = []) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  const lines = result.stdout.split('\n');
  const all = (key) => lines.filter((line) => line.startsWith(`${key}=`)).map((line) => line.slice(key.length + 1));
  const value = (key) => all(key)[0] ?? '';
  const gate = (name) => (all('GATE').find((line) => line.startsWith(`${name}|`)) || '').split('|');
  return { result, lines, all, value, gate, output: result.stdout + result.stderr };
}

const configPath = (dir) => path.join(dir, 'agent.config.json');
const readConfig = (dir) => JSON.parse(fs.readFileSync(configPath(dir), 'utf8'));
const readText = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

test('qa setup: 检测 vitest 与 Playwright，写入套件、repro 命令与报告目录忽略规则', (t) => {
  const project = linkedProject({
    'package.json': packageJson({ vitest: '^2.0.0', '@playwright/test': '^1.45.0' }),
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
  });
  t.after(() => project.cleanup());

  const run = setup(project.wt);
  assert.equal(run.result.status, 0, run.output);
  assert.equal(run.value('STATUS'), 'OK', run.output);
  assert.equal(run.value('MODE'), 'write');
  assert.ok(run.all('DETECTED').some((line) => line.startsWith('vitest|.|')), run.output);
  assert.ok(run.all('DETECTED').some((line) => line.startsWith('playwright|.|')), run.output);

  const config = readConfig(project.wt);
  assert.deepEqual(config.qa.business.suites, [
    {
      name: 'vitest',
      platform: '-',
      command: 'pnpm exec vitest run --reporter=default --reporter=junit --outputFile.junit="$PWD/reports/qa/vitest.junit.xml"',
      report: 'reports/qa/vitest.junit.xml',
    },
    {
      name: 'playwright',
      platform: 'web',
      command: 'PLAYWRIGHT_JUNIT_OUTPUT_FILE="$PWD/reports/qa/playwright.junit.xml" pnpm exec playwright test --reporter=list,junit',
      report: 'reports/qa/playwright.junit.xml',
    },
  ]);
  assert.equal(
    config.qa.repro.command,
    'pnpm exec vitest run -t "$XIRANG_REPRO_PATTERN" --reporter=default --reporter=junit --outputFile.junit="$XIRANG_REPRO_REPORT"',
  );
  // 没有规格：业务门禁不写开关，保持默认关闭；没有 Stryker：不碰变异门禁。
  assert.equal(config.qa.business.enabled, undefined);
  assert.equal(config.qa.mutation, undefined);
  assert.equal(run.gate('business')[1], 'off', run.output);
  assert.match(run.value('NEXT_ACTION'), /qa automate --all/);

  // 写出的配置能通过 qa run / qa repro 的严格校验。
  const merged = loadConfig({ repoRoot: project.wt, env: {}, cli: {} });
  const business = resolveBusinessConfig(merged);
  assert.equal(business.ok, true, JSON.stringify(business.errors));
  assert.doesNotThrow(() => resolveReproConfig(merged));

  // 报告目录被忽略：qa run 产出报告后工作区仍然干净。
  assert.match(readText(path.join(project.wt, '.gitignore')), /^reports\/qa\/$/m);
  const ignored = spawnSync('git', ['check-ignore', '-q', '--no-index', 'reports/qa/vitest.junit.xml'], { cwd: project.wt });
  assert.equal(ignored.status, 0);
});

test('qa setup --dry-run: 只输出计划，不写任何文件', (t) => {
  const project = linkedProject({
    'package.json': packageJson({ vitest: '^2.0.0' }),
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
  });
  t.after(() => project.cleanup());

  const run = setup(project.wt, ['--dry-run']);
  assert.equal(run.result.status, 0, run.output);
  assert.equal(run.value('MODE'), 'dry-run');
  assert.ok(run.all('WRITE').some((line) => line.startsWith('qa.business.suites|')), run.output);
  assert.equal(fs.existsSync(configPath(project.wt)), false);
  assert.equal(fs.existsSync(path.join(project.wt, '.gitignore')), false);
  assert.equal(runGit(project.wt, ['status', '--porcelain']).trim(), '');
});

test('qa setup: 重复运行幂等，第二次写入 0 项且文件不变', (t) => {
  const project = linkedProject({
    'package.json': packageJson({ vitest: '^2.0.0', '@stryker-mutator/core': '^8.0.0' }),
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
  });
  t.after(() => project.cleanup());

  const first = setup(project.wt);
  assert.equal(first.value('STATUS'), 'OK', first.output);
  assert.ok(first.all('WRITE').length > 0, first.output);
  const configBefore = readText(configPath(project.wt));
  const ignoreBefore = readText(path.join(project.wt, '.gitignore'));

  const second = setup(project.wt);
  assert.equal(second.value('STATUS'), 'OK', second.output);
  assert.deepEqual(second.all('WRITE'), [], second.output);
  assert.equal(readText(configPath(project.wt)), configBefore);
  assert.equal(readText(path.join(project.wt, '.gitignore')), ignoreBefore);
});

test('qa setup: 项目已写的键保留不动并输出 SKIP', (t) => {
  const suite = { name: 'custom', command: 'make test', report: 'out/custom.xml' };
  const project = linkedProject({
    'package.json': packageJson({ vitest: '^2.0.0' }),
    'agent.config.json': json({ qa: { repro: { command: 'make repro' }, business: { suites: [suite] } } }),
  });
  t.after(() => project.cleanup());

  const run = setup(project.wt);
  assert.equal(run.value('STATUS'), 'OK', run.output);
  const config = readConfig(project.wt);
  assert.equal(config.qa.repro.command, 'make repro');
  assert.deepEqual(config.qa.business.suites, [suite]);
  assert.ok(run.all('SKIP').some((line) => line.startsWith('qa.repro.command|')), run.output);
  assert.ok(run.all('SKIP').some((line) => line.startsWith('qa.business.suites|')), run.output);
  assert.equal(run.all('WRITE').some((line) => line.startsWith('qa.business.suites|')), false, run.output);
});

test('qa setup: 显式 enabled:false 的门禁整节跳过', (t) => {
  const project = linkedProject({
    'package.json': packageJson({ vitest: '^2.0.0', '@stryker-mutator/core': '^8.0.0' }),
    'agent.config.json': json({ qa: { repro: { enabled: false }, mutation: { enabled: false } } }),
  });
  t.after(() => project.cleanup());

  const run = setup(project.wt);
  assert.equal(run.value('STATUS'), 'OK', run.output);
  const config = readConfig(project.wt);
  assert.deepEqual(config.qa.repro, { enabled: false });
  assert.deepEqual(config.qa.mutation, { enabled: false });
  assert.ok(run.all('SKIP').some((line) => line.startsWith('qa.repro|')), run.output);
  assert.ok(run.all('SKIP').some((line) => line.startsWith('qa.mutation|')), run.output);
  assert.equal(run.gate('mutation')[1], 'off');
});

test('qa setup: 根目录装了 Stryker 时开启变异门禁', (t) => {
  const project = linkedProject({
    'package.json': packageJson({ vitest: '^2.0.0', '@stryker-mutator/core': '^8.0.0' }),
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
  });
  t.after(() => project.cleanup());

  const run = setup(project.wt);
  assert.equal(run.value('STATUS'), 'OK', run.output);
  const config = readConfig(project.wt);
  assert.deepEqual(config.qa.mutation, {
    enabled: true,
    command: 'pnpm exec stryker run --mutate "$XIRANG_MUTATE_FILES" --reporters json',
    report: 'reports/mutation/mutation.json',
  });
  assert.equal(run.gate('mutation')[1], 'on');
  assert.match(readText(path.join(project.wt, '.gitignore')), /^reports\/mutation\/$/m);
  assert.doesNotThrow(() => resolveMutationConfig(loadConfig({ repoRoot: project.wt, env: {}, cli: {} })));
});

test('qa setup: 规格、用例、套件都就绪时自动开启业务门禁', (t) => {
  const project = linkedProject({
    'package.json': packageJson({ '@playwright/test': '^1.45.0' }),
    [PRD_FILE]: prdDocument(WEB_ONLY_ACS),
    [PATHS_FILE]: pathsDocument(),
    [SPEC_FILE]: SPEC_TEXT,
  });
  t.after(() => project.cleanup());

  const run = setup(project.wt);
  assert.equal(run.value('STATUS'), 'OK', run.output);
  assert.equal(readConfig(project.wt).qa.business.enabled, true);
  assert.equal(run.gate('business')[1], 'on', run.output);
  assert.match(run.value('NEXT_ACTION'), /qa run/);
});

test('qa setup: 必需 AC 的端没有对应套件时业务门禁保持关闭', (t) => {
  const project = linkedProject({
    'package.json': packageJson({ '@playwright/test': '^1.45.0' }),
    [PRD_FILE]: prdDocument(),
    [PATHS_FILE]: pathsDocument(),
    [SPEC_FILE]: SPEC_TEXT,
  });
  t.after(() => project.cleanup());

  const run = setup(project.wt);
  assert.equal(run.value('STATUS'), 'OK', run.output);
  assert.equal(readConfig(project.wt).qa.business.enabled, undefined);
  assert.equal(run.gate('business')[1], 'off');
  assert.match(run.gate('business').slice(2).join('|'), /PLATFORM_SUITE_MISSING.*ios/);
});

test('qa setup: 必需 AC 没有用例引用时业务门禁保持关闭', (t) => {
  const project = linkedProject({
    'package.json': packageJson({ '@playwright/test': '^1.45.0' }),
    [PRD_FILE]: prdDocument(WEB_ONLY_ACS),
    [PATHS_FILE]: pathsDocument(),
    [SPEC_FILE]: "test('AC-SHOP-001-01 结算', async () => {});\n",
  });
  t.after(() => project.cleanup());

  const run = setup(project.wt);
  assert.equal(readConfig(project.wt).qa.business.enabled, undefined);
  assert.match(run.gate('business').slice(2).join('|'), /UNREFERENCED_AC.*AC-SHOP-001-02/);
});

test('qa setup: 成员包与 pytest 的命令进入成员目录并以 $PWD 锚定报告', (t) => {
  const project = linkedProject({
    'apps/web/package.json': packageJson({ vitest: '^2.0.0' }),
    'pyproject.toml': '[project]\nname = "fixture"\n\n[dependency-groups]\ndev = ["pytest>=8"]\n',
    'uv.lock': 'version = 1\n',
  });
  t.after(() => project.cleanup());

  const run = setup(project.wt);
  assert.equal(run.value('STATUS'), 'OK', run.output);
  const config = readConfig(project.wt);
  assert.deepEqual(config.qa.business.suites, [
    {
      name: 'pytest',
      platform: '-',
      command: 'uv run pytest --junitxml="$PWD/reports/qa/pytest.junit.xml"',
      report: 'reports/qa/pytest.junit.xml',
    },
    {
      name: 'web-vitest',
      platform: '-',
      command: 'cd apps/web && npx --no-install vitest run --reporter=default --reporter=junit --outputFile.junit="$PWD/../../reports/qa/web-vitest.junit.xml"',
      report: 'reports/qa/web-vitest.junit.xml',
    },
  ]);
  assert.equal(config.qa.repro.command, 'uv run pytest --junitxml="$XIRANG_REPRO_REPORT"');
});

test('qa setup: 缺 jest-junit 的 Jest 与 Go 只给出手动步骤，不登记套件', (t) => {
  const project = linkedProject({
    'package.json': packageJson({ jest: '^29.0.0' }),
    'go.mod': 'module example.com/fixture\n\ngo 1.22\n',
  });
  t.after(() => project.cleanup());

  const run = setup(project.wt);
  assert.equal(run.value('STATUS'), 'OK', run.output);
  assert.ok(run.all('MANUAL').some((line) => line.startsWith('jest|.|') && line.includes('jest-junit')), run.output);
  assert.ok(run.all('MANUAL').some((line) => line.startsWith('go|.|') && line.includes('gotestsum')), run.output);
  assert.equal(fs.existsSync(configPath(project.wt)), false, run.output);
});

test('qa setup: .gitignore 已忽略报告目录时不重复追加', (t) => {
  const project = linkedProject({
    'package.json': packageJson({ vitest: '^2.0.0' }),
    '.gitignore': 'reports/\n',
  });
  t.after(() => project.cleanup());

  const run = setup(project.wt);
  assert.equal(run.value('STATUS'), 'OK', run.output);
  assert.equal(readText(path.join(project.wt, '.gitignore')), 'reports/\n');
  assert.equal(run.all('WRITE').some((line) => line.startsWith('.gitignore|')), false, run.output);
});

test('qa setup: 主 worktree 上写入被阻断，dry-run 仍可预览', (t) => {
  const project = linkedProject({ 'package.json': packageJson({ vitest: '^2.0.0' }) });
  t.after(() => project.cleanup());

  const blocked = setup(project.repo);
  assert.equal(blocked.result.status, 1, blocked.output);
  assert.equal(blocked.value('STATUS'), 'BLOCKED');
  assert.match(blocked.value('NEXT_ACTION'), /worktree new/);
  assert.equal(fs.existsSync(configPath(project.repo)), false);

  const preview = setup(project.repo, ['--dry-run']);
  assert.equal(preview.result.status, 0, preview.output);
  assert.equal(preview.value('MODE'), 'dry-run');
});

test('qa setup: 模板源仓库输出 SKIPPED 且不写文件', (t) => {
  const source = json({ template: { role: 'source' } });
  const project = linkedProject({ 'package.json': packageJson({ vitest: '^2.0.0' }), 'agent.config.json': source });
  t.after(() => project.cleanup());

  const run = setup(project.wt);
  assert.equal(run.result.status, 0, run.output);
  assert.equal(run.value('STATUS'), 'SKIPPED');
  assert.equal(readText(configPath(project.wt)), source);
});

test('qa setup: agent.config.json 非法时 BLOCKED 且不写任何文件', (t) => {
  const project = linkedProject({ 'package.json': packageJson({ vitest: '^2.0.0' }), 'agent.config.json': '{ broken' });
  t.after(() => project.cleanup());

  const run = setup(project.wt);
  assert.equal(run.result.status, 1, run.output);
  assert.equal(run.value('STATUS'), 'BLOCKED');
  assert.equal(readText(configPath(project.wt)), '{ broken');
  assert.equal(fs.existsSync(path.join(project.wt, '.gitignore')), false);
});

test('qa setup: 合并后的 qa 配置不合法时 BLOCKED 且不写任何文件', (t) => {
  const broken = json({ qa: { business: { enable: true } } });
  const project = linkedProject({ 'package.json': packageJson({ vitest: '^2.0.0' }), 'agent.config.json': broken });
  t.after(() => project.cleanup());

  const run = setup(project.wt);
  assert.equal(run.result.status, 1, run.output);
  assert.equal(run.value('STATUS'), 'BLOCKED');
  assert.match(run.value('SUMMARY'), /qa\.business\.enable/);
  assert.equal(readText(configPath(project.wt)), broken);
  assert.equal(fs.existsSync(path.join(project.wt, '.gitignore')), false);
});

test('qa setup: 未知参数 BLOCKED 并以 2 退出', (t) => {
  const project = linkedProject({ 'README.md': '# 空项目\n' });
  t.after(() => project.cleanup());

  const run = setup(project.wt, ['--force']);
  assert.equal(run.result.status, 2, run.output);
  assert.equal(run.value('STATUS'), 'BLOCKED');
});

test('qa setup: agent CLI 路由到 qa-setup.js 并透传参数', () => {
  const resolved = resolveCommand(['qa', 'setup', '--dry-run']);
  assert.match(resolved.script, /qa-tools\/qa-setup\.js$/);
  assert.deepEqual(resolved.args, ['--dry-run']);
});

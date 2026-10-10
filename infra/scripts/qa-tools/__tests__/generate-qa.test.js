'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  generateModuleQA,
  generateModuleList,
  generateProjectOverview,
  getQaPlanSessionStatePath,
  inferSessionModules,
  parsePRD,
  planModuleQaWrite,
  validateModuleEntriesForGeneration,
  validateUpstreamModuleAlignment,
} = require('../generate-qa');
const { splitTableRow } = require('../business-spec');
const {
  AC_COLUMNS,
  acRowCells,
  createProject,
  mdTable,
} = require('./fixtures/business-testing/builders');

const SCRIPT = path.join(__dirname, '..', 'generate-qa.js');
// The CLI colors its lines; the parsable block is matched on the plain text.
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/gu, '');

test('module QA links resolve from the generated file to their actual documents', () => {
  for (const qaPath of ['docs/qa-modules/auth/QA.md', 'reports/quality/nested/auth/QA.md']) {
    const entry = {
      moduleDir: 'auth', moduleName: 'Auth', qaPath,
      prdPath: 'docs/prd-modules/auth/PRD.md',
      stories: [{ id: 'US-AUTH-001', domain: 'AUTH' }],
    };
    const markdown = generateModuleQA(entry);
    for (const [label, target] of [
      ['所属主 QA', 'docs/QA.md'],
      ['模块 PRD', entry.prdPath],
      ['模块 ARCH', 'docs/arch-modules/auth/ARCH.md'],
      ['模块 TASK', 'docs/task-modules/auth/TASK.md'],
    ]) {
      const line = markdown.split('\n').find((value) => value.includes(label));
      const href = line.match(/\]\(([^)]+)\)/)[1];
      assert.equal(path.posix.normalize(path.posix.join(path.posix.dirname(qaPath), href)), target, label);
      assert.equal(href.includes('\\'), false);
    }
  }
});

const modules = [
  {
    moduleDir: 'auth',
    moduleName: 'Auth',
    qaPath: 'docs/qa-modules/auth/QA.md',
    stories: [{ id: 'US-AUTH-001' }],
  },
];

test('project QA overview always indexes module QA documents', () => {
  const markdown = generateProjectOverview(modules);

  assert.match(markdown, /作为测试总纲与模块索引/);
  assert.match(markdown, /qa-modules\/auth\/QA\.md/);
  assert.doesNotMatch(markdown, /大型项目|小型项目|单一 QA/);
});

test('project QA generation includes a canonical module list', () => {
  const markdown = generateModuleList(modules);

  assert.match(markdown, /# QA 模块清单/);
  assert.match(markdown, /\| Auth \| auth \| \[auth\/QA\.md\]/);
});

test('QA generation detects upstream module set drift', () => {
  const result = validateUpstreamModuleAlignment(modules, ['auth', 'orphan'], []);

  assert.deepEqual(result.missingArch, []);
  assert.deepEqual(result.extraArch, ['orphan']);
  assert.deepEqual(result.missingTask, ['auth']);
  assert.deepEqual(result.extraTask, []);
});

test('QA plan session state defaults to the container worktree session directory', () => {
  const mainRoot = '/workspace/project/repo';
  const worktreeRoot = '/workspace/project/worktrees/fix-a';
  const statePath = getQaPlanSessionStatePath({
    env: {},
    mainRoot,
    worktreeRoot,
    config: { worktree: { sessionDir: '../tmp/worktree-sessions' } },
  });

  assert.equal(
    path.dirname(statePath),
    path.resolve(mainRoot, '../tmp/worktree-sessions/qa-plan'),
  );
  assert.match(path.basename(statePath), /^fix-a-[a-f0-9]{12}\.json$/);
});

test('QA plan session state is stable per worktree and isolated across worktrees', () => {
  const options = {
    env: {},
    mainRoot: '/workspace/project/repo',
    config: { worktree: { sessionDir: '../tmp/worktree-sessions' } },
  };
  const first = getQaPlanSessionStatePath({
    ...options,
    worktreeRoot: '/workspace/project/worktrees/fix-a',
  });
  const firstAgain = getQaPlanSessionStatePath({
    ...options,
    worktreeRoot: '/workspace/project/worktrees/fix-a',
  });
  const second = getQaPlanSessionStatePath({
    ...options,
    worktreeRoot: '/workspace/project/worktrees/fix-b',
  });

  assert.equal(firstAgain, first);
  assert.notEqual(second, first);
});

test('QA plan session state path keeps the explicit environment override', () => {
  const statePath = getQaPlanSessionStatePath({
    env: { QA_PLAN_SESSION_STATE_PATH: '/custom/qa-session.json' },
  });

  assert.equal(statePath, '/custom/qa-session.json');
});

test('QA plan does not overwrite a manually maintained module QA document', () => {
  const decision = planModuleQaWrite({
    existingContent: '# QA\n\n人工 Phase 16 验收计划\n',
    generatedContent: '# generated\n',
  });

  assert.deepEqual(decision, {
    action: 'preserve',
    content: '# QA\n\n人工 Phase 16 验收计划\n',
    reason: 'manual-document',
  });
});

test('QA plan may refresh a document that declares generator ownership', () => {
  const decision = planModuleQaWrite({
    existingContent: '# QA\n\n<!-- QA-GENERATED: generate-qa.js -->\nold\n',
    generatedContent: '# QA\n\n<!-- QA-GENERATED: generate-qa.js -->\nnew\n',
  });

  assert.equal(decision.action, 'write');
  assert.match(decision.content, /new/);
});

test('QA ownership marker is authoritative only immediately after the H1', () => {
  const existing = '# QA\n\nManual text quotes <!-- QA-GENERATED: generate-qa.js --> later.\n';
  assert.equal(planModuleQaWrite({ existingContent: existing, generatedContent: '# new\n' }).action, 'preserve');
});

test('QA generation fails closed when any module parses zero stories', () => {
  assert.throws(
    () => validateModuleEntriesForGeneration([
      modules[0],
      { moduleDir: 'empty', moduleName: 'Empty', stories: [] },
    ]),
    /zero stories.*empty/i
  );
});

// ---- Story table / AC table awareness

const STORY_TABLE_HEADER = ['Story ID', '用户故事', '优先级', '依赖', '预估工时'];

// A PRD the way a real project writes it: a banner naming another module's Story, a
// Story table whose dependency column does the same, the atomic AC table, and prose
// that keeps repeating this module's own Story ids.
function shopPrd(acs, storyIds = ['US-SHOP-001', 'US-SHOP-002', 'US-SHOP-003']) {
  const storyRows = storyIds.map((id, index) => [
    id, `作为买家完成第 ${index + 1} 项购物`, 'P0', index === 0 ? '依赖 US-USER-001' : '-', '3d',
  ]);
  return [
    '# 购物模块 PRD',
    '',
    '> 登录态由 US-USER-001 提供（见用户模块 PRD）。',
    '',
    '## 用户故事',
    '',
    mdTable(STORY_TABLE_HEADER, storyRows),
    '',
    '### 原子 AC 清单',
    '',
    mdTable(AC_COLUMNS, acs.map((ac) => acRowCells(ac))),
    '',
    '正文反复提到 US-SHOP-001、US-SHOP-002、US-SHOP-001。',
    '',
  ].join('\n');
}

// What buildModuleEntries hands to generateModuleQA, built from parsePRD output.
function shopEntry(content) {
  const parsed = parsePRD(content);
  return {
    moduleDir: 'shop',
    moduleName: '购物模块',
    qaPath: 'docs/qa-modules/shop/QA.md',
    prdPath: 'docs/prd-modules/shop/PRD.md',
    stories: parsed.stories,
    acs: parsed.acs,
    moduleId: parsed.moduleId,
  };
}

function tcIds(markdown) {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('| TC-'))
    .map((line) => splitTableRow(line)[0]);
}

function rowFor(markdown, tcId) {
  const line = markdown.split('\n').find((value) => value.startsWith(`| ${tcId} |`));
  assert.ok(line, `no table row for ${tcId}`);
  return splitTableRow(line);
}

function sectionBetween(markdown, start, end) {
  const from = markdown.indexOf(start);
  assert.notEqual(from, -1, `missing section ${start}`);
  const to = markdown.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section end ${end}`);
  return markdown.slice(from, to);
}

// TC-SHOP-010 is shared by two ACs, TC-SHOP-011 by two ACs of different Stories, and
// the manual AC has no test case yet.
const GROUPED_ACS = [
  { id: 'AC-SHOP-001-01', story: 'US-SHOP-001', priority: 'P1', given: '购物车内有商品', tc: 'TC-SHOP-010' },
  { id: 'AC-SHOP-001-02', story: 'US-SHOP-001', priority: 'P0', given: '位于支付页', tc: 'TC-SHOP-010, TC-SHOP-011' },
  { id: 'AC-SHOP-002-01', story: 'US-SHOP-002', priority: 'P2', tc: 'TC-SHOP-011' },
  { id: 'AC-SHOP-002-02', story: 'US-SHOP-002', priority: 'P1', verification: 'manual', platform: '-', tc: '-' },
];

test('parsePRD takes Stories from the Story table and the AC table, not from every mention', () => {
  const parsed = parsePRD(shopPrd(GROUPED_ACS));

  assert.deepEqual(parsed.stories.map((story) => story.id), ['US-SHOP-001', 'US-SHOP-002', 'US-SHOP-003']);
  assert.deepEqual(parsed.stories[0], { id: 'US-SHOP-001', domain: 'SHOP', number: 1 });
  assert.deepEqual(parsed.domains, ['SHOP']);
  assert.equal(parsed.moduleId, 'SHOP');
  assert.deepEqual(parsed.acs.map((ac) => ac.id), GROUPED_ACS.map((ac) => ac.id));
});

test('parsePRD keeps module ids that contain digits or several segments', () => {
  const multiSegment = parsePRD([
    '# 多段模块 PRD',
    '',
    mdTable(STORY_TABLE_HEADER, [
      ['US-MODEL-CONFIG-001', '模型配置', 'P0', '-', '1d'],
      ['US-MODEL-CONFIG-002', '模型切换', 'P1', '-', '1d'],
    ]),
    '',
  ].join('\n'));
  assert.deepEqual(multiSegment.stories.map((story) => story.id), ['US-MODEL-CONFIG-001', 'US-MODEL-CONFIG-002']);
  assert.deepEqual(multiSegment.domains, ['MODEL-CONFIG']);
  assert.equal(multiSegment.moduleId, 'MODEL-CONFIG');

  const withDigits = parsePRD(['# 端到端 PRD', '', mdTable(STORY_TABLE_HEADER, [['US-E2E-001', '端到端', 'P0', '-', '1d']]), ''].join('\n'));
  assert.deepEqual(withDigits.stories.map((story) => story.id), ['US-E2E-001']);
  assert.equal(withDigits.moduleId, 'E2E');
});

test('parsePRD leaves Stories of other modules listed in the first column out of the module', () => {
  const parsed = parsePRD([
    '# 模型配置 PRD',
    '',
    mdTable(STORY_TABLE_HEADER, [
      ['US-MODEL-CONFIG-001', '模型配置', 'P0', '依赖 US-E2E-001', '1d'],
      ['US-MODEL-CONFIG-002', '模型切换', 'P1', '-', '1d'],
    ]),
    '',
    mdTable(['依赖 Story', '提供方'], [['US-E2E-001', '端到端模块']]),
    '',
  ].join('\n'));

  assert.deepEqual(parsed.stories.map((story) => story.id), ['US-MODEL-CONFIG-001', 'US-MODEL-CONFIG-002']);
  assert.equal(parsed.moduleId, 'MODEL-CONFIG');
});

test('parsePRD falls back to distinct Story mentions when the PRD has neither table', () => {
  const content = '# 登录模块 PRD\n\n- US-AUTH-001 登录\n- US-AUTH-002 登出\n\n回顾 US-AUTH-001，并见 US-AUTH-001。\n';

  const parsed = parsePRD(content);

  assert.deepEqual(parsed.stories.map((story) => story.id), ['US-AUTH-001', 'US-AUTH-002']);
  assert.deepEqual(parsed.acs, []);
  assert.equal(parsed.moduleId, null);
});

test('parsePRD returns an empty result for empty content', () => {
  for (const content of ['', null, undefined]) {
    assert.deepEqual(parsePRD(content), { stories: [], domains: [], acs: [], moduleId: null });
  }
});

test('module QA takes its test cases from the AC table TC column instead of inventing ids', () => {
  const markdown = generateModuleQA(shopEntry(shopPrd(GROUPED_ACS)));

  assert.match(markdown, /\| 用例 ID \| 用例名称 \| 关联 Story \| 优先级 \| 前置条件 \| 状态 \| 执行人 \|/u);
  assert.deepEqual(tcIds(markdown), ['TC-SHOP-010', 'TC-SHOP-011']);
  assert.doesNotMatch(markdown, /TC-SHOP-00\d/u);
  assert.doesNotMatch(markdown, /（更多）/u);

  const first = rowFor(markdown, 'TC-SHOP-010');
  assert.equal(first.length, 7);
  assert.match(first[1], /AC-SHOP-001-01/u);
  assert.match(first[1], /AC-SHOP-001-02/u);
  assert.equal(first[2], 'US-SHOP-001');
  assert.equal(first[3], 'P0');
  assert.equal(first[4], '购物车内有商品');
  assert.equal(first[5], '📝 待执行');
  assert.equal(first[6], 'TBD');

  const second = rowFor(markdown, 'TC-SHOP-011');
  assert.equal(second.length, 7);
  assert.equal(second[2], 'US-SHOP-001、US-SHOP-002');
  assert.equal(second[3], 'P0');
  assert.equal(second[4], '位于支付页');
});

test('module QA counts the distinct test cases the AC table names', () => {
  const markdown = generateModuleQA(shopEntry(shopPrd(GROUPED_ACS)));

  assert.match(markdown, /包含 3 个用户故事/u);
  assert.match(markdown, /测试用例总数：2 条/u);
  assert.match(markdown, /\*\*总用例数\*\*：2 条/u);
  assert.doesNotMatch(markdown, /（预估）/u);
});

test('module QA lists the acceptance criteria and Stories that have no registered test case', () => {
  const markdown = generateModuleQA(shopEntry(shopPrd(GROUPED_ACS)));
  const gaps = sectionBetween(markdown, '### 3.2 尚未登记用例的验收标准', '\n---');

  assert.match(gaps, /AC-SHOP-002-02/u);
  assert.match(gaps, /US-SHOP-003/u);
  assert.doesNotMatch(gaps, /AC-SHOP-001-01/u);
  assert.doesNotMatch(gaps, /AC-SHOP-001-02/u);
  assert.doesNotMatch(gaps, /AC-SHOP-002-01/u);
  assert.ok(markdown.indexOf('### 3.2') > markdown.indexOf('### 3.1'));
  assert.ok(markdown.indexOf('### 3.2') < markdown.indexOf('## 4. 缺陷列表'));
});

test('module QA omits the gap section when every AC has a test case and every Story has ACs', () => {
  const acs = [
    { id: 'AC-SHOP-001-01', story: 'US-SHOP-001', tc: 'TC-SHOP-001' },
    { id: 'AC-SHOP-002-01', story: 'US-SHOP-002', tc: 'TC-SHOP-002' },
  ];

  const markdown = generateModuleQA(shopEntry(shopPrd(acs, ['US-SHOP-001', 'US-SHOP-002'])));

  assert.deepEqual(tcIds(markdown), ['TC-SHOP-001', 'TC-SHOP-002']);
  assert.doesNotMatch(markdown, /### 3\.2/u);
});

test('module QA escapes pipes copied from the AC table so every row keeps seven cells', () => {
  const acs = [{ id: 'AC-SHOP-001-01', story: 'US-SHOP-001', given: '输入 a\\|b', tc: 'TC-SHOP-001' }];
  const entry = shopEntry(shopPrd(acs, ['US-SHOP-001']));
  assert.equal(entry.acs[0].given, '输入 a|b');

  const row = rowFor(generateModuleQA(entry), 'TC-SHOP-001');

  assert.equal(row.length, 7);
  assert.equal(row[4], '输入 a|b');
});

test('module QA lists every test case the AC table names, without the ten-row cap', () => {
  const acs = Array.from({ length: 12 }, (_, index) => ({
    id: `AC-SHOP-001-${String(index + 1).padStart(2, '0')}`,
    story: 'US-SHOP-001',
    tc: `TC-SHOP-${101 + index}`,
  }));

  const markdown = generateModuleQA(shopEntry(shopPrd(acs, ['US-SHOP-001'])));

  assert.deepEqual(tcIds(markdown), acs.map((ac) => ac.tc));
  assert.doesNotMatch(markdown, /（更多）/u);
});

test('test-case prefix follows the module id, not the first Story mentioned', () => {
  const entry = {
    moduleDir: 'shop',
    moduleName: '购物模块',
    qaPath: 'docs/qa-modules/shop/QA.md',
    prdPath: 'docs/prd-modules/shop/PRD.md',
    stories: [{ id: 'US-USER-001', domain: 'USER' }, { id: 'US-SHOP-001', domain: 'SHOP' }],
    moduleId: 'SHOP',
  };

  assert.deepEqual(tcIds(generateModuleQA(entry)), ['TC-SHOP-001', 'TC-SHOP-002']);
});

test('a Story-table-only PRD that quotes another module first still gets its own prefix', () => {
  const content = [
    '# 购物模块 PRD',
    '',
    '> 登录态由 US-USER-001 提供。',
    '',
    mdTable(STORY_TABLE_HEADER, [
      ['US-SHOP-001', '结算', 'P0', '依赖 US-USER-001', '3d'],
      ['US-SHOP-002', '退款', 'P1', '-', '2d'],
    ]),
    '',
  ].join('\n');

  const entry = shopEntry(content);

  assert.equal(entry.stories.length, 2);
  assert.deepEqual(tcIds(generateModuleQA(entry)), ['TC-SHOP-001', 'TC-SHOP-002']);
});

test('without an AC table the generated test cases keep the legacy skeleton', () => {
  const entry = {
    moduleDir: 'auth',
    moduleName: 'Auth',
    qaPath: 'docs/qa-modules/auth/QA.md',
    prdPath: 'docs/prd-modules/auth/PRD.md',
    stories: [{ id: 'US-AUTH-001', domain: 'AUTH' }, { id: 'US-AUTH-002', domain: 'AUTH' }],
  };

  const markdown = generateModuleQA(entry);
  assert.deepEqual(tcIds(markdown), ['TC-AUTH-001', 'TC-AUTH-002']);
  assert.match(markdown, /测试用例总数：6 条（预估）/u);
  assert.doesNotMatch(markdown, /### 3\.2/u);

  const many = generateModuleQA({
    ...entry,
    stories: Array.from({ length: 11 }, (_, index) => ({
      id: `US-AUTH-${String(index + 1).padStart(3, '0')}`,
      domain: 'AUTH',
    })),
  });
  assert.equal(tcIds(many).length, 10);
  assert.match(many, /\| （更多） \|/u);
});

test('qa plan --project writes the QA documents from the Story table and the AC table', (t) => {
  const project = createProject({
    'docs/PRD.md': '# 项目 PRD\n\n各模块 PRD 见 docs/prd-modules/。\n',
    'docs/prd-modules/shop/PRD.md': shopPrd(GROUPED_ACS),
    'docs/arch-modules/shop/ARCH.md': '# 购物模块 ARCH\n',
    'docs/task-modules/shop/TASK.md': '# 购物模块 TASK\n',
  }, { git: true });
  t.after(() => project.cleanup());

  const result = spawnSync(process.execPath, [SCRIPT, '--project'], { cwd: project.repo, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const lines = stripAnsi(result.stdout).split('\n');
  assert.ok(lines.includes('STATUS=OK'), result.stdout);
  assert.ok(lines.some((line) => line.startsWith('SUMMARY=')), result.stdout);
  assert.ok(lines.some((line) => line.startsWith('NEXT_ACTION=')), result.stdout);

  const read = (relative) => fs.readFileSync(path.join(project.repo, relative), 'utf8');
  const moduleQa = read('docs/qa-modules/shop/QA.md');
  assert.deepEqual(tcIds(moduleQa), ['TC-SHOP-010', 'TC-SHOP-011']);
  assert.match(moduleQa, /### 3\.2 尚未登记用例的验收标准/u);
  assert.match(read('docs/qa-modules/module-list.md'), /\| shop \| \[shop\/QA\.md\]\(shop\/QA\.md\) \| 3 \|/u);
  assert.match(read('docs/QA.md'), /3 个 Story，1 个模块/u);
});

// A PRD/ARCH/TASK module-set mismatch is a gate, not a crash: the CLI names every missing or extra module on its own
// line and ends with a BLOCKED block carrying a stable reason code, so a caller can act without parsing JSON.
test('qa plan blocks a PRD/ARCH/TASK module-set mismatch with a parsable reason and per-module lines', (t) => {
  const project = createProject({
    'docs/PRD.md': '# 项目 PRD\n\n各模块 PRD 见 docs/prd-modules/。\n',
    'docs/prd-modules/shop/PRD.md': shopPrd(GROUPED_ACS),
    'docs/arch-modules/billing/ARCH.md': '# 计费模块 ARCH\n',
    'docs/task-modules/shop/TASK.md': '# 购物模块 TASK\n',
  }, { git: true });
  t.after(() => project.cleanup());

  const result = spawnSync(process.execPath, [SCRIPT, '--project'], { cwd: project.repo, encoding: 'utf8' });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  const lines = stripAnsi(result.stdout).split('\n');
  assert.ok(lines.includes('MODULE_SET_MISMATCH=missingArch|shop'), result.stdout);
  assert.ok(lines.includes('MODULE_SET_MISMATCH=extraArch|billing'), result.stdout);
  assert.ok(lines.includes('STATUS=BLOCKED'), result.stdout);
  assert.ok(lines.includes('REASON=MODULE_SET_MISMATCH'), result.stdout);
  assert.ok(lines.some((line) => line.startsWith('SUMMARY=') && line.includes('PRD/ARCH/TASK')), result.stdout);
  assert.ok(lines.some((line) => line.startsWith('NEXT_ACTION=')), result.stdout);
  assert.equal(fs.existsSync(path.join(project.repo, 'docs/qa-modules/shop/QA.md')), false);
});

test('qa plan blocks a missing root PRD with a parsable reason', (t) => {
  const project = createProject({
    'docs/prd-modules/shop/PRD.md': shopPrd(GROUPED_ACS),
  }, { git: true });
  t.after(() => project.cleanup());

  const result = spawnSync(process.execPath, [SCRIPT, '--project'], { cwd: project.repo, encoding: 'utf8' });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  const lines = stripAnsi(result.stdout).split('\n');
  assert.ok(lines.includes('STATUS=BLOCKED'), result.stdout);
  assert.ok(lines.includes('REASON=PRD_MISSING'), result.stdout);
});

const sessionModules = (moduleDirs, changedFiles, branchName = '') =>
  inferSessionModules(moduleDirs.map((moduleDir) => ({ moduleDir })), changedFiles, branchName)
    .map((entry) => entry.moduleDir);

test('session modules come only from module documents when the diff touches any', () => {
  assert.deepEqual(
    sessionModules(['admin', 'agent', 'auth'], [
      'docs/qa-modules/admin/PATHS.md',
      'docs/prd-modules/admin/PRD.md',
      'apps/server/src/routes/admin/auth.ts',
      'agent.config.json',
    ], 'feature/admin-auth'),
    ['admin'],
  );
});

test('session modules ignore template tooling paths and repository root files', () => {
  assert.deepEqual(
    sessionModules(['agent', 'auth', 'qa'], [
      'agent.config.json',
      'infra/scripts/agent-runner/agent-cli.js',
      'AgentRoles/QA-TESTING-EXPERT.md',
      'agent/manifest.json',
      'tooling/xirang/agent-kit.js',
      'architecture/scripts/auth.js',
      '.xirang/baselines/agent.json',
      'apps/server/src/auth/session.ts',
    ]),
    ['auth'],
  );
});

test('session modules ignore template-owned standards and generated data documents', () => {
  assert.deepEqual(
    sessionModules(['data', 'ui', 'directories'], [
      'docs/standards/ui.md',
      'docs/standards/directories.md',
      'docs/data/CODEBASE_MAP.md',
      'docs/data/traceability-matrix.md',
    ]),
    [],
  );
  assert.deepEqual(sessionModules(['data', 'ui'], ['apps/web/src/ui/button.tsx']), ['ui']);
});

test('session modules still match source paths and the branch name without module documents', () => {
  assert.deepEqual(sessionModules(['billing', 'chat'], ['apps/desktop/src/billing/plan.ts']), ['billing']);
  assert.deepEqual(sessionModules(['billing', 'chat'], [], 'feature/chat-retry'), ['chat']);
  assert.deepEqual(sessionModules(['billing', 'chat'], ['README.md', 'package.json']), []);
});

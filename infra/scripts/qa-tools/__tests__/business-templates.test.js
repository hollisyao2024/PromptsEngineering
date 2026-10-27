'use strict';

// 业务测试模板。
//
// 模板是模型写用例时照抄的样板：样板自相矛盾，所有继承它的项目都会带着这个矛盾。这里把模板当作输入文件，
// 交给真实的解析器和分析器去检验——PRD 示例必须是一张合法的原子 AC 表，PATHS 模板必须是一份连通、
// 满足覆盖准则的路径模型，两者放进同一个项目必须通过 `qa paths`；测试用例标识统一为 TC-{MODULE}-NNN，
// 不再有 QA-N，也不再把 Given/When/Then 拆成三个 AC。
//
// 所有权检查（清单登记、资产集合、应用到项目后的收敛）只对息壤源有意义——实际项目里没有这份清单——
// 因此只在模板源执行；模板内容检查在任何地方都执行，因为这些文件会随模板分发。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { parseAcTables, parsePathsDocument } = require('../business-spec');
const { analyzeSpec } = require('../qa-paths');
const {
  AC_ID_SOURCE,
  STORY_ID_SOURCE,
  TEST_CASE_ID_SOURCE,
  exactPattern,
  extractIds,
} = require('../../shared/governance-ids');
const { createProject } = require('./fixtures/business-testing/builders');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const CONFIG_FILE = 'agent.config.json';
const MANIFEST_FILE = 'infra/templates/agent/template.manifest.json';

const PRD_TEMPLATE = 'docs/prd-modules/MODULE-TEMPLATE.md';
const PRD_EXAMPLE = 'docs/prd-modules/MODULE-EXAMPLE.md';
const QA_TEMPLATE = 'docs/qa-modules/MODULE-TEMPLATE.md';
const PATHS_TEMPLATE = 'docs/data/templates/qa/PATHS-TEMPLATE.md';
const TEST_DESIGN_TEMPLATE = 'docs/data/templates/qa/TEST-DESIGN-TEMPLATE.md';
const TRACEABILITY_TEMPLATE = 'docs/data/templates/prd/TRACEABILITY-MATRIX-TEMPLATE.md';
const TASK_TEMPLATE = 'docs/task-modules/MODULE-TEMPLATE.md';
const MODULE_TEMPLATES = [
  PRD_TEMPLATE,
  PRD_EXAMPLE,
  'docs/arch-modules/MODULE-TEMPLATE.md',
  TASK_TEMPLATE,
  QA_TEMPLATE,
];
// PRD 示例所在的功能域目录；PATHS 模板里的 P0 AC 必须落在同一个域，qa paths 才会要求它们被转移覆盖。
const EXAMPLE_DOMAIN = 'user-management';

function isTemplateSource() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, CONFIG_FILE), 'utf8'));
    return Boolean(config.template && config.template.role === 'source');
  } catch {
    return false;
  }
}
const TEMPLATE_SOURCE_ONLY = isTemplateSource() ? false : '仅息壤源登记模板所有权清单，实际项目跳过';

function read(relative) {
  return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

function markdownFilesUnder(relativeDir) {
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (entry.name.endsWith('.md')) found.push(relative);
    }
  };
  walk(relativeDir);
  return found.sort();
}

// 随模板分发、会被模型当作样板的全部 Markdown。
function templateFiles() {
  return [...MODULE_TEMPLATES, ...markdownFilesUnder('docs/data/templates')];
}

// 附录 A 是一个 ```markdown 围栏；扫描器会忽略围栏内的表格，所以取出围栏内容再解析。
function appendixFence(content) {
  const lines = content.split('\n');
  const open = lines.findIndex((line) => /^```markdown\s*$/.test(line));
  assert.notEqual(open, -1, '模块模板的附录 A 应当是一个 ```markdown 围栏');
  const close = lines.findIndex((line, index) => index > open && /^```\s*$/.test(line));
  assert.notEqual(close, -1, '附录 A 的围栏必须闭合');
  return lines.slice(open + 1, close).join('\n');
}

// 逐行收集命中某个模式的位置，失败信息直接指出文件与行号。
function offendersOf(files, pattern) {
  const hits = [];
  for (const file of files) {
    read(file).split('\n').forEach((line, index) => {
      if (pattern.test(line)) hits.push(`${file}:${index + 1}`);
    });
  }
  return hits;
}

// 标识形如 PREFIX-{MODULE}-NNN（AC 为 PREFIX-{MODULE}-NNN-NN）；去掉前缀与数字尾巴就是模块标记。
function moduleOf(id) {
  return id.slice(id.indexOf('-') + 1, id.startsWith('AC-') ? -7 : -4);
}

// 把示例项目的两份模板放进临时项目：PRD 示例放在 docs/prd-modules/<域>/，PATHS 模板放在 docs/qa-modules/<域>/。
function projectFromTemplates({ paths = read(PATHS_TEMPLATE) } = {}) {
  return createProject({
    [`docs/prd-modules/${EXAMPLE_DOMAIN}/PRD.md`]: read(PRD_EXAMPLE),
    [`docs/qa-modules/${EXAMPLE_DOMAIN}/PATHS.md`]: paths,
  });
}

// ───────────────────────── 内容：原子 AC 与统一的用例标识 ─────────────────────────

test('PRD 示例是一张合法的原子 AC 表，Given/When/Then 各占独立一列', () => {
  const parsed = parseAcTables(read(PRD_EXAMPLE), { file: PRD_EXAMPLE });

  assert.deepEqual(parsed.violations, []);
  assert.equal(parsed.tables, 1, '示例只应有一张原子 AC 表');
  assert.ok(parsed.acs.length >= 10, `示例应展示足够多的原子 AC，实际 ${parsed.acs.length} 条`);
  assert.equal(new Set(parsed.acs.map((ac) => ac.id)).size, parsed.acs.length, '每个 AC 一行，不能把同一个 AC 拆成多行');
  for (const ac of parsed.acs) {
    assert.ok(ac.given && ac.when && ac.then, `${ac.id} 的 Given/When/Then 必须各自成列且非空`);
  }
  assert.deepEqual(
    [...new Set(parsed.acs.map((ac) => ac.story))].sort(),
    ['US-USER-001', 'US-USER-002', 'US-USER-003', 'US-USER-004'],
  );
  assert.ok(parsed.acs.some((ac) => ac.verification === 'auto'), '示例要展示可自动验证的 AC');
  assert.ok(
    parsed.acs.some((ac) => ac.verification === 'manual' && ac.tcs.length === 0),
    '示例要展示不可自动化的验收：manual，TC 写 -',
  );
  assert.ok(parsed.acs.some((ac) => ac.platforms.length > 1), '示例要展示一条 AC 声明多个端');
});

test('PRD 模块模板的附录 A 带有可直接填写的原子 AC 表', () => {
  const appendix = appendixFence(read(PRD_TEMPLATE));
  const parsed = parseAcTables(appendix, { file: PRD_TEMPLATE });

  assert.ok(/^## 3\. 用户故事与验收/m.test(appendix), '章节标题保持不变：prd:lint 按它识别模块结构');
  assert.equal(/\|\s*验收标准（Given-When-Then）\s*\|/.test(appendix), false, '不再把 Given/When/Then 塞进一个单元格');
  assert.deepEqual(parsed.violations, []);
  assert.equal(parsed.tables, 1);
  assert.ok(parsed.acs.some((ac) => ac.verification === 'auto'));
  assert.ok(parsed.acs.some((ac) => ac.verification === 'manual' && ac.tcs.length === 0));
});

test('模板与示例不再把 Given/When/Then 拆成三个 AC', () => {
  const splitAc = /AC-[A-Za-z0-9{}_-]+\s*\((?:Given|When|Then)\)/;
  assert.deepEqual(offendersOf(templateFiles(), splitAc), []);
});

test('测试用例标识统一为 TC-{MODULE}-NNN，不再有 QA-N', () => {
  const files = templateFiles();
  // 旧的 QA-N 编号（含 QA-{{N}} 占位）；不误伤 TASK-QA-001 这类以 QA 作为模块名的标识。
  const legacyCaseId = /(?<![A-Za-z0-9-])QA-(?:\{\{N\}\}|N(?![A-Za-z0-9])|\d)/;
  // 旧的格式说明 TC-{MODULE}-{序号}。
  const legacyFormat = /TC-\{MODULE\}-\{[^}]*\}/;

  assert.deepEqual(offendersOf(files, legacyCaseId), []);
  assert.deepEqual(offendersOf(files, legacyFormat), []);
  for (const file of [PRD_TEMPLATE, TASK_TEMPLATE, TRACEABILITY_TEMPLATE]) {
    assert.ok(read(file).includes('TC-{MODULE}-NNN'), `${file} 应当把用例标识格式写成 TC-{MODULE}-NNN`);
  }
});

test('追溯矩阵模板不再允许用测试文件路径代替用例标识', () => {
  const text = read(TRACEABILITY_TEMPLATE);

  assert.equal(/按测试框架惯例/.test(text), false, '用例标识只有 TC-{MODULE}-NNN 一种写法');
  assert.equal(/\.test\.[jt]sx?::/.test(text), false, '用例标识不是 `文件::用例名` 路径');
});

test('模板里出现的每个用例标识，代入示例值后都是合法的 TC-{MODULE}-NNN', () => {
  const caseId = exactPattern(TEST_CASE_ID_SOURCE);
  // 占位符替换成示例值之后，必须是合法的用例标识。
  const filled = (token) => token
    .replace(/\{\{MODULE_ID\}\}/g, 'USER')
    .replace(/\{MODULE\}/g, 'USER')
    .replace(/NNN/g, '001');
  const invalid = [];

  for (const file of templateFiles()) {
    for (const token of new Set(read(file).match(/TC-[A-Za-z0-9{}_-]+/g) || [])) {
      if (!caseId.test(filled(token))) invalid.push(`${file} ${token}`);
    }
  }

  assert.deepEqual(invalid, []);
});

test('示例自洽——用例与需求使用同一个模块标记', () => {
  const mismatched = [];

  for (const file of templateFiles()) {
    const text = read(file);
    // 用例的模块标记必须出现在同一文件的 Story/AC 标识里；没有具体需求标识的文件无从比较。
    const requirementModules = new Set(
      [...extractIds(text, STORY_ID_SOURCE), ...extractIds(text, AC_ID_SOURCE)].map(moduleOf),
    );
    if (requirementModules.size === 0) continue;
    for (const id of new Set(extractIds(text, TEST_CASE_ID_SOURCE))) {
      if (!requirementModules.has(moduleOf(id))) mismatched.push(`${file} ${id}`);
    }
  }

  assert.deepEqual(mismatched, []);
});

test('QA 模块模板用 TC-{MODULE}-NNN 编号用例，并说明它与自动化测试名的关系', () => {
  const text = read(QA_TEMPLATE);

  assert.ok(/TC-\{\{MODULE_ID\}\}-001/.test(text), '用例表与用例详情应当用 TC-{{MODULE_ID}}-NNN');
  assert.ok(text.includes('TC-{MODULE}-NNN'), '应说明统一的用例标识格式');
  assert.ok(text.includes('qa run'), '应说明自动化测试名携带 AC/TC 标识，qa run 据此绑定结果');
});

// ───────────────────────── 内容：PATHS 模板与示例的整体自洽 ─────────────────────────

test('PATHS 模板是一份合法的路径模型，并声明覆盖准则', () => {
  const parsed = parsePathsDocument(read(PATHS_TEMPLATE), { file: PATHS_TEMPLATE });

  assert.deepEqual(parsed.violations, []);
  assert.deepEqual(parsed.missingTables, []);
  assert.ok(parsed.criterionLine, '模板必须显式声明「覆盖准则」，不能靠默认值');
  assert.deepEqual(parsed.criteria, ['all-transitions']);
  assert.ok(parsed.screens.length >= 3 && parsed.states.length >= 3 && parsed.transitions.length >= 3);
  assert.ok(parsed.paths.length >= 3, '模板要展示多条路径');
  for (const route of parsed.paths) {
    assert.ok(route.tcs.length > 0, `${route.id} 须绑定端到端用例：没有 TC 的路径无法被证明`);
  }
});

test('PRD 示例与 PATHS 模板放进同一个项目，qa paths 全部通过', (t) => {
  const project = projectFromTemplates();
  t.after(() => project.cleanup());

  const analysis = analyzeSpec({ repoRoot: project.repo });

  assert.deepEqual(analysis.violations, []);
  assert.equal(analysis.status, 'OK');
  assert.equal(analysis.noAtomicAc, false);
  assert.ok(analysis.counts.acTotal >= 10);
  assert.ok(analysis.counts.paths >= 3);
});

test('样板被改坏时 qa paths 会拦住，而不是静默通过', (t) => {
  // 反例：把一条转移关联的 AC 改成不存在的编号——模板里的引用必须真的被校验，而不是摆设。
  const broken = read(PATHS_TEMPLATE).replace(/AC-USER-001-01/, 'AC-USER-999-01');
  assert.notEqual(broken, read(PATHS_TEMPLATE), '被改动的样板应当引用 AC-USER-001-01');
  const project = projectFromTemplates({ paths: broken });
  t.after(() => project.cleanup());

  const analysis = analyzeSpec({ repoRoot: project.repo });

  assert.equal(analysis.status, 'BLOCKED');
  assert.ok(analysis.violations.some((item) => item.code === 'REF_UNKNOWN'), JSON.stringify(analysis.violations));
});

test('PRD 示例与 TEST-DESIGN 模板放进同一个项目，设计门禁只剩覆盖与头部类提示', (t) => {
  // 模板是会被照抄的样板：行格式、出处、引用与必需维度必须本身合规，否则照抄的项目一上来就被阻断。
  const { evaluateDesign, resolveDesignConfig } = require('../qa-design');
  const example = JSON.parse(read('infra/templates/agent/config.example.json'));
  const design = resolveDesignConfig({ qa: { design: example.qa.design, integrity: example.qa.integrity } });
  const content = read(TEST_DESIGN_TEMPLATE);
  const project = createProject({
    [`docs/prd-modules/${EXAMPLE_DOMAIN}/PRD.md`]: read(PRD_EXAMPLE),
    [`docs/qa-modules/${EXAMPLE_DOMAIN}/TEST-DESIGN.md`]: content,
  });
  t.after(() => project.cleanup());
  const tcs = Object.fromEntries(extractIds(content, TEST_CASE_ID_SOURCE).map((id) => [id, { status: 'passed' }]));

  const result = evaluateDesign({ repoRoot: project.repo, design, results: { available: true, tcs } });

  assert.equal(result.docs, 1);
  assert.equal(result.isolation, 'subagent');
  const unexpected = result.blocks.filter((item) => !['DESIGN_SOURCE_UNCOVERED'].includes(item.code));
  assert.deepEqual(unexpected, []);
  for (const item of result.risks) {
    assert.ok(!['DESIGN_HEADER_MISSING'].includes(item.code) || /设计材料包/u.test(item.detail), JSON.stringify(item));
  }
  assert.ok(result.metrics.rulesTotal >= 5);
  assert.equal(result.metrics.rulesVerified, result.metrics.rulesTotal);
  assert.equal(result.metrics.advCovered, result.metrics.advTotal);
});

// ───────────────────────── 盲测子代理 ─────────────────────────

const QA_SUBAGENTS = ['.claude/agents/xirang-qa-designer.md', '.claude/agents/xirang-qa-redteam.md'];

// 只解析本测试需要的扁平 `key: value` frontmatter；子代理文件不使用嵌套 YAML。
// Windows core.autocrlf=true 会把工作区检出为 CRLF，先归一化为 LF 再匹配。
function frontmatterOf(file, content) {
  const normalized = content.replace(/\r\n/gu, '\n');
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(normalized);
  assert.ok(match, `${file} 必须以 YAML frontmatter 开头`);
  const fields = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { fields, body: normalized.slice(match[0].length) };
}

function toolList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

test('frontmatterOf 兼容 CRLF 检出：Windows core.autocrlf=true 时仍能解析字段与正文', () => {
  const { fields, body } = frontmatterOf('crlf.md', '---\r\nname: x\r\ndescription: y\r\n---\r\nbody\r\n');
  assert.equal(fields.name, 'x');
  assert.equal(fields.description, 'y');
  assert.equal(body, 'body\n');
});

test('盲测子代理没有任何工具：材料包由主代理内联传入，只返回表格行', () => {
  // 盲测唯一的程序级约束：子代理拿不到 Read/Grep/Glob/Bash，就读不到源码。
  // 省略 tools 等于继承主会话全部工具，所以显式列出 Read 再用 disallowedTools 拒绝它，得到空集合。
  for (const file of QA_SUBAGENTS) {
    const { fields, body } = frontmatterOf(file, read(file));
    assert.equal(fields.name, path.basename(file, '.md'), `${file} 的 name 必须与文件名一致`);
    assert.ok(fields.description, `${file} 缺少 description`);
    assert.ok(toolList(fields.tools).length > 0, `${file} 不得省略 tools：省略即继承全部工具`);
    const denied = toolList(fields.disallowedTools);
    assert.deepEqual(toolList(fields.tools).filter((tool) => !denied.includes(tool)), [], `${file} 的有效工具集合必须为空`);
    assert.match(body, /设计材料包/u, `${file} 必须说明输入只有主代理内联的设计材料包`);
    assert.match(body, /源码/u, `${file} 必须写明不得依据源码`);
    assert.match(body, /出处/u, `${file} 必须要求预期写明出处`);
  }
  assert.match(read(QA_SUBAGENTS[0]), /\|\s*ID\s*\|\s*类型\s*\|\s*陈述\s*\|\s*出处\s*\|/u, '设计子代理只返回规则表行');
  assert.match(read(QA_SUBAGENTS[1]), /\|\s*ID\s*\|\s*规则\s*\|\s*维度\s*\|\s*场景\s*\|\s*预期\s*\|/u, '红队子代理只返回反例目录行');
});

// ───────────────────────── 所有权：清单登记与收敛 ─────────────────────────

function effectiveRule(rules, file) {
  return rules
    .filter((rule) => file === rule.path || file.startsWith(`${rule.path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0];
}

test('新增的模板文件登记为模板自有，项目自有文档保持项目自有', { skip: TEMPLATE_SOURCE_ONLY }, () => {
  const { rules } = JSON.parse(read(MANIFEST_FILE));

  assert.deepEqual(rules.find((rule) => rule.path === PATHS_TEMPLATE), { path: PATHS_TEMPLATE, strategy: 'overwrite' });
  for (const file of QA_SUBAGENTS) {
    assert.deepEqual(rules.find((rule) => rule.path === file), { path: file, strategy: 'overwrite' }, `${file} 必须逐个登记为模板自有`);
  }
  for (const file of [...MODULE_TEMPLATES, ...markdownFilesUnder('docs/data/templates')]) {
    const rule = effectiveRule(rules, file);
    assert.ok(rule, `${file} 没有任何所有权规则`);
    assert.equal(rule.strategy, 'overwrite', `${file} 应为模板自有（overwrite），实际 ${rule.strategy}`);
  }

  for (const file of [
    'docs/prd-modules/user-management/PRD.md',
    'docs/qa-modules/user-management/PATHS.md',
    'docs/qa-modules/user-management/QA.md',
    'docs/data/traceability-matrix.md',
  ]) {
    assert.equal(effectiveRule(rules, file).strategy, 'project-owned', `${file} 必须保持项目自有`);
  }
  assert.equal(effectiveRule(rules, CONFIG_FILE).strategy, 'init-if-missing', 'agent.config.json 只在缺失时初始化');
});

test('分发给项目的资产里，只有模板文件落在项目自有目录之下', { skip: TEMPLATE_SOURCE_ONLY }, (t) => {
  const { buildAgentAssets } = require('../../../../tooling/xirang/template');
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-assets-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));

  const { assets } = buildAgentAssets(REPO_ROOT, target);
  const byPath = new Map(assets.map((asset) => [asset.path, asset]));

  const added = byPath.get(PATHS_TEMPLATE);
  assert.ok(added, 'PATHS 模板必须随模板分发');
  assert.equal(added.strategy, 'overwrite');
  assert.equal(added.content, read(PATHS_TEMPLATE));
  for (const file of QA_SUBAGENTS) {
    assert.equal(byPath.get(file)?.strategy, 'overwrite', `${file} 必须随模板分发`);
    assert.equal(byPath.get(file).content, read(file));
  }

  const under = (prefix) => assets.map((asset) => asset.path).filter((file) => file.startsWith(prefix)).sort();
  assert.deepEqual(under('docs/prd-modules/'), [PRD_EXAMPLE, PRD_TEMPLATE]);
  assert.deepEqual(under('docs/qa-modules/'), [QA_TEMPLATE]);
  assert.deepEqual(under('docs/arch-modules/'), ['docs/arch-modules/MODULE-TEMPLATE.md']);
  assert.deepEqual(under('docs/task-modules/'), [TASK_TEMPLATE]);
  assert.equal(byPath.has('docs/data/traceability-matrix.md'), false, '追溯矩阵归项目所有，不得被分发');
  assert.equal(byPath.get(CONFIG_FILE).strategy, 'init-if-missing');
});

test('把模板应用到已有项目文档的项目，只新增模板文件，项目文档原样保留并收敛', { skip: TEMPLATE_SOURCE_ONLY, timeout: 180000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-apply-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'project');
  // 项目已有的自有文件：内容刻意与模板不同，应用之后必须逐字节不变。
  const projectOwned = {
    'docs/prd-modules/shop/PRD.md': '# 购物模块 PRD\n\n项目自己写的需求。\n',
    'docs/qa-modules/shop/PATHS.md': '# 购物路径\n\n覆盖准则：none\n',
    'docs/qa-modules/shop/QA.md': '# 购物 QA\n\n项目自己的测试记录。\n',
    'docs/data/traceability-matrix.md': '# 项目追溯矩阵\n\n| Story | AC | TC |\n',
    [CONFIG_FILE]: '{\n  "qa": { "business": { "enabled": false } }\n}\n',
  };
  for (const [relative, content] of Object.entries(projectOwned)) {
    fs.mkdirSync(path.dirname(path.join(target, relative)), { recursive: true });
    fs.writeFileSync(path.join(target, relative), content);
  }

  const run = (args) => spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, 'infra/scripts/setup/update-template.js'), target, '--scope', 'agent', ...args],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  const dry = run(['--dry-run']);
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.equal(fs.existsSync(path.join(target, PATHS_TEMPLATE)), false, 'dry-run 不得写入目标项目');

  const applied = run([]);
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  assert.match(applied.stdout, /CONVERGENCE_STATUS=OK/, '应用之后再次 dry-run 必须无差异');

  assert.equal(fs.readFileSync(path.join(target, PATHS_TEMPLATE), 'utf8'), read(PATHS_TEMPLATE));
  assert.equal(fs.readFileSync(path.join(target, PRD_EXAMPLE), 'utf8'), read(PRD_EXAMPLE));
  for (const [relative, content] of Object.entries(projectOwned)) {
    assert.equal(fs.readFileSync(path.join(target, relative), 'utf8'), content, `${relative} 是项目自有文件，不得被模板更新改动`);
  }
});

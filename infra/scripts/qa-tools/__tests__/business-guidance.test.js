/*
 * 业务测试自动化的专家指引与命令面同步。
 *
 * - 预言机只来自 PRD 原子 AC、数据字典、UX 规范与 ARCH 接口契约
 * - 路径推导、覆盖准则、测试设计技术、用例预算与数据驱动约定
 * - 刷新只新增或提出差异，不覆盖已评审用例
 * - 命令表与完成定义同步原子 AC、qa paths、qa run、测试名携带 AC/TC 标识
 *
 * 本文件随 qa-tools 一并分发到实际项目，因此只读取模板自有文件：专家文件、CONVENTIONS、
 * PATHS 模板、默认配置、qa-tools 源码与 README，不读取息壤源独有的模块文档。
 * 速查表与脚本的对应关系由「漂移守卫」用例保证：脚本新增违规码、阻断码、风险码时，手册必须同步。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { BLOCK_CODES, RISK_CODES } = require('../qa-business-gate');
const { CRITERIA, PRIORITIES } = require('../business-spec');
const { DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS } = require('../business-config');
const { AC_ID_SOURCE, TEST_CASE_ID_SOURCE } = require('../../shared/governance-ids');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const QA_TOOLS = path.join(ROOT, 'infra', 'scripts', 'qa-tools');

const PLAYBOOK = 'AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md';
const PRD_PLAYBOOK = 'AgentRoles/Handbooks/PRD-WRITER-EXPERT.playbook.md';
const ROLES = {
  PRD: 'AgentRoles/PRD-WRITER-EXPERT.md',
  ARCH: 'AgentRoles/ARCHITECTURE-WRITER-EXPERT.md',
  TDD: 'AgentRoles/TDD-PROGRAMMING-EXPERT.md',
  QA: 'AgentRoles/QA-TESTING-EXPERT.md',
};
const CONVENTIONS = 'docs/CONVENTIONS.md';
const README = 'infra/scripts/qa-tools/README.md';
const PATHS_TEMPLATE = 'docs/data/templates/qa/PATHS-TEMPLATE.md';
const CONFIG_EXAMPLE = 'infra/templates/agent/config.example.json';
const CHAPTER = '业务测试自动化';

// 三条规范句：指引文件必须逐字包含，防止各处措辞漂移后弱化约束。
const ORACLE_RULE = '预期结果只来自 PRD 原子 AC、数据字典、UX 规范与 ARCH 接口契约，禁止以被测代码当前输出作期望值；规格有歧义时回流 PRD 澄清。';
const NAME_RULE = '测试名携带 AC/TC 标识';
const REFRESH_RULE = '刷新只新增或提出差异，不覆盖已评审用例';
const TECHNIQUE_RULE = '取值技术只产生同一条路径上的数据行，不新增状态、转移或路径';

// 业务测试章的十个小节，按此顺序出现；标题以这些前缀开头。
const SUBSECTIONS = [
  '预言机',
  '路径推导',
  '覆盖准则',
  '测试设计技术',
  '用例预算',
  '数据驱动',
  '刷新策略',
  '驱动产物与报告',
  '配置与使用顺序',
  '阻断码与风险码速查',
];
// 套件配置项由 business-config 内部校验，未导出键名，这里按文档契约写死。
const SUITE_KEYS = ['name', 'platform', 'command', 'report', 'timeoutSeconds'];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// 按标题切分文档，忽略围栏代码块里以 # 开头的注释行。
function headings(text) {
  const found = [];
  let fence = null;
  text.split('\n').forEach((line, index) => {
    const mark = /^(```|~~~)/u.exec(line);
    if (mark) {
      if (fence === null) fence = mark[1];
      else if (fence === mark[1]) fence = null;
      return;
    }
    if (fence !== null) return;
    const match = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
    if (match) found.push({ level: match[1].length, title: match[2], index });
  });
  return found;
}

// 取 level 级、标题以 prefix 开头的章节（含标题行），到下一个同级或更高级标题前结束；找不到返回 null。
function section(text, level, prefix) {
  const all = headings(text);
  const at = all.findIndex((heading) => heading.level === level && heading.title.startsWith(prefix));
  if (at < 0) return null;
  const lines = text.split('\n');
  const next = all.slice(at + 1).find((heading) => heading.level <= level);
  return lines.slice(all[at].index, next ? next.index : lines.length).join('\n');
}

function chapter() {
  const body = section(read(PLAYBOOK), 2, CHAPTER);
  assert.ok(body, `QA 手册缺少「${CHAPTER}」一章（## 标题）：${PLAYBOOK}`);
  return body;
}

function sub(prefix) {
  const body = section(chapter(), 3, prefix);
  assert.ok(body, `「${CHAPTER}」一章缺少「${prefix}」小节（### 标题）`);
  return body;
}

function assertIncludes(label, text, needles) {
  const lacking = needles.filter((needle) => !text.includes(needle));
  assert.deepEqual(lacking, [], `${label} 缺少：${lacking.join(' | ')}`);
}

// 依次出现：每个 needle 都存在，且首次出现的位置严格递增。
function assertOrdered(label, text, needles) {
  const positions = needles.map((needle) => text.indexOf(needle));
  const lacking = needles.filter((needle, index) => positions[index] < 0);
  assert.deepEqual(lacking, [], `${label} 缺少：${lacking.join(' | ')}`);
  assert.ok(
    positions.every((position, index) => index === 0 || position > positions[index - 1]),
    `${label} 的出现顺序应为：${needles.join(' → ')}`,
  );
}

// 表格行：首列去掉反引号与加粗标记后等于 label，返回该行各单元格。
function rowOf(body, label) {
  for (const line of body.split('\n')) {
    const cells = line.trim().replace(/^\||\|$/gu, '').split('|').map((cell) => cell.trim());
    if (cells.length >= 2 && cells[0].replace(/[`*]/gu, '') === label) return cells;
  }
  return null;
}

function assertRows(label, body, labels, columns = 2) {
  const lacking = [];
  const hollow = [];
  for (const item of labels) {
    const cells = rowOf(body, item);
    if (!cells) lacking.push(item);
    else if (cells.length < columns || cells.some((cell) => cell === '')) hollow.push(item);
  }
  assert.deepEqual(lacking, [], `${label} 缺少表格行：${lacking.join('、')}`);
  assert.deepEqual(hollow, [], `${label} 的表格行存在空单元格或列数不足：${hollow.join('、')}`);
}

// 扫描 business-spec 与 qa-paths 里产生违规的代码；断言数量下限，扫描规则失效时直接报错。
function scanViolationCodes() {
  const found = new Set();
  for (const file of ['business-spec.js', 'qa-paths.js']) {
    const source = fs.readFileSync(path.join(QA_TOOLS, file), 'utf8');
    for (const match of source.matchAll(/(?:report\(|code:\s*)'([A-Z][A-Z_]+)'/gu)) found.add(match[1]);
  }
  assert.ok(found.size >= 20, `违规码扫描只得到 ${found.size} 个，扫描规则可能已失效`);
  return [...found].sort();
}

test('预言机规则逐字出现在 QA 手册业务测试章与 PRD/ARCH/TDD/QA 四个角色文件', () => {
  const targets = { [`${PLAYBOOK}「${CHAPTER}」`]: chapter() };
  for (const rel of Object.values(ROLES)) targets[rel] = read(rel);
  const lacking = Object.entries(targets).filter(([, text]) => !text.includes(ORACLE_RULE)).map(([name]) => name);
  assert.deepEqual(lacking, [], `以下文件缺少预言机规则「${ORACLE_RULE}」`);
});

test('预言机小节列出允许的来源、禁止项与歧义回流', () => {
  const body = sub('预言机');
  assertIncludes('预言机小节', body, [
    'PRD 原子 AC',
    '数据字典',
    'UX 规范',
    'ARCH 接口契约',
    '当前输出',
    '录制',
    '截图',
    '回流 PRD',
    '禁止',
  ]);
});

test('四个角色文件各按职责说明预言机', () => {
  const focus = {
    PRD: ['预言机', '可断言'],
    ARCH: ['预言机', '接口契约', '可断言'],
    TDD: ['预言机', '期望值'],
    QA: ['预言机', '期望值'],
  };
  const lacking = Object.entries(ROLES)
    .map(([key, rel]) => [key, focus[key].filter((needle) => !read(rel).includes(needle))])
    .filter(([, missing]) => missing.length > 0);
  assert.deepEqual(lacking, [], '角色文件缺少与自身职责对应的预言机表述');
});

test('业务测试章按固定顺序给出十个小节', () => {
  const titles = headings(chapter()).filter((heading) => heading.level === 3).map((heading) => heading.title);
  let from = 0;
  const lacking = [];
  for (const prefix of SUBSECTIONS) {
    const at = titles.findIndex((title, index) => index >= from && title.startsWith(prefix));
    if (at < 0) lacking.push(prefix);
    else from = at + 1;
  }
  assert.deepEqual(lacking, [], `小节缺失或顺序不符，实际小节：${titles.join(' | ')}`);
});

test('路径推导给出界面、状态、转移、覆盖准则、路径与 qa paths 校验六步', () => {
  const body = sub('路径推导');
  const leads = body
    .split('\n')
    .map((line) => /^\d+\.\s+\*\*(.+?)\*\*/u.exec(line))
    .filter(Boolean)
    .map((match) => match[1]);
  const expected = ['列界面', '列状态', '列转移', '选覆盖准则', '推导路径', '运行'];
  assert.deepEqual(
    leads.map((lead) => expected.find((prefix) => lead.startsWith(prefix)) ?? lead),
    expected,
    `编号步骤的加粗开头应依次为：${expected.join(' → ')}`,
  );
  assertIncludes('路径推导小节', body, ['PATHS.md', 'pnpm agent -- qa paths', 'STATUS=OK', 'VIOLATION', 'MATRIX_PATH', '评审']);
});

test('覆盖准则逐一说明三种取值与声明方式', () => {
  const body = sub('覆盖准则');
  assertRows('覆盖准则', body, CRITERIA, 3);
  assertIncludes('覆盖准则小节', body, ['覆盖准则：', '通过的路径']);
});

test('测试设计技术覆盖等价类、边界值、判定表、状态迁移与两两组合，且只产生数据行', () => {
  const body = sub('测试设计技术');
  assertRows('测试设计技术', body, ['等价类', '边界值', '判定表', '状态迁移', '两两组合'], 3);
  assertIncludes('测试设计技术小节', body, [TECHNIQUE_RULE, '守卫']);
});

test('用例预算按优先级给出预算，并说明 requiredPriorities 默认值', () => {
  const body = sub('用例预算');
  assertRows('用例预算', body, PRIORITIES, 3);
  const defaults = JSON.stringify(JSON.parse(read(CONFIG_EXAMPLE)).qa.business.requiredPriorities);
  assertIncludes('用例预算小节', body, ['requiredPriorities', defaults, 'RISK_LOWER_PRIORITY']);
});

test('数据驱动约定一行数据一个 testcase、同路径共用 TC、任一失败即失败，并给出带标识的命名示例', () => {
  const body = sub('数据驱动');
  assertIncludes('数据驱动小节', body, [NAME_RULE, '一行数据', 'testcase', '共用', '任一', '失败', 'RISK_UNLABELLED_CASES']);
  const tcPattern = new RegExp(TEST_CASE_ID_SOURCE, 'u');
  const acPattern = new RegExp(AC_ID_SOURCE, 'u');
  const example = body.split('\n').find((line) => tcPattern.test(line) && acPattern.test(line));
  assert.ok(example, '数据驱动小节应给出同时携带 TC 与 AC 标识的测试名示例');
});

test('驱动产物与报告说明 JUnit 契约、忽略产物、脏工作区处理与跨平台路径', () => {
  const body = sub('驱动产物与报告');
  assertIncludes('驱动产物与报告小节', body, [
    'JUnit XML',
    '.gitignore',
    'RESULTS_DIRTY_WORKTREE',
    'git rm --cached',
    '不自动重试',
    '环境变量',
    '跨平台',
  ]);
});

test('配置与使用顺序逐项说明 qa.business 配置键、默认值与 paths → run → verify 顺序', () => {
  const body = sub('配置与使用顺序');
  const businessKeys = Object.keys(JSON.parse(read(CONFIG_EXAMPLE)).qa.business);
  assertRows('qa.business 配置键', body, [...businessKeys, ...SUITE_KEYS], 2);
  assertIncludes('配置与使用顺序小节', body, [
    'qa.business',
    String(DEFAULT_TIMEOUT_SECONDS),
    String(MAX_TIMEOUT_SECONDS),
    '最后一次提交',
    'SUITE=',
    'RESULTS_FILE=',
  ]);
  assertOrdered('使用顺序', body, ['pnpm agent -- qa paths', 'pnpm agent -- qa run', 'pnpm agent -- qa verify']);
});

test('漂移守卫——qa paths 违规码速查覆盖脚本中的全部违规码', () => {
  const body = section(sub('阻断码与风险码速查'), 4, 'qa paths 违规码');
  assert.ok(body, '速查小节缺少「qa paths 违规码」（#### 标题）');
  assertRows('qa paths 违规码', body, scanViolationCodes(), 2);
});

test('漂移守卫——qa verify 阻断码速查覆盖 BLOCK_CODES，且每行给出含义与处理', () => {
  const body = section(sub('阻断码与风险码速查'), 4, 'qa verify 阻断码');
  assert.ok(body, '速查小节缺少「qa verify 阻断码」（#### 标题）');
  assertRows('qa verify 阻断码', body, [...BLOCK_CODES], 3);
});

test('漂移守卫——风险披露码速查覆盖 RISK_CODES', () => {
  const body = section(sub('阻断码与风险码速查'), 4, '风险披露码');
  assert.ok(body, '速查小节缺少「风险披露码」（#### 标题）');
  assertRows('风险披露码', body, [...RISK_CODES], 2);
});

test('刷新策略规定新增、修改、删除 AC 与应用改版的处理，且不覆盖已评审用例', () => {
  const body = sub('刷新策略');
  assertIncludes('刷新策略小节', body, [REFRESH_RULE, '/qa plan', 'PATHS.md', '追加', '提案', '评审']);
  assertRows('刷新策略', body, ['新增 AC', '修改 AC', '删除 AC', '应用改版'], 3);
});

test('/qa plan 保留策略、QA 角色文件与 PATHS 模板口径一致，且不再声明无条件覆盖', () => {
  const playbook = read(PLAYBOOK);
  const retention = section(playbook, 3, '更新现有 QA.md 的保留策略');
  assert.ok(retention, 'QA 手册缺少「更新现有 QA.md 的保留策略」小节');
  assertIncludes('保留策略小节', retention, ['PATHS.md', '不覆盖已评审', CHAPTER]);
  assert.equal(playbook.includes('MVP 版不保留人工标注'), false, '保留策略仍写着无条件覆盖');
  assert.ok(read(ROLES.QA).includes(REFRESH_RULE), 'QA 角色文件缺少刷新规则');
  assert.ok(/不覆盖已评审/u.test(read(PATHS_TEMPLATE)), 'PATHS 模板缺少不覆盖已评审条目的约定');
});

test('四个角色文件同步原子 AC、qa paths、qa run 与测试命名约定', () => {
  const needles = ['原子 AC', 'pnpm agent -- qa paths', 'pnpm agent -- qa run', NAME_RULE];
  const lacking = Object.entries(ROLES)
    .map(([key, rel]) => [key, needles.filter((needle) => !read(rel).includes(needle))])
    .filter(([, missing]) => missing.length > 0);
  assert.deepEqual(lacking, [], '角色文件缺少业务测试自动化的同步内容');
});

test('四个角色文件的完成定义同步原子 AC 与业务测试门槛', () => {
  const dod = {
    PRD: ['完成定义', ['原子 AC', 'qa paths']],
    ARCH: ['完成定义', ['原子 AC', '预言机']],
    TDD: ['Definition of Done', ['原子 AC', NAME_RULE, 'qa paths']],
    QA: ['完成定义', ['原子 AC', 'qa paths', 'qa run', 'qa.business']],
  };
  const problems = [];
  for (const [key, [heading, needles]] of Object.entries(dod)) {
    const body = section(read(ROLES[key]), 2, heading);
    if (!body) {
      problems.push(`${key}：缺少「${heading}」章`);
      continue;
    }
    const lacking = needles.filter((needle) => !body.includes(needle));
    if (lacking.length > 0) problems.push(`${key}：完成定义缺少 ${lacking.join('、')}`);
  }
  assert.deepEqual(problems, [], '完成定义未同步业务测试自动化');
});

test('QA 命令表登记 /qa paths 与 /qa run 并说明业务验收门禁', () => {
  const qa = read(ROLES.QA);
  assertIncludes('QA 命令表', qa, [
    '| `/qa paths` | `pnpm agent -- qa paths` |',
    '| `/qa run` | `pnpm agent -- qa run` |',
  ]);
  const verify = qa.split('\n').find((line) => line.startsWith('- `/qa verify`'));
  assert.ok(verify && verify.includes('qa.business'), '`/qa verify` 的命令说明应提到启用 qa.business 时的业务验收门禁');
});

test('CONVENTIONS 命令面登记 qa paths 与 qa run，交付章节说明业务验收门禁', () => {
  const conventions = read(CONVENTIONS);
  const surface = section(conventions, 2, '7. 命令面');
  const delivery = section(conventions, 2, '8. TDD、QA 与交付');
  assert.ok(surface && delivery, 'CONVENTIONS 缺少 §7 命令面或 §8 TDD、QA 与交付');
  assertIncludes('CONVENTIONS §7', surface, ['pnpm agent -- qa paths', 'pnpm agent -- qa run']);
  assertIncludes('CONVENTIONS §8', delivery, ['qa.business', '最后一次提交']);
});

test('qa-tools README 说明业务测试命令、门禁与配置', () => {
  assertIncludes('qa-tools README', read(README), ['pnpm agent -- qa paths', 'pnpm agent -- qa run', 'qa.business', 'RESULTS_DIRTY_WORKTREE']);
});

test('QA 手册的用例生成步骤引用原子 AC，常用命令包含业务测试命令，PRD 手册检查原子 AC', () => {
  const playbook = read(PLAYBOOK);
  const generation = section(playbook, 4, '第二步：测试用例生成');
  assert.ok(generation, 'QA 手册缺少「第二步：测试用例生成」小节');
  assertIncludes('第二步：测试用例生成', generation, ['原子 AC', NAME_RULE]);
  const commands = section(playbook, 2, '常用命令与自动化');
  assert.ok(commands, 'QA 手册缺少「常用命令与自动化」章');
  assertIncludes('常用命令与自动化', commands, ['pnpm agent -- qa paths', 'pnpm agent -- qa run']);
  assertIncludes('PRD 手册', read(PRD_PLAYBOOK), ['原子 AC', 'pnpm agent -- qa paths']);
});

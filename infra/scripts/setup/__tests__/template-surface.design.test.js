'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument } = require('../../../../tooling/xirang/yaml');
const { ROOT, headingBody, lineCount, read } = require('./template-surface.helpers');

const DESIGN_TEMPLATE = 'docs/data/templates/prd/DESIGN-TEMPLATE.md';
const DESIGN_SECTIONS = [
  'Overview',
  'Colors',
  'Typography',
  'Layout',
  'Elevation & Depth',
  'Shapes',
  'Components',
  "Do's and Don'ts",
];
const TOUCH_TARGET_MISLABEL = /44×44(?:px)?\s*[（(]\s*WCAG\s*2\.5\.8/u;

// 行形态检查把骨架限定为嵌套映射（拒绝列表项）；解析交给随模板分发的 tooling/xirang/yaml，重复键与非法缩进会直接抛错。
function parseDesignTemplate(text = read(DESIGN_TEMPLATE)) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(text);
  assert.ok(match, 'DESIGN skeleton starts with YAML front matter');
  for (const line of match[1].split(/\r?\n/u)) assert.match(line, /^\s*(?:#.*|[A-Za-z0-9_.-]+:(?:\s.*)?)?$/u, `front matter line is key: value: ${line}`);
  return { data: parseDocument(match[1]).value, rest: text.slice(match[0].length), text };
}

// 未加引号的 {colors.primary} 会被解析成单键映射而非字符串，Token 引用必须带引号才是 DESIGN.md 规范里的值
function assertComponentValuesAreStrings(components) {
  for (const [component, props] of Object.entries(components)) {
    for (const [prop, value] of Object.entries(props)) {
      assert.equal(typeof value, 'string', `components.${component}.${prop} is a string (quote token references)`);
    }
  }
}

// 官方 lint（@google/design.md 0.4.0，包内 spec-config.yaml 的 component_sub_tokens）认可的组件子属性。其余属性只报 broken-ref 警告、退出码仍为 0，
// 所以要在骨架里事先列明；升级官方 lint 后以其输出的 Valid sub-tokens 为准，核对后同步本清单与骨架 Components 节。
const DESIGN_COMPONENT_SUB_TOKENS = ['backgroundColor', 'textColor', 'typography', 'rounded', 'padding', 'size', 'height', 'width'];

function assertComponentSubTokensAreRecognised(components) {
  for (const [component, props] of Object.entries(components)) {
    for (const prop of Object.keys(props)) {
      assert.ok(DESIGN_COMPONENT_SUB_TOKENS.includes(prop), `components.${component}.${prop} is not a recognised sub-token`);
    }
  }
}

test('DESIGN skeleton is compact, spec-shaped and carries the accessibility targets', () => {
  assert.ok(lineCount(DESIGN_TEMPLATE) <= 80, 'skeleton stays within 80 lines');
  const { data, rest, text } = parseDesignTemplate();
  assert.deepEqual(
    Object.keys(data),
    ['version', 'name', 'colors', 'typography', 'rounded', 'spacing', 'components'],
  );
  assert.equal(data.version, 'alpha');
  // 八个规范章节依次出现，三个三级节排在最后一个规范章节 Do's and Don'ts 之下
  assert.deepEqual(
    rest.split(/\r?\n/u).filter((line) => /^#{2,3} /u.test(line)),
    [...DESIGN_SECTIONS.map((section) => `## ${section}`), '### Accessibility', '### Motion', '### Visual QA'],
  );
  const accessibility = headingBody(rest, 'Accessibility');
  assert.match(accessibility, /正文 ≥ 4\.5:1，大文本 ≥ 3:1/u);
  assert.match(accessibility, /推荐 ≥ 44×44；WCAG 2\.2 SC 2\.5\.8 最低 24×24（AA）/u);
  assert.doesNotMatch(text, TOUCH_TARGET_MISLABEL);
});

test('DESIGN skeleton tokens match the shadcn defaults and resolve their references', () => {
  const { data, text } = parseDesignTemplate();
  assertComponentValuesAreStrings(data.components);
  const resolve = (ref) => ref.split('.').reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), data);
  const refs = text.match(/\{[A-Za-z0-9_.-]+\}/gu) || [];
  assert.ok(refs.length > 0, 'components reference tokens');
  for (const ref of refs) assert.notEqual(resolve(ref.slice(1, -1)), undefined, `${ref} resolves in front matter`);
  assert.doesNotMatch(text, /https?:\/\/|@font-face|@import/u, 'no network font or external asset');
  assert.doesNotMatch(text, /architecture\/components\/|tokens\.css/u, 'no path that exists only in the Xirang source');
  // 项目侧没有 architecture 组件源，同源比对只在息壤源执行
  if (JSON.parse(read('agent.config.json')).template?.role !== 'source') return;
  const tokens = read('architecture/components/shadcn/tokens.css');
  const rootMatch = /:root\s*\{([^}]*)\}/u.exec(tokens);
  assert.ok(rootMatch, 'tokens.css has a :root block');
  const defaults = Object.fromEntries(
    [...rootMatch[1].matchAll(/--([a-z0-9-]+):\s*([^;]+);/gu)].map((match) => [match[1], match[2].trim()]),
  );
  for (const [name, value] of Object.entries(data.colors)) {
    assert.equal(value, defaults[name], `colors.${name} equals the shadcn default`);
  }
  assert.match(defaults.radius, /^[\d.]+rem$/u, 'tokens.css radius is in rem');
  const radius = parseFloat(defaults.radius) * 16;
  assert.deepEqual(data.rounded, { sm: `${radius - 4}px`, md: `${radius - 2}px`, lg: `${radius}px` });
  assert.match(tokens, /--radius-sm: calc\(var\(--radius\) - 4px\);\s*--radius-md: calc\(var\(--radius\) - 2px\);\s*--radius-lg: var\(--radius\);/u, 'rounded offsets mirror tokens.css');
  assert.equal(data.typography.body.fontFamily, /font-family:\s*([^;]+);/u.exec(tokens)[1].trim());
});

test('unquoted token references are rejected', () => {
  const skeleton = read(DESIGN_TEMPLATE);
  const unquoted = skeleton.replace(/"(\{[A-Za-z0-9_.-]+\})"/gu, '$1');
  assert.notEqual(unquoted, skeleton, 'skeleton quotes its token references');
  assert.throws(() => assertComponentValuesAreStrings(parseDesignTemplate(unquoted).data.components), /is a string/u);
});

test('DESIGN skeleton lists the component sub-tokens the official lint recognises and uses only those', () => {
  const { data, rest } = parseDesignTemplate();
  assertComponentSubTokensAreRecognised(data.components);
  const components = headingBody(rest, 'Components');
  const listed = /子属性仅限：([^。\n]*)。/u.exec(components);
  assert.ok(listed, 'Components names the recognised sub-tokens');
  assert.deepEqual([...listed[1].matchAll(/`([A-Za-z]+)`/gu)].map((match) => match[1]), DESIGN_COMPONENT_SUB_TOKENS);
  assert.match(components, /`broken-ref`[^\n]*退出码仍为 0/u, 'an unknown sub-token is named as a broken-ref warning that leaves the exit code at 0');
});

test('unknown component sub-tokens are rejected', () => {
  const skeleton = read(DESIGN_TEMPLATE);
  const withMinHeight = skeleton.replace('    padding: "{spacing.md}"\n', '    padding: "{spacing.md}"\n    minHeight: 44px\n');
  assert.notEqual(withMinHeight, skeleton, 'the probe adds a property to the example component');
  assert.throws(() => assertComponentSubTokensAreRecognised(parseDesignTemplate(withMinHeight).data.components), /not a recognised sub-token/u);
});

test('DESIGN skeleton is template-owned while the root DESIGN.md stays project-owned', () => {
  const manifest = JSON.parse(read('infra/templates/agent/template.manifest.json'));
  assert.deepEqual(
    manifest.rules.find((entry) => entry.path === DESIGN_TEMPLATE),
    { path: DESIGN_TEMPLATE, strategy: 'overwrite' },
  );
  assert.equal(manifest.rules.some((entry) => entry.path === 'DESIGN.md'), false);
  for (const file of ['agent/manifest.json', 'architecture/manifest.json']) {
    if (fs.existsSync(path.join(ROOT, file))) assert.doesNotMatch(read(file), /"DESIGN\.md"/u, `${file} does not own the root file`);
  }
  const readme = read('docs/data/templates/README.md');
  assert.match(readme, /`DESIGN-TEMPLATE\.md`/u);
  assert.match(readme, /根目录 `DESIGN\.md` 属项目文件/u);
});

test('UX, PRD and module templates point to DESIGN.md instead of repeating its values', () => {
  const ux = read('docs/data/templates/prd/UX-SPECIFICATIONS-TEMPLATE.md');
  assert.match(ux, /`DESIGN\.md`/u);
  for (const repeated of ['色彩系统', '排版系统', '间距系统', '其他视觉 Token', '--color-primary', '--space-md', '--radius-sm', '#XXXXXX', 'Mobile S', '4.5:1', '44×44']) {
    assert.ok(!ux.includes(repeated), `UX template no longer repeats ${repeated}`);
  }
  assert.match(ux, /状态覆盖/u, 'component state coverage stays in the UX template');
  assert.match(ux, /^### 7\.5 验证工具$/mu);
  const prdTemplate = read('docs/data/templates/prd/PRD-TEMPLATE.md');
  assert.match(prdTemplate, /`DESIGN\.md`/u);
  assert.ok(!prdTemplate.includes('Token 定义概览'));
  const moduleTemplate = read('docs/prd-modules/MODULE-TEMPLATE.md');
  assert.match(moduleTemplate, /`DESIGN\.md`/u);
  assert.ok(!moduleTemplate.includes('设计系统引用（全局 Design Token + 模块特定组件）'));
  assert.ok(!moduleTemplate.includes('响应式断点与无障碍要求（WCAG 2.1 AA）'));
  const playbook = read('AgentRoles/Handbooks/PRD-WRITER-EXPERT.playbook.md');
  for (const text of [prdTemplate, moduleTemplate, playbook]) assert.ok(!text.includes('44×44'), 'the touch-target number lives only in DESIGN.md');
});

// PRD 负责建立；ARCH、TDD、QA 仅在根 DESIGN.md 存在且含 YAML front matter 时点读，否则回退 UX 规范 §5 与 styles.css
const DESIGN_BUILDERS = ['AgentRoles/PRD-WRITER-EXPERT.md', 'AgentRoles/Handbooks/PRD-WRITER-EXPERT.playbook.md'];
const DESIGN_CONSUMERS = [
  'AgentRoles/Handbooks/ARCHITECTURE-WRITER-EXPERT.playbook.md',
  'AgentRoles/TDD-PROGRAMMING-EXPERT.md',
  'AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md',
  'AgentRoles/QA-TESTING-EXPERT.md',
  'AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md',
];
const DESIGN_GATE = /存在[^\n]{0,8}YAML front matter/u;
const DESIGN_FALLBACK = /回退 UX 规范 §5[^\n]*`styles\.css`/u;
const ACCESSIBILITY_FALLBACK = /Accessibility[^\n]*WCAG 2\.1 AA 默认阈值/u;

test('DESIGN.md is routed to PRD, ARCH, TDD and QA with their own responsibility', () => {
  for (const file of DESIGN_BUILDERS) assert.ok(read(file).includes('DESIGN.md'), `${file} builds DESIGN.md`);
  assert.match(read('AgentRoles/PRD-WRITER-EXPERT.md'), /DESIGN-TEMPLATE\.md/u);
  for (const file of DESIGN_CONSUMERS) {
    const text = read(file);
    assert.ok(text.includes('DESIGN.md'), `${file} routes to DESIGN.md`);
    assert.match(text, DESIGN_GATE, `${file} reads DESIGN.md only when it exists with YAML front matter`);
    assert.match(text, DESIGN_FALLBACK, `${file} falls back to UX §5 and styles.css`);
  }
  assert.match(read('AgentRoles/Handbooks/ARCHITECTURE-WRITER-EXPERT.playbook.md'), /`DESIGN\.md`[^\n]*实现映射[^\n]*不复述取值/u);
  for (const file of ['AgentRoles/QA-TESTING-EXPERT.md', 'AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md']) {
    assert.match(read(file), /设计还原度[^\n]*`DESIGN\.md`/u, `${file} checks fidelity against DESIGN.md`);
  }
  const tddUi = headingBody(read('AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md'), 'UI 实现约定');
  for (const needle of ['`DESIGN.md`', 'YAML front matter', '`docs/standards/ui.md`', '`styles.css`']) {
    assert.ok(tddUi.includes(needle), `TDD UI convention names ${needle}`);
  }
  assert.match(read('AgentRoles/TDD-PROGRAMMING-EXPERT.md'), /UI 实现约定/u);
});

// ADR-040：tdd sync / qa verify 的 DESIGN.md 漂移告警只报告给用户，不阻断，也不由执行器自行改项目样式
test('TDD and QA playbooks explain the non-blocking ARCHITECTURE_WARNING line', () => {
  const sections = [
    [headingBody(read('AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md'), 'UI 实现约定'), '`tdd sync`'],
    [headingBody(read('AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md'), '第三步：验收检查（/qa verify）'), '`qa verify`'],
  ];
  for (const [body, command] of sections) {
    assert.ok(body.includes(command), `${command} is named`);
    assert.ok(body.includes('`ARCHITECTURE_WARNING=<name>|<code>|<reason>`'), `${command} names the warning line format`);
    assert.match(body, /不阻断/u, `${command} says the warning does not block`);
    assert.match(body, /报告给用户[^\n]*不[^\n]*`DESIGN\.md`[^\n]*`styles\.css`/u, `${command} reports instead of editing project styles`);
  }
});

test('accessibility targets keep a fallback when DESIGN.md is absent', () => {
  for (const file of [
    'AgentRoles/QA-TESTING-EXPERT.md',
    'AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md',
    'docs/data/templates/prd/UX-SPECIFICATIONS-TEMPLATE.md',
  ]) assert.match(read(file), ACCESSIBILITY_FALLBACK, `${file} falls back to WCAG 2.1 AA default thresholds without DESIGN.md`);
});

// 存量项目副本试验（2026-10-08）：styles.css 已存在时补建 DESIGN.md 的三个实际难点，以及官方 lint 的使用口径
test('PRD playbook guides adopting DESIGN.md where styles already exist, and gating on the official lint', () => {
  const ux = headingBody(read('AgentRoles/Handbooks/PRD-WRITER-EXPERT.playbook.md'), '5. 用户体验设计（UX）');
  assert.match(ux, /存量项目[^\n]*`DESIGN\.md`/u, 'adoption in a project that already has styles is covered');
  assert.match(ux, /实际生效[^\n]*(?:覆盖|`@layer`)/u, 'values come from what the stylesheet effectively applies');
  assert.match(ux, /已知偏差[^\n]*Do's and Don'ts/u, 'hard-coded deviations are recorded, not promoted to contract');
  assert.match(ux, /【待确认】/u, 'items the code cannot decide stay marked');
  assert.match(ux, /官方 lint[^\n]*退出码[^\n]*不以警告条数/u, 'the official lint gates on its exit code, not the warning count');
  assert.match(ux, /官方 lint[^\n]*退出码[^\n]*`--format json`[^\n]*`broken-ref`[^\n]*条数为 0/u, 'the gate also reads the JSON output and requires zero broken-ref findings');
  assert.match(ux, /未知[^\n]*子属性[^\n]*`broken-ref`[^\n]*退出码仍为 0/u, 'an unknown sub-token only warns while the exit code stays 0, so the exit code alone cannot gate it');
  assert.match(ux, /清单见骨架 Components 节/u, 'the recognised sub-token list lives in the skeleton');
  assert.ok(!ux.includes('backgroundColor'), 'the sub-token list is not duplicated in the playbook');
  assert.match(ux, /`orphaned-tokens`[^\n]*结构性噪声/u, 'orphaned-tokens on stylesheet-consumed tokens is not worth a fake component');
  assert.ok(!ux.includes('44×44'), 'the touch-target number lives only in DESIGN.md');
});

test('DESIGN.md stays out of TASK, OPS and the always-loaded rules', () => {
  for (const file of [
    'AgentRoles/TASK-PLANNING-EXPERT.md',
    'AgentRoles/Handbooks/TASK-PLANNING-EXPERT.playbook.md',
    'AgentRoles/OPS-ENGINEERING-EXPERT.md',
    'AgentRoles/Handbooks/OPS-ENGINEERING-EXPERT.playbook.md',
    'AGENTS.md',
    'docs/CONVENTIONS.md',
    'infra/templates/agent/RULES.example.md',
  ]) assert.ok(!read(file).includes('DESIGN.md'), `${file} stays free of DESIGN.md`);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseDocument } = require('../../../../tooling/xirang/yaml');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function lineCount(relativePath) {
  return read(relativePath).split(/\r?\n/u).length;
}

test('always-loaded routing remains explicit but compact', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /@\.\/docs\/CONVENTIONS\.md/u);
  assert.match(agents, /@\.\/RULES\.md/u);
  assert.ok(lineCount('AGENTS.md') <= 180, 'AGENTS.md should stay within 180 lines');
  assert.doesNotMatch(agents, /展示思考过程/u);
});

test('RULES initializes only when missing and the source root has no project rules', () => {
  const manifest = JSON.parse(read('infra/templates/agent/template.manifest.json'));
  const rule = manifest.rules.find((entry) => entry.path === 'RULES.md');
  assert.deepEqual(rule, { path: 'RULES.md', source: 'infra/templates/agent/RULES.example.md', strategy: 'init-if-missing' });
  assert.ok(read(rule.source).trim());
  if (JSON.parse(read('agent.config.json')).template?.role === 'source') {
    assert.equal(fs.existsSync(path.join(ROOT, 'RULES.md')), false);
  }
});

test('environment examples initialize once while runtime files stay ignored', () => {
  const manifest = JSON.parse(read('infra/templates/agent/template.manifest.json'));
  for (const file of ['.env.example', '.env.staging.example', '.env.production.example']) {
    assert.deepEqual(
      manifest.rules.find((entry) => entry.path === file),
      { path: file, strategy: 'init-if-missing' },
    );
    assert.doesNotThrow(() => read(file));
  }

  const runtimeFiles = ['.env.local', '.env.staging', '.env.production'];
  for (const file of runtimeFiles) {
    assert.equal(manifest.rules.some((entry) => entry.path === file), false);
  }

  const gitignoreTemplate = read('infra/templates/merge/gitignore.agent.append');
  const ignoredPaths = new Set(gitignoreTemplate.split(/\r?\n/u));
  for (const file of runtimeFiles) assert.equal(ignoredPaths.has(file), true);
  for (const file of ['.env.example', '.env.staging.example', '.env.production.example']) {
    assert.equal(ignoredPaths.has(file), false);
  }
});

test('new projects receive a small canonical command surface', () => {
  const example = JSON.parse(read('infra/templates/agent/package-scripts.example.json'));
  const names = Object.keys(example.scripts || {});
  assert.ok(names.length <= 20, `expected <=20 scripts, found ${names.length}`);
  assert.equal(example.scripts.agent, 'node infra/scripts/agent-runner/agent-cli.js');
  const config = JSON.parse(read('infra/templates/agent/config.example.json'));
  assert.equal(config.commands.test, 'pnpm agent -- test');
  assert.equal(example.scripts['agent:task'], 'node infra/scripts/agent-runner/agent-task.js');
  assert.equal(example.scripts['tdd:new-worktree'], undefined);
  assert.equal(example.scripts['tdd:worktree-list'], undefined);
  assert.equal(example.scripts['tdd:worktree-remove'], undefined);
  assert.equal(example.scripts['tdd:resume'], undefined);
});

test('template defaults register the complete client, service, and server build command matrix', () => {
  const config = JSON.parse(read('infra/templates/agent/config.example.json'));
  const manifest = JSON.parse(read('infra/templates/agent/template.manifest.json'));
  assert.deepEqual(
    manifest.rules.find((entry) => entry.path === 'infra/templates'),
    { path: 'infra/templates', strategy: 'overwrite' },
    'template updates must propagate config.example.json to target projects'
  );

  for (const platform of ['mac', 'win', 'ios', 'android']) {
    assert.deepEqual(config.app.commands.dev[platform], {
      default: `pnpm dev:app:${platform}`,
      private: `pnpm private:dev:app:${platform}`,
    });
    assert.deepEqual(config.app.commands.build[platform], {
      default: `pnpm build:app:${platform}`,
      private: `pnpm private:build:app:${platform}`,
    });
  }

  for (const action of ['start', 'restart', 'stop', 'status', 'logs']) {
    assert.deepEqual(config.devServer.commands[action], {
      default: `pnpm dev:${action}`,
      private: `pnpm private:${action}`,
    });
  }

  assert.deepEqual(config.devops.commands.build, {
    dev: 'pnpm build:dev',
    staging: 'pnpm build:staging',
    production: 'pnpm build:prod',
    private: {
      dev: 'pnpm private:build:dev',
      staging: 'pnpm private:build:staging',
      production: 'pnpm private:build:prod',
    },
  });
  assert.deepEqual(config.devops.commands.ship, {
    dev: '',
    staging: '',
    production: '',
  });
});

test('template conventions explicitly register every supported client shortcut', () => {
  const conventions = read('docs/CONVENTIONS.md');
  for (const platform of ['mac', 'win', 'ios', 'android']) {
    assert.match(conventions, new RegExp(`/${'dev'} app ${platform}`, 'u'));
    assert.match(conventions, new RegExp(`/private dev app ${platform}`, 'u'));
    assert.match(conventions, new RegExp(`/build app ${platform}`, 'u'));
    assert.match(conventions, new RegExp(`/private build app ${platform}`, 'u'));
  }
  assert.match(conventions, /\/build dev\|staging\|prod/u);
  assert.match(conventions, /\/private build dev\|staging\|prod/u);
});

test('large expert and module templates are concise entrypoints', () => {
  assert.ok(lineCount('AgentRoles/TDD-PROGRAMMING-EXPERT.md') <= 220);
  assert.ok(lineCount('docs/qa-modules/MODULE-TEMPLATE.md') <= 350);
  assert.ok(lineCount('docs/arch-modules/MODULE-TEMPLATE.md') <= 350);
  assert.ok(lineCount('docs/prd-modules/MODULE-TEMPLATE.md') <= 350);
});

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

function headingBody(text, heading) {
  const lines = text.split(/\r?\n/u);
  const isHeading = (line) => /^#{2,3} /u.test(line);
  const levelOf = (line) => /^#+/u.exec(line)[0].length;
  const start = lines.findIndex((line) => isHeading(line) && line.replace(/^#+ /u, '') === heading);
  assert.notEqual(start, -1, `heading ${heading} exists`);
  const stop = lines.findIndex((line, index) => index > start && isHeading(line) && levelOf(line) <= levelOf(lines[start]));
  return lines.slice(start + 1, stop === -1 ? lines.length : stop).join('\n');
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

test('accessibility targets keep a fallback when DESIGN.md is absent', () => {
  for (const file of [
    'AgentRoles/QA-TESTING-EXPERT.md',
    'AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md',
    'docs/data/templates/prd/UX-SPECIFICATIONS-TEMPLATE.md',
  ]) assert.match(read(file), ACCESSIBILITY_FALLBACK, `${file} falls back to WCAG 2.1 AA default thresholds without DESIGN.md`);
});

test('DESIGN.md stays out of TASK, DEVOPS and the always-loaded rules', () => {
  for (const file of [
    'AgentRoles/TASK-PLANNING-EXPERT.md',
    'AgentRoles/Handbooks/TASK-PLANNING-EXPERT.playbook.md',
    'AgentRoles/DEVOPS-ENGINEERING-EXPERT.md',
    'AgentRoles/Handbooks/DEVOPS-ENGINEERING-EXPERT.playbook.md',
    'AGENTS.md',
    'docs/CONVENTIONS.md',
    'infra/templates/agent/RULES.example.md',
  ]) assert.ok(!read(file).includes('DESIGN.md'), `${file} stays free of DESIGN.md`);
});

test('every phase expert explicitly participates in durable task recovery', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /pnpm agent -- task resume --auto/u);
  assert.match(agents, /pnpm agent -- task start/u);
  assert.match(agents, /checkpoint/u);
  assert.match(agents, /pnpm agent -- task finish/u);
  const experts = [
    'AgentRoles/PRD-WRITER-EXPERT.md',
    'AgentRoles/ARCHITECTURE-WRITER-EXPERT.md',
    'AgentRoles/TASK-PLANNING-EXPERT.md',
    'AgentRoles/TDD-PROGRAMMING-EXPERT.md',
    'AgentRoles/QA-TESTING-EXPERT.md',
    'AgentRoles/DEVOPS-ENGINEERING-EXPERT.md',
  ];
  for (const expert of experts) {
    const source = read(expert);
    assert.match(source, /任务状态、恢复与阶段切换遵循 `AGENTS\.md`“长任务断点续跑”/u, `${expert} must use shared recovery policy`);
  }
});

test('phase experts use bounded context handoffs instead of full document reloads', () => {
  const agents = read('AGENTS.md');
  const conventions = read('docs/CONVENTIONS.md');
  const config = read('.codex/config.example.toml');
  assert.match(agents, /## 上下文预算与阶段交接/u);
  assert.match(agents, /180000/u);
  assert.match(agents, /pnpm agent -- task context/u);
  assert.match(agents, /pnpm agent -- task exec/u);
  assert.match(agents, /70%/u);
  assert.doesNotMatch(conventions, /## 11\. 上下文预算与阶段交接/u);
  assert.match(agents, /8KB\/80/u);
  assert.match(config, /model_auto_compact_token_limit = 180000/u);

  const experts = [
    'AgentRoles/PRD-WRITER-EXPERT.md',
    'AgentRoles/ARCHITECTURE-WRITER-EXPERT.md',
    'AgentRoles/TASK-PLANNING-EXPERT.md',
    'AgentRoles/TDD-PROGRAMMING-EXPERT.md',
    'AgentRoles/QA-TESTING-EXPERT.md',
    'AgentRoles/DEVOPS-ENGINEERING-EXPERT.md',
  ];
  for (const expert of experts) {
    const source = read(expert);
    assert.match(source, /上下文预算与阶段交接/u, expert);
    assert.match(source, /pnpm agent -- task context/u, expert);
  }
  assert.doesNotMatch(read('AgentRoles/TDD-PROGRAMMING-EXPERT.md'), /AGENT_STATE/u);
  assert.doesNotMatch(read('AgentRoles/QA-TESTING-EXPERT.md'), /必须读取 PRD\/ARCH\/TASK 模块清单/u);
});

test('context governance uses staged soft watermarks without blocking lightweight work', () => {
  const agents = read('AGENTS.md');
  const conventions = read('docs/CONVENTIONS.md');
  for (const watermark of ['80000', '120000', '150000']) {
    assert.match(agents, new RegExp(watermark, 'u'));
  }
  assert.match(agents, /新对话.*可.*创建/u);
  assert.match(agents, /轻量.*不.*限制/u);
  assert.match(agents, /长命令.*继续/u);
  assert.match(agents, /后台.*暂停/u);
  for (const pattern of [/1-2 条重型任务/u, /8-10 次模型请求\/分钟/u, /2\.5M TPM/u, /3M.*告警/u, /4M.*后台/u, /4\.5M.*重型.*排队/u, /429.*退避/u, /节流不得跳过.*验收/u]) {
    assert.match(agents, pattern);
  }
  assert.doesNotMatch(conventions, /禁止新会话|强制杀死/u);

  const experts = [
    'AgentRoles/PRD-WRITER-EXPERT.md',
    'AgentRoles/ARCHITECTURE-WRITER-EXPERT.md',
    'AgentRoles/TASK-PLANNING-EXPERT.md',
    'AgentRoles/TDD-PROGRAMMING-EXPERT.md',
    'AgentRoles/QA-TESTING-EXPERT.md',
    'AgentRoles/DEVOPS-ENGINEERING-EXPERT.md',
  ];
  for (const expert of experts) {
    assert.match(read(expert), /上下文预算与阶段交接/u, expert);
  }
});

test('always-loaded protocol makes mutation and phase explicit', () => {
  const agents = read('AGENTS.md');
  const conventions = read('docs/CONVENTIONS.md');
  assert.match(agents, /## 任务输入门禁/u);
  assert.match(agents, /目标、非目标、可观察验收与验证/u);
  assert.match(agents, /mutation.*显式验收/u);
  assert.match(agents, /--type mutation/u);
  assert.match(agents, /--acceptance/u);
  assert.match(agents, /--phase <phase>/u);
  assert.match(agents, /task transition/u);
  assert.match(agents, /task extend/u);
  assert.match(conventions, /AGENTS\.md.*任务输入门禁/u);
  assert.match(conventions, /--type mutation.*--acceptance/u);
});

test('template-owned Codex guidance avoids deprecated approval policies', () => {
  const manifest = JSON.parse(read('infra/templates/agent/template.manifest.json'));
  const codexFiles = manifest.rules
    .filter((entry) => entry.path.startsWith('.codex/') && entry.strategy !== 'remove')
    .map((entry) => entry.source || entry.path);

  for (const file of codexFiles) {
    assert.doesNotMatch(read(file), /on-failure|untrusted/u, `${file} must not recommend retired approval policies`);
  }
  assert.match(read('.codex/config.example.toml'), /approval_policy = "on-request"/u);
  assert.match(read('.codex/README.md'), /approval_policy = "on-request"/u);
});

test('Codex authentication uses the cross-platform wrapper instead of a non-functional session hook', () => {
  const manifest = JSON.parse(read('infra/templates/agent/template.manifest.json'));
  assert.deepEqual(
    manifest.rules.find((entry) => entry.path === '.codex/hooks.json'),
    { path: '.codex/hooks.json', strategy: 'remove' },
  );
  assert.equal(fs.existsSync(path.join(ROOT, '.codex/hooks.json')), false);

  const guide = read('.codex/README.md');
  assert.match(guide, /github-auth-run\.js/u);
  assert.match(guide, /Codex.*SessionStart.*不.*环境变量|Codex.*不.*Hook.*注入/u);
  assert.doesNotMatch(guide, /hooks\.json.*把 `GH_TOKEN` 注入 CLI 环境文件/u);
});

test('single-session read-only investigation does not acquire durable task state by step count', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /单会话只读.*不.*步骤数量/u);
  assert.match(agents, /修改 tracked 文件.*必须/u);
  assert.match(agents, /仅.*需要任务状态.*resume/u);
  const roles = fs.readdirSync(path.join(ROOT, 'AgentRoles')).filter(name => name.endsWith('-EXPERT.md'));
  for (const file of ['AGENTS.md', 'docs/CONVENTIONS.md', ...roles.map(name => `AgentRoles/${name}`)]) {
    assert.doesNotMatch(read(file), /至少\s*(3|三)\s*个?[^\n]*步骤|至少三步/u, file);
  }
  for (const role of roles) {
    assert.match(read(`AgentRoles/${role}`), /AGENTS\.md.*长任务断点续跑/u, role);
  }
});

test('recording guidance preserves denial boundaries and makes container permissions explicit', () => {
  const agents = read('AGENTS.md');
  const guide = read('.codex/README.md');
  const config = read('.codex/config.example.toml');
  assert.match(agents, /task paths/u);
  assert.match(agents, /具体规则未知/u);
  assert.match(agents, /继续.*只读/u);
  assert.match(guide, /TASK_RUNS_ROOT/u);
  assert.match(guide, /PERMISSION_STATUS=NOT_EVALUATED/u);
  assert.match(guide, /blocked by policy.*不能.*Auto-review/u);
  assert.doesNotMatch(guide, /无任何安全检查|Codex 无法实现/u);
  assert.match(config, /writable_roots/u);
  assert.match(config, /task paths/u);
  assert.doesNotMatch(config, /^writable_roots\s*=/mu, 'the template must not silently expand permissions');
});

test('always-loaded protocol forbids parent-relative patch paths for container writes', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /apply_patch.*绝对路径/u);
  assert.match(agents, /禁止.*父级相对路径.*apply_patch/u);
  assert.match(agents, /错误写入.*空父目录/u);
});

test('failure recovery protocol lives in AGENTS.md and is not duplicated in conventions', () => {
  const agents = read('AGENTS.md');
  const conventions = read('docs/CONVENTIONS.md');
  assert.doesNotMatch(conventions, /### 失败分类与恢复/u);
  for (const kind of ['tool_error', 'policy_denied', 'unknown_result']) {
    assert.ok(agents.includes(kind), kind);
  }
  assert.match(agents, /具体规则未知/u);
  assert.match(agents, /继续获准.*只读/u);
  assert.match(agents, /recovery-evidence/u);
  assert.doesNotMatch(agents, /CONVENTIONS\.md.*失败分类与恢复/u);
  assert.doesNotMatch(read('.codex/README.md'), /CONVENTIONS\.md#失败分类与恢复/u);
});

function conventionsSection(heading) {
  return headingBody(read('docs/CONVENTIONS.md'), heading);
}

test('conventions test-scope section keeps the contract that experts reference by name', () => {
  const section = conventionsSection('8. TDD、QA 与交付');
  assert.match(section, /^### 测试范围与证据复用$/mu);
  assert.match(section, /\| 变更影响 \| 必需验证 \|/u);
  for (const trigger of ['explicit_requirement', 'whole_scope_impact', 'unbounded_after_investigation', 'cross_domain_failure']) {
    assert.ok(section.includes(trigger), trigger);
  }
  for (const field of ['TEST_SCOPE_DECISION', 'TEST_SCOPE_RESULT', 'tdd.projectChecks']) {
    assert.ok(section.includes(field), field);
  }
  for (const expert of ['AgentRoles/TDD-PROGRAMMING-EXPERT.md', 'AgentRoles/QA-TESTING-EXPERT.md']) {
    assert.ok(read(expert).includes('测试范围与证据复用'), expert);
  }
});

test('delivery pipeline, schema and review rules live with their owners instead of conventions section 8', () => {
  const section = conventionsSection('8. TDD、QA 与交付');
  for (const removed of [
    /修改任务固定执行/u,
    /数据库 schema 变更必须同一交付/u,
    /使用显式运行时迁移注册表/u,
    /审查高风险域/u,
    /整体 `package\.json`/u,
  ]) {
    assert.doesNotMatch(section, removed);
  }
  assert.match(section, /官方息壤源.*`tdd sync`.*自动递增.*source-version-sync\.js/u);

  const owners = {
    'AGENTS.md': ['pnpm agent -- tdd sync', 'tdd push --committed-only', 'config.baseBranch', 'CLEANUP_STATUS=PRESERVED', '高风险改动包括'],
    'AgentRoles/TDD-PROGRAMMING-EXPERT.md': ['tdd.schemaGate.semantic', 'tdd.migrationRegistry.registryFile', 'docs/data/dictionary.md', 'Review-Class: REQUIRED'],
  };
  // 架构源标准只在息壤源仓库存在，下游项目中该文件可能缺席。
  if (fs.existsSync(path.join(ROOT, 'architecture/standards/data.md'))) {
    owners['architecture/standards/data.md'] = ['-- xirang:hard-delete', 'tdd.schemaGate.semantic'];
  }
  for (const [file, needles] of Object.entries(owners)) {
    const text = read(file);
    for (const needle of needles) {
      assert.ok(text.includes(needle), `${file} keeps ${needle}`);
    }
  }
});

test('conventions section 8 states each test-scope rule once and keeps the rules next to every trim', () => {
  const section = conventionsSection('8. TDD、QA 与交付');
  const occurrences = (needle) => section.split(needle).length - 1;

  // 「不能单独触发全量」清单只在全量段列一次，首段只保留低风险判定。
  assert.equal(occurrences('进入 QA、创建 PR'), 1);
  assert.match(section, /高风险标签、进入 QA、创建 PR 均不能单独触发全量/u);
  assert.match(section, /改动行数少不能单独证明低风险/u);

  // 范围不明先调查、仍不明再升级由第三类触发表达，不再另起一句。
  assert.doesNotMatch(section, /遇到范围不明/u);
  assert.match(section, /调查调用关系后仍无法可靠界定影响（不猜测范围）/u);

  // 大日志的存放位置由 AGENTS.md 与 §6 的 evidence/ 约定负责。
  assert.doesNotMatch(section, /大日志留在任务 evidence/u);
  assert.match(read('AGENTS.md'), /完整日志写入任务 evidence/u);
  assert.match(read('AGENTS.md'), /大证据放 `evidence\/`/u);
  assert.match(conventionsSection('6. 长任务状态文件'), /evidence\/\s+# 可选大体积证据/u);

  // 预提交运行的绑定规则只写一次，并带上摘要核对方式。
  assert.equal(occurrences('提交前运行'), 1);
  assert.match(section, /提交前运行的测试须先确认受测内容与当前提交一致（可用受测文件摘要核对），再绑定 HEAD/u);
  assert.match(section, /证据须能绑定当前提交、测试范围、命令、退出码、依赖\/配置和环境/u);

  // 全量入口段不再重复触发依据的记录要求，放行条件仍由 task exec 一句承担。
  assert.doesNotMatch(section, /按上段记录触发依据/u);
  assert.match(section, /只有事先记录了匹配命令和触发依据的 `mode=full` 决策才放行/u);
  assert.match(section, /明确需要全量时使用项目显式全量入口/u);

  // 压缩只合并重复，邻近的规则本身必须原样保留。
  for (const rule of [
    '不得用全量失败掩盖定向结果',
    '全量测试是例外，只有以下四类可触发',
    '某一应用的全量单测不自动扩大为所有应用、全量 E2E、安全与负载测试',
    '结构校验不代替 QA 对范围、日志与证据真实性的判断',
    '`task exec` 在启动前拦截常见聚合测试命令',
    '不得临时改成空命令或忽略失败来缩小范围',
    '新增 QA 测试仍须实际执行',
    '测试证据复用不替代 `qa verify` 的本机 base/head 回执及合并前 SHA 复验',
    '时间压力不能豁免必需项',
  ]) {
    assert.ok(section.includes(rule), rule);
  }
});

test('agents test entry keeps its own rules and leaves task exec interception to conventions section 8', () => {
  const agents = read('AGENTS.md');
  const section = conventionsSection('8. TDD、QA 与交付');

  // 「task exec 拦截聚合测试命令」只在 §8 运行器段写一次，并带放行条件。
  assert.doesNotMatch(agents, /`task exec` 会在启动前拦截聚合测试命令/u);
  assert.ok(
    section.includes('`task exec` 在启动前拦截常见聚合测试命令，只有事先记录了匹配命令和触发依据的 `mode=full` 决策才放行'),
    'conventions section 8 keeps the task exec interception rule with its release condition',
  );

  // 测试入口句的其余规则原样保留：定向入口、默认回归禁令、全量记录要求与 CONVENTIONS 指针。
  assert.ok(
    agents.includes(
      '测试优先使用 `pnpm agent -- test --file <测试文件> -- <定向运行器>`；不得把项目自有 `pnpm test` 或无文件参数的运行器当作默认回归。全量测试须先按 `docs/CONVENTIONS.md` 记录触发依据和对应命令。',
    ),
    'agents keeps the targeted test entry, the default-regression ban and the full-test pointer',
  );
  // task exec 的长命令用法仍由上下文预算章节承担。
  assert.ok(
    agents.includes('任何预计超过 5 秒或 2KB 输出的测试、构建、部署命令使用 `pnpm agent -- task exec --task <id> --name <name> -- <command...>`'),
    'agents keeps the task exec usage in the context budget section',
  );
});

test('qa expert points to conventions section 8 and keeps only its own review duties', () => {
  const qa = read('AgentRoles/QA-TESTING-EXPERT.md');
  const section = conventionsSection('8. TDD、QA 与交付');

  // 旧 QA 子句 → 仍在 §8 的承接原文：删除与保留在同一处断言，避免只删不留。
  const dedupedIntoSection = [
    [/检查完整 diff、调用方和依赖，按影响范围选择测试/u, ['TDD 与 QA 共用以下口径', '检查调用方、共享依赖、配置和测试映射，再选择最小充分范围']],
    [/记录命令、退出码、覆盖范围和未运行项/u, ['`impact_paths`', '`commands`', '`not_run`', '`exit_code:0`']],
    [/不得将未运行项记为通过/u, ['未运行项不得记为通过']],
    [/纯文档运行格式、链接或模板契约检查/u, ['相关格式、链接或模板契约检查']],
    [/局部样式运行相关视觉或定向 E2E/u, ['受影响页面的视觉或定向 E2E']],
    [/局部逻辑运行定向单元\/集成及消费者回归/u, ['定向单测及直接调用方回归', '涉及用户路径时补相关 E2E']],
    [/全局样式追踪受影响页面/u, ['全局样式须追踪受影响页面']],
    [/高风险标签不自动触发全量/u, ['高风险标签、进入 QA、创建 PR 均不能单独触发全量']],
    [/记录具体依据及全量的应用\/测试类型/u, ['记录具体触发项、调查证据、需要全量的应用/工作区和测试类型']],
    [/必需验证通过后，无新变更、失败或具体未解决风险不继续扩大或重复测试/u, ['必需验证通过后，仅因新变更、失败或具体未解决风险扩大或重跑测试']],
    [/时间限制不能豁免必需项/u, ['时间压力不能豁免必需项']],
    [/范围不明先调查再决定升级/u, ['调查调用关系后仍无法可靠界定影响（不猜测范围）', '先界定影响范围，再判断是否升级全量']],
  ];
  for (const [removed, kept] of dedupedIntoSection) {
    assert.doesNotMatch(qa, removed);
    for (const needle of kept) {
      assert.ok(section.includes(needle), 'conventions section 8 keeps ' + needle);
    }
  }

  // QA 自有职责保留：显式指针、§8 未列出的跨模块联动高风险清单、对 TEST_SCOPE 记录的审查与复用边界。
  for (const duty of [
    '- **测试执行**：遵循 `docs/CONVENTIONS.md` §测试范围与证据复用（变更影响表、全量触发与停止条件均以该节为准）。',
    '- **高风险变更**：认证权限、数据写删、事务、缓存、并发、外部 API、schema、共享基础库和跨模块联动补足对应专项及消费者回归。',
    '- **证据复用**：QA 审查当前任务的 `TEST_SCOPE_DECISION` 与 `TEST_SCOPE_RESULT`，核实影响分析、全量触发依据、未运行项及仍覆盖当前提交、依赖、配置和环境的 TDD 通过证据，只补新增或失效范围。',
  ]) {
    assert.ok(qa.includes(duty), duty);
  }

  // 门禁标题与四项保留；第 1 项只去掉与 §8 重复的升级尾句，第 2 项原样保留。
  const gateStart = qa.indexOf('## 测试执行验证门禁（/qa verify 前置，强制）');
  assert.ok(gateStart > 0, 'qa gate heading');
  const gate = qa.slice(gateStart, qa.indexOf('\n## ', gateStart + 1));
  for (const item of ['**测试范围已判定**', '**对应测试有有效结果**', '**测试覆盖摘要已输出**', '**专项验证按域完成**']) {
    assert.ok(gate.includes(item), item);
  }
  assert.match(gate, /全量时核实 `docs\/CONVENTIONS\.md` §测试范围与证据复用中的触发项、调查证据及具体应用\/测试类型$/mu);
  assert.match(gate, /逻辑变更有受影响的单元\/集成结果，涉及用户路径时有相关 E2E/u);
  assert.match(gate, /可复用符合 `docs\/CONVENTIONS\.md` §测试范围与证据复用的 TDD 证据/u);
  assert.ok(gate.includes('未满足任一条件 → 禁止执行 `/qa verify`，输出缺失项提示。'));
});

test('qa receipt scope stays with the receipt definition in conventions section 5', () => {
  const section = conventionsSection('5. Worktree 生命周期');
  assert.match(section, /回执不跨电脑共享.*重新执行 `qa verify`/u);
});

test('agents cleanup deferral keeps its principle and bounds and leaves the command to conventions section 6', () => {
  const agents = read('AGENTS.md');
  for (const removed of [/--defer-cleanup-step/u, /--cleanup-evidence/u, /独立性与保留措施/u]) {
    assert.doesNotMatch(agents, removed);
  }
  assert.ok(agents.includes(
    '独立清理失败不得自动升级为交付前置条件。进入 QA/DEVOPS 时，可按 `docs/CONVENTIONS.md` §长任务状态文件 的条件与证据要求延后明确未开始的清理；不改变失败状态、不重试被拒绝操作、不豁免测试或最终完成门禁。',
  ));
  assert.ok(agents.includes(
    '开发 worktree 的未提交内容不阻止合并已通过 QA 的固定提交；推送已有提交而需保留本地内容时用 `tdd push --committed-only`。合并须在独立、干净的目标主干 worktree 写入；合并后开发目录仍有本地内容则保留目录、分支和恢复状态，明确报告 `MERGE_STATUS=MERGED` 与 `CLEANUP_STATUS=PRESERVED`，不把合并成功冒充清理完成。',
  ));
  const section = conventionsSection('6. 长任务状态文件');
  for (const kept of [
    '独立收尾清理可以在进入 QA/DEVOPS 时显式延后',
    '`transition ... --defer-cleanup-step S5 --cleanup-evidence',
    '仅限有结构化失败证明 `not_started` 的 `blocked` 步骤，必须核实并说明不影响目标阶段的理由',
    '不得用于测试、验收、权限审批、发布前置条件或结果未知的副作用',
    '失败状态和恢复要求不变',
    '`task finish` 仍要求清理完成',
    '此参数不授权执行被拒绝的动作',
  ]) {
    assert.ok(section.includes(kept), kept);
  }
});

test('qa playbook points to the conventions test-scope section by name instead of a vague reference', () => {
  const playbook = read('AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md');
  for (const anchored of [
    '按 `docs/CONVENTIONS.md` §测试范围与证据复用选择定向、消费者及专项回归',
    '全量与证据复用遵循 `docs/CONVENTIONS.md` §测试范围与证据复用',
    '过滤参数的核实见 `docs/CONVENTIONS.md` §测试范围与证据复用；不逐条执行',
    '有效的 TDD 证据按 `docs/CONVENTIONS.md` §测试范围与证据复用的条件复用',
  ]) {
    assert.ok(playbook.includes(anchored), anchored);
  }
  for (const removed of [/全量与证据复用遵循通用约定/u, /TDD 证据按通用约定复用/u, /并核实过滤参数/u]) {
    assert.doesNotMatch(playbook, removed);
  }
  for (const kept of [
    '不逐条执行，不因进入 QA 自动运行全量或生成全仓覆盖率',
    '# 仅满足明确全量升级条件时执行',
    '具体门禁见 Expert 文件',
    '不适用项记录理由，不能据此默认新增测试类型或扩大为全量',
    '确认 §测试执行验证门禁（Expert 文件）全部满足',
  ]) {
    assert.ok(playbook.includes(kept), kept);
  }
  assert.ok(conventionsSection('8. TDD、QA 与交付').includes('确认测试运行器支持所用过滤参数'));
});

test('agents task exec usage rule stays consistent with the conventions syntax registry and cli limits', () => {
  assert.ok(read('AGENTS.md').includes(
    '使用 `pnpm agent -- task exec --task <id> --name <name> -- <command...>`，完整日志写入任务 evidence，只回传约 8KB/80 行摘要',
  ));
  const section = conventionsSection('7. 命令面');
  for (const syntax of [
    'pnpm agent -- task exec --task <id> --name <evidence-name> -- <command...>',
    'pnpm agent -- task context --task <id> [--max-bytes 8192] [--include <path#Lx-Ly>]...',
  ]) {
    assert.ok(section.includes(syntax), syntax);
  }
  const cli = read('infra/scripts/agent-runner/agent-task.js');
  for (const limit of [/DEFAULT_CONTEXT_BYTES\s*=\s*8192\b/u, /DEFAULT_SUMMARY_BYTES\s*=\s*8192\b/u, /DEFAULT_SUMMARY_LINES\s*=\s*80\b/u]) {
    assert.match(cli, limit);
  }
});

test('agents worktree section leaves the remote same-name branch rule to conventions section 5 and keeps its unique lifecycle rules', () => {
  const agents = read('AGENTS.md');
  for (const removed of [/远端同名分支/u, /固定 SHA 建立本机/u, /worktree resume/u]) {
    assert.doesNotMatch(agents, removed);
  }
  for (const kept of [
    '合并后清理由 session 封印和补偿器完成；存在未提交变更、HEAD 漂移或缺少封印时转为恢复状态，禁止删除。',
    '多 worktree、多电脑可并行开发；本机 session 与锁只保护本机生命周期，不承担跨电脑互斥。跨电脑通过远端分支 SHA 复验和主干普通非强制 push 的非快进拒绝协调。',
    '不得用拆分、改写、换工具或放宽权限重试被策略拒绝的同一操作。',
    '`policy_denied`（工具明确拒绝：保留原始理由和调用编号，停止该操作，不改写命令、换入口或扩大权限）',
    '禁止改写命令、换工具或迁移记录以重试被拒绝动作。',
  ]) {
    assert.ok(agents.includes(kept), kept);
  }
  const section = conventionsSection('5. Worktree 生命周期');
  for (const carried of [
    '如果 required fetch 后已经存在 `refs/remotes/origin/<branch>`，`worktree new` 必须阻断并提示显式恢复或更名',
    '只有 `worktree resume` 可以从远端分支固定 SHA 创建本机 tracking branch、worktree 和 session',
  ]) {
    assert.ok(section.includes(carried), carried);
  }
});

test('tdd playbook points to the conventions test-scope section by name instead of a vague reference', () => {
  const playbook = read('AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md');
  assert.ok(playbook.includes(
    '以下是命令示例，须按项目运行器核实过滤参数并选择受影响用例；全量命令仅在满足 `docs/CONVENTIONS.md` §测试范围与证据复用的升级条件时使用，不按示例逐条执行。',
  ));
  assert.doesNotMatch(playbook, /满足通用约定的升级条件/u);
  assert.ok(conventionsSection('8. TDD、QA 与交付').includes('\n### 测试范围与证据复用\n'));
});

test('experts and handbooks name the conventions test-scope section instead of a vague 通用约定 reference', () => {
  const roleFiles = ['AgentRoles', 'AgentRoles/Handbooks'].flatMap((dir) => fs
    .readdirSync(path.join(ROOT, dir))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `${dir}/${name}`));
  assert.ok(roleFiles.length >= 12, 'expert and handbook files found');
  for (const file of roleFiles) {
    assert.doesNotMatch(read(file), /通用约定/u, `${file} names docs/CONVENTIONS.md instead of 通用约定`);
  }
  assert.ok(read('AgentRoles/TDD-PROGRAMMING-EXPERT.md').includes(
    '高风险标签本身不触发全量，按 `docs/CONVENTIONS.md` §测试范围与证据复用界定范围。',
  ));
});

test('agents github section leaves the rules carried by conventions sections 5 and 9 there and keeps its own unique rules', () => {
  const agents = read('AGENTS.md');
  const start = agents.indexOf('\n## GitHub 与安全');
  const end = agents.indexOf('\n## ', start + 1);
  assert.ok(start >= 0 && end > start, 'agents github section');
  const section = agents.slice(start, end);
  const receipts = conventionsSection('5. Worktree 生命周期');
  const policy = conventionsSection('9. GitHub、命名与安全');

  // 旧 AGENTS 子句 → 仍在 CONVENTIONS 的承接原文：删除与保留在同一处断言，避免只删不留。
  const dedupedIntoConventions = [
    [/远端 Git\/GitHub 操作只能走/u, policy, ['GitHub token 变量统一为 `GH_TOKEN`。', '远端 Git/GitHub 命令必须由 `infra/scripts/shared/github-auth-run.js` 或上层脚本执行。']],
    [/是阶段职责，不是电脑或账号身份/u, policy, ['专家名称表示当前阶段职责，不绑定电脑、hostname、机器角色或专用 QA 账号；所有已获仓库权限的协作者可以执行任意阶段、合并 PR 或普通更新配置主干。']],
    [/原子写入绑定 base、branch/u, receipts, [
      '`qa verify` 通过后在本机原子保存绑定配置主干、功能分支、`BASE_SHA` 和 `HEAD_SHA` 的回执',
      '合并前重新 fetch，并把回执与 PR base/head refs、远端引用逐项复验',
      '任何 SHA 漂移、冲突或非快进拒绝都必须停止并要求重新 QA，不得自动 rebase 已验证分支或覆盖远端历史',
    ]],
    [/配置主干禁止 force push 和删除/u, policy, ['配置主干禁止 force push 和删除；跨电脑合并不使用分布式锁，以远端 SHA 复验和普通 push 的非快进拒绝实现乐观并发。']],
    [/主干并发更新失败时不得覆盖远端历史/u, receipts, ['不得自动 rebase 已验证分支或覆盖远端历史']],
    [/不创建、修改、触发或依赖 GitHub CI/u, policy, ['TDD、QA 与合并门禁完全在本地执行，不创建、修改、触发或依赖 GitHub CI、required checks 或 `.github/workflows`；工作流目录始终由实际项目自行维护。']],
  ];
  for (const [removed, carrier, kept] of dedupedIntoConventions) {
    assert.doesNotMatch(agents, removed);
    for (const needle of kept) {
      assert.ok(carrier.includes(needle), `conventions keeps ${needle}`);
    }
  }

  // AGENTS 自有规则保留：CONVENTIONS 无正文的「只用 `.env.local`」排他令牌来源声明（§9 只写落点与解析顺序）与裸执行清单、PR base 绑定、expected SHA 租约、删除与状态保护、记录边界，外加一条指针。
  for (const kept of [
    '- GitHub 鉴权封装与 `GH_TOKEN`、阶段不绑定电脑或账号、QA 回执复验、配置主干禁止 force push 与删除、本地门禁不依赖 GitHub CI 的规则见 `docs/CONVENTIONS.md` §5、§9。',
    '- GitHub 访问只用 `.env.local` 的 `GH_TOKEN`；不得裸执行 `git fetch/pull/push/ls-remote`、`gh`。',
    '- `tdd push` 必须显式以 `config.baseBranch` 为 PR base。',
    '- 功能分支只有在精确 expected SHA 的 `--force-with-lease` 保护下才可清理。',
    '- 删除前解析并复核精确目标；失败、阻塞、等待确认和恢复态不得清理任务/worktree 状态。',
    '- 不记录或提交密钥、凭据、个人信息和大段原始日志。',
  ]) {
    assert.ok(section.includes(kept), kept);
  }
});

test('agents leaves project ownership and scan details to conventions while keeping its own one-line rules', () => {
  const agents = read('AGENTS.md');
  const conventions = read('docs/CONVENTIONS.md');
  const ownership = conventionsSection('3. 模板所有权');
  const scan = conventions.slice(conventions.indexOf('\n## 10. 全仓扫描'));
  assert.ok(scan.startsWith('\n## 10. 全仓扫描'), 'conventions scan section');
  const scanStart = agents.indexOf('\n## 全仓扫描');
  const agentsScan = agents.slice(scanStart, agents.indexOf('\n## ', scanStart + 1));
  assert.ok(scanStart >= 0 && agentsScan.includes('Discovery'), 'agents scan section');

  // 旧 AGENTS 子句 → 仍在承接处的原文：删除与保留在同一处断言，避免只删不留。
  assert.doesNotMatch(agents, /业务源码、真实项目文档和部署实现属于项目/u);
  assert.ok(agents.includes('`RULES.md` 由实际项目维护；首次应用与更新仅在缺失时从模板骨架初始化，已有文件保持不变'));
  for (const carried of [
    '`RULES.md`、真实项目文档、源码、业务部署脚本和已有 `agent.config.json` 均属于项目；`RULES.md` 仅在缺失时初始化，已有内容（包括空文件）不改写',
    '- `init-if-missing`：仅初始化，已有项目文件不覆盖。',
    '- `project-owned`：模板永不写入。',
  ]) {
    assert.ok(ownership.includes(carried), carried);
  }

  for (const removed of [/scan-manifests/u, /scanned_count/u, /matched = modified/u]) {
    assert.doesNotMatch(agentsScan, removed);
  }
  assert.ok(agentsScan.includes('跨目录且完整性影响正确性时，Discovery 与 Editing 必须分离，细则见 `docs/CONVENTIONS.md` §全仓扫描。'));
  for (const carried of [
    '候选 manifest 写入容器 `tmp/scan-manifests/`，包含范围、排除项和全部候选',
    'scanned_count\nmatched_count\nmodified_count\nskipped_count',
    '并满足 `matched_count = modified_count + skipped_count`。范围变化时创建新 manifest，不得静默缩小。',
  ]) {
    assert.ok(scan.includes(carried), carried);
  }
});

test('conventions leaves task-input, checkpoint, default-type, alias and context-budget sentences to agents', () => {
  const agents = read('AGENTS.md');
  const conventions = read('docs/CONVENTIONS.md');
  const tasks = conventionsSection('6. 长任务状态文件');
  const commands = conventionsSection('7. 命令面');

  // 旧 CONVENTIONS 子句 → 仍在 AGENTS 的承接原文：删除与保留在同一处断言，避免只删不留。
  const dedupedIntoAgents = [
    [/mutation 必须显式提供可观察验收/u, ['- mutation 任务在创建或恢复修改 worktree 前必须有显式验收；只读诊断、研究和运维可按现有目标继续。']],
    [/同一次 checkpoint 可更新步骤和验收项/u, ['- 一个 checkpoint 可同时完成步骤和验收项，并记录简短证据、退出码、路径或哈希。']],
    [/新任务安全默认 `type=mutation`/u, ['- 新任务默认 `type=mutation` 并执行 completion guard；能证明不会修改 tracked 文件时才显式使用 `diagnose|research|operation`。']],
    [/旧 aliases 在已有项目中保留兼容/u, ['已有项目中的旧 package aliases 作为兼容入口保留；新模板不继续扩张别名集合。']],
    [/上下文预算、阶段交接与失败恢复协议/u, ['\n## 上下文预算与阶段交接\n', '\n## 长任务断点续跑\n']],
  ];
  for (const [removed, kept] of dedupedIntoAgents) {
    assert.doesNotMatch(conventions, removed);
    for (const needle of kept) {
      assert.ok(agents.includes(needle), `agents keeps ${needle}`);
    }
  }

  // 同句中不重复的规则原样保留；§6 内两处「长任务断点续跑」指针留在各自规则所在处，是被删末行中失败恢复半句的承接位置。
  for (const [section, kept] of [
    [tasks, '是否需要任务状态统一遵循 `AGENTS.md`“长任务断点续跑”：'],
    [tasks, '记录不可用时按 `AGENTS.md`“长任务断点续跑”的失败恢复规则对话留痕'],
    [tasks, '任务输入的补齐、假设和最小提问规则以 `AGENTS.md` 的“任务输入门禁”为准。'],
    [tasks, 'pnpm agent -- task start --task <id> --phase <phase> --type mutation --desc "<目标>" --acceptance "<可观察验收>" --step "<步骤>"'],
    [tasks, '- schema v1 状态在读取时升级为 v2，保留既有步骤、证据与生命周期状态。'],
    [commands, '新项目只推荐统一入口：'],
    [commands, '命令必须输出可解析的 `STATUS`、`SUMMARY`、`NEXT_ACTION`，失败时退出码非零。'],
  ]) {
    assert.ok(section.includes(kept), kept);
  }
});

test('devops expert leaves client, build and ship shortcut rows to conventions section 7 and keeps its own routing', () => {
  const expert = read('AgentRoles/DEVOPS-ENGINEERING-EXPERT.md');
  const section = conventionsSection('7. 命令面');
  assert.ok(section.includes('\n### 客户端与服务端快捷命令\n'), 'conventions keeps the shortcut registry the pointers name');

  // 旧专家表行 → 仍在 §7 的承接行：删除与保留在同一处断言，避免只删不留。
  for (const [shortcut, entry] of [
    ['/dev app <platform>', 'pnpm agent -- dev app <platform>'],
    ['/private dev app <platform>', 'pnpm agent -- private dev app <platform>'],
    ['/build app <platform>', 'pnpm agent -- build app <platform>'],
    ['/private build app <platform>', 'pnpm agent -- private build app <platform>'],
    ['/build <env>', 'pnpm agent -- build <env>'],
    ['/private build <env>', 'pnpm agent -- private build <env>'],
    ['/private ship <env>', 'pnpm agent -- private ship <env>'],
  ]) {
    const row = `| \`${shortcut}\` | \`${entry}\` |`;
    assert.ok(!expert.includes(row), `expert leaves ${shortcut} to conventions`);
    assert.ok(section.includes(row), `conventions keeps ${shortcut}`);
  }
  for (const removed of [/app\.commands\.dev\/build\.<platform>/u, /devops\.commands\.build\/ship/u]) {
    assert.doesNotMatch(expert, removed);
  }
  for (const carried of [
    '- 客户端：`app.commands.<dev|build>.<platform>`',
    '- 服务端构建与部署：`devops.commands.build` / `devops.commands.ship`',
    '客户端开发、发行构建、服务端产物构建与真实部署是四种不同副作用边界，验收证据不得互相替代。',
    '构建服务端环境产物，不改变目标环境状态',
  ]) {
    assert.ok(section.includes(carried), carried);
  }

  // 专家自有路由保留：§7 未登记的 ship/cd/ci/env 与 restart 行、指向 §7 的指针、验收证据提醒与本地服务管理。
  for (const kept of [
    '| `/ship dev` | `pnpm agent -- ship dev` |',
    '| `/ship staging` | `pnpm agent -- ship staging` |',
    '| `/ship prod` | `pnpm agent -- ship production` |',
    '| `/cd staging` | `node infra/scripts/devops-tools/devops-run.js --action=cd --env=staging` |',
    '| `/cd prod` | `node infra/scripts/devops-tools/devops-run.js --action=cd --env=production` |',
    '| `/ci run` | `node infra/scripts/devops-tools/devops-run.js --action=ci-run` |',
    '| `/ci status` | `node infra/scripts/devops-tools/devops-run.js --action=ci-status` |',
    '| `/env check <env>` | `node infra/scripts/devops-tools/devops-run.js --action=env-check --env=<env>` |',
    '| `/env status` | `node infra/scripts/devops-tools/devops-run.js --action=env-status` |',
    '| `/restart` | `pnpm agent -- dev restart` | `pnpm dev:restart` |',
    '| `/private restart` | `pnpm agent -- private restart` | `pnpm private:restart` |',
    '`docs/CONVENTIONS.md` §客户端与服务端快捷命令',
    '开发启动、发行构建和真实部署的验收证据不得互相替代',
    '`/private start|restart|stop|status|logs`；禁止写成 `/restart private`',
    'devServer.commands.<action>.<profile>',
  ]) {
    assert.ok(expert.includes(kept), kept);
  }
});

test('devops handbook points to conventions section 7 for shortcut rows and keeps its own profile and script rules', () => {
  const handbook = read('AgentRoles/Handbooks/DEVOPS-ENGINEERING-EXPERT.playbook.md');
  const registry = '`docs/CONVENTIONS.md` §客户端与服务端快捷命令';

  // 旧手册条目 → 仍在承接处的原文：删除与保留在同一处断言，避免只删不留。
  for (const removed of [
    /private profile 的用户快捷语法为/u,
    /`\/dev app <platform>` 与 `\/private dev app <platform>` 读取/u,
    /`\/build app <platform>` 与 `\/private build app <platform>` 读取/u,
    /^\| `\/private restart` \|/mu,
    /^\| `\/dev app <platform>` \|/mu,
    /^\| `\/build app <platform>` \|/mu,
    /^\| `\/build <env>` \|/mu,
  ]) {
    assert.doesNotMatch(handbook, removed);
  }
  assert.equal(handbook.split(registry).length - 1, 2, 'handbook names the conventions shortcut registry where its rows used to be');

  // 手册自有规则保留：脚本路径表中的真实 alias 行、profile 阻断、dispatcher 说明与服务配置约定。
  for (const kept of [
    '- 显式 profile 没有精确命令时必须阻断，禁止回退 default；构建成功不得替代运行态验收。',
    '用户使用 `/private ...` 语法，内部 target 仅用于 dispatcher 调度，不得作为用户快捷命令公开。',
    '- **配置约定**：实际命令写在 `agent.config.json devServer.commands`，必要时通过环境变量提供端口、服务名和日志路径',
    '| `ship:dev` | `node infra/scripts/devops-tools/devops-run.js --action=ship --env=dev` | 需 `devops.deployEnabled=true` |',
    '| `dev:restart` | `node infra/scripts/devops-tools/devops-run.js --action=dev-restart` | |',
  ]) {
    assert.ok(handbook.includes(kept), kept);
  }
});

test('tdd expert states where run evidence goes once', () => {
  const tdd = read('AgentRoles/TDD-PROGRAMMING-EXPERT.md');
  assert.doesNotMatch(tdd, /^- 运行证据写 session 或长任务状态，不写入阶段文件。$/mu);
  assert.doesNotMatch(tdd, /运行证据留在 task state、QA 报告和部署记录；/u);
  assert.ok(tdd.includes('- 不维护 tracked 阶段状态文档；运行证据写 session、长任务状态、QA 报告和部署记录，不写入阶段文件。'));
  assert.ok(tdd.includes('- 用户可见变化更新 CHANGELOG；'));
});

test('expert and handbook path-base notes point at the conventions topology section instead of a missing agents section', () => {
  assert.match(read('docs/CONVENTIONS.md'), /^## 1\. 路径与仓库拓扑$/mu);
  assert.doesNotMatch(read('AGENTS.md'), /^#+ .*仓库拓扑/mu);
  const roleFiles = ['AgentRoles', 'AgentRoles/Handbooks'].flatMap((dir) => fs
    .readdirSync(path.join(ROOT, dir))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `${dir}/${name}`));
  const withNote = roleFiles.filter((file) => read(file).includes('**路径基准**'));
  assert.ok(withNote.length >= 11, 'expert and handbook path-base notes found');
  for (const file of withNote) {
    const text = read(file);
    assert.ok(text.includes('；详见 `/docs/CONVENTIONS.md` §路径与仓库拓扑。'), `${file} points at conventions section 1`);
    assert.doesNotMatch(text, /`\/AGENTS\.md` §仓库拓扑/u, `${file} no longer points at a missing agents section`);
  }
});

test('TDD read-only flow does not require writing diagnostic artifacts', () => {
  const handbook = read('AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md');
  assert.doesNotMatch(handbook, /只读排查[^\n]*产物写容器/u);
  assert.match(handbook, /只读排查[^\n]*对话/u);
  assert.match(handbook, /持久化.*AGENTS\.md/u);
});

test('task CLI help distinguishes work type from state-writing commands', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, ['infra/scripts/agent-runner/agent-task.js', 'start', '--help'], {
    cwd: ROOT, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Single-session read-only.*do not.*start.*resume/u);
  assert.match(result.stdout, /diagnose.*research.*operation.*work.*types/u);
  assert.match(result.stdout, /start.*checkpoint.*resume.*write.*state.*locks/u);
  assert.doesNotMatch(result.stdout, /read-only task type/u);
});

test('template release advertises the phase-aware durable task contract', () => {
  const manifest = JSON.parse(read('infra/templates/agent/template.manifest.json'));
  if (JSON.parse(read('agent.config.json')).template?.role === 'source') {
    assert.equal(manifest.templateVersion, JSON.parse(read('package.json')).version);
  }
  assert.equal(manifest.templateVersion, JSON.parse(read('agent/manifest.json')).version);
  assert.match(manifest.description, /phase-aware durable tasks/u);
  assert.deepEqual(
    manifest.rules.find((entry) => entry.path === 'docs/AGENT_STATE.md'),
    { path: 'docs/AGENT_STATE.md', strategy: 'remove' },
  );
});

test('Xirang identity, official upstream, and natural-language sync route propagate to projects', () => {
  const config = JSON.parse(read('infra/templates/agent/config.example.json'));
  const manifest = JSON.parse(read('infra/templates/agent/template.manifest.json'));
  const packageJson = JSON.parse(read('package.json'));
  const agents = read('AGENTS.md');
  const conventions = read('docs/CONVENTIONS.md');

  assert.deepEqual(config.template.identity, {
    id: 'xirang',
    name: '息壤',
    englishName: 'Xirang',
  });
  assert.deepEqual(config.template.upstream, {
    repository: 'https://github.com/hollisyao2024/PromptsEngineering.git',
    branch: 'main',
    fetchRequired: true,
  });
  assert.equal(config.template.role, 'consumer');
  assert.equal(config.template.sourceRepo, '', 'local backfill source keeps its existing meaning');
  assert.deepEqual(manifest.template, {
    id: 'xirang',
    name: '息壤',
    englishName: 'Xirang',
    repository: 'https://github.com/hollisyao2024/PromptsEngineering.git',
    branch: 'main',
  });
  assert.deepEqual(manifest.capabilities.officialSync, {
    schemaVersion: 1,
    convergenceRequired: true,
  });
  // Package identity belongs to each project. Only the source release must
  // use the Xirang package name and match the template release version.
  const projectConfigPath = path.join(ROOT, 'agent.config.json');
  const projectConfig = fs.existsSync(projectConfigPath)
    ? JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'))
    : {};
  if (projectConfig.template?.role === 'source') {
    assert.equal(packageJson.name, 'xirang-agent-template');
    assert.equal(packageJson.version, manifest.templateVersion);
  }
  assert.match(agents, /更新息壤模板/u);
  assert.match(agents, /pnpm agent -- template sync/u);
  assert.match(conventions, /更新息壤模板/u);
  assert.match(conventions, /TEMPLATE_COMMIT/u);
  assert.match(agents, /匿名 HTTPS/u);
  assert.match(conventions, /TEMPLATE_AUTH_MODE/u);
  assert.match(conventions, /不读取或发送项目/u);
});

test('agent config is initialized sparsely instead of merged with every default', () => {
  const manifest = JSON.parse(read('infra/templates/agent/template.manifest.json'));
  const rule = manifest.rules.find((entry) => entry.path === 'agent.config.json');
  assert.equal(rule.strategy, 'init-if-missing');
  assert.equal(rule.source, 'infra/templates/agent/project-config.example.json');
  const projectExample = JSON.parse(read(rule.source));
  assert.ok(Object.keys(projectExample).length <= 3);

  const configSource = read('infra/scripts/shared/config.js');
  assert.doesNotMatch(configSource, /const DEFAULT_CONFIG\s*=\s*\{/u);
  assert.match(configSource, /templates', 'agent', 'config\.example\.json/u);
});

// 息壤源仓是模板，不是实际项目：功能域详情、总纲与派生矩阵由实际项目维护，不进入源仓。
// 本文件随 infra/scripts 分发到项目，这些文档在项目里合法存在，所以下面的断言只在息壤源执行。
const PROJECT_GOVERNANCE_DOCS = [
  'docs/PRD.md',
  'docs/ARCH.md',
  'docs/TASK.md',
  'docs/QA.md',
  'docs/data/traceability-matrix.md',
  'docs/data/task-dependency-matrix.md',
  'docs/data/test-priority-matrix.md',
  'docs/data/test-risk-matrix.md',
  'docs/data/test-strategy-matrix.md',
  'docs/data/arch-prd-traceability.md',
  'docs/data/story-task-mapping.md',
  'docs/data/component-dependency-graph.md',
  'docs/data/global-dependency-graph.md',
];

function moduleSkeletons() {
  const manifest = JSON.parse(read('infra/templates/agent/template.manifest.json'));
  return new Set(manifest.rules
    .filter((entry) => entry.strategy === 'overwrite' && /^docs\/(?:prd|arch|task|qa)-modules\/[^/]+$/u.test(entry.path))
    .map((entry) => entry.path));
}

function relativeLinks(markdown) {
  const prose = markdown
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gmu, '')
    .replace(/`[^`\n]*`/gu, '');
  const targets = [
    ...[...prose.matchAll(/!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/gu)].map((match) => match[1]),
    ...[...prose.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*<?(\S+?)>?(?:\s+.*)?$/gmu)].map((match) => match[1]),
  ];
  return targets.filter((target) => !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/iu.test(target));
}

test('template source keeps only the template-owned module skeletons', () => {
  if (JSON.parse(read('agent.config.json')).template?.role !== 'source') return;
  const skeletons = moduleSkeletons();
  for (const kind of ['prd', 'arch', 'task', 'qa']) {
    const dir = `docs/${kind}-modules`;
    const expected = [...skeletons].filter((file) => file.startsWith(`${dir}/`)).sort();
    assert.ok(expected.length > 0, `${dir} has a template-owned skeleton in the manifest`);
    const kept = fs.readdirSync(path.join(ROOT, dir))
      .filter((name) => !name.startsWith('.'))
      .map((name) => `${dir}/${name}`)
      .sort();
    assert.deepEqual(kept, expected, `${dir} holds only template-owned skeletons`);
  }
});

test('template source carries no project governance outlines or derived matrices', () => {
  if (JSON.parse(read('agent.config.json')).template?.role !== 'source') return;
  const present = PROJECT_GOVERNANCE_DOCS.filter((file) => fs.existsSync(path.join(ROOT, file)));
  assert.deepEqual(present, [], 'these documents belong to actual projects');
});

test('source-owned documents do not link into project governance docs the source does not keep', () => {
  if (JSON.parse(read('agent.config.json')).template?.role !== 'source') return;
  const skeletons = moduleSkeletons();
  // 模板自有的 README 与 *-TEMPLATE 文档带项目侧链接，不在范围内
  const markdownIn = (dir) => fs.readdirSync(path.join(ROOT, dir))
    .filter((name) => name.endsWith('.md') && name !== 'README.md' && !name.endsWith('-TEMPLATE.md'))
    .map((name) => `${dir}/${name}`);
  const sourceOwned = [
    'README.md',
    'CHANGELOG.md',
    'docs/data/ERD.md',
    'docs/data/dictionary.md',
    ...['docs/adr', 'docs/data/change-requests', 'docs/data/scrs'].flatMap(markdownIn),
  ];
  const dangling = [];
  for (const file of sourceOwned) {
    for (const target of relativeLinks(read(file))) {
      const bare = target.split(/[?#]/u)[0];
      const resolved = path.posix.normalize(bare.startsWith('/') ? bare.slice(1) : path.posix.join(path.posix.dirname(file), bare));
      const intoRemovedDocs = PROJECT_GOVERNANCE_DOCS.includes(resolved)
        || (/^docs\/(?:prd|arch|task|qa)-modules\/[^/]/u.test(resolved) && !skeletons.has(resolved));
      if (intoRemovedDocs) dangling.push(`${file} -> ${target}`);
    }
  }
  assert.deepEqual(dangling, []);
});

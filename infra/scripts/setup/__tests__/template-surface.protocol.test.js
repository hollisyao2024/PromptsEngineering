'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, read } = require('./template-surface.helpers');

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
    'AgentRoles/OPS-ENGINEERING-EXPERT.md',
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
    'AgentRoles/OPS-ENGINEERING-EXPERT.md',
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
    'AgentRoles/OPS-ENGINEERING-EXPERT.md',
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

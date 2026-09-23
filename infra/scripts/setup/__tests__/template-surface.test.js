'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  assert.ok(lineCount('docs/CONVENTIONS.md') <= 300, 'CONVENTIONS.md should stay within 300 lines');
  assert.doesNotMatch(agents, /展示思考过程/u);
});

test('RULES remains project-owned and is never copied from the template source', () => {
  const manifest = JSON.parse(read('infra/templates/agent/template.manifest.json'));
  const rule = manifest.rules.find((entry) => entry.path === 'RULES.md');
  assert.deepEqual(rule, { path: 'RULES.md', strategy: 'project-owned' });
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
});

test('every phase expert explicitly participates in durable task recovery', () => {
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
    assert.match(source, /pnpm agent -- task resume --auto/u, `${expert} must resume durable state`);
    assert.match(source, /pnpm agent -- task start/u, `${expert} must start durable state explicitly`);
    assert.match(source, /pnpm agent -- task checkpoint/u, `${expert} must checkpoint durable state`);
    assert.match(source, /pnpm agent -- task finish/u, `${expert} must explain terminal cleanup`);
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
  assert.match(conventions, /## 11\. 上下文预算与阶段交接/u);
  assert.match(conventions, /8KB\/80/u);
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
  assert.doesNotMatch(read('AgentRoles/TDD-PROGRAMMING-EXPERT.md'), /读取 `docs\/AGENT_STATE\.md` 和当前任务状态/u);
  assert.doesNotMatch(read('AgentRoles/QA-TESTING-EXPERT.md'), /必须读取 PRD\/ARCH\/TASK 模块清单/u);
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
    .filter((entry) => entry.path.startsWith('.codex/'))
    .map((entry) => entry.source || entry.path);

  for (const file of codexFiles) {
    assert.doesNotMatch(read(file), /on-failure|untrusted/u, `${file} must not recommend retired approval policies`);
  }
  assert.match(read('.codex/config.example.toml'), /approval_policy = "on-request"/u);
  assert.match(read('.codex/README.md'), /approval_policy = "on-request"/u);
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

test('shared recovery protocol is available without loading client-specific guidance', () => {
  const conventions = read('docs/CONVENTIONS.md');
  assert.match(conventions, /### 失败分类与恢复/u);
  for (const kind of ['tool_error', 'policy_denied', 'unknown_result']) {
    assert.ok(conventions.includes(kind), kind);
  }
  assert.match(conventions, /具体规则未知/u);
  assert.match(conventions, /继续.*独立.*只读/u);
  assert.match(conventions, /recovery-evidence.*不是.*许可/u);
  assert.match(read('.codex/README.md'), /CONVENTIONS\.md#失败分类与恢复/u);
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
  assert.equal(manifest.templateVersion, '3.5.0');
  assert.match(manifest.description, /phase-aware durable tasks/u);
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

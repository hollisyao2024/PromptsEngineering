'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, lineCount, read } = require('./template-surface.helpers');

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
  assert.equal(config.template.sourceRepo, undefined, 'backfill always targets the official upstream; no local source setting');
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
// 这条规则的文字落点是 docs/CONVENTIONS.md §4；下面三条用例失败时把它连同出处带进失败信息，换电脑或换人开发也能读到。
const SOURCE_BOUNDARY_HINT = 'The Xirang source is a template, not a project: do not add PRD/ARCH/TASK/QA documents for it without asking the user first (docs/CONVENTIONS.md §4)';
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
    assert.deepEqual(kept, expected, `${dir} holds only template-owned skeletons. ${SOURCE_BOUNDARY_HINT}`);
  }
});

test('template source carries no project governance outlines or derived matrices', () => {
  if (JSON.parse(read('agent.config.json')).template?.role !== 'source') return;
  const present = PROJECT_GOVERNANCE_DOCS.filter((file) => fs.existsSync(path.join(ROOT, file)));
  assert.deepEqual(present, [], `these documents belong to actual projects: ${present.join(', ')}. ${SOURCE_BOUNDARY_HINT}`);
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
  assert.deepEqual(dangling, [], `source-owned documents link to project governance docs the source does not keep; write the reference as plain text, not a link: ${dangling.join('; ')}. ${SOURCE_BOUNDARY_HINT}`);
});

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
  assert.ok(lineCount('docs/CONVENTIONS.md') <= 260, 'CONVENTIONS.md should stay within 260 lines');
  assert.doesNotMatch(agents, /展示思考过程/u);
});

test('RULES remains project-owned and is never copied from the template source', () => {
  const manifest = JSON.parse(read('infra/templates/agent/template.manifest.json'));
  const rule = manifest.rules.find((entry) => entry.path === 'RULES.md');
  assert.deepEqual(rule, { path: 'RULES.md', strategy: 'project-owned' });
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

test('large expert and module templates are concise entrypoints', () => {
  assert.ok(lineCount('AgentRoles/TDD-PROGRAMMING-EXPERT.md') <= 220);
  assert.ok(lineCount('docs/qa-modules/MODULE-TEMPLATE.md') <= 350);
  assert.ok(lineCount('docs/arch-modules/MODULE-TEMPLATE.md') <= 350);
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

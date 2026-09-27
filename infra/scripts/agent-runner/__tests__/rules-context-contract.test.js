'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const { resolveCommand } = require('../agent-cli');

test('new contexts must read all three complete rule files before side effects', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /新执行上下文.*完整读取.*AGENTS\.md.*CONVENTIONS\.md.*RULES\.md/u);
  assert.match(agents, /输出截断.*补读.*文件末尾/u);
  assert.match(agents, /读取失败.*停止后续副作用/u);
  assert.doesNotMatch(agents, /rules load|CONTENT_END/u);
  for (const role of ['PRD', 'ARCH', 'TASK', 'TDD', 'QA', 'DEVOPS']) {
    assert.match(agents, new RegExp(`\\[\\[ACTIVATE: .*\\b${role}\\b`, 'u'));
  }
  for (const gate of ['task resume', 'worktree new', 'tdd sync', 'tdd push', 'qa plan', 'qa verify', 'qa merge', 'task finish']) {
    assert.ok(agents.includes(gate), `missing gate: ${gate}`);
  }
});

test('handoff and CLI no longer require the removed rule loader', () => {
  const task = fs.readFileSync(path.join(ROOT, 'infra/scripts/agent-runner/agent-task.js'), 'utf8');
  const conventions = fs.readFileSync(path.join(ROOT, 'docs/CONVENTIONS.md'), 'utf8');
  assert.match(task, /HANDOFF_PROMPT=.*read AGENTS\.md, docs\/CONVENTIONS\.md, and RULES\.md/u);
  assert.match(task, /complete truncated output/u);
  assert.doesNotMatch(task, /rules load/u);
  assert.doesNotMatch(conventions, /rules load/u);
  assert.throws(() => resolveCommand(['rules', 'load', '--file', 'RULES.md']), /unknown agent command/u);
  assert.equal(fs.existsSync(path.join(ROOT, 'infra/scripts/agent-runner/rules-load.js')), false);
});

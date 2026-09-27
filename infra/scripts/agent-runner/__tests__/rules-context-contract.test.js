'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const { resolveCommand } = require('../agent-cli');

test('applied projects read three complete rules while the official template source reads its two files', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.equal(fs.existsSync(path.join(ROOT, 'RULES.md')), false);
  assert.match(agents, /实际项目.*完整读取.*AGENTS\.md.*CONVENTIONS\.md.*RULES\.md/u);
  assert.match(agents, /origin.*官方息壤源.*PromptsEngineering.*RULES\.md.*免读/u);
  assert.match(agents, /项目.*RULES\.md.*缺失.*停止后续副作用/u);
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
  assert.match(task, /HANDOFF_PROMPT=.*read AGENTS\.md and docs\/CONVENTIONS\.md completely/u);
  assert.match(task, /applied projects must also read RULES\.md completely/u);
  assert.match(task, /official PromptsEngineering template source.*skip that project-owned file/u);
  assert.match(task, /[Cc]omplete truncated output/u);
  assert.doesNotMatch(task, /rules load/u);
  assert.doesNotMatch(conventions, /rules load/u);
  assert.throws(() => resolveCommand(['rules', 'load', '--file', 'RULES.md']), /unknown agent command/u);
  assert.equal(fs.existsSync(path.join(ROOT, 'infra/scripts/agent-runner/rules-load.js')), false);
});

test('expert command guidance follows the available dispatcher and mandatory QA gates', () => {
  const readRole = (name) => fs.readFileSync(path.join(ROOT, 'AgentRoles', name), 'utf8');
  const qa = readRole('QA-TESTING-EXPERT.md');
  const devops = readRole('DEVOPS-ENGINEERING-EXPERT.md');
  const tdd = readRole('TDD-PROGRAMMING-EXPERT.md');
  for (const action of ['plan', 'verify', 'merge']) {
    assert.ok(qa.includes('| `/qa ' + action + '` | `pnpm agent -- qa ' + action + '`'), `missing qa ${action} dispatcher`);
  }
  assert.match(devops, /`pnpm agent -- ship staging`/u);
  assert.match(devops, /`pnpm agent -- dev restart`/u);
  assert.match(devops, /`cd`、`ci`、`env`.*未接入.*pnpm agent/u);
  assert.doesNotMatch(tdd, /若用户明确 `--no-qa`/u);
  assert.match(tdd, /无状态的微小动作.*不.*checkpoint/u);
});

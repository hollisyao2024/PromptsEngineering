'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const { resolveCommand } = require('../agent-cli');

test('applied projects read three complete rules while the official template source reads its two files', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /实际项目.*完整读取.*AGENTS\.md.*CONVENTIONS\.md.*RULES\.md/u);
  assert.match(agents, /项目.*RULES\.md.*缺失.*停止后续副作用/u);
  if (fs.existsSync(path.join(ROOT, 'RULES.md'))) {
    assert.ok(fs.readFileSync(path.join(ROOT, 'RULES.md'), 'utf8').trim(), 'project rules must not be empty');
  } else {
    assert.match(agents, /origin.*官方息壤源.*PromptsEngineering.*RULES\.md.*免读/u);
  }
  assert.match(agents, /输出截断.*补读.*文件末尾/u);
  assert.match(agents, /读取失败.*停止后续副作用/u);
  assert.match(agents, /首次应用.*模板更新.*RULES\.md.*缺失/u);
  assert.match(agents, /创建后.*完整读取/u);
  assert.doesNotMatch(agents, /rules load|CONTENT_END/u);
  for (const role of ['PRD', 'ARCH', 'TASK', 'TDD', 'QA', 'OPS']) {
    assert.match(agents, new RegExp(`\\[\\[ACTIVATE: .*\\b${role}\\b`, 'u'));
  }
  for (const gate of ['task resume', 'worktree new', 'tdd sync', 'tdd push', 'qa plan', 'qa verify', 'qa merge', 'task finish']) {
    assert.ok(agents.includes(gate), `missing gate: ${gate}`);
  }
});

test('runtime-injected base rules are not re-read while uninjected, truncated or unconfirmed files still are', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  const task = fs.readFileSync(path.join(ROOT, 'infra/scripts/agent-runner/agent-task.js'), 'utf8');
  assert.match(agents, /运行环境已把.*正文完整注入当前上下文.*不再重读/u);
  assert.match(agents, /`@` 路径本身只表示引用.*不能当作已加载/u);
  assert.match(agents, /未注入、被截断或无法确认时仍须完整读取/u);
  // 注入免读不得放松 fail-closed：目标缺失或为空时门禁照常生效。
  assert.match(agents, /注入免读不放松.*缺失、为空或读取失败/u);
  assert.match(agents, /已完整读取或注入的必需基础规则，阶段切换不重复全文加载/u);
  assert.match(task, /files already injected to EOF need no re-read \(@ paths do not count\)/u);
});

test('compaction restores only what the next step needs without skipping tests, evidence or key reads', () => {
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  const budget = agents.split('## 上下文预算与阶段交接')[1].split('\n## ')[0];
  const rule = budget.split('\n').find((line) => line.startsWith('- 上下文压缩后'));
  assert.ok(rule, 'context budget section must define the post-compaction scope');
  for (const required of [
    '不全量重读',
    '只读接下来要 Edit 的文件',
    '其余用 Grep 点查',
    '决策和下一动作写入当前步骤的 `task checkpoint --next`',
    '不对仍在执行的副作用步骤调用恢复入口',
    '不得因此跳过测试、证据或关键读取',
  ]) {
    assert.ok(rule.includes(required), `missing: ${required}`);
  }
  // 压缩恢复范围不能吞掉基础规则门禁：正文不在上下文时仍须补读。
  assert.match(rule, /基础规则.*必须加载的上下文.*补读/u);
});

test('handoff and CLI no longer require the removed rule loader', () => {
  const task = fs.readFileSync(path.join(ROOT, 'infra/scripts/agent-runner/agent-task.js'), 'utf8');
  const conventions = fs.readFileSync(path.join(ROOT, 'docs/CONVENTIONS.md'), 'utf8');
  assert.match(task, /HANDOFF_PROMPT=.*read AGENTS\.md and docs\/CONVENTIONS\.md completely/u);
  assert.match(task, /applied projects must also read RULES\.md completely/u);
  assert.match(task, /official PromptsEngineering template source.*skip that project-owned file/u);
  assert.match(task, /[Cc]omplete truncated output/u);
  assert.match(task, /template application or update.*missing RULES\.md/u);
  assert.doesNotMatch(task, /rules load/u);
  assert.doesNotMatch(conventions, /rules load/u);
  assert.throws(() => resolveCommand(['rules', 'load', '--file', 'RULES.md']), /unknown agent command/u);
  assert.equal(fs.existsSync(path.join(ROOT, 'infra/scripts/agent-runner/rules-load.js')), false);
});

test('expert command guidance follows the available dispatcher and mandatory QA gates', () => {
  const readRole = (name) => fs.readFileSync(path.join(ROOT, 'AgentRoles', name), 'utf8');
  const qa = readRole('QA-TESTING-EXPERT.md');
  const ops = readRole('OPS-ENGINEERING-EXPERT.md');
  const tdd = readRole('TDD-PROGRAMMING-EXPERT.md');
  for (const action of ['plan', 'verify', 'merge']) {
    assert.ok(qa.includes('| `/qa ' + action + '` | `pnpm agent -- qa ' + action + '`'), `missing qa ${action} dispatcher`);
  }
  for (const command of ['ship staging', 'dev restart', 'cd staging', 'ci run', 'ci status', 'env check <env>', 'env status']) {
    assert.ok(ops.includes('`pnpm agent -- ' + command + '`'), `missing ops dispatcher: ${command}`);
  }
  assert.doesNotMatch(ops, /未接入/u);
  assert.doesNotMatch(qa, /\/ship|\/cd |部署门禁|交接 DevOps/u);
  assert.doesNotMatch(tdd, /若用户明确 `--no-qa`/u);
  assert.match(tdd, /无状态的微小动作.*不.*checkpoint/u);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checkRequiredSections,
  extractCanonicalTaskRows,
  hasModuleTaskStructure,
  isValidTaskId,
} = require('../task-lint');
const { generateTaskMarkdown, validateModuleAlignment } = require('../generate-task');

test('task lint accepts modular TASK document section aliases', () => {
  const content = [
    '## 1. 项目概述',
    '## 2. 模块任务索引',
    '## 3. 全局里程碑（跨模块）',
    '## 4. 跨模块依赖关系',
    '## 5. 全局关键路径（CPM）',
    '## 6. 全局风险与缓解',
    '## 7. 模块同步与相关文档',
  ].join('\n\n');

  assert.deepEqual(checkRequiredSections(content).missingSections, []);
});

test('task generator always emits a modular project overview', () => {
  const tasks = [{
    id: 'TASK-AUTH-001',
    title: 'Implement auth',
    type: 'feature',
    module: 'AUTH',
    owner: '@team',
    effort: 2,
    priority: 'P0',
    dependencies: [],
    story: 'US-AUTH-001',
    moduleDir: 'user-access',
  }];
  const markdown = generateTaskMarkdown(tasks, [{ id: 'US-AUTH-001', title: 'Auth' }], [], ['user-access']);

  assert.match(markdown, /## 2\. 模块任务索引/);
  assert.match(markdown, /task-modules\/user-access\/TASK\.md/);
  assert.doesNotMatch(markdown, /## 3\. WBS（工作分解结构）/);
});

test('task generator rejects PRD and ARCH module set drift', () => {
  const result = validateModuleAlignment(
    [{ moduleDir: 'auth' }, { moduleDir: 'billing' }],
    [{ moduleDir: 'auth' }, { moduleDir: 'orphan' }]
  );

  assert.deepEqual(result.missingArch, ['billing']);
  assert.deepEqual(result.extraArch, ['orphan']);
});

test('task lint accepts numeric and multi-segment module names', () => {
  assert.equal(isValidTaskId('TASK-E2E-001'), true);
  assert.equal(isValidTaskId('TASK-MODEL-CONFIG-021'), true);
  assert.equal(isValidTaskId('TASK-AGENT-V3-001'), true);
  assert.equal(isValidTaskId('TASK-MODEL-CONFIG-21'), false);
});

test('module TASK indexes may provide a WBS section before task IDs are planned', () => {
  assert.equal(hasModuleTaskStructure('## 2. WBS（工作分解结构）\n\n待规划'), true);
  assert.equal(hasModuleTaskStructure('TASK-AUTH-001'), true);
  assert.equal(hasModuleTaskStructure('仅有说明，没有 WBS 或 Task ID'), false);
});

test('task quality checks only inspect canonical WBS table rows', () => {
  const rows = extractCanonicalTaskRows([
    '| Task ID | 名称 | Owner | 工时 |',
    '| TASK-AUTH-001 | 登录 | @team-auth | 2d |',
    '- 关联 TASK-BILLING-002，详见模块文档',
    '| 模块 | TASK-CANVAS-003 | 说明 |',
  ].join('\n'));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'TASK-AUTH-001');
  assert.match(rows[0].line, /@team-auth/);
});

test('task quality checks ignore index-only and malformed task references', () => {
  assert.deepEqual(extractCanonicalTaskRows('TASK-AUTH-001 — 模块索引'), []);
  assert.deepEqual(extractCanonicalTaskRows('| TASK-AUTH-01 | 非规范 ID | @team | 1d |'), []);
  assert.deepEqual(extractCanonicalTaskRows([
    '| Task ID | Story | AC/TC | Gate / 责任人 |',
    '|---------|-------|-------|----------------|',
    '| TASK-AUTH-001 | US-AUTH-001 | AC-AUTH-001-01 | @team-auth |',
  ].join('\n')), []);
  assert.deepEqual(extractCanonicalTaskRows(''), []);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkRequiredSections } = require('../task-lint');

test('task lint accepts modular TASK document section aliases', () => {
  const content = [
    '## 1. 项目概述',
    '## 2. 模块任务索引',
    '## 3. 全局里程碑（跨模块）',
    '## 4. 跨模块依赖关系',
    '## 5. 全局关键路径（CPM）',
    '## 6. 全局风险与缓解',
    '## 7. 基础设施任务（INFRA）',
    '## 8. Story → Task 映射',
  ].join('\n\n');

  assert.deepEqual(checkRequiredSections(content).missingSections, []);
});

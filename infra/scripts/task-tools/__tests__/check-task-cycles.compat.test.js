'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  collectAllDependencies,
  detectCycles,
  detectInvalidDependencies,
  parseDependencies,
} = require('../check-task-cycles');

test('task dependency parser handles multi-segment IDs row-by-row', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-dependencies-'));
  const file = path.join(root, 'TASK.md');
  fs.writeFileSync(file, [
    '| Task ID | Name | Owner | Estimate | Priority | Dependencies | Status |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| TASK-RUNTIME-GAP-002 | Import | backend | 2d | P0 | TASK-RUNTIME-GAP-001 | pending |',
    '| TASK-RUNTIME-GAP-003 | Export | backend | 2d | P0 | TASK-RUNTIME-GAP-002 | pending |',
    '',
    '### TASK-MODEL-CONFIG-010：Validate config',
    '',
    '**依赖**：TASK-RUNTIME-GAP-003',
  ].join('\n'));

  assert.deepEqual(
    [...parseDependencies(file).entries()],
    [
      ['TASK-RUNTIME-GAP-002', ['TASK-RUNTIME-GAP-001']],
      ['TASK-RUNTIME-GAP-003', ['TASK-RUNTIME-GAP-002']],
      ['TASK-MODEL-CONFIG-010', ['TASK-RUNTIME-GAP-003']],
      ['TASK-RUNTIME-GAP-001', []],
    ],
  );
});

test('task dependency parser respects module and global matrix header direction', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-matrix-direction-'));
  const file = path.join(root, 'TASK.md');
  fs.writeFileSync(file, [
    '| 任务 | 依赖 | 类型 | 说明 |',
    '| --- | --- | --- | --- |',
    '| TASK-BRAND-001 | TASK-GOV-001 | FS | Brand depends on governance |',
    '| TASK-BRAND-001 | TASK-IA-001 | CHECK | IA validates the result but is not a prerequisite |',
    '| 前置任务 | 后置任务 | 类型 | Lag |',
    '| --- | --- | --- | --- |',
    '| TASK-GOV-001 | TASK-GROWTH-001 | FS | 0 |',
  ].join('\n'));

  assert.deepEqual([...parseDependencies(file).entries()], [
    ['TASK-BRAND-001', ['TASK-GOV-001']],
    ['TASK-GOV-001', []],
    ['TASK-GROWTH-001', ['TASK-GOV-001']],
  ]);
});

test('invalid dependency detection distinguishes canonical definitions from references', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-invalid-dependencies-'));
  const file = path.join(root, 'TASK.md');
  fs.writeFileSync(file, [
    '| Task ID | Name | Dependencies | Status |',
    '| --- | --- | --- | --- |',
    '| TASK-REAL-001 | Real task | TASK-MISSING-001 | pending |',
    '| 任务 | 依赖 | 类型 | 说明 |',
    '| --- | --- | --- | --- |',
    '| TASK-PHANTOM-001 | TASK-REAL-001 | FS | Matrix rows are references, not definitions |',
  ].join('\n'));

  const dependencies = parseDependencies(file);
  assert.deepEqual(detectInvalidDependencies(dependencies), [
    { taskId: 'TASK-REAL-001', depId: 'TASK-MISSING-001' },
    { taskId: 'TASK-PHANTOM-001', depId: null },
  ]);
});


'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  collectAllAcceptanceCriteriaIds,
  collectAllStoryIds,
  collectAllTaskIds,
  extractAcceptanceCriteriaIdsFromText,
  extractCanonicalPrdIdsFromContent,
  extractCanonicalTaskIdsFromContent,
  extractStoryIds,
  extractTaskIds,
  parseStoryTaskMapping,
  parseStoryTaskMappingContent,
  validateRepositoryTraceability,
} = require('../sync-prd-task-ids');

test('sync parser extracts multi-segment Story and Task IDs without truncation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-sync-'));
  const file = path.join(root, 'mapping.md');
  fs.writeFileSync(file, [
    '| US-RUNTIME-TRUST-001 | TASK-RUNTIME-GAP-003 |',
    '| US-MODEL-CONFIG-002 | TASK-MODEL-CONFIG-010 |',
  ].join('\n'));

  assert.deepEqual([...extractStoryIds(file)], [
    'US-RUNTIME-TRUST-001',
    'US-MODEL-CONFIG-002',
  ]);
  assert.deepEqual([...extractTaskIds(file)], [
    'TASK-RUNTIME-GAP-003',
    'TASK-MODEL-CONFIG-010',
  ]);
});

test('sync parser does not truncate migration phase labels into canonical Task IDs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-sync-phase-'));
  const file = path.join(root, 'phases.md');
  fs.writeFileSync(file, [
    'TASK-DB-003-EXPAND is a phase label, not a canonical task.',
    'TASK-DB-003 is canonical.',
  ].join('\n'));

  assert.deepEqual([...extractTaskIds(file)], ['TASK-DB-003']);
});

test('canonical PRD extraction ignores reference-only Story and AC IDs', () => {
  const result = extractCanonicalPrdIdsFromContent([
    '### US-REAL-001：Canonical story',
    '',
    '- AC-REAL-001-01..02 Given a real acceptance criterion.',
    '',
    '### Notes',
    '',
    'Reference only: US-PHANTOM-001 and AC-PHANTOM-001-01.',
  ].join('\n'));

  assert.deepEqual([...result.storyIds], ['US-REAL-001']);
  assert.deepEqual([...result.acceptanceCriteriaIds], [
    'AC-REAL-001-01',
    'AC-REAL-001-02',
  ]);
});

test('canonical Task extraction ignores body and mapping references', () => {
  const ids = extractCanonicalTaskIdsFromContent([
    '| Task ID | Name | Owner | Status |',
    '| --- | --- | --- | --- |',
    '| TASK-REAL-001 | Canonical work | @backend | pending |',
    '',
    '| Story ID | AC 范围 | Task ID |',
    '| --- | --- | --- |',
    '| US-REAL-001 | AC-REAL-001-01 | TASK-PHANTOM-001 |',
    '',
    'Reference only: TASK-PHANTOM-002.',
    '',
    '### 3.1 TASK-REAL-002：Canonical detail',
  ].join('\n'));

  assert.deepEqual([...ids], ['TASK-REAL-001', 'TASK-REAL-002']);
});

test('mapping parser records every Task ID in a multi-ID mapping cell', () => {
  const result = parseStoryTaskMappingContent([
    '| Story ID | AC 范围 | Task ID |',
    '| --- | --- | --- |',
    '| US-DATA-REAL-002 | AC-DATA-REAL-002-01..06 | TASK-GEO-001、TASK-GEO-002 |',
  ].join('\n'));

  assert.deepEqual(result.mapping.get('US-DATA-REAL-002'), [
    'TASK-GEO-001',
    'TASK-GEO-002',
  ]);
  assert.deepEqual([...result.mappedAcceptanceCriteria], [
    'AC-DATA-REAL-002-01',
    'AC-DATA-REAL-002-02',
    'AC-DATA-REAL-002-03',
    'AC-DATA-REAL-002-04',
    'AC-DATA-REAL-002-05',
    'AC-DATA-REAL-002-06',
  ]);
});

test('mapping parser handles adjacent Markdown tables without swallowing the next header', () => {
  const result = parseStoryTaskMappingContent([
    '| Story ID | AC 范围 | Task ID |',
    '| --- | --- | --- |',
    '| US-REAL-001 | AC-REAL-001-01 | TASK-REAL-001 |',
    '| Story ID | AC 范围 | Task ID |',
    '| --- | --- | --- |',
    '| US-REAL-002 | AC-REAL-002-01 | TASK-REAL-002 |',
  ].join('\n'));

  assert.deepEqual([...result.mappedStories], ['US-REAL-001', 'US-REAL-002']);
  assert.deepEqual([...result.mappedTasks], ['TASK-REAL-001', 'TASK-REAL-002']);
});

test('AC parser expands compact ranges and sparse suffixes', () => {
  assert.deepEqual(
    [...extractAcceptanceCriteriaIdsFromText('AC-RBAC-001-01..03、07、09')],
    [
      'AC-RBAC-001-01',
      'AC-RBAC-001-02',
      'AC-RBAC-001-03',
      'AC-RBAC-001-07',
      'AC-RBAC-001-09',
    ],
  );
});

test('traceability rejects empty, missing and unknown mappings without project data', () => {
  const input = {
    stories: new Set(['US-EXAMPLE-DATA-001']),
    acceptanceCriteria: new Set(['AC-EXAMPLE-DATA-001-01']),
    tasks: new Set(['TASK-EXAMPLE-DATA-001']),
    mapping: {
      mappedStories: new Set(['US-EXAMPLE-DATA-001']),
      mappedAcceptanceCriteria: new Set(['AC-EXAMPLE-DATA-001-01']),
      mappedTasks: new Set(['TASK-EXAMPLE-DATA-001']),
    },
  };
  assert.equal(validateRepositoryTraceability(input).passed, true);
  const missing = validateRepositoryTraceability({
    ...input, mapping: { ...input.mapping, mappedStories: new Set() },
  });
  assert.equal(missing.passed, false);
  assert.deepEqual(missing.orphanStories, ['US-EXAMPLE-DATA-001']);
  const unknown = validateRepositoryTraceability({
    ...input, mapping: { ...input.mapping, mappedTasks: new Set(['TASK-EXAMPLE-DATA-002']) },
  });
  assert.equal(unknown.passed, false);
  assert.deepEqual(unknown.invalidTasks, ['TASK-EXAMPLE-DATA-002']);
  assert.equal(validateRepositoryTraceability({ ...input, stories: new Set() }).passed, false);
});

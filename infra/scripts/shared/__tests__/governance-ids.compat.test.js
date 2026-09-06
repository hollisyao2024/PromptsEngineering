'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AC_ID_SOURCE,
  COMPONENT_ID_SOURCE,
  STORY_ID_SOURCE,
  TASK_ID_SOURCE,
  exactPattern,
  extractIds,
} = require('../governance-ids');

test('governance ID grammar supports multi-segment canonical IDs', () => {
  assert.deepEqual(
    extractIds(
      [
        'US-RUNTIME-TRUST-001',
        'AC-RUNTIME-TRUST-001-06',
        'TASK-RUNTIME-GAP-003',
        'PLATFORM-TRUST-SVC-001',
      ].join(' '),
      STORY_ID_SOURCE,
    ),
    ['US-RUNTIME-TRUST-001'],
  );
  assert.equal(exactPattern(AC_ID_SOURCE).test('AC-RUNTIME-TRUST-001-06'), true);
  assert.equal(exactPattern(TASK_ID_SOURCE).test('TASK-RUNTIME-GAP-003'), true);
  assert.equal(exactPattern(COMPONENT_ID_SOURCE).test('PLATFORM-TRUST-SVC-001'), true);
});

test('governance ID search never truncates a phase label into a canonical ID', () => {
  assert.deepEqual(
    extractIds('TASK-DB-003-EXPAND then TASK-DB-003', TASK_ID_SOURCE),
    ['TASK-DB-003'],
  );
  assert.deepEqual(
    extractIds('US-RUNTIME-TRUST-001-DRAFT', STORY_ID_SOURCE),
    [],
  );
});

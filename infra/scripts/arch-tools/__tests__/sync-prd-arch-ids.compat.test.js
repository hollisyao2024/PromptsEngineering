'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractComponentIDs,
  extractStoryDefinitions,
  extractStoryIDs,
  traceabilityHasErrors,
} = require('../sync-prd-arch-ids');

test('ARCH sync extracts multi-segment Story IDs', () => {
  const results = extractStoryIDs([
    'US-RUNTIME-TRUST-001 is implemented by PLATFORM-TRUST-SVC-001.',
    'US-MODEL-CONFIG-002 depends on FEAT-ANSWER-INTELLIGENCE-003.',
  ].join('\n'), 'ARCH.md');

  assert.deepEqual(results.map(({ storyID }) => storyID), [
    'US-RUNTIME-TRUST-001',
    'US-MODEL-CONFIG-002',
    'FEAT-ANSWER-INTELLIGENCE-003',
  ]);
});

test('ARCH sync extracts multi-segment Component IDs without treating stories as components', () => {
  const results = extractComponentIDs([
    'PLATFORM-TRUST-SVC-001 --> ASYNC-OUTBOX-DB-002',
    'US-RUNTIME-TRUST-001',
  ].join('\n'), 'ARCH.md');

  assert.deepEqual(results.map(({ componentID }) => componentID), [
    'PLATFORM-TRUST-SVC-001',
    'ASYNC-OUTBOX-DB-002',
  ]);
});

test('PRD definition extraction accepts canonical headings and ignores body references', () => {
  const results = extractStoryDefinitions([
    'Reference only: US-PHANTOM-001.',
    '### US-RUNTIME-TRUST-001：Canonical story',
    '### FEAT-ANSWER-INTELLIGENCE-003: Canonical feature',
  ].join('\n'), 'PRD.md');

  assert.deepEqual(results.map(({ storyID }) => storyID), [
    'US-RUNTIME-TRUST-001',
    'FEAT-ANSWER-INTELLIGENCE-003',
  ]);
});

test('ARCH traceability fails closed on empty or one-way coverage', () => {
  const cleanStories = {
    archReferencesNotInPRD: [],
    prdDefinitionsNotInArch: [],
  };
  const cleanComponents = { graphReferencesNotInModules: [] };

  assert.equal(traceabilityHasErrors(cleanStories, cleanComponents, {
    inArch: 0,
    inPRD: 0,
    inGraph: 0,
    inModules: 0,
  }), true);
  assert.equal(traceabilityHasErrors({
    ...cleanStories,
    prdDefinitionsNotInArch: [{ storyID: 'US-MISSING-001' }],
  }, cleanComponents, {
    inArch: 1,
    inPRD: 2,
    inGraph: 1,
    inModules: 1,
  }), true);
  assert.equal(traceabilityHasErrors(cleanStories, cleanComponents, {
    inArch: 1,
    inPRD: 1,
    inGraph: 1,
    inModules: 1,
  }), false);
});

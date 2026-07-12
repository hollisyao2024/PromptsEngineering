'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isValidTestCaseId, isValidDefectId, isValidStoryId } = require('../qa-lint');

test('QA IDs accept numeric and multi-segment module names', () => {
  assert.equal(isValidTestCaseId('TC-E2E-001'), true);
  assert.equal(isValidTestCaseId('TC-MODEL-CONFIG-001'), true);
  assert.equal(isValidDefectId('BUG-BROWSER-START-001'), true);
  assert.equal(isValidStoryId('US-AGENTPLATFORM-004'), true);
});

test('QA IDs still require an uppercase module and three-digit sequence', () => {
  assert.equal(isValidTestCaseId('TC-E2E-01'), false);
  assert.equal(isValidDefectId('BUG-browser-start-001'), false);
  assert.equal(isValidStoryId('US-MODEL-CONFIG-0001'), false);
});

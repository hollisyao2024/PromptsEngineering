'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { legacyPhaseError, normalizeLegacyPhase } = require('../legacy-phase');

test('persisted legacy phases normalize to their current names and other values pass through', () => {
  assert.equal(normalizeLegacyPhase('devops'), 'ops');
  assert.equal(normalizeLegacyPhase('ops'), 'ops');
  assert.equal(normalizeLegacyPhase('qa'), 'qa');
  assert.equal(normalizeLegacyPhase(''), '');
  assert.equal(normalizeLegacyPhase(undefined), undefined);
});

test('renamed phase input produces a migration message instead of a silent alias', () => {
  assert.match(legacyPhaseError('devops'), /devops 阶段已更名为 ops/u);
  assert.match(legacyPhaseError('DevOps'), /--phase ops/u);
  assert.equal(legacyPhaseError('ops'), '');
  assert.equal(legacyPhaseError('tdd'), '');
  assert.equal(legacyPhaseError(undefined), '');
});

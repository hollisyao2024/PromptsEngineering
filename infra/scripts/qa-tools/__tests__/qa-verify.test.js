'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateQaFile } = require('../qa-verify');

const repoRoot = path.resolve(__dirname, '../../../..');

test('validateQaFile accepts module IDs that contain digits and multiple segments', (t) => {
  const moduleDir = `digit-id-fixture-${process.pid}`;
  const prdDir = path.join(repoRoot, 'docs', 'prd-modules', moduleDir);
  const qaDir = path.join(repoRoot, 'docs', 'qa-modules', moduleDir);
  const qaRelPath = path.posix.join('docs/qa-modules', moduleDir, 'QA.md');

  fs.mkdirSync(prdDir, { recursive: true });
  fs.mkdirSync(qaDir, { recursive: true });
  t.after(() => {
    fs.rmSync(prdDir, { recursive: true, force: true });
    fs.rmSync(qaDir, { recursive: true, force: true });
  });

  fs.writeFileSync(
    path.join(prdDir, 'PRD.md'),
    ['# PRD', '', '## Stories', '- US-E2E-001: nightly coverage', '- US-MODEL-CONFIG-001: routing config'].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(qaDir, 'QA.md'),
    ['# QA', '', '## Coverage', '- US-E2E-001 -> TC-E2E-001', '- US-MODEL-CONFIG-001 -> TC-MODEL-CONFIG-001'].join('\n'),
    'utf8'
  );

  const result = validateQaFile(qaRelPath);

  assert.equal(result.errors.length, 0);
  assert.equal(result.stats.storyCount, 2);
  assert.equal(result.stats.testCaseCount, 2);
  assert.equal(result.stats.validStoryRefCount, 2);
  assert.equal(result.stats.storyCoverage, 100);
});

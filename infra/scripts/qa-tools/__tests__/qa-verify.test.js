'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveTargetsFromQaPlanState, validateQaFile } = require('../qa-verify');

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

test('validateQaFile accepts cross-module Story references without inflating local coverage', (t) => {
  const fixtureId = `${process.pid}-${Date.now()}`;
  const moduleDir = `cross-module-source-${fixtureId}`;
  const siblingModuleDir = `cross-module-target-${fixtureId}`;
  const prdDir = path.join(repoRoot, 'docs', 'prd-modules', moduleDir);
  const siblingPrdDir = path.join(repoRoot, 'docs', 'prd-modules', siblingModuleDir);
  const qaDir = path.join(repoRoot, 'docs', 'qa-modules', moduleDir);
  const qaRelPath = path.posix.join('docs/qa-modules', moduleDir, 'QA.md');

  fs.mkdirSync(prdDir, { recursive: true });
  fs.mkdirSync(siblingPrdDir, { recursive: true });
  fs.mkdirSync(qaDir, { recursive: true });
  t.after(() => {
    fs.rmSync(prdDir, { recursive: true, force: true });
    fs.rmSync(siblingPrdDir, { recursive: true, force: true });
    fs.rmSync(qaDir, { recursive: true, force: true });
  });

  fs.writeFileSync(
    path.join(prdDir, 'PRD.md'),
    ['# PRD', '', '## Stories', '- US-SOURCE-001: local story', '- US-SOURCE-002: uncovered local story'].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(siblingPrdDir, 'PRD.md'),
    ['# PRD', '', '## Stories', '- US-TARGET-001: cross-module dependency'].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(qaDir, 'QA.md'),
    ['# QA', '', '## Coverage', '- US-SOURCE-001 -> TC-SOURCE-001', '- US-TARGET-001 -> TC-TARGET-001'].join('\n'),
    'utf8'
  );

  const result = validateQaFile(qaRelPath);

  assert.equal(result.errors.length, 0);
  assert.equal(result.stats.storyCount, 2);
  assert.equal(result.stats.validStoryRefCount, 1);
  assert.equal(result.stats.storyCoverage, 50);
});

test('QA verification reads only the selected worktree session state file', (t) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-session-isolation-'));
  const currentStatePath = path.join(fixtureDir, 'current-worktree.json');
  const foreignStatePath = path.join(fixtureDir, 'foreign-worktree.json');
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));

  fs.writeFileSync(currentStatePath, JSON.stringify({
    scope: 'session',
    modules: ['current-module'],
    touchedFiles: ['docs/qa-modules/current-module/QA.md'],
  }), 'utf8');
  fs.writeFileSync(foreignStatePath, JSON.stringify({
    scope: 'session',
    modules: ['foreign-module'],
    touchedFiles: ['docs/qa-modules/foreign-module/QA.md'],
  }), 'utf8');

  const result = resolveTargetsFromQaPlanState(currentStatePath);

  assert.deepEqual(result.modules, ['current-module']);
  assert.deepEqual(result.files, ['docs/qa-modules/current-module/QA.md']);
  assert.match(result.source, /current-worktree\.json/);
  assert.doesNotMatch(result.source, /foreign-worktree\.json/);
});

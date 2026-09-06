'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  analyzeCoverage,
  coverageExitCode,
  parseStoriesFromPRD,
  parseTestCasesFromQA,
  parseTraceabilityMatrix,
} = require('../check-test-coverage');

function writeFixture(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

test('coverage discovery accepts modular tables and multi-segment Story and Test Case IDs', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-coverage-modules-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  writeFixture(root, 'docs/prd-modules/example-module/PRD.md', [
    '# Platform governance',
    '',
    '| Story | Priority |',
    '| --- | --- |',
    '| `US-DATA-REAL-002` | P0 |',
    '| `US-MODEL-CONFIG-001` | P1 |',
  ].join('\n'));
  writeFixture(root, 'docs/qa-modules/example-module/QA.md', [
    '# Platform QA',
    '',
    '| Test Case | Story |',
    '| --- | --- |',
    '| `TC-SAMPLE-CONTRACT-001` | `US-DATA-REAL-002` |',
    '| `TC-MODEL-CONFIG-001` | `US-MODEL-CONFIG-001` |',
  ].join('\n'));
  writeFixture(root, 'docs/data/traceability-matrix.md', [
    '| Story | Test Case |',
    '| --- | --- |',
    '| `US-DATA-REAL-002` | `TC-SAMPLE-CONTRACT-001..006` |',
    '| `US-MODEL-CONFIG-001` | `TC-MODEL-CONFIG-001` |',
  ].join('\n'));

  const config = {
    prdPath: path.join(root, 'docs/PRD.md'),
    prdModulesDir: path.join(root, 'docs/prd-modules'),
    qaPath: path.join(root, 'docs/QA.md'),
    qaModulesDir: path.join(root, 'docs/qa-modules'),
    traceabilityMatrixPath: path.join(root, 'docs/data/traceability-matrix.md'),
    coverageSummaryPath: path.join(root, 'docs/data/qa-reports/coverage-summary.md'),
  };

  const stories = parseStoriesFromPRD(config);
  const { testCases, testCaseToStory } = parseTestCasesFromQA(config);
  const matrix = parseTraceabilityMatrix(config);
  const result = analyzeCoverage(stories, testCaseToStory, matrix);

  assert.deepEqual([...stories.keys()].sort(), ['US-DATA-REAL-002', 'US-MODEL-CONFIG-001']);
  assert.equal(stories.get('US-DATA-REAL-002').module, 'example-module');
  assert.equal(stories.get('US-DATA-REAL-002').priority, 'P0');
  assert.deepEqual([...testCases.keys()].sort(), ['TC-MODEL-CONFIG-001', 'TC-SAMPLE-CONTRACT-001']);
  assert.deepEqual(matrix.get('US-DATA-REAL-002'), ['TC-SAMPLE-CONTRACT-001']);
  assert.equal(result.uncoveredStories.length, 0);
});

test('coverage gate fails closed below the configured threshold', () => {
  assert.equal(coverageExitCode(84, 85), 1);
  assert.equal(coverageExitCode(85, 85), 0);
  assert.equal(coverageExitCode(100, 85), 0);
});


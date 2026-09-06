'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseDependencies,
  validateDependencyGraph,
} = require('../check-dependency-cycles');

test('dependency parser supports multi-segment story IDs and Chinese-colon headings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-dependencies-'));
  const file = path.join(root, 'PRD.md');
  fs.writeFileSync(file, [
    '### US-RUNTIME-TRUST-001：Secure registration',
    '',
    '**依赖**：US-MODEL-CONFIG-001、US-API-DATA-001',
    '',
    '### US-MODEL-CONFIG-001: Model config',
    '',
    '**依赖**：无',
    '',
    '### US-API-DATA-001: API data',
    '',
    '**依赖**：无',
    '',
    '## Traceability',
    '',
    '**依赖**：US-PHANTOM-001',
  ].join('\n'));

  assert.deepEqual(
    [...parseDependencies(file).entries()],
    [
      ['US-RUNTIME-TRUST-001', ['US-MODEL-CONFIG-001', 'US-API-DATA-001']],
      ['US-MODEL-CONFIG-001', []],
      ['US-API-DATA-001', []],
    ],
  );
});

test('dependency validation fails closed on an empty graph', () => {
  const result = validateDependencyGraph(new Map());

  assert.equal(result.passed, false);
  assert.deepEqual(result.cycles, []);
  assert.deepEqual(result.invalidDeps, []);
});

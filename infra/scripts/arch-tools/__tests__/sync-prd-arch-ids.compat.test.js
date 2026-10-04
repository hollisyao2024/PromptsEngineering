'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  collectModulePrdFiles,
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

test('PRD discovery includes linked markdown specifications and excludes non-markdown files', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guixu-prd-discovery-'));

  try {
    fs.writeFileSync(path.join(tempDir, 'PRD.md'), '# Module PRD\n', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'linked-spec.md'), '## US-MODULE-001：Linked story\n', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'US-MODULE-002\n', 'utf8');

    const files = collectModulePrdFiles(tempDir).map(file => path.basename(file));

    assert.deepEqual(files, ['PRD.md', 'linked-spec.md']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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


test('CLI discovers split module definitions, keeps PRD.md and ignores body-only references', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-modular-prd-'));
  const root = path.resolve(__dirname, '../../../..');
  try {
    for (const file of [
      'infra/scripts/arch-tools/sync-prd-arch-ids.js',
      'infra/scripts/arch-tools/protected-sections.js',
      'infra/scripts/shared/config.js',
      'infra/scripts/shared/governance-ids.js',
      'infra/templates/agent/config.example.json',
    ]) {
      const target = path.join(fixture, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, file), target);
    }
    fs.mkdirSync(path.join(fixture, 'docs/prd-modules/example'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'docs/ARCH.md'), 'US-MODULE-001 US-MODULE-002\n');
    fs.writeFileSync(path.join(fixture, 'docs/prd-modules/example/PRD.md'), '## US-MODULE-001: Landing requirement\n');
    fs.writeFileSync(path.join(fixture, 'docs/prd-modules/example/split.md'), '## US-MODULE-002：Split requirement\nReference US-PHANTOM-001\n');
    fs.mkdirSync(path.join(fixture, 'docs/data'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'docs/arch-modules/example'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'docs/data/component-dependency-graph.md'), 'MODULE-SVC-001\n');
    fs.writeFileSync(path.join(fixture, 'docs/arch-modules/example/ARCH.md'), 'MODULE-SVC-001\n');
    const result = spawnSync(process.execPath, ['infra/scripts/arch-tools/sync-prd-arch-ids.js', '--json'], {
      cwd: fixture, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /"inPRD": 2/);
    assert.match(result.stdout, /"status": "pass"/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

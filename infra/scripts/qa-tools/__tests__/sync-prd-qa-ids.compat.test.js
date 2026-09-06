'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseStoriesAndACsFromContent,
  collectACRefsFromContents,
  findStoriesWithoutACs,
} = require('../sync-prd-qa-ids');

test('QA sync assigns multi-segment ACs to their canonical Story headings', () => {
  const content = [
    'A trace note mentions US-MODEL-CONFIG-001 but does not define it.',
    '',
    '### US-RUNTIME-TRUST-001：Secure registration',
    '',
    '**优先级**：P0',
    '',
    '#### 验收标准',
    '',
    '| AC-RUNTIME-TRUST-001-01 | invitation is valid | register | account is created |',
    '| AC-RUNTIME-TRUST-001-02 | invitation is reused | register | request is rejected |',
    '',
    '### US-MODEL-CONFIG-001: Configure models',
    '',
    '**优先级**：P1',
    '',
    '| AC-MODEL-CONFIG-001-01 | config is valid | save | version is persisted |',
    '',
    '## 4. Traceability',
    '',
    '| US-RUNTIME-TRUST-001 | AC-RUNTIME-TRUST-001-03 | referenced outside the Story definition |',
  ].join('\n');

  assert.deepEqual([...parseStoriesAndACsFromContent(content, 'platform').entries()], [
    ['US-RUNTIME-TRUST-001', {
      module: 'platform',
      priority: 'P0',
      acs: ['AC-RUNTIME-TRUST-001-01', 'AC-RUNTIME-TRUST-001-02'],
    }],
    ['US-MODEL-CONFIG-001', {
      module: 'platform',
      priority: 'P1',
      acs: ['AC-MODEL-CONFIG-001-01'],
    }],
  ]);
});

test('QA sync identifies canonical Stories with zero acceptance criteria', () => {
  const stories = parseStoriesAndACsFromContent([
    '### US-EMPTY-001：Missing acceptance criteria',
    '',
    '**优先级**：P0',
  ].join('\n'), 'empty');

  assert.deepEqual(findStoriesWithoutACs(stories), ['US-EMPTY-001']);
});

test('QA sync preserves canonical acceptance criteria when a later subsection repeats the Story ID', () => {
  const stories = parseStoriesAndACsFromContent([
    '### US-CONTENT-001：Generate content tasks',
    '',
    '**优先级**：P1',
    '',
    '- AC-CONTENT-001-01 Given a request, When saved, Then a task exists.',
    '- AC-CONTENT-001-02 Given a task, When read, Then its evidence is visible.',
    '',
    '### US-CONTENT-001 子菜单信息架构',
    '',
    '| Menu | Route |',
    '| --- | --- |',
    '| Briefs | /writing/briefs |',
  ].join('\n'), 'writing-commerce');

  assert.deepEqual([...stories.entries()], [[
    'US-CONTENT-001',
    {
      module: 'writing-commerce',
      priority: 'P1',
      acs: ['AC-CONTENT-001-01', 'AC-CONTENT-001-02'],
    },
  ]]);
});

test('QA sync counts literal AC references from QA plans as tested coverage', () => {
  const references = collectACRefsFromContents([
    '| TC-RBAC-001 | US-RBAC-001 | AC-RBAC-001-01 |',
    'AC-RUNTIME-TRUST-001-02 is covered by a negative replay case.',
    '| trace | AC-RBAC-001-01 | duplicate |',
  ]);

  assert.deepEqual([...references].sort(), [
    'AC-RBAC-001-01',
    'AC-RUNTIME-TRUST-001-02',
  ]);
});

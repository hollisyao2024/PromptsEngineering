'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  determineReleaseDecision,
  parseDefectContent,
  parseNFRCompliance,
} = require('../check-defect-blockers');

test('defect parser reads modular defect-log tables and multi-segment IDs', () => {
  const content = [
    '| 缺陷 ID | 标题 | 严重度 | 优先级 | 状态 | 影响模块 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| `BUG-QA-GATE-006` | 发布门禁 fail-open | P1 | P0 Gate | Closed | example-module |',
    '| `BUG-SEC-AUTH-001` | 越权写入 | P0 | P0 Gate | Open | auth |',
  ].join('\n');

  const defects = parseDefectContent(content, 'example-module');

  assert.deepEqual(defects, [
    {
      bugId: 'BUG-QA-GATE-006',
      title: '发布门禁 fail-open',
      severity: 'P1',
      status: 'Closed',
      storyId: null,
      assignee: '未指定',
      eta: '未指定',
      impact: 'example-module',
      module: 'example-module',
    },
    {
      bugId: 'BUG-SEC-AUTH-001',
      title: '越权写入',
      severity: 'P0',
      status: 'Open',
      storyId: null,
      assignee: '未指定',
      eta: '未指定',
      impact: 'auth',
      module: 'example-module',
    },
  ]);
});

test('NFR parser distinguishes achieved, conditional, and unmet rows', () => {
  const content = [
    '| NFR ID | 类型 | 描述 | 关联 Story | 基线 | 目标 | 当前值 | 验证方式 | 状态 | 负责人 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| NFR-RUNTIME-QA-001 | 可测试性 | 本地隔离验证 | US-RUNTIME-001 | none | pass | pass | tests | ✅ 达标 | @qa |',
    '| NFR-SAMPLE-EVIDENCE-001 | 证据保真 | 真实证据验证 | US-SAMPLE-001 | none | pass | local only | tests | ⚠️ 本地 QA 通过；真实 evidence 未确认 | @qa |',
    '| NFR-SAMPLE-CONTRACT-001 | 数据治理 | 跨仓导入验证 | US-SAMPLE-002 | none | pass | fail | tests | ❌ 未达标 | @qa |',
  ].join('\n');

  const result = parseNFRCompliance(content);

  assert.equal(result.totalCount, 3);
  assert.deepEqual(result.compliantNFRs.map(item => item.nfrId), ['NFR-RUNTIME-QA-001']);
  assert.deepEqual(result.conditionalNFRs.map(item => item.nfrId), ['NFR-SAMPLE-EVIDENCE-001']);
  assert.deepEqual(result.nonCompliantNFRs.map(item => item.nfrId), ['NFR-SAMPLE-CONTRACT-001']);
  assert.equal(result.conditionalNFRs[0].description, '真实证据验证');
});

test('conditional NFRs pass the local checker without becoming a release recommendation', () => {
  const decision = determineReleaseDecision(
    { p0Defects: [], p1Open: [], p1InProgress: [] },
    {
      sourceAvailable: true,
      compliantNFRs: [],
      conditionalNFRs: [
        { nfrId: 'NFR-SAMPLE-METHOD-001', description: '合成证据验证' },
      ],
      nonCompliantNFRs: [],
    }
  );

  assert.equal(decision.gatePass, true);
  assert.equal(decision.canRelease, false);
  assert.equal(decision.releaseStatus, 'conditional');
  assert.deepEqual(decision.blockingIssues, []);
  assert.deepEqual(decision.warningIssues, ['1 项 NFR 条件通过或尚未确认']);
});

test('missing NFR evidence fails closed', () => {
  const decision = determineReleaseDecision(
    { p0Defects: [], p1Open: [], p1InProgress: [] },
    {
      sourceAvailable: false,
      compliantNFRs: [],
      conditionalNFRs: [],
      nonCompliantNFRs: [],
    }
  );

  assert.equal(decision.gatePass, false);
  assert.equal(decision.canRelease, false);
  assert.equal(decision.releaseStatus, 'no-go');
  assert.deepEqual(decision.blockingIssues, ['NFR 追踪表缺失']);
});

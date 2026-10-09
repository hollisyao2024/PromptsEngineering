'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  checkTestCaseIdNotation,
  findNonCanonicalTestCaseRefs,
  isValidTestCaseId,
  isValidDefectId,
  isValidStoryId,
} = require('../qa-lint');

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

test('TC notation finder reports ranges and sub-numbers with their line numbers', () => {
  const content = [
    '| US-ADMIN-035 | AC-ADMIN-035-01~06 | TC-ADMIN-035-A~E |',
    '| US-CHAT-023 | AC-CHAT-023-01 | TC-CHAT-023-01~05, TC-CHAT-015-05 |',
    '| US-HK-077 | - | TC-HKERNEL-077~086 |',
    '| US-X-001 | - | TC-PRIVATE-040-A，TC-MODEL-CONFIG-001 |',
    'TC-E2E-001 与 TC-BIZTEST-022 是完整编号',
  ].join('\n');
  assert.deepEqual(findNonCanonicalTestCaseRefs(content), [
    { line: 1, token: 'TC-ADMIN-035-A~E' },
    { line: 2, token: 'TC-CHAT-023-01~05' },
    { line: 2, token: 'TC-CHAT-015-05' },
    { line: 3, token: 'TC-HKERNEL-077~086' },
    { line: 4, token: 'TC-PRIVATE-040-A' },
  ]);
});

test('TC notation finder accepts canonical ids, including multi-segment modules', () => {
  assert.deepEqual(findNonCanonicalTestCaseRefs('TC-MODEL-CONFIG-001, TC-E2E-001; (TC-ADMIN-035)'), []);
});

test('TC notation check warns across QA, PRD and the traceability matrix without failing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-lint-tc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write('docs/QA.md', '# QA\nTC-CORE-001\n');
  write('docs/qa-modules/admin/QA.md', '| TC-ADMIN-035-A | x |\n');
  write('docs/PRD.md', 'TC-CORE-002~004\n');
  write('docs/prd-modules/admin/PRD.md', 'ok\n| AC | TC-ADMIN-001-05 |\n');
  write('docs/data/traceability-matrix.md', '| US-ADMIN-035 | TC-ADMIN-035-A~E |\n');
  const config = {
    mainQAPath: path.join(root, 'docs/QA.md'),
    qaModulesDir: path.join(root, 'docs/qa-modules'),
    mainPrdPath: path.join(root, 'docs/PRD.md'),
    prdModulesDir: path.join(root, 'docs/prd-modules'),
    traceabilityMatrixPath: path.join(root, 'docs/data/traceability-matrix.md'),
  };
  const result = checkTestCaseIdNotation(config, { root, quiet: true });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings.map(({ file, line, token }) => `${file}:${line} ${token}`), [
    'docs/qa-modules/admin/QA.md:1 TC-ADMIN-035-A',
    'docs/PRD.md:1 TC-CORE-002~004',
    'docs/prd-modules/admin/PRD.md:2 TC-ADMIN-001-05',
    'docs/data/traceability-matrix.md:1 TC-ADMIN-035-A~E',
  ]);
});

test('qa-lint keeps exit code 0 when only TC notation warnings are present', (t) => {
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-lint-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, 'infra/scripts/qa-tools/qa-lint.js');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'qa-lint.js'), script);
  fs.mkdirSync(path.join(root, 'docs/data'), { recursive: true });
  const sections = ['QA 概览', '模块索引', '全局测试策略', '跨模块整合与集成测试', '全局执行矩阵与指标',
    '全局缺陷汇总与回流', '模块 QA 总览', '发布建议', '部署记录', '追溯 & 附录']
    .map((title, index) => `## ${index + 1}. ${title}`);
  fs.writeFileSync(path.join(root, 'docs/QA.md'), `# QA\n${sections.join('\n')}\n`);
  fs.writeFileSync(path.join(root, 'docs/data/traceability-matrix.md'), '| US-ADMIN-035 | TC-ADMIN-035-A~E |\n');
  const run = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  const output = run.stdout.replace(/\x1b\[[0-9;]*m/gu, '');
  assert.match(output, /TC_ID_NONCANONICAL=docs\/data\/traceability-matrix\.md:1 TC-ADMIN-035-A~E/);
  assert.doesNotMatch(output, /❌ 发现错误/);
  assert.equal(run.status, 0, output);
});

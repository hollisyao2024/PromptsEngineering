'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createProject } = require('./fixtures/business-testing/builders');
const { GROUPED_ACS, shopPrd, tcIds } = require('./generate-qa.helpers');

const SCRIPT = path.join(__dirname, '..', 'generate-qa.js');
// The CLI colors its lines; the parsable block is matched on the plain text.
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/gu, '');

test('qa plan --project writes the QA documents from the Story table and the AC table', (t) => {
  const project = createProject({
    'docs/PRD.md': '# 项目 PRD\n\n各模块 PRD 见 docs/prd-modules/。\n',
    'docs/prd-modules/shop/PRD.md': shopPrd(GROUPED_ACS),
    'docs/arch-modules/shop/ARCH.md': '# 购物模块 ARCH\n',
    'docs/task-modules/shop/TASK.md': '# 购物模块 TASK\n',
  }, { git: true });
  t.after(() => project.cleanup());

  const result = spawnSync(process.execPath, [SCRIPT, '--project'], { cwd: project.repo, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const lines = stripAnsi(result.stdout).split('\n');
  assert.ok(lines.includes('STATUS=OK'), result.stdout);
  assert.ok(lines.some((line) => line.startsWith('SUMMARY=')), result.stdout);
  assert.ok(lines.some((line) => line.startsWith('NEXT_ACTION=')), result.stdout);

  const read = (relative) => fs.readFileSync(path.join(project.repo, relative), 'utf8');
  const moduleQa = read('docs/qa-modules/shop/QA.md');
  assert.deepEqual(tcIds(moduleQa), ['TC-SHOP-010', 'TC-SHOP-011']);
  assert.match(moduleQa, /### 3\.2 尚未登记用例的验收标准/u);
  assert.match(read('docs/qa-modules/module-list.md'), /\| shop \| \[shop\/QA\.md\]\(shop\/QA\.md\) \| 3 \|/u);
  assert.match(read('docs/QA.md'), /3 个 Story，1 个模块/u);
});

// A PRD/ARCH/TASK module-set mismatch is a gate, not a crash: the CLI names every missing or extra module on its own
// line and ends with a BLOCKED block carrying a stable reason code, so a caller can act without parsing JSON.
test('qa plan blocks a PRD/ARCH/TASK module-set mismatch with a parsable reason and per-module lines', (t) => {
  const project = createProject({
    'docs/PRD.md': '# 项目 PRD\n\n各模块 PRD 见 docs/prd-modules/。\n',
    'docs/prd-modules/shop/PRD.md': shopPrd(GROUPED_ACS),
    'docs/arch-modules/billing/ARCH.md': '# 计费模块 ARCH\n',
    'docs/task-modules/shop/TASK.md': '# 购物模块 TASK\n',
  }, { git: true });
  t.after(() => project.cleanup());

  const result = spawnSync(process.execPath, [SCRIPT, '--project'], { cwd: project.repo, encoding: 'utf8' });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  const lines = stripAnsi(result.stdout).split('\n');
  assert.ok(lines.includes('MODULE_SET_MISMATCH=missingArch|shop'), result.stdout);
  assert.ok(lines.includes('MODULE_SET_MISMATCH=extraArch|billing'), result.stdout);
  assert.ok(lines.includes('STATUS=BLOCKED'), result.stdout);
  assert.ok(lines.includes('REASON=MODULE_SET_MISMATCH'), result.stdout);
  assert.ok(lines.some((line) => line.startsWith('SUMMARY=') && line.includes('PRD/ARCH/TASK')), result.stdout);
  assert.ok(lines.some((line) => line.startsWith('NEXT_ACTION=')), result.stdout);
  assert.equal(fs.existsSync(path.join(project.repo, 'docs/qa-modules/shop/QA.md')), false);
});

test('qa plan blocks a missing root PRD with a parsable reason', (t) => {
  const project = createProject({
    'docs/prd-modules/shop/PRD.md': shopPrd(GROUPED_ACS),
  }, { git: true });
  t.after(() => project.cleanup());

  const result = spawnSync(process.execPath, [SCRIPT, '--project'], { cwd: project.repo, encoding: 'utf8' });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  const lines = stripAnsi(result.stdout).split('\n');
  assert.ok(lines.includes('STATUS=BLOCKED'), result.stdout);
  assert.ok(lines.includes('REASON=PRD_MISSING'), result.stdout);
});

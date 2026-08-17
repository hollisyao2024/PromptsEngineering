'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { planGeneratedTaskWrite, validateGeneratedTaskInputs } = require('../generate-task');

test('TASK generator preserves a manually maintained document', () => {
  const existing = '# TASK\n\nPhase 16 manual WBS\n';
  assert.deepEqual(planGeneratedTaskWrite(existing, '# generated\n'), {
    action: 'preserve',
    content: existing,
    reason: 'manual-document',
  });
});

test('TASK generator refreshes only a generator-owned document', () => {
  const generated = '# TASK\n\n<!-- TASK-GENERATED: generate-task.js -->\nnew\n';
  const decision = planGeneratedTaskWrite(
    '# TASK\n\n<!-- TASK-GENERATED: generate-task.js -->\nold\n',
    generated
  );
  assert.equal(decision.action, 'write');
  assert.equal(decision.content, generated);
});

test('TASK ownership marker is authoritative only immediately after the H1', () => {
  const existing = '# TASK\n\nManual text quotes <!-- TASK-GENERATED: generate-task.js --> later.\n';
  assert.equal(planGeneratedTaskWrite(existing, '# generated\n').action, 'preserve');
});

test('TASK generation fails closed on any module with zero stories or components', () => {
  const stories = [{ moduleDir: 'ready' }];
  const components = [{ moduleDir: 'ready' }];
  assert.throws(
    () => validateGeneratedTaskInputs(stories, components, ['ready', 'empty']),
    /empty.*zero stories.*zero components/i
  );
});

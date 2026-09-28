'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runTargetedTest } = require('../targeted-test');

test('targeted test entry rejects missing or invalid targets before starting a runner', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-targeted-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'unit.test.js'), '');
  assert.throws(() => runTargetedTest([], { cwd: root }), /--file/u);
  assert.throws(() => runTargetedTest(['--file', 'missing.test.js', '--', 'node', '--test'], { cwd: root }), /existing test file/u);
  assert.throws(() => runTargetedTest(['--file', 'unit.test.js', '--'], { cwd: root }), /runner/u);
  assert.throws(() => runTargetedTest(['--file', 'unit.test.js', '--', 'pnpm', 'test'], { cwd: root }), /aggregate test command/u);
  assert.throws(() => runTargetedTest(['--file', 'unit.test.js', '--', 'node', '-e', 'process.exit(0)'], { cwd: root }), /file-scoped runner/u);
});

test('targeted test entry appends exactly the requested file to an explicit runner', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-targeted-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'unit.test.js'), '');
  const args = ['--file', 'unit.test.js', '--', 'pnpm', 'exec', 'vitest', 'run'];
  let spawned;
  assert.equal(runTargetedTest(args, { cwd: root, spawn: (bin, parameters) => {
    spawned = { bin, parameters };
    return { status: 0 };
  } }), 0);
  assert.deepEqual(spawned, { bin: 'pnpm', parameters: ['exec', 'vitest', 'run', 'unit.test.js'] });
});

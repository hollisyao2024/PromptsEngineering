'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

test('root test script covers every tracked unit test under infra/scripts and architecture/__tests__', () => {
  const script = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts.test;
  const patterns = script.split(/\s+/).filter((part) => part.includes('*')).map(globToRegExp);
  const tracked = execFileSync('git', ['ls-files', 'infra/scripts', 'architecture/__tests__'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((file) => /\/__tests__\/[^/]+\.test\.(?:js|mjs)$/.test(file));
  assert.ok(tracked.length > 0);
  const uncovered = tracked.filter((file) => !patterns.some((pattern) => pattern.test(file)));
  assert.deepEqual(uncovered, []);
});

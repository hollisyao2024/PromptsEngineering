'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('tdd-tick is import-safe so ownership routing can be tested without running the CLI', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'tdd-tick.js'), 'utf8');
  assert.match(source, /if \(require\.main === module\) \{\s*main\(\);\s*\}/);
});

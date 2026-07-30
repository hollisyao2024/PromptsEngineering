'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  INCLUDE_DIR_PATTERNS,
  normalizePathSeparators,
} = require('../generate-codemap');

test('normalizes Windows repository paths before matching scan patterns', () => {
  const windowsPath =
    'apps\\desktop\\src\\services\\builtin-browser\\policy.ts';
  const normalized = normalizePathSeparators(windowsPath);

  assert.equal(
    normalized,
    'apps/desktop/src/services/builtin-browser/policy.ts'
  );
  assert.equal(
    INCLUDE_DIR_PATTERNS.some((pattern) => pattern.test(normalized)),
    true
  );
});

test('keeps POSIX repository paths unchanged', () => {
  const posixPath = 'packages/database/src/index.ts';

  assert.equal(normalizePathSeparators(posixPath), posixPath);
});

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

// --scope=session used to overwrite docs/data/CODEBASE_MAP.md with only the branch's changed files, so every
// tdd sync replaced the full map with a fragment. The map is always built from the full file set; the session
// scope only adds the changed high-value files as a report.
test('session scope keeps the full file set and reports the changed files separately', () => {
  const { selectFilesForScope } = require('../generate-codemap');
  const allFiles = ['/r/apps/a.ts', '/r/packages/b.ts', '/r/infra/c.js'];
  const session = selectFilesForScope({ scope: 'session', allFiles, sessionFiles: new Set(['/r/packages/b.ts', '/r/docs/x.md']) });
  assert.deepEqual(session, { files: allFiles, changed: ['/r/packages/b.ts'] });
  assert.deepEqual(selectFilesForScope({ scope: 'session', allFiles, sessionFiles: null }), { files: allFiles, changed: [] });
  assert.deepEqual(selectFilesForScope({ scope: 'project', allFiles, sessionFiles: new Set(allFiles) }), { files: allFiles, changed: [] });
});

test('main writes the map from the full file set in session scope', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'generate-codemap.js'), 'utf8');
  const mainBody = source.slice(source.indexOf('function main()'));
  assert.match(mainBody, /selectFilesForScope\(/);
  assert.doesNotMatch(mainBody, /allFiles\.filter\(/);
  assert.match(mainBody, /SESSION_CHANGED_FILES=/);
});

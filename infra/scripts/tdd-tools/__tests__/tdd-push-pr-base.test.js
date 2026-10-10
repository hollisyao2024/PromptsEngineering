'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPrCreateArgs, parseCliArgs, autoCommitWorkingTreeIfNeeded } = require('../tdd-push');

test('committed-only push explicitly opts out of staging and automatic commits', () => {
  assert.equal(parseCliArgs(['--committed-only']).committedOnly, true);
  assert.equal(parseCliArgs([]).committedOnly, false);
  const result = autoCommitWorkingTreeIfNeeded('fix/dirty', {
    committedOnly: true,
    getWorkingTreeStatusLines() { assert.fail('must not enter automatic commit path'); },
  });
  assert.equal(result.committed, false);
  assert.equal(result.retainedWorkingTree, true);
});

test('tdd push creates a PR with explicit configured base and head branches', () => {
  const args = buildPrCreateArgs({
    title: 'fix: safe merge',
    body: 'body',
    branch: 'fix/safe-merge',
    baseBranch: 'stable',
  });

  assert.deepEqual(args, [
    'pr', 'create',
    '--title', 'fix: safe merge',
    '--body', 'body',
    '--head', 'fix/safe-merge',
    '--base', 'stable',
  ]);
});

test('automatic commit reports the new HEAD and that head-bound evidence must be refreshed', (t) => {
  const calls = [];
  const logs = [];
  t.mock.method(console, 'log', (line) => logs.push(String(line)));
  const result = autoCommitWorkingTreeIfNeeded('feature/codemap', {
    getWorkingTreeStatusLines: () => [' M docs/data/CODEBASE_MAP.md'],
    runGit(args, options = {}) {
      calls.push(args);
      return options.capture ? 'a'.repeat(40) + '\n' : '';
    },
  });
  assert.equal(result.committed, true);
  assert.equal(result.headSha, 'a'.repeat(40));
  assert.deepEqual(calls.map((args) => args[0]), ['add', 'commit', 'rev-parse']);
  assert.ok(logs.includes(`AUTO_COMMIT_HEAD=${'a'.repeat(40)}`), logs.join('\n'));
  assert.ok(logs.some((line) => /TEST_SCOPE_RESULT.*qa run/u.test(line)), logs.join('\n'));
});

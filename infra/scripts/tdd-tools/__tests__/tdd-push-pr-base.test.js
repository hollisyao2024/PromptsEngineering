'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildFailureNextAction, buildPrCreateArgs, parseCliArgs, autoCommitWorkingTreeIfNeeded } = require('../tdd-push');

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

test('remote claim block failure never suggests a manual PR that would bypass the gate', () => {
  const error = new Error('任务远端登记门禁阻断（TASK_CLAIM_LOST）：remote holder/epoch changed');
  error.code = 'TASK_REMOTE_BLOCKED';
  error.nextAction = '本机已失去该任务的远端持有权：停止推送与合并';
  const next = buildFailureNextAction({ error, remoteUrl: 'https://github.com/o/r', branch: 'feature/x' });
  assert.equal(next, error.nextAction);
  assert.doesNotMatch(next, /pull\/new/);
});

test('ordinary push failures keep the idempotent retry and manual PR hint', () => {
  const error = new Error('network down');
  assert.match(
    buildFailureNextAction({ error, remoteUrl: 'https://github.com/o/r', branch: 'feature/x' }),
    /https:\/\/github\.com\/o\/r\/pull\/new\/feature\/x/
  );
  assert.equal(
    buildFailureNextAction({ error, remoteUrl: '', branch: 'feature/x' }),
    '修复上述原因后重新执行 pnpm agent -- tdd push'
  );
});

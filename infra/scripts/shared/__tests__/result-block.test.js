'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { oneLine, resultBlockLines, resultExitCode } = require('../result-block');

test('result block folds multi-line values and places REASON between STATUS and SUMMARY', () => {
  assert.deepEqual(resultBlockLines({
    status: 'BLOCKED',
    reason: 'STALE_QA_BASE',
    summary: 'origin/main (abc)\n  is not an ancestor\r\nof origin/feature',
    nextAction: 'merge origin/main\nthen rerun',
  }), [
    'STATUS=BLOCKED',
    'REASON=STALE_QA_BASE',
    'SUMMARY=origin/main (abc) is not an ancestor of origin/feature',
    'NEXT_ACTION=merge origin/main then rerun',
  ]);
  assert.deepEqual(resultBlockLines({ status: 'OK', summary: 'done', nextAction: 'next' }), [
    'STATUS=OK', 'SUMMARY=done', 'NEXT_ACTION=next',
  ]);
});

test('result block rejects unknown statuses, missing reasons and missing fields', () => {
  assert.throws(() => resultBlockLines({ status: 'DONE', summary: 's', nextAction: 'n' }), /OK\|BLOCKED\|FAILED/);
  assert.throws(() => resultBlockLines({ status: 'FAILED', summary: 's', nextAction: 'n' }), /requires a REASON/);
  assert.throws(() => resultBlockLines({ status: 'OK', summary: '', nextAction: 'n' }), /SUMMARY and NEXT_ACTION/);
});

test('result exit code is zero only for STATUS=OK and oneLine keeps single-line text intact', () => {
  assert.equal(resultExitCode('OK'), 0);
  assert.equal(resultExitCode('BLOCKED'), 1);
  assert.equal(resultExitCode('FAILED'), 1);
  assert.equal(oneLine('plain text'), 'plain text');
  assert.equal(oneLine('a\n  b\r\n c'), 'a b c');
});

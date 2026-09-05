'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildQaVerificationReceipt,
  getQaVerificationReceiptPath,
  readQaVerificationReceipt,
  validateQaVerificationReceipt,
  writeQaVerificationReceipt,
} = require('../qa-verification-state');

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

test('qa verification receipt is stored outside the worktree and round-trips exact refs', (t) => {
  const container = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'qa-receipt-'));
  const mainRoot = path.join(container, 'repo');
  const worktreePath = path.join(container, 'worktrees', 'feature-one');
  const config = { containerDirs: { tmp: path.join(container, 'tmp') } };
  fs.mkdirSync(mainRoot, { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });
  t.after(() => fs.rmSync(container, { recursive: true, force: true }));

  const receipt = buildQaVerificationReceipt({
    baseBranch: 'stable',
    branch: 'fix/one',
    baseSha: A,
    headSha: B,
    verifiedAt: '2026-09-05T00:00:00.000Z',
  });
  const receiptPath = writeQaVerificationReceipt(config, mainRoot, worktreePath, receipt);

  assert.equal(receiptPath, getQaVerificationReceiptPath(config, mainRoot, worktreePath));
  assert.equal(path.dirname(receiptPath).startsWith(path.join(container, 'tmp')), true);
  assert.deepEqual(readQaVerificationReceipt(config, mainRoot, worktreePath), receipt);
});

test('qa receipt validation blocks either base or head drift', () => {
  const receipt = buildQaVerificationReceipt({
    baseBranch: 'main',
    branch: 'fix/one',
    baseSha: A,
    headSha: B,
  });

  assert.doesNotThrow(() => validateQaVerificationReceipt(receipt, {
    baseBranch: 'main', branch: 'fix/one', baseSha: A, headSha: B,
    prBaseRef: 'main', prHeadRef: 'fix/one', prBaseSha: A, prHeadSha: B,
  }));
  assert.throws(() => validateQaVerificationReceipt(receipt, {
    baseBranch: 'main', branch: 'fix/one', baseSha: C, headSha: B,
    prBaseRef: 'main', prHeadRef: 'fix/one', prBaseSha: C, prHeadSha: B,
  }), (error) => error.code === 'STALE_QA_RECEIPT' && /BASE_SHA/u.test(error.message));
  assert.throws(() => validateQaVerificationReceipt(receipt, {
    baseBranch: 'main', branch: 'fix/one', baseSha: A, headSha: C,
    prBaseRef: 'main', prHeadRef: 'fix/one', prBaseSha: A, prHeadSha: C,
  }), (error) => error.code === 'STALE_QA_RECEIPT' && /HEAD_SHA/u.test(error.message));
});

test('qa receipt validation binds the configured base and exact PR refs', () => {
  const receipt = buildQaVerificationReceipt({
    baseBranch: 'stable',
    branch: 'fix/one',
    baseSha: A,
    headSha: B,
  });

  assert.throws(() => validateQaVerificationReceipt(receipt, {
    baseBranch: 'main', branch: 'fix/one', baseSha: A, headSha: B,
    prBaseRef: 'main', prHeadRef: 'fix/one', prBaseSha: A, prHeadSha: B,
  }), /BASE_BRANCH/u);
  assert.throws(() => validateQaVerificationReceipt(receipt, {
    baseBranch: 'stable', branch: 'fix/one', baseSha: A, headSha: B,
    prBaseRef: 'stable', prHeadRef: 'fix/one', prBaseSha: A, prHeadSha: C,
  }), /PR_HEAD_SHA/u);
  assert.throws(() => validateQaVerificationReceipt(receipt, {
    baseBranch: 'stable', branch: 'fix/one', baseSha: A, headSha: B,
  }), /PR_BASE_BRANCH|PR_HEAD_BRANCH|PR_BASE_SHA|PR_HEAD_SHA/u);
});

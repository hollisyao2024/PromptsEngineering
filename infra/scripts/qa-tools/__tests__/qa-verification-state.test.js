'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildQaVerificationReceipt,
  describeReceiptBusiness,
  getQaVerificationReceiptPath,
  readQaVerificationReceipt,
  validateMergedPrReceipt,
  validateQaVerificationReceipt,
  writeQaVerificationReceipt,
} = require('../qa-verification-state');

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

const LEGACY_KEYS = ['base_branch', 'base_sha', 'branch', 'head_sha', 'schema_version', 'verdict', 'verified_at'];
const BUSINESS = {
  gate: 'PASS',
  required_priorities: ['P0', 'P1'],
  acs_proven: 4,
  risk_count: 3,
  config_digest: 'd'.repeat(64),
};
const IDENTITY = { baseBranch: 'main', branch: 'fix/one', baseSha: A, headSha: B };
const DESIGN = {
  gate: 'PASS_WITH_RISK',
  mode: 'warn',
  docs: 1,
  rules_total: 3,
  rules_verified: 2,
  adv_covered: '4/5',
  amendments: 1,
  isolation: 'subagent',
  risk_count: 2,
};

function receiptFixture(t) {
  const container = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'qa-receipt-'));
  t.after(() => fs.rmSync(container, { recursive: true, force: true }));
  const mainRoot = path.join(container, 'repo');
  const worktreePath = path.join(container, 'worktrees', 'feature-one');
  fs.mkdirSync(mainRoot, { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });
  return { mainRoot, worktreePath, config: { containerDirs: { tmp: path.join(container, 'tmp') } } };
}

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

test('a receipt without a business summary keeps the legacy shape', () => {
  const receipt = buildQaVerificationReceipt({ ...IDENTITY, verifiedAt: '2026-10-08T00:00:00.000Z' });

  assert.deepEqual(Object.keys(receipt).sort(), LEGACY_KEYS);
  assert.equal('business' in buildQaVerificationReceipt({ ...IDENTITY, business: null }), false);
  assert.equal('business' in buildQaVerificationReceipt({ ...IDENTITY, business: undefined }), false);
});

test('a receipt records the three-state QA verdict and an explicit no-module reason, and round-trips them through disk', (t) => {
  const { mainRoot, worktreePath, config } = receiptFixture(t);
  const receipt = buildQaVerificationReceipt({ ...IDENTITY, qaVerdict: 'PASS_WITH_RISK', noModuleReason: '  只改脚本  ' });

  assert.equal(receipt.qa_verdict, 'PASS_WITH_RISK');
  assert.equal(receipt.no_module_reason, '只改脚本');
  assert.equal(receipt.verdict, 'passed');
  assert.deepEqual(Object.keys(receipt).sort(), [...LEGACY_KEYS, 'no_module_reason', 'qa_verdict'].sort());
  writeQaVerificationReceipt(config, mainRoot, worktreePath, receipt);
  assert.deepEqual(readQaVerificationReceipt(config, mainRoot, worktreePath), receipt);
  assert.equal('no_module_reason' in buildQaVerificationReceipt({ ...IDENTITY, qaVerdict: 'PASS' }), false);
});

test('a receipt refuses a blocking or unknown QA verdict and a blank no-module reason, before anything reaches disk', (t) => {
  const { mainRoot, worktreePath, config } = receiptFixture(t);
  for (const qaVerdict of ['BLOCKED', 'Go', 'Conditional', 'pass', '']) {
    assert.throws(() => buildQaVerificationReceipt({ ...IDENTITY, qaVerdict }), /QA_VERDICT/u, qaVerdict);
  }
  assert.throws(() => buildQaVerificationReceipt({ ...IDENTITY, qaVerdict: 'PASS', noModuleReason: '   ' }), /NO_MODULE_REASON/u);
  const forged = { ...buildQaVerificationReceipt({ ...IDENTITY, qaVerdict: 'PASS' }), qa_verdict: 'BLOCKED' };
  assert.throws(() => writeQaVerificationReceipt(config, mainRoot, worktreePath, forged), /QA_VERDICT/u);
  assert.equal(fs.existsSync(getQaVerificationReceiptPath(config, mainRoot, worktreePath)), false);
});

test('a receipt carries the business gate summary as an additive field and round-trips it through disk', (t) => {
  const { mainRoot, worktreePath, config } = receiptFixture(t);
  const receipt = buildQaVerificationReceipt({ ...IDENTITY, business: BUSINESS });

  assert.equal(receipt.schema_version, 1, 'the summary is additive, the schema version must not change');
  assert.equal(receipt.verdict, 'passed');
  assert.deepEqual(receipt.business, BUSINESS);
  assert.notEqual(receipt.business, BUSINESS, 'the receipt must own a copy, not alias the caller object');

  writeQaVerificationReceipt(config, mainRoot, worktreePath, receipt);
  const stored = readQaVerificationReceipt(config, mainRoot, worktreePath);
  assert.deepEqual(stored, receipt);
  assert.deepEqual(Object.keys(stored).sort(), [...LEGACY_KEYS, 'business'].sort());
});

test('only the declared business summary fields are stored', () => {
  const receipt = buildQaVerificationReceipt({
    ...IDENTITY,
    business: { ...BUSINESS, results_file: '/tmp/ac-results.json', note: 'free text' },
  });

  assert.deepEqual(Object.keys(receipt.business).sort(), Object.keys(BUSINESS).sort());
});

test('a malformed business summary is rejected before anything is written', (t) => {
  const malformed = {
    'not an object': 'PASS',
    'an array': [BUSINESS],
    'a blocked gate': { ...BUSINESS, gate: 'BLOCKED' },
    'a missing gate': { ...BUSINESS, gate: undefined },
    'no required priorities': { ...BUSINESS, required_priorities: [] },
    'priorities that are not a list': { ...BUSINESS, required_priorities: 'P0' },
    'an empty priority': { ...BUSINESS, required_priorities: ['P0', ''] },
    'a negative proven count': { ...BUSINESS, acs_proven: -1 },
    'a fractional proven count': { ...BUSINESS, acs_proven: 1.5 },
    'a textual proven count': { ...BUSINESS, acs_proven: '4' },
    'a negative risk count': { ...BUSINESS, risk_count: -1 },
    'a textual risk count': { ...BUSINESS, risk_count: '3' },
    'an empty config digest': { ...BUSINESS, config_digest: '' },
    'a numeric config digest': { ...BUSINESS, config_digest: 7 },
  };
  for (const [name, business] of Object.entries(malformed)) {
    assert.throws(() => buildQaVerificationReceipt({ ...IDENTITY, business }), /business/iu, name);
  }

  const { mainRoot, worktreePath, config } = receiptFixture(t);
  const receipt = { ...buildQaVerificationReceipt(IDENTITY), business: { ...BUSINESS, acs_proven: -1 } };
  assert.throws(() => writeQaVerificationReceipt(config, mainRoot, worktreePath, receipt), /business/iu);
  assert.equal(fs.existsSync(getQaVerificationReceiptPath(config, mainRoot, worktreePath)), false);
});

// 测试设计摘要同样是可选附加字段：只在 qa verify 放行且执行了设计门禁时出现，只保留声明的九项。
test('a receipt carries the design gate summary as an additive field and round-trips it through disk', (t) => {
  const { mainRoot, worktreePath, config } = receiptFixture(t);
  const receipt = buildQaVerificationReceipt({ ...IDENTITY, design: { ...DESIGN, blocks: ['x'], note: 'free text' } });

  assert.deepEqual(receipt.design, DESIGN);
  assert.equal('design' in buildQaVerificationReceipt(IDENTITY), false, 'no design gate, no design key');

  writeQaVerificationReceipt(config, mainRoot, worktreePath, receipt);
  const stored = readQaVerificationReceipt(config, mainRoot, worktreePath);
  assert.deepEqual(stored, receipt);
  assert.deepEqual(Object.keys(stored).sort(), [...LEGACY_KEYS, 'design'].sort());
});

test('a malformed design summary is rejected before anything is written', (t) => {
  const malformed = {
    'not an object': 'PASS',
    'a blocked gate': { ...DESIGN, gate: 'BLOCKED' },
    'an unknown mode': { ...DESIGN, mode: 'off' },
    'a negative rule count': { ...DESIGN, rules_total: -1 },
    'verified above total': { ...DESIGN, rules_verified: 4 },
    'a malformed adversarial ratio': { ...DESIGN, adv_covered: '4 of 5' },
    'an unknown isolation': { ...DESIGN, isolation: 'trust-me' },
    'a textual risk count': { ...DESIGN, risk_count: '2' },
  };
  for (const [name, design] of Object.entries(malformed)) {
    assert.throws(() => buildQaVerificationReceipt({ ...IDENTITY, design }), /design/iu, name);
  }

  const { mainRoot, worktreePath, config } = receiptFixture(t);
  const receipt = { ...buildQaVerificationReceipt(IDENTITY), design: { ...DESIGN, gate: 'BLOCKED' } };
  assert.throws(() => writeQaVerificationReceipt(config, mainRoot, worktreePath, receipt), /design/iu);
  assert.equal(fs.existsSync(getQaVerificationReceiptPath(config, mainRoot, worktreePath)), false);
});

test('receipt validation compares identity only, so summarized and legacy receipts are both accepted', () => {
  const legacy = buildQaVerificationReceipt(IDENTITY);
  const summarized = buildQaVerificationReceipt({ ...IDENTITY, business: BUSINESS });
  const current = {
    baseBranch: 'main', branch: 'fix/one', baseSha: A, headSha: B,
    prBaseRef: 'main', prHeadRef: 'fix/one', prBaseSha: A, prHeadSha: B,
  };
  const merged = { baseRefName: 'main', headRefName: 'fix/one', headRefOid: B };

  for (const receipt of [legacy, summarized]) {
    assert.equal(validateQaVerificationReceipt(receipt, current), receipt);
    assert.equal(validateMergedPrReceipt(receipt, merged, current), receipt);
  }
  assert.throws(() => validateQaVerificationReceipt(summarized, { ...current, headSha: C, prHeadSha: C }),
    (error) => error.code === 'STALE_QA_RECEIPT' && /HEAD_SHA/u.test(error.message));
});

// qa merge 读取回执的 business 摘要并原样输出一行审计信息；摘要不参与复验，畸形摘要也只披露、不抛错。
test('describeReceiptBusiness renders the audit line qa merge prints for a receipt', () => {
  const receipt = buildQaVerificationReceipt({ ...IDENTITY, business: BUSINESS });
  assert.equal(
    describeReceiptBusiness(receipt),
    `QA_RECEIPT_BUSINESS=PASS|required=P0,P1|acs_proven=4|risk_count=3|config_digest=${'d'.repeat(64)}`,
  );
  assert.equal(describeReceiptBusiness(buildQaVerificationReceipt(IDENTITY)), 'QA_RECEIPT_BUSINESS=NONE');
  assert.equal(describeReceiptBusiness(null), 'QA_RECEIPT_BUSINESS=NONE');
  assert.match(
    describeReceiptBusiness({ ...receipt, business: { ...BUSINESS, gate: 'BLOCKED' } }),
    /^QA_RECEIPT_BUSINESS=INVALID\|business\.gate must be PASS$/u,
  );
});

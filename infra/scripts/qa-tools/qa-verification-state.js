'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { resolveContainerPath } = require('../shared/config');

const RECEIPT_SCHEMA_VERSION = 1;
const SHA_PATTERN = /^[0-9a-f]{40,64}$/iu;

function assertNonEmpty(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function assertSha(value, field) {
  const sha = assertNonEmpty(value, field);
  if (!SHA_PATTERN.test(sha)) throw new Error(`${field} must be a full Git commit SHA`);
  return sha.toLowerCase();
}

function assertCount(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
  return value;
}

// 业务验收摘要是回执的可选附加字段，只记录门禁通过时的事实；缺省表示这次验证没有启用业务门禁。
// 回执只留这五项，其余字段一律丢弃；不合法的摘要在写盘前抛错，不会留下半份回执。
function normalizeBusinessSummary(business) {
  if (business === undefined || business === null) return null;
  if (typeof business !== 'object' || Array.isArray(business)) throw new Error('business summary must be an object');
  if (business.gate !== 'PASS') throw new Error('business.gate must be PASS');
  const priorities = business.required_priorities;
  if (!Array.isArray(priorities) || priorities.length === 0) {
    throw new Error('business.required_priorities must be a non-empty list');
  }
  return {
    gate: 'PASS',
    required_priorities: priorities.map((priority) => assertNonEmpty(priority, 'business.required_priorities item')),
    acs_proven: assertCount(business.acs_proven, 'business.acs_proven'),
    risk_count: assertCount(business.risk_count, 'business.risk_count'),
    config_digest: assertNonEmpty(business.config_digest, 'business.config_digest'),
  };
}

function buildQaVerificationReceipt({
  baseBranch,
  branch,
  baseSha,
  headSha,
  verifiedAt = new Date().toISOString(),
  business,
} = {}) {
  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    verdict: 'passed',
    base_branch: assertNonEmpty(baseBranch, 'BASE_BRANCH'),
    branch: assertNonEmpty(branch, 'BRANCH'),
    base_sha: assertSha(baseSha, 'BASE_SHA'),
    head_sha: assertSha(headSha, 'HEAD_SHA'),
    verified_at: assertNonEmpty(verifiedAt, 'VERIFIED_AT'),
  };
  const summary = normalizeBusinessSummary(business);
  if (summary) receipt.business = summary;
  return receipt;
}

// 回执 business 摘要的唯一读取方是 qa merge 的审计输出；它不参与复验，畸形摘要只披露为 INVALID。
function describeReceiptBusiness(receipt) {
  if (!receipt || receipt.business === undefined || receipt.business === null) return 'QA_RECEIPT_BUSINESS=NONE';
  let summary;
  try {
    summary = normalizeBusinessSummary(receipt.business);
  } catch (error) {
    return `QA_RECEIPT_BUSINESS=INVALID|${String(error.message).replace(/\s+/gu, ' ')}`;
  }
  return [
    `QA_RECEIPT_BUSINESS=${summary.gate}`,
    `required=${summary.required_priorities.join(',')}`,
    `acs_proven=${summary.acs_proven}`,
    `risk_count=${summary.risk_count}`,
    `config_digest=${summary.config_digest}`,
  ].join('|');
}

function worktreeReceiptKey(worktreePath) {
  return createHash('sha256').update(path.resolve(worktreePath)).digest('hex').slice(0, 20);
}

function getQaVerificationReceiptPath(config, mainRoot, worktreePath) {
  const tmpRoot = resolveContainerPath(config, mainRoot, 'tmp');
  return path.join(tmpRoot, 'qa-verification-receipts', `${worktreeReceiptKey(worktreePath)}.json`);
}

function writeQaVerificationReceipt(config, mainRoot, worktreePath, receipt) {
  const normalized = buildQaVerificationReceipt({
    baseBranch: receipt && receipt.base_branch,
    branch: receipt && receipt.branch,
    baseSha: receipt && receipt.base_sha,
    headSha: receipt && receipt.head_sha,
    verifiedAt: receipt && receipt.verified_at,
    business: receipt && receipt.business,
  });
  const receiptPath = getQaVerificationReceiptPath(config, mainRoot, worktreePath);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const temporaryPath = `${receiptPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryPath, receiptPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
  return receiptPath;
}

function readQaVerificationReceipt(config, mainRoot, worktreePath) {
  const receiptPath = getQaVerificationReceiptPath(config, mainRoot, worktreePath);
  if (!fs.existsSync(receiptPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (error) {
    const invalid = new Error(`QA verification receipt is invalid: ${error.message}`);
    invalid.code = 'INVALID_QA_RECEIPT';
    throw invalid;
  }
}

function removeQaVerificationReceipt(config, mainRoot, worktreePath) {
  const receiptPath = getQaVerificationReceiptPath(config, mainRoot, worktreePath);
  fs.rmSync(receiptPath, { force: true });
  return receiptPath;
}

function staleReceipt(mismatches) {
  const error = new Error(`QA verification receipt is stale: ${mismatches.join(', ')}`);
  error.code = 'STALE_QA_RECEIPT';
  error.mismatches = mismatches;
  error.nextManualAction = 'Synchronize the configured base and feature branch, rerun qa verify, then retry qa merge.';
  return error;
}

function validateQaVerificationReceipt(receipt, current = {}) {
  if (!receipt) {
    const error = new Error('QA verification receipt is missing; run qa verify before qa merge.');
    error.code = 'MISSING_QA_RECEIPT';
    throw error;
  }
  const mismatches = [];
  if (receipt.schema_version !== RECEIPT_SCHEMA_VERSION) mismatches.push('SCHEMA_VERSION');
  if (receipt.verdict !== 'passed') mismatches.push('VERDICT');
  if (receipt.base_branch !== current.baseBranch) mismatches.push('BASE_BRANCH');
  if (receipt.branch !== current.branch) mismatches.push('BRANCH');
  if (receipt.base_sha !== current.baseSha) mismatches.push('BASE_SHA');
  if (receipt.head_sha !== current.headSha) mismatches.push('HEAD_SHA');
  if (current.prBaseRef !== current.baseBranch) mismatches.push('PR_BASE_BRANCH');
  if (current.prHeadRef !== current.branch) mismatches.push('PR_HEAD_BRANCH');
  if (current.prBaseSha !== receipt.base_sha) mismatches.push('PR_BASE_SHA');
  if (current.prHeadSha !== receipt.head_sha) mismatches.push('PR_HEAD_SHA');
  if (mismatches.length > 0) throw staleReceipt(mismatches);
  return receipt;
}

// Resume path for a PR that GitHub already merged: the base moved, so only the
// receipt identity and the merged head SHA can still be compared.
function validateMergedPrReceipt(receipt, pr, current = {}) {
  if (!receipt) {
    const error = new Error('QA verification receipt is missing; cannot resume qa merge for a merged PR.');
    error.code = 'MISSING_QA_RECEIPT';
    throw error;
  }
  const mismatches = [];
  if (receipt.schema_version !== RECEIPT_SCHEMA_VERSION) mismatches.push('SCHEMA_VERSION');
  if (receipt.verdict !== 'passed') mismatches.push('VERDICT');
  if (receipt.base_branch !== current.baseBranch) mismatches.push('BASE_BRANCH');
  if (receipt.branch !== current.branch) mismatches.push('BRANCH');
  if (!pr || pr.baseRefName !== current.baseBranch) mismatches.push('PR_BASE_BRANCH');
  if (!pr || pr.headRefName !== current.branch) mismatches.push('PR_HEAD_BRANCH');
  if (!pr || String(pr.headRefOid || '').toLowerCase() !== receipt.head_sha) mismatches.push('PR_HEAD_SHA');
  if (mismatches.length > 0) throw staleReceipt(mismatches);
  return receipt;
}

module.exports = {
  RECEIPT_SCHEMA_VERSION,
  buildQaVerificationReceipt,
  describeReceiptBusiness,
  getQaVerificationReceiptPath,
  readQaVerificationReceipt,
  removeQaVerificationReceipt,
  validateMergedPrReceipt,
  validateQaVerificationReceipt,
  worktreeReceiptKey,
  writeQaVerificationReceipt,
};

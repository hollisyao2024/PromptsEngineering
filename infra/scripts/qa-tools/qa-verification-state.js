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

function buildQaVerificationReceipt({
  baseBranch,
  branch,
  baseSha,
  headSha,
  verifiedAt = new Date().toISOString(),
} = {}) {
  return {
    schema_version: RECEIPT_SCHEMA_VERSION,
    verdict: 'passed',
    base_branch: assertNonEmpty(baseBranch, 'BASE_BRANCH'),
    branch: assertNonEmpty(branch, 'BRANCH'),
    base_sha: assertSha(baseSha, 'BASE_SHA'),
    head_sha: assertSha(headSha, 'HEAD_SHA'),
    verified_at: assertNonEmpty(verifiedAt, 'VERIFIED_AT'),
  };
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

module.exports = {
  RECEIPT_SCHEMA_VERSION,
  buildQaVerificationReceipt,
  getQaVerificationReceiptPath,
  readQaVerificationReceipt,
  removeQaVerificationReceipt,
  validateQaVerificationReceipt,
  writeQaVerificationReceipt,
};

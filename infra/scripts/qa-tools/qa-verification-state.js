'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { resolveContainerPath } = require('../shared/config');

const RECEIPT_SCHEMA_VERSION = 1;
const SHA_PATTERN = /^[0-9a-f]{40,64}$/iu;
// 回执只在放行时签发，因此 QA 裁决只能是 PASS 或 PASS_WITH_RISK；BLOCKED 永远不落盘。
// 缺省只出现在 qa verify 签发前的身份快照与升级前的旧回执里；qa verify 写盘时总会带上裁决。
const RECEIPT_QA_VERDICTS = new Set(['PASS', 'PASS_WITH_RISK']);

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

// 测试设计摘要：qa verify 放行且执行了设计门禁时写入；只保留这九项，畸形摘要在写盘前抛错。
const DESIGN_GATES = new Set(['PASS', 'PASS_WITH_RISK']);
const DESIGN_MODES = new Set(['enforce', 'warn']);
const DESIGN_ISOLATIONS = new Set(['NONE', 'UNDECLARED', 'subagent', 'commit-order', 'mixed']);
const RATIO_PATTERN = /^(\d+)\/(\d+)$/u;

function normalizeDesignSummary(design) {
  if (design === undefined || design === null) return null;
  if (typeof design !== 'object' || Array.isArray(design)) throw new Error('design summary must be an object');
  if (!DESIGN_GATES.has(design.gate)) throw new Error('design.gate must be PASS or PASS_WITH_RISK');
  if (!DESIGN_MODES.has(design.mode)) throw new Error('design.mode must be enforce or warn');
  const rulesTotal = assertCount(design.rules_total, 'design.rules_total');
  const rulesVerified = assertCount(design.rules_verified, 'design.rules_verified');
  if (rulesVerified > rulesTotal) throw new Error('design.rules_verified must not exceed design.rules_total');
  const ratio = RATIO_PATTERN.exec(typeof design.adv_covered === 'string' ? design.adv_covered : '');
  if (!ratio || Number(ratio[1]) > Number(ratio[2])) throw new Error('design.adv_covered must be <covered>/<total>');
  if (!DESIGN_ISOLATIONS.has(design.isolation)) throw new Error(`design.isolation must be ${[...DESIGN_ISOLATIONS].join('|')}`);
  return {
    gate: design.gate,
    mode: design.mode,
    docs: assertCount(design.docs, 'design.docs'),
    rules_total: rulesTotal,
    rules_verified: rulesVerified,
    adv_covered: design.adv_covered,
    amendments: assertCount(design.amendments, 'design.amendments'),
    isolation: design.isolation,
    risk_count: assertCount(design.risk_count, 'design.risk_count'),
  };
}

// 缺陷复现摘要：qa verify 放行且执行了复现门禁时写入；SKIPPED 表示 qa.repro.enabled=false（同时记风险）。
// defect_repro 为 <通过>/<总数>，总数即本分支新增 BUG 行数；只保留这四项，畸形摘要在写盘前抛错。
const REPRO_GATES = new Set(['PASS', 'PASS_WITH_RISK', 'SKIPPED']);

function normalizeReproSummary(repro) {
  if (repro === undefined || repro === null) return null;
  if (typeof repro !== 'object' || Array.isArray(repro)) throw new Error('repro summary must be an object');
  if (!REPRO_GATES.has(repro.gate)) throw new Error(`repro.gate must be ${[...REPRO_GATES].join('|')}`);
  const ratio = RATIO_PATTERN.exec(typeof repro.defect_repro === 'string' ? repro.defect_repro : '');
  if (!ratio || Number(ratio[1]) > Number(ratio[2])) throw new Error('repro.defect_repro must be <passed>/<total>');
  const newDefects = assertCount(repro.new_defects, 'repro.new_defects');
  if (newDefects > Number(ratio[2])) throw new Error('repro.new_defects must not exceed the defect_repro total');
  return {
    gate: repro.gate,
    defect_repro: repro.defect_repro,
    new_defects: newDefects,
    risk_count: assertCount(repro.risk_count, 'repro.risk_count'),
  };
}

// 变异测试摘要：qa verify 放行且 qa.mutation 已启用时写入；关闭或模板源跳过时不写。
// score 为 null 表示没有可计分的变异体（同时记风险）；p0_tests 为 <杀死过变异体的 P0 测试>/<参与判定的 P0 测试>，未要求时为 NA。
const MUTATION_GATES = new Set(['PASS', 'PASS_WITH_RISK']);

const isPercent = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

function normalizeMutationSummary(mutation) {
  if (mutation === undefined || mutation === null) return null;
  if (typeof mutation !== 'object' || Array.isArray(mutation)) throw new Error('mutation summary must be an object');
  if (!MUTATION_GATES.has(mutation.gate)) throw new Error(`mutation.gate must be ${[...MUTATION_GATES].join('|')}`);
  const killed = assertCount(mutation.killed, 'mutation.killed');
  const valid = assertCount(mutation.valid, 'mutation.valid');
  if (killed > valid) throw new Error('mutation.killed must not exceed mutation.valid');
  if (mutation.score !== null && !isPercent(mutation.score)) throw new Error('mutation.score must be a number between 0 and 100 or null');
  if (!isPercent(mutation.min_score)) throw new Error('mutation.min_score must be a number between 0 and 100');
  if (mutation.p0_tests !== 'NA') {
    const ratio = RATIO_PATTERN.exec(typeof mutation.p0_tests === 'string' ? mutation.p0_tests : '');
    if (!ratio || Number(ratio[1]) > Number(ratio[2])) throw new Error('mutation.p0_tests must be <killing>/<evaluated> or NA');
  }
  return {
    gate: mutation.gate,
    files: assertCount(mutation.files, 'mutation.files'),
    score: mutation.score,
    min_score: mutation.min_score,
    killed,
    valid,
    accepted: assertCount(mutation.accepted, 'mutation.accepted'),
    p0_tests: mutation.p0_tests,
    risk_count: assertCount(mutation.risk_count, 'mutation.risk_count'),
  };
}

function assertQaVerdict(value) {
  if (!RECEIPT_QA_VERDICTS.has(value)) throw new Error('QA_VERDICT must be PASS or PASS_WITH_RISK');
  return value;
}

function isPresent(value) {
  return value !== undefined && value !== null;
}

// verdict:'passed' 保留给 qa merge 的既有复验；qa_verdict 记录三态裁决中放行的那一种。
// no_module_reason 只在 --no-module 显式放行时出现，缺省表示本次验证识别到了 QA 目标。
function buildQaVerificationReceipt({
  baseBranch,
  branch,
  baseSha,
  headSha,
  verifiedAt = new Date().toISOString(),
  qaVerdict,
  noModuleReason,
  business,
  design,
  repro,
  mutation,
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
  if (isPresent(qaVerdict)) receipt.qa_verdict = assertQaVerdict(qaVerdict);
  if (isPresent(noModuleReason)) receipt.no_module_reason = assertNonEmpty(noModuleReason, 'NO_MODULE_REASON');
  const summary = normalizeBusinessSummary(business);
  if (summary) receipt.business = summary;
  const designSummary = normalizeDesignSummary(design);
  if (designSummary) receipt.design = designSummary;
  const reproSummary = normalizeReproSummary(repro);
  if (reproSummary) receipt.repro = reproSummary;
  const mutationSummary = normalizeMutationSummary(mutation);
  if (mutationSummary) receipt.mutation = mutationSummary;
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
    qaVerdict: receipt && receipt.qa_verdict,
    noModuleReason: receipt && receipt.no_module_reason,
    business: receipt && receipt.business,
    design: receipt && receipt.design,
    repro: receipt && receipt.repro,
    mutation: receipt && receipt.mutation,
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

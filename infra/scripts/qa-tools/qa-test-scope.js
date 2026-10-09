'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { orderedStepEvidence } = require('../shared/task-evidence');

// A check's evidence may cite a task evidence log as `evidence/<name>.log sha256=<hex>` (what `task exec` records).
// When the caller knows the task runs root, that citation must resolve to an existing file with the same digest, so
// a result cannot point at a log that was never written or has been replaced since.
const EVIDENCE_LOG_REFERENCE = /evidence\/([a-z0-9][a-z0-9._-]*\.log) sha256=([0-9a-f]{64})/u;

const MODES = new Set(['targeted', 'full', 'static']);
const FULL_TRIGGERS = new Set([
  'explicit_requirement',
  'whole_scope_impact',
  'unbounded_after_investigation',
  'cross_domain_failure',
]);

function samePath(left, right) {
  return typeof left === 'string' && typeof right === 'string' && left.length > 0 && right.length > 0
    && path.resolve(left) === path.resolve(right);
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// environment/dependencies 可写成描述字符串，或各叶值均非空的对象（嵌套对象与非空数组也可）。
function described(value, depth = 0) {
  if (typeof value === 'string') return nonempty(value);
  if (depth > 0 && typeof value === 'number') return Number.isFinite(value);
  if (depth > 0 && typeof value === 'boolean') return true;
  if (depth > 0 && Array.isArray(value)) return value.length > 0 && value.every((item) => described(item, depth + 1));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const values = Object.values(value);
  return values.length > 0 && values.every((item) => described(item, depth + 1));
}

function stringList(value, { allowEmpty = false } = {}) {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every(nonempty)
    && new Set(value).size === value.length;
}

function parseRecord(raw, prefix) {
  try {
    const value = JSON.parse(raw.slice(prefix.length));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* report one stable error below */ }
  throw new Error(`${prefix.slice(0, -1)} must contain a JSON object`);
}

function validateDecision(value) {
  if (value.version !== 1 || !MODES.has(value.mode)) {
    throw new Error('TEST_SCOPE_DECISION requires version=1 and mode=targeted|full|static');
  }
  if (!stringList(value.impact_paths)) throw new Error('TEST_SCOPE_DECISION impact_paths must be nonempty');
  if (!stringList(value.commands)) throw new Error('TEST_SCOPE_DECISION commands must be nonempty');
  if (!stringList(value.not_run, { allowEmpty: true })) {
    throw new Error('TEST_SCOPE_DECISION not_run must be an array of distinct descriptions');
  }
  if (!nonempty(value.reason)) throw new Error('TEST_SCOPE_DECISION reason is required');
  if (value.mode === 'full') {
    if (!FULL_TRIGGERS.has(value.full_trigger)) {
      throw new Error('TEST_SCOPE_DECISION full_trigger must name an approved full-test trigger');
    }
    if (!nonempty(value.trigger_evidence)) {
      throw new Error('TEST_SCOPE_DECISION trigger_evidence is required for full mode');
    }
  } else if (value.full_trigger !== undefined || value.trigger_evidence !== undefined) {
    throw new Error('TEST_SCOPE_DECISION full_trigger is only valid for full mode');
  }
  return value;
}

function verifyEvidenceLogReference(evidence, { runsRoot, taskId }) {
  const match = EVIDENCE_LOG_REFERENCE.exec(evidence);
  if (!match || !runsRoot) return;
  const [, fileName, expected] = match;
  const file = path.join(runsRoot, taskId, 'evidence', fileName);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`TEST_SCOPE_RESULT evidence file is missing: ${path.join(taskId, 'evidence', fileName)}`);
  }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== expected) {
    throw new Error(`TEST_SCOPE_RESULT evidence sha256 mismatch for ${path.join(taskId, 'evidence', fileName)}: recorded ${expected}, actual ${actual}`);
  }
}

function validateResult(value, decision, headSha, evidenceContext = {}) {
  if (value.version !== 1 || !/^[0-9a-f]{40}$/.test(value.head_sha || '')) {
    throw new Error('TEST_SCOPE_RESULT requires version=1 and a commit head_sha');
  }
  if (value.head_sha !== headSha) {
    throw new Error('TEST_SCOPE_RESULT head_sha does not match the QA receipt HEAD');
  }
  if (!described(value.environment) || !described(value.dependencies)) {
    throw new Error('TEST_SCOPE_RESULT environment and dependencies are required as a nonempty string or an object whose values are all nonempty');
  }
  if (!Array.isArray(value.checks) || value.checks.length !== decision.commands.length) {
    throw new Error('TEST_SCOPE_RESULT checks must cover every selected command');
  }
  const checks = new Map();
  for (const check of value.checks) {
    if (!check || !nonempty(check.command) || check.exit_code !== 0 || !nonempty(check.evidence)) {
      throw new Error('TEST_SCOPE_RESULT checks require command, exit_code=0 and evidence');
    }
    if (checks.has(check.command)) throw new Error('TEST_SCOPE_RESULT checks contain duplicate commands');
    verifyEvidenceLogReference(check.evidence, evidenceContext);
    checks.set(check.command, check);
  }
  if (decision.commands.some((command) => !checks.has(command))) {
    throw new Error('TEST_SCOPE_RESULT checks do not match TEST_SCOPE_DECISION commands');
  }
}

function verifyTestScopeEvidence({ states, context, headSha, runsRoot, templateSource = false }) {
  if (templateSource) return { skipped: true };
  const matches = states.filter((state) => state.status === 'running'
    && samePath(state.project_root, context.projectRoot)
    && samePath(state.worktree, context.worktree)
    && state.branch === context.branch);
  if (matches.length === 0) throw new Error('QA requires a matching mutation task with test scope evidence');
  if (matches.length > 1) throw new Error('QA found ambiguous mutation tasks for this worktree and branch');

  const task = matches[0];
  if (task.task_type !== 'mutation') return { skipped: true };
  const records = orderedStepEvidence(task);
  const decisionIndex = records.findLastIndex((item) => typeof item === 'string' && item.startsWith('TEST_SCOPE_DECISION='));
  if (decisionIndex < 0) throw new Error('TEST_SCOPE_DECISION is missing from the current task');
  const decision = validateDecision(parseRecord(records[decisionIndex], 'TEST_SCOPE_DECISION='));
  const resultRaw = records.slice(decisionIndex + 1).findLast((item) => (
    typeof item === 'string' && item.startsWith('TEST_SCOPE_RESULT=')
  ));
  if (!resultRaw) throw new Error('TEST_SCOPE_RESULT is missing after the latest decision');
  validateResult(parseRecord(resultRaw, 'TEST_SCOPE_RESULT='), decision, headSha, { runsRoot, taskId: task.task_id });
  return { taskId: task.task_id, mode: decision.mode, commands: decision.commands };
}

module.exports = { verifyTestScopeEvidence };

'use strict';

const path = require('node:path');

const FULL_TRIGGERS = new Set([
  'explicit_requirement', 'whole_scope_impact', 'unbounded_after_investigation', 'cross_domain_failure',
]);

function hasTestFile(args) {
  return args.some((arg) => /(?:[._-](?:test|spec)\.[cm]?[jt]sx?|(?:^test_.+|.+_test)\.py|_test\.go)$/iu.test(arg));
}

function commandRisk(command) {
  const executable = path.basename(command[0] || '').replace(/\.cmd$/iu, '').toLowerCase();
  const args = command.slice(1);
  if (['pnpm', 'npm', 'yarn', 'bun'].includes(executable)) {
    if (args[0] === 'agent' && args.includes('test') && args.includes('--file')) return '';
    const testIndex = args.findIndex((arg) => /^test(?::|$)/u.test(arg));
    if (testIndex >= 0 && (testIndex === 0 || args[testIndex - 1] === 'run' || args.includes('--filter'))) return 'aggregate';
    if (args.includes('turbo') && args.includes('test')) return 'aggregate';
    const runnerIndex = args.findIndex((arg) => ['vitest', 'jest', 'playwright'].includes(arg));
    if (runnerIndex >= 0 && !hasTestFile(args.slice(runnerIndex + 1))) return 'unbounded';
  }
  if (executable === 'node' && args.includes('--test') && !hasTestFile(args)) return 'unbounded';
  if (['vitest', 'jest', 'playwright', 'pytest'].includes(executable) && !hasTestFile(args)) return 'unbounded';
  if (executable === 'go' && args[0] === 'test' && !hasTestFile(args)) return 'unbounded';
  return '';
}

function hasFullApproval(command, state) {
  const records = (state.steps || []).flatMap((step) => Array.isArray(step.evidence) ? step.evidence : []);
  const raw = records.findLast((item) => typeof item === 'string' && item.startsWith('TEST_SCOPE_DECISION='));
  if (!raw) return false;
  let decision;
  try { decision = JSON.parse(raw.slice('TEST_SCOPE_DECISION='.length)); } catch { return false; }
  return decision?.version === 1
    && decision.mode === 'full'
    && FULL_TRIGGERS.has(decision.full_trigger)
    && typeof decision.trigger_evidence === 'string'
    && decision.trigger_evidence.trim().length > 0
    && Array.isArray(decision.commands)
    && decision.commands.includes(command.join(' '));
}

function assertTestCommandScope(command, state) {
  const risk = commandRisk(command);
  if (!risk || hasFullApproval(command, state)) return;
  const explanation = risk === 'aggregate'
    ? 'aggregate test command'
    : 'test runner needs an explicit test file';
  throw new Error(`${explanation}; use pnpm agent -- test --file <file> -- <runner>, or record a matching TEST_SCOPE_DECISION with mode=full before task exec`);
}

module.exports = { assertTestCommandScope, commandRisk };

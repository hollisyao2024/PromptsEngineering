'use strict';

const path = require('node:path');
const { orderedStepEvidence } = require('../shared/task-evidence');

const FULL_TRIGGERS = new Set([
  'explicit_requirement', 'whole_scope_impact', 'unbounded_after_investigation', 'cross_domain_failure',
]);

function hasTestFile(args) {
  return args.some((arg) => /(?:[._-](?:test|spec)\.[cm]?[jt]sx?|(?:^test_.+|.+_test)\.py|_test\.go)$/iu.test(arg));
}

const PACKAGE_MANAGERS = new Set(['pnpm', 'npm', 'yarn', 'bun']);
const RUNNERS = new Set(['vitest', 'jest', 'playwright', 'pytest']);
const NESTED_EXECUTABLES = new Set([...PACKAGE_MANAGERS, ...RUNNERS, 'turbo', 'npx', 'go']);

function commandRisk(command) {
  const executable = path.basename(command[0] || '').replace(/\.cmd$/iu, '').toLowerCase();
  const args = command.slice(1);
  if (['sh', 'bash', 'zsh'].includes(executable)
    && args.some((arg) => /^-[a-z]*c[a-z]*$/iu.test(arg))
    && args.some((arg) => /\b(?:pnpm|npm|yarn|bun|turbo|vitest|jest|playwright|pytest)\b|\bnode\s+--test\b/iu.test(arg))) {
    return 'aggregate';
  }
  if (PACKAGE_MANAGERS.has(executable)) {
    if (args[0] === 'agent' && args[1] === '--' && args[2] === 'test' && args[3] === '--file') return '';
    const runnerIndex = args.findIndex((arg) => RUNNERS.has(arg));
    if (runnerIndex >= 0) return hasTestFile(args.slice(runnerIndex + 1)) ? '' : 'unbounded';
    if (args.includes('turbo') && args.includes('test')) return 'aggregate';
    if (args.some((arg) => /^test(?::|$)/u.test(arg))) return 'aggregate';
  }
  if (executable === 'turbo' && args.includes('test')) return 'aggregate';
  if (executable === 'npx') return commandRisk(args);
  if (executable === 'node') {
    if (args.includes('--test') && !hasTestFile(args)) return 'unbounded';
    const nestedIndex = args.findIndex((arg) => NESTED_EXECUTABLES.has(path.basename(arg).toLowerCase())
      || /^python(?:3(?:\.\d+)?)?$/u.test(path.basename(arg).toLowerCase()));
    if (nestedIndex >= 0) return commandRisk(args.slice(nestedIndex));
  }
  if (/^python(?:3(?:\.\d+)?)?$/u.test(executable) && args[0] === '-m' && args[1] === 'pytest') {
    return hasTestFile(args.slice(2)) ? '' : 'unbounded';
  }
  if (RUNNERS.has(executable) && !hasTestFile(args)) return 'unbounded';
  if (executable === 'go' && args[0] === 'test' && !hasTestFile(args)) return 'unbounded';
  return '';
}

function hasFullApproval(command, state) {
  const records = orderedStepEvidence(state);
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

// 登记命令仅在每个词都是无需 shell 解释的普通参数时参与匹配；引号、变量、管道、重定向、通配符等一律不匹配。
const SAFE_WORD = /^[\w@+,./:=-]+$/u;

function registeredWords(entry) {
  if (typeof entry !== 'string') return null;
  const words = entry.replace(/^[ \t]+|[ \t]+$/gu, '').split(/[ \t]+/u);
  return words.every((word) => SAFE_WORD.test(word)) ? words : null;
}

// qa run 本就无护栏地运行 qa.business.suites 登记的命令；task exec 逐词精确匹配后放行同一条，包装器与任何参数变体都不放行。
function isRegisteredSuiteCommand(command, registeredCommands) {
  if (!Array.isArray(registeredCommands)) return false;
  return registeredCommands.some((entry) => {
    const words = registeredWords(entry);
    return words !== null && words.length === command.length && words.every((word, index) => word === command[index]);
  });
}

function assertTestCommandScope(command, state, options) {
  const risk = commandRisk(command);
  if (!risk || isRegisteredSuiteCommand(command, options && options.registeredCommands) || hasFullApproval(command, state)) return;
  const explanation = risk === 'aggregate'
    ? 'aggregate test command'
    : 'test runner needs an explicit test file';
  throw new Error(`${explanation}; use pnpm agent -- test --file <file> -- <runner>, or record a matching TEST_SCOPE_DECISION with mode=full before task exec (a command registered under qa.business.suites is accepted when typed verbatim)`);
}

module.exports = { assertTestCommandScope, commandRisk };

#!/usr/bin/env node
'use strict';

const { auditManagedWorktrees } = require('./worktree-audit');

function printHelp() {
  console.log(`Usage:
  pnpm agent -- worktree audit [--apply] [--json]

Options:
  --apply  Persist recovery states and clean only fully proven orphan worktrees
  --json   Print the complete machine-readable report
  -h       Show this help without changing Git or the filesystem

The default mode is a read-only dry run.`);
}

function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }
  const known = new Set(['--apply', '--json']);
  const unknown = argv.find((arg) => !known.has(arg));
  if (unknown) throw new Error(`unknown option: ${unknown}`);
  const result = auditManagedWorktrees({ apply: argv.includes('--apply') });
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`STATUS=${result.status}`);
    console.log(`MODE=${result.mode}`);
    for (const [state, count] of Object.entries(result.counts).sort()) {
      console.log(`COUNT_${state.toUpperCase()}=${count}`);
    }
    for (const record of result.records) {
      console.log(`WORKTREE=${record.branch || '(detached)'}\tSTATE=${record.state}\tREASON=${record.reason}\tPATH=${record.path || ''}`);
    }
    if (result.qaPlanStates) {
      for (const [state, count] of Object.entries(result.qaPlanStates.counts).sort()) {
        console.log(`QA_PLAN_COUNT_${state.toUpperCase()}=${count}`);
      }
      for (const record of result.qaPlanStates.records) {
        console.log(`QA_PLAN_STATE=${record.state}\tREASON=${record.reason}\tPATH=${record.path}`);
      }
    }
    const recovery = [
      ...result.records,
      ...(result.qaPlanStates?.records || []),
    ].filter((record) => record.state === 'recovery_required');
    if (recovery.length > 0) {
      console.log('NEXT_ACTION=Inspect recovery_required worktrees and preserve needed changes with worktree resume --recover-as.');
    }
  }
  return result.status === 'ATTENTION' ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error('STATUS=BLOCKED');
    console.error(`REASON=${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main };

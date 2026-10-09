'use strict';

// Parsable result block for the stable command entry points (docs/CONVENTIONS.md §7): a command ends with
// STATUS=, SUMMARY= and NEXT_ACTION= on their own lines, with REASON=<code> between STATUS and SUMMARY whenever the
// status is not OK, and exits non-zero unless STATUS=OK. Values are folded onto one line so a consumer can split the
// output on newlines without a multi-line message breaking the block.

const RESULT_STATUSES = new Set(['OK', 'BLOCKED', 'FAILED']);

const oneLine = (text) => String(text).replace(/\s*[\r\n]+\s*/gu, ' ');

function resultBlockLines({ status, reason, summary, nextAction }) {
  if (!RESULT_STATUSES.has(status)) throw new Error(`result block status must be OK|BLOCKED|FAILED: ${status}`);
  if (status !== 'OK' && !reason) throw new Error(`result block with STATUS=${status} requires a REASON code`);
  if (!summary || !nextAction) throw new Error('result block requires SUMMARY and NEXT_ACTION');
  const lines = [`STATUS=${status}`];
  if (reason) lines.push(`REASON=${oneLine(reason)}`);
  lines.push(`SUMMARY=${oneLine(summary)}`, `NEXT_ACTION=${oneLine(nextAction)}`);
  return lines;
}

function resultExitCode(status) {
  return status === 'OK' ? 0 : 1;
}

module.exports = { RESULT_STATUSES, oneLine, resultBlockLines, resultExitCode };

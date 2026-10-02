'use strict';

// Evidence bodies remain in their owning steps. This index is written in the
// same atomic state transaction, so cross-step backflow preserves append order.
function legacyReferences(state) {
  return (state.steps || []).flatMap(step => (
    Array.isArray(step.evidence)
      ? step.evidence.map((_, index) => ({ step_id: step.id, index })) : []
  ));
}

function orderedStepEvidence(state) {
  if (!Object.hasOwn(state, 'evidence_order')) {
    // Old files cannot establish checkpoint chronology. Preserve the historic
    // interpretation rather than inventing timestamps from step.updated_at.
    return (state.steps || []).flatMap(step => Array.isArray(step.evidence) ? step.evidence : []);
  }
  if (!Array.isArray(state.evidence_order)) throw new Error('invalid evidence_order: expected an array');
  const steps = new Map();
  let count = 0;
  for (const step of state.steps || []) {
    if (typeof step.id !== 'string' || !step.id || steps.has(step.id) || !Array.isArray(step.evidence)) {
      throw new Error('invalid evidence_order: steps require unique ids and evidence arrays');
    }
    steps.set(step.id, { evidence: step.evidence, next: 0 });
    count += step.evidence.length;
  }
  const records = [];
  for (const ref of state.evidence_order) {
    const step = steps.get(ref?.step_id);
    if (!ref || !step || !Number.isSafeInteger(ref.index) || ref.index !== step.next
      || ref.index >= step.evidence.length) {
      throw new Error('invalid evidence_order: missing, duplicate, reordered or out-of-range reference');
    }
    records.push(step.evidence[ref.index]);
    step.next += 1;
  }
  if (records.length !== count) throw new Error('invalid evidence_order: incomplete evidence coverage');
  return records;
}

function appendStepEvidence(state, step, records) {
  orderedStepEvidence(state);
  if (!Object.hasOwn(state, 'evidence_order')) state.evidence_order = legacyReferences(state);
  const start = step.evidence.length;
  step.evidence = [...step.evidence, ...records];
  state.evidence_order.push(...records.map((_, offset) => ({ step_id: step.id, index: start + offset })));
}

module.exports = { orderedStepEvidence, appendStepEvidence };

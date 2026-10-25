'use strict';

/**
 * Single mapping table for renamed governance phases.
 *
 * Input surfaces (CLI flags, new tasks, new worktrees) reject a renamed phase with
 * a migration message instead of aliasing it. Persisted state (task state.json,
 * worktree sessions) is upgraded on read so in-flight work stays resumable.
 */
const LEGACY_PHASE_RENAMES = Object.freeze({ devops: 'ops' });

function legacyKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// Persisted reads only: returns the current phase name, leaving other values untouched.
function normalizeLegacyPhase(value) {
  const key = legacyKey(value);
  return Object.prototype.hasOwnProperty.call(LEGACY_PHASE_RENAMES, key) ? LEGACY_PHASE_RENAMES[key] : value;
}

// Input validation: a non-empty message means the caller must fail closed.
function legacyPhaseError(value) {
  const key = legacyKey(value);
  if (!Object.prototype.hasOwnProperty.call(LEGACY_PHASE_RENAMES, key)) return '';
  const current = LEGACY_PHASE_RENAMES[key];
  return `${key} 阶段已更名为 ${current}；请改用 --phase ${current}`;
}

module.exports = { LEGACY_PHASE_RENAMES, legacyPhaseError, normalizeLegacyPhase };

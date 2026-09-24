#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');
const { spawnSync } = require('child_process');
const {
  getMainRepoRoot,
  getWorktreeRoot,
  loadConfig,
  resolveContainerPath,
  resolveRuntimePath,
} = require('../shared/config');
const {
  acquireLock,
  getCurrentBranch,
  isPathInside,
  isSamePath,
  safeRemoveTreeNoFollow,
} = require('../worktree-tools/worktree-core');

const SCHEMA_VERSION = 2;
const LEGACY_SCHEMA_VERSION = 1;
const DEFAULT_CONTEXT_BYTES = 8192;
const DEFAULT_SUMMARY_BYTES = 8192;
const DEFAULT_SUMMARY_LINES = 80;
const TASK_STATUSES = new Set(['running', 'blocked', 'completed', 'cleanup_pending']);
const TASK_TYPES = new Set(['operation', 'mutation', 'diagnose', 'deploy', 'computer_use', 'research']);
const STEP_STATUSES = new Set(['pending', 'running', 'done', 'blocked', 'verify_required']);
const REPLAY_MODES = new Set(['safe', 'verify_first']);
const TASK_PHASES = new Set(['unspecified', 'prd', 'arch', 'task', 'tdd', 'qa', 'devops']);
const PHASE_ORDER = new Map([
  ['unspecified', -1], ['prd', 0], ['arch', 1], ['task', 2], ['tdd', 3], ['qa', 4], ['devops', 5],
]);
const PHASE_TRANSITIONS = new Map([
  ['unspecified', new Set(['prd', 'arch', 'task', 'tdd', 'qa', 'devops'])],
  ['prd', new Set(['arch'])],
  ['arch', new Set(['prd', 'task'])],
  ['task', new Set(['prd', 'arch', 'tdd'])],
  ['tdd', new Set(['prd', 'arch', 'task', 'qa'])],
  ['qa', new Set(['tdd', 'devops'])],
  ['devops', new Set(['arch', 'tdd', 'qa'])],
]);

function nowIso(value) {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function safeTaskId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (
    !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(normalized)
    || normalized.includes('..')
  ) {
    throw new Error('invalid task id; use 1-80 letters, numbers, dots, underscores, or hyphens');
  }
  return normalized;
}

function ensureRealDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
  assertRealDirectory(directoryPath);
}

function assertRealDirectory(directoryPath) {
  const stat = fs.lstatSync(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`task state directory must be a real directory: ${directoryPath}`);
  }
}

function taskPaths(runsRoot, taskId, { createRoot = true } = {}) {
  if (!path.isAbsolute(runsRoot || '')) throw new Error('runsRoot must be an absolute path');
  if (createRoot) ensureRealDirectory(runsRoot);
  else assertRealDirectory(runsRoot);
  const id = safeTaskId(taskId);
  const taskDir = path.join(runsRoot, id);
  if (!isPathInside(runsRoot, taskDir)) throw new Error(`task path escapes runs root: ${id}`);
  return { id, taskDir, statePath: path.join(taskDir, 'state.json') };
}

function fsyncDirectory(directoryPath) {
  let descriptor;
  try {
    descriptor = fs.openSync(directoryPath, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (!error || !['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR'].includes(error.code)) throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function normalizePhase(value) {
  const phase = String(value || 'unspecified').trim().toLowerCase();
  if (!TASK_PHASES.has(phase)) throw new Error(`invalid task phase: ${phase}`);
  return phase;
}

function upgradeLegacyState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
  if (state.schema_version !== LEGACY_SCHEMA_VERSION) return state;
  return {
    ...state,
    schema_version: SCHEMA_VERSION,
    current_phase: 'unspecified',
    phase_history: [],
    plan_revision: 1,
    plan_history: [],
  };
}

function validateState(inputState, expectedTaskId) {
  const state = upgradeLegacyState(inputState);
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('invalid task state: expected an object');
  }
  if (state.schema_version !== SCHEMA_VERSION) {
    throw new Error(`invalid task state: unsupported schema_version ${state.schema_version}`);
  }
  if (safeTaskId(state.task_id) !== expectedTaskId) {
    throw new Error(`invalid task state: task id mismatch for ${expectedTaskId}`);
  }
  if (!TASK_STATUSES.has(state.status)) {
    throw new Error(`invalid task state: unsupported status ${state.status}`);
  }
  if (!TASK_TYPES.has(state.task_type)) {
    throw new Error(`invalid task state: unsupported task_type ${state.task_type}`);
  }
  if (!TASK_PHASES.has(state.current_phase)) {
    throw new Error(`invalid task state: unsupported current_phase ${state.current_phase}`);
  }
  if (!Array.isArray(state.phase_history)) {
    throw new Error('invalid task state: phase_history must be an array');
  }
  let historyPhase = 'unspecified';
  for (let index = 0; index < state.phase_history.length; index += 1) {
    const entry = state.phase_history[index];
    if (!entry || !TASK_PHASES.has(entry.phase) || !Array.isArray(entry.evidence)) {
      throw new Error('invalid task state: malformed phase history');
    }
    const establishesInitialPhase = index === 0 && entry.from_phase === '';
    if (!establishesInitialPhase && !TASK_PHASES.has(entry.from_phase)) {
      throw new Error(`invalid task state: unsupported phase history source ${entry.from_phase}`);
    }
    if (!establishesInitialPhase) {
      if (entry.from_phase !== historyPhase) {
        throw new Error(`invalid task state: discontinuous phase history at ${entry.phase}`);
      }
      const allowed = PHASE_TRANSITIONS.get(entry.from_phase) || new Set();
      if (!allowed.has(entry.phase)) {
        throw new Error(`invalid task state: impossible phase history ${entry.from_phase} -> ${entry.phase}`);
      }
    }
    historyPhase = entry.phase;
  }
  if (
    (state.phase_history.length === 0 && state.current_phase !== 'unspecified')
    || (state.phase_history.length > 0 && state.current_phase !== historyPhase)
  ) {
    throw new Error('invalid task state: current_phase does not match phase history');
  }
  if (!Number.isInteger(state.plan_revision) || state.plan_revision < 1) {
    throw new Error('invalid task state: plan_revision must be a positive integer');
  }
  if (!Array.isArray(state.plan_history)) {
    throw new Error('invalid task state: plan_history must be an array');
  }
  if (state.plan_history.length !== state.plan_revision - 1) {
    throw new Error('invalid task state: plan history does not match plan_revision');
  }
  for (let index = 0; index < state.plan_history.length; index += 1) {
    const entry = state.plan_history[index];
    if (
      !entry
      || entry.revision !== index + 2
      || !Array.isArray(entry.added_step_ids)
      || !Array.isArray(entry.added_acceptance_ids)
      || !String(entry.reason || '').trim()
    ) {
      throw new Error('invalid task state: malformed plan history');
    }
  }
  if (!path.isAbsolute(state.project_root || '')) {
    throw new Error('invalid task state: project_root must be absolute');
  }
  if (!Array.isArray(state.steps) || state.steps.length === 0) {
    throw new Error('invalid task state: at least one step is required');
  }
  const stepIds = new Set();
  for (const step of state.steps) {
    if (!step || typeof step.id !== 'string' || stepIds.has(step.id)) {
      throw new Error('invalid task state: step ids must be unique strings');
    }
    stepIds.add(step.id);
    if (!STEP_STATUSES.has(step.status) || !REPLAY_MODES.has(step.replay)) {
      throw new Error(`invalid task state: unsupported step state for ${step.id}`);
    }
    if (!String(step.title || '').trim() || !String(step.next_action || '').trim()) {
      throw new Error(`invalid task state: step ${step.id} requires title and next_action`);
    }
    if (!Array.isArray(step.evidence)) {
      throw new Error(`invalid task state: evidence must be an array for ${step.id}`);
    }
    const failures = step.failures === undefined ? [] : step.failures;
    const recoveries = step.recoveries === undefined ? [] : step.recoveries;
    if (!Array.isArray(failures) || !Array.isArray(recoveries)) {
      throw new Error('invalid task state: failure/recovery history must be arrays');
    }
    for (const failure of failures) {
      if (!failure || !['tool_error', 'policy_denied', 'unknown_result'].includes(failure.failure_kind)
        || !['not_started', 'started', 'unknown'].includes(failure.execution_state)
        || (failure.failure_kind === 'unknown_result' && failure.execution_state !== 'unknown')
        || !Array.isArray(failure.evidence) || !failure.evidence.length
        || !String(failure.next_action || '').trim() || !Number.isFinite(Date.parse(failure.at))) {
        throw new Error('invalid task state: malformed failure history');
      }
    }
    const recovered = new Set();
    for (const recovery of recoveries) {
      if (!recovery || !Number.isInteger(recovery.failure_index) || recovery.failure_index < 0
        || recovery.failure_index >= failures.length || recovered.has(recovery.failure_index)
        || !String(recovery.evidence || '').trim() || !Number.isFinite(Date.parse(recovery.at))) {
        throw new Error('invalid task state: malformed recovery history');
      }
      recovered.add(recovery.failure_index);
    }
  }
  for (const entry of state.phase_history) {
    if (entry.deferred_cleanup === undefined) continue;
    const deferred = entry.deferred_cleanup;
    const step = state.steps.find(item => item.id === deferred?.step_id);
    const failure = step?.failures?.[deferred?.failure_index];
    if (!['qa', 'devops'].includes(entry.phase) || !step
      || !Number.isInteger(deferred.failure_index) || deferred.failure_index < 0
      || failure?.execution_state !== 'not_started' || !String(deferred.evidence || '').trim()) {
      throw new Error('invalid task state: malformed deferred cleanup evidence');
    }
  }
  if (!Array.isArray(state.acceptance_criteria)) {
    throw new Error('invalid task state: acceptance_criteria must be an array');
  }
  const acceptanceIds = new Set();
  for (const criterion of state.acceptance_criteria) {
    if (!criterion || typeof criterion.id !== 'string' || acceptanceIds.has(criterion.id)) {
      throw new Error('invalid task state: acceptance ids must be unique strings');
    }
    acceptanceIds.add(criterion.id);
    if (!String(criterion.text || '').trim() || !['pending', 'done'].includes(criterion.status)) {
      throw new Error(`invalid task state: malformed acceptance criterion ${criterion.id}`);
    }
    if (!Array.isArray(criterion.evidence)) {
      throw new Error(`invalid task state: acceptance evidence must be an array for ${criterion.id}`);
    }
  }
  const plannedStepIds = new Set();
  const plannedAcceptanceIds = new Set();
  for (const entry of state.plan_history) {
    for (const stepId of entry.added_step_ids) {
      if (!stepIds.has(stepId) || plannedStepIds.has(stepId)) {
        throw new Error(`invalid task state: plan history references invalid step ${stepId}`);
      }
      plannedStepIds.add(stepId);
    }
    for (const acceptanceId of entry.added_acceptance_ids) {
      if (!acceptanceIds.has(acceptanceId) || plannedAcceptanceIds.has(acceptanceId)) {
        throw new Error(`invalid task state: plan history references invalid acceptance ${acceptanceId}`);
      }
      plannedAcceptanceIds.add(acceptanceId);
    }
  }
  const firstIncomplete = state.steps.find((step) => step.status !== 'done') || null;
  if (state.current_step !== (firstIncomplete ? firstIncomplete.id : '')) {
    throw new Error('invalid task state: current_step does not match step progress');
  }
  if (['completed', 'cleanup_pending'].includes(state.status) && firstIncomplete) {
    throw new Error(`invalid task state: ${state.status} task contains incomplete steps`);
  }
  if (!['completed', 'cleanup_pending'].includes(state.status)) {
    const expectedStatus = state.steps.some((step) => ['blocked', 'verify_required'].includes(step.status))
      ? 'blocked'
      : 'running';
    if (state.status !== expectedStatus) {
      throw new Error(`invalid task state: status ${state.status} does not match step progress`);
    }
  }
  return state;
}

function writeAtomicState({ runsRoot, taskId, state }) {
  const { id, taskDir, statePath } = taskPaths(runsRoot, taskId);
  ensureRealDirectory(taskDir);
  const validatedState = validateState(state, id);
  const temporaryPath = path.join(taskDir, `state.json.tmp-${process.pid}-${Date.now()}`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(validatedState, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, statePath);
    fsyncDirectory(taskDir);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
  return validatedState;
}

function readTaskState({ runsRoot, taskId }) {
  const { id, taskDir, statePath } = taskPaths(runsRoot, taskId, { createRoot: false });
  let taskStat;
  let stateStat;
  try {
    taskStat = fs.lstatSync(taskDir);
    stateStat = fs.lstatSync(statePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error(`task state not found: ${id}`);
    throw error;
  }
  if (taskStat.isSymbolicLink() || !taskStat.isDirectory() || stateStat.isSymbolicLink() || !stateStat.isFile()) {
    throw new Error(`invalid task state path: ${id}`);
  }
  try {
    return validateState(JSON.parse(fs.readFileSync(statePath, 'utf8')), id);
  } catch (error) {
    if (/^invalid task state/u.test(error.message)) throw error;
    throw new Error(`invalid task state for ${id}: ${error.message}`);
  }
}

function withTaskLock({ lockDir, taskId }, action) {
  if (!path.isAbsolute(lockDir || '')) throw new Error('lockDir must be an absolute path');
  const release = acquireLock(lockDir, `agent-task-${safeTaskId(taskId)}`, 30000);
  try {
    return action();
  } finally {
    release();
  }
}

function normalizeTextList(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function createTask(options) {
  const {
    runsRoot,
    lockDir,
    projectRoot,
    worktree,
    branch = '',
    goal,
    taskType = 'mutation',
  } = options;
  const taskId = safeTaskId(options.taskId);
  const goalText = String(goal || '').trim();
  if (!goalText) throw new Error('--desc requires a non-empty task goal');
  if (!path.isAbsolute(projectRoot || '')) throw new Error('projectRoot must be absolute');
  if (worktree && !path.isAbsolute(worktree)) throw new Error('worktree must be absolute when provided');
  const sourceSteps = Array.isArray(options.steps) ? options.steps : [];
  if (sourceSteps.length === 0) throw new Error('at least one --step is required');

  return withTaskLock({ lockDir, taskId }, () => {
    const { taskDir } = taskPaths(runsRoot, taskId);
    if (fs.existsSync(taskDir)) throw new Error(`task already exists: ${taskId}`);
    const timestamp = nowIso(options.now);
    const normalizedTaskType = String(taskType || 'operation');
    if (!TASK_TYPES.has(normalizedTaskType)) throw new Error(`invalid task type: ${normalizedTaskType}`);
    const steps = sourceSteps.map((step, index) => {
      const title = String(typeof step === 'string' ? step : step.title || '').trim();
      const replay = typeof step === 'string' ? 'safe' : (step.replay || 'safe');
      if (!title) throw new Error(`step ${index + 1} requires a non-empty title`);
      if (!REPLAY_MODES.has(replay)) throw new Error(`invalid replay mode for step ${index + 1}: ${replay}`);
      return {
        id: `S${index + 1}`,
        title,
        status: 'pending',
        replay,
        evidence: [],
        next_action: title,
      };
    });
    const acceptance = normalizeTextList(options.acceptanceCriteria);
    if (normalizedTaskType === 'mutation' && acceptance.length === 0) {
      throw new Error('mutation tasks require at least one explicit --acceptance');
    }
    const currentPhase = normalizePhase(options.phase);
    const state = {
      schema_version: SCHEMA_VERSION,
      task_id: taskId,
      goal: goalText,
      task_type: normalizedTaskType,
      status: 'running',
      project_root: path.resolve(projectRoot),
      worktree: worktree ? path.resolve(worktree) : '',
      branch: String(branch || ''),
      acceptance_criteria: (acceptance.length > 0 ? acceptance : [goalText]).map((text, index) => ({
        id: `AC${index + 1}`,
        text,
        status: 'pending',
        evidence: [],
      })),
      constraints: normalizeTextList(options.constraints),
      current_phase: currentPhase,
      phase_history: currentPhase === 'unspecified' ? [] : [{
        phase: currentPhase,
        from_phase: '',
        evidence: [],
        entered_at: timestamp,
      }],
      plan_revision: 1,
      plan_history: [],
      current_step: steps[0].id,
      next_action: steps[0].title,
      last_error: null,
      steps,
      created_at: timestamp,
      updated_at: timestamp,
    };
    return writeAtomicState({ runsRoot, taskId, state });
  });
}

function bindTaskLocation(options) {
  const taskId = safeTaskId(options.taskId);
  if (!path.isAbsolute(options.projectRoot || '')) {
    throw new Error('projectRoot must be absolute');
  }
  if (!path.isAbsolute(options.worktree || '')) {
    throw new Error('worktree must be absolute');
  }
  const taskDir = path.join(options.runsRoot, taskId);
  if (!fs.existsSync(taskDir)) return { status: 'MISSING', taskId };

  return withTaskLock({ lockDir: options.lockDir, taskId }, () => {
    const state = readTaskState({ runsRoot: options.runsRoot, taskId });
    if (!isSamePath(state.project_root, options.projectRoot)) {
      throw new Error(`task ${taskId} belongs to a different project root`);
    }
    if (['completed', 'cleanup_pending'].includes(state.status)) {
      return { status: 'TERMINAL', taskId, taskStatus: state.status };
    }

    const worktree = path.resolve(options.worktree);
    const branch = String(options.branch || '');
    if (isSamePath(state.worktree, worktree) && state.branch === branch) {
      return { status: 'UNCHANGED', taskId };
    }
    state.worktree = worktree;
    state.branch = branch;
    state.updated_at = nowIso(options.now);
    writeAtomicState({ runsRoot: options.runsRoot, taskId, state });
    return { status: 'BOUND', taskId };
  });
}

function extendTask(options) {
  const taskId = safeTaskId(options.taskId);
  const sourceSteps = Array.isArray(options.steps) ? options.steps : [];
  const acceptance = normalizeTextList(options.acceptanceCriteria);
  const reason = String(options.reason || '').trim();
  if (sourceSteps.length === 0 && acceptance.length === 0) {
    throw new Error('extend requires --add-step, --add-verify-step, or --add-acceptance');
  }
  if (!reason) throw new Error('extend requires --reason');

  return withTaskLock({ lockDir: options.lockDir, taskId }, () => {
    const state = readTaskState({ runsRoot: options.runsRoot, taskId });
    if (['completed', 'cleanup_pending'].includes(state.status)) {
      throw new Error(`task is ${state.status}; plan extension is not allowed`);
    }
    const timestamp = nowIso(options.now);
    const addedSteps = sourceSteps.map((source, index) => {
      const title = String(typeof source === 'string' ? source : source.title || '').trim();
      const replay = typeof source === 'string' ? 'safe' : (source.replay || 'safe');
      if (!title) throw new Error(`added step ${index + 1} requires a non-empty title`);
      if (!REPLAY_MODES.has(replay)) throw new Error(`invalid replay mode for added step ${index + 1}: ${replay}`);
      return {
        id: `S${state.steps.length + index + 1}`,
        title,
        status: 'pending',
        replay,
        evidence: [],
        next_action: title,
      };
    });
    const addedAcceptance = acceptance.map((text, index) => ({
      id: `AC${state.acceptance_criteria.length + index + 1}`,
      text,
      status: 'pending',
      evidence: [],
    }));
    state.steps.push(...addedSteps);
    state.acceptance_criteria.push(...addedAcceptance);
    state.plan_revision += 1;
    state.plan_history.push({
      revision: state.plan_revision,
      reason,
      added_step_ids: addedSteps.map((step) => step.id),
      added_acceptance_ids: addedAcceptance.map((criterion) => criterion.id),
      changed_at: timestamp,
    });
    const current = firstIncompleteStep(state);
    state.current_step = current ? current.id : '';
    state.next_action = current
      ? String(current.next_action || current.title)
      : 'Verify acceptance criteria, then run finish gate';
    state.status = deriveTaskStatus(state);
    state.updated_at = timestamp;
    return writeAtomicState({ runsRoot: options.runsRoot, taskId, state });
  });
}

function transitionTaskPhase(options) {
  const taskId = safeTaskId(options.taskId);
  const targetPhase = normalizePhase(options.phase);
  const evidence = normalizeTextList(options.evidence);
  return withTaskLock({ lockDir: options.lockDir, taskId }, () => {
    const state = readTaskState({ runsRoot: options.runsRoot, taskId });
    if (['completed', 'cleanup_pending'].includes(state.status)) {
      throw new Error(`task is ${state.status}; phase transition is not allowed`);
    }
    if (state.current_phase === targetPhase) return state;
    if (evidence.length === 0) throw new Error('phase transition requires evidence');
    const allowed = PHASE_TRANSITIONS.get(state.current_phase) || new Set();
    if (!allowed.has(targetPhase)) {
      throw new Error(`invalid phase transition: ${state.current_phase} -> ${targetPhase}`);
    }
    const movesForward = PHASE_ORDER.get(targetPhase) > PHASE_ORDER.get(state.current_phase);
    let deferredCleanup;
    if (options.deferCleanupStep || options.cleanupEvidence) {
      if (!movesForward || !['qa', 'devops'].includes(targetPhase)) throw new Error('cleanup deferral only applies to forward QA or DEVOPS transitions');
      if (!String(options.cleanupEvidence || '').trim()) throw new Error('cleanup deferral requires independence evidence');
      const step = state.steps.find(item => item.id === options.deferCleanupStep);
      const failureIndex = (step?.failures?.length || 0) - 1;
      if (!step || step.status !== 'blocked' || step.failures?.[failureIndex]?.execution_state !== 'not_started'
        || step.recoveries?.some(item => item.failure_index === failureIndex)) {
        throw new Error('cleanup step must have an unresolved failure proven not started');
      }
      deferredCleanup = { step_id: step.id, failure_index: failureIndex, evidence: options.cleanupEvidence.trim() };
    }
    const unresolvedEffect = state.steps.find((step) => ['blocked', 'verify_required'].includes(step.status)
      && step.id !== deferredCleanup?.step_id);
    if (movesForward && unresolvedEffect) {
      throw new Error(`phase transition blocked by unresolved step ${unresolvedEffect.id}: ${unresolvedEffect.status}`);
    }
    const timestamp = nowIso(options.now);
    state.phase_history.push({
      phase: targetPhase,
      from_phase: state.current_phase,
      evidence,
      entered_at: timestamp,
      ...(deferredCleanup ? { deferred_cleanup: deferredCleanup } : {}),
    });
    state.current_phase = targetPhase;
    if (options.projectRoot && isSamePath(options.projectRoot, state.project_root)) {
      if (options.worktree) state.worktree = path.resolve(options.worktree);
      if (options.branch) state.branch = String(options.branch);
    }
    state.updated_at = timestamp;
    return writeAtomicState({ runsRoot: options.runsRoot, taskId, state });
  });
}

function firstIncompleteStep(state) {
  return state.steps.find((step) => step.status !== 'done') || null;
}

function deriveTaskStatus(state) {
  if (state.status === 'completed' || state.status === 'cleanup_pending') return state.status;
  return state.steps.some((step) => ['blocked', 'verify_required'].includes(step.status))
    ? 'blocked'
    : 'running';
}

function checkpointTask(options) {
  const taskId = safeTaskId(options.taskId);
  const evidence = normalizeTextList(options.evidence);
  const requestedStatus = String(options.status || '').trim();
  return withTaskLock({ lockDir: options.lockDir, taskId }, () => {
    const state = readTaskState({ runsRoot: options.runsRoot, taskId });
    if (['completed', 'cleanup_pending'].includes(state.status)) {
      throw new Error(`task is ${state.status}; checkpoint is not allowed`);
    }
    const timestamp = nowIso(options.now);
    const stepId = String(options.stepId || '').trim();
    const acceptanceId = String(options.acceptanceId || '').trim();
    const failureKind = String(options.failureKind || '').trim();
    const executionState = String(options.executionState || '').trim();
    const recoveryEvidence = String(options.recoveryEvidence || '').trim();
    if (failureKind || executionState || options.callId) {
      if (!stepId || acceptanceId || recoveryEvidence) {
        throw new Error('failure checkpoint requires a step only and cannot include recovery');
      }
      if (!['tool_error', 'policy_denied', 'unknown_result'].includes(failureKind)) {
        throw new Error('invalid failure kind');
      }
      if (!['not_started', 'started', 'unknown'].includes(executionState)) {
        throw new Error('invalid execution state');
      }
      const requiredStatus = executionState === 'not_started' ? 'blocked' : 'verify_required';
      if (requestedStatus !== requiredStatus) throw new Error('failure requires status=' + requiredStatus);
      if (failureKind === 'unknown_result' && executionState !== 'unknown') {
        throw new Error('unknown_result requires execution-state=unknown');
      }
      if (!evidence.length || !String(options.nextAction || '').trim()) {
        throw new Error('failure checkpoint requires evidence and next action');
      }
    }
    if (recoveryEvidence && (!stepId || !['running', 'done'].includes(requestedStatus))) {
      throw new Error('recovery evidence requires a running or done step');
    }
    if (!stepId && !acceptanceId) {
      throw new Error('checkpoint requires --step, --acceptance-id, or both');
    }
    if (acceptanceId) {
      if (requestedStatus !== 'done') throw new Error('acceptance checkpoints only support status=done');
      if (evidence.length === 0) throw new Error('done checkpoints require evidence');
      const criterion = state.acceptance_criteria.find((item) => item.id === acceptanceId);
      if (!criterion) throw new Error(`unknown acceptance criterion: ${acceptanceId}`);
      criterion.status = 'done';
      criterion.evidence = [...criterion.evidence, ...evidence];
      criterion.completed_at = timestamp;
    }
    if (stepId) {
      if (!STEP_STATUSES.has(requestedStatus) || requestedStatus === 'pending') {
        throw new Error(`invalid checkpoint status: ${requestedStatus || '(missing)'}`);
      }
      if (requestedStatus === 'done' && evidence.length === 0) {
        throw new Error('done checkpoints require evidence');
      }
      const step = state.steps.find((item) => item.id === stepId);
      if (!step) throw new Error(`unknown step: ${stepId}`);
      const failures = step.failures || [];
      const recoveries = step.recoveries || [];
      const failureIndex = failures.length - 1;
      const unresolvedFailure = failureIndex >= 0 &&
        !recoveries.some((item) => item.failure_index === failureIndex);
      if (unresolvedFailure && ['running', 'done'].includes(requestedStatus) && !recoveryEvidence) {
        throw new Error('structured failure requires recovery evidence before running or done');
      }
      if (recoveryEvidence) {
        if (!unresolvedFailure) throw new Error('no unresolved structured failure to recover');
        step.recoveries = [...recoveries, { failure_index: failureIndex, evidence: recoveryEvidence, at: timestamp }];
        step.evidence = [...step.evidence, recoveryEvidence];
      }
      if (failureKind) {
        step.failures = [...failures, {
          failure_kind: failureKind, execution_state: executionState,
          call_id: String(options.callId || '').trim() || null,
          evidence, next_action: String(options.nextAction).trim(), at: timestamp,
        }];
      }
      if (options.replay && !REPLAY_MODES.has(options.replay)) {
        throw new Error(`invalid replay mode: ${options.replay}`);
      }
      if (options.replay) step.replay = options.replay;
      step.status = requestedStatus;
      step.evidence = [...step.evidence, ...evidence];
      step.next_action = String(options.nextAction || step.next_action || step.title);
      if (requestedStatus === 'running') step.started_at = timestamp;
      if (requestedStatus === 'done') step.completed_at = timestamp;
      if (['blocked', 'verify_required'].includes(requestedStatus)) {
        state.last_error = {
          step_id: step.id,
          message: String(options.error || `${step.id} is ${requestedStatus}`),
          at: timestamp,
          ...(failureKind ? {
            failure_kind: failureKind, execution_state: executionState,
            call_id: String(options.callId || '').trim() || null,
          } : {}),
        };
      } else if (requestedStatus === 'done' && state.last_error && state.last_error.step_id === step.id) {
        state.last_error = null;
      }
    }

    if (options.projectRoot && isSamePath(options.projectRoot, state.project_root)) {
      if (options.worktree) state.worktree = path.resolve(options.worktree);
      if (options.branch) state.branch = String(options.branch);
    }
    const current = firstIncompleteStep(state);
    state.current_step = current ? current.id : '';
    state.next_action = String(options.nextAction || (current && (current.next_action || current.title)) || 'Run finish gate');
    state.status = deriveTaskStatus(state);
    state.updated_at = timestamp;
    return writeAtomicState({ runsRoot: options.runsRoot, taskId, state });
  });
}

function listTaskStates({ runsRoot }) {
  if (!fs.existsSync(runsRoot)) return [];
  const rootStat = fs.lstatSync(runsRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`task runs root must be a real directory: ${runsRoot}`);
  }
  const states = [];
  for (const entry of fs.readdirSync(runsRoot, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`invalid task state path: ${entry.name}`);
    if (!entry.isDirectory()) continue;
    states.push(readTaskState({ runsRoot, taskId: entry.name }));
  }
  return states;
}

function selectTaskState(states, context) {
  const projectMatches = states.filter((state) => (
    isSamePath(state.project_root, context.projectRoot)
    && !['completed'].includes(state.status)
  ));
  const exactMatches = projectMatches.filter((state) => (
    (state.worktree && context.worktree && isSamePath(state.worktree, context.worktree))
    || (state.branch && context.branch && state.branch === context.branch)
  ));
  const candidates = exactMatches.length > 0 ? exactMatches : projectMatches;
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    const ids = candidates.map((state) => state.task_id).sort().join(',');
    const error = new Error(`ambiguous active tasks: ${ids}`);
    error.candidates = candidates.map((state) => state.task_id).sort();
    throw error;
  }
  return candidates[0];
}

function resumeTask(options) {
  let selected;
  if (options.taskId) {
    selected = readTaskState({ runsRoot: options.runsRoot, taskId: options.taskId });
  } else {
    selected = selectTaskState(listTaskStates({ runsRoot: options.runsRoot }), {
      projectRoot: options.projectRoot,
      worktree: options.worktree,
      branch: options.branch,
    });
    if (!selected) return null;
  }
  const taskId = selected.task_id;
  return withTaskLock({ lockDir: options.lockDir, taskId }, () => {
    const state = readTaskState({ runsRoot: options.runsRoot, taskId });
    if (state.status === 'cleanup_pending') return state;
    const interrupted = state.steps.filter((step) => step.status === 'running');
    if (interrupted.length === 0) return state;
    const timestamp = nowIso(options.now);
    let verifyRequired = false;
    for (const step of interrupted) {
      if (step.replay === 'safe') {
        step.status = 'pending';
      } else {
        step.status = 'verify_required';
        verifyRequired = true;
      }
    }
    const current = firstIncompleteStep(state);
    state.current_step = current ? current.id : '';
    state.status = verifyRequired ? 'blocked' : deriveTaskStatus(state);
    state.last_error = {
      step_id: interrupted[0].id,
      message: 'interrupted running step detected during resume',
      at: timestamp,
    };
    state.next_action = verifyRequired
      ? `Verify external result before replaying ${current.id}: ${current.title}`
      : String((current && (current.next_action || current.title)) || 'Run finish gate');
    state.updated_at = timestamp;
    return writeAtomicState({ runsRoot: options.runsRoot, taskId, state });
  });
}

function runMutationCompletionGuard(state, dependencies = {}) {
  if (!state.task_id) {
    return { ok: false, output: 'STATUS=BLOCKED\nREASON=mutation completion guard requires task_id' };
  }
  const spawn = dependencies.spawnSync || spawnSync;
  const result = spawn(process.execPath, [
    'infra/scripts/tdd-tools/tdd-completion-guard.js',
    '--task',
    state.task_id,
  ], {
    cwd: state.project_root,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return { ok: result.status === 0 && /(?:^|\n)STATUS=OK(?:\n|$)/u.test(output), output };
}

function completionBlockers(state) {
  const blockers = [];
  for (const step of state.steps) {
    if (step.status !== 'done') blockers.push(step.id);
    else if (!step.evidence.length) blockers.push(`${step.id}:evidence`);
  }
  for (const criterion of state.acceptance_criteria) {
    if (criterion.status !== 'done') blockers.push(criterion.id);
    else if (!criterion.evidence.length) blockers.push(`${criterion.id}:evidence`);
  }
  return blockers;
}

function removeOwnedTask({ runsRoot, taskId, removeTree = safeRemoveTreeNoFollow }) {
  const { id, taskDir } = taskPaths(runsRoot, taskId, { createRoot: false });
  const state = readTaskState({ runsRoot, taskId: id });
  if (state.task_id !== id) throw new Error(`task ownership mismatch: ${id}`);
  removeTree(taskDir, { allowedRoot: runsRoot });
  if (fs.existsSync(taskDir)) throw new Error(`task directory still exists after removal: ${id}`);
}

function finishTask(options) {
  const taskId = safeTaskId(options.taskId);
  return withTaskLock({ lockDir: options.lockDir, taskId }, () => {
    let state = readTaskState({ runsRoot: options.runsRoot, taskId });
    if (!['completed', 'cleanup_pending'].includes(state.status)) {
      const blockers = completionBlockers(state);
      if (blockers.length > 0) {
        return {
          status: 'BLOCKED',
          taskId,
          blockers,
          nextAction: `Complete and verify: ${blockers.join(', ')}`,
        };
      }
      if (state.task_type === 'mutation') {
        const guard = (options.completionGuard || runMutationCompletionGuard)(state);
        if (!guard.ok) {
          return {
            status: 'BLOCKED',
            taskId,
            guardOutput: guard.output,
            nextAction: 'Run the repository completion guard NEXT_COMMANDS, then retry finish.',
          };
        }
      }
      state.status = 'completed';
      state.current_step = '';
      state.next_action = 'Delete completed task state';
      state.completed_at = nowIso(options.now);
      state.updated_at = state.completed_at;
      writeAtomicState({ runsRoot: options.runsRoot, taskId, state });
    }

    const summary = {
      taskId,
      goal: state.goal,
      stepCount: state.steps.length,
      acceptanceCount: state.acceptance_criteria.length,
    };
    try {
      removeOwnedTask({
        runsRoot: options.runsRoot,
        taskId,
        removeTree: options.removeTree || safeRemoveTreeNoFollow,
      });
      return { status: 'OK', ...summary };
    } catch (error) {
      state.status = 'cleanup_pending';
      state.next_action = 'Retry finish to remove completed task state';
      state.last_error = { message: error.message, at: nowIso(options.now) };
      state.updated_at = nowIso(options.now);
      writeAtomicState({ runsRoot: options.runsRoot, taskId, state });
      return { status: 'BLOCKED', ...summary, nextAction: state.next_action, reason: error.message };
    }
  });
}

function cancelTask(options) {
  const taskId = safeTaskId(options.taskId);
  if (!options.force) throw new Error('cancel requires --force');
  return withTaskLock({ lockDir: options.lockDir, taskId }, () => {
    removeOwnedTask({
      runsRoot: options.runsRoot,
      taskId,
      removeTree: options.removeTree || safeRemoveTreeNoFollow,
    });
    return { status: 'CANCELLED', taskId };
  });
}

function boundedInteger(value, fallback, { name, min, max }) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function clipText(value, maxChars = 600) {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function clipSummary(value, maxBytes, maxLines) {
  const text = String(value || '').replace(/\r/gu, '').replace(/\s+$/u, '');
  const selected = text.split('\n').slice(-maxLines).join('\n');
  const bytes = Buffer.from(selected, 'utf8');
  if (bytes.length <= maxBytes) return selected;
  return bytes.subarray(bytes.length - maxBytes).toString('utf8');
}

function readBoundedLineRange(filePath, { startLine = 1, endLine = null, maxBytes }) {
  const descriptor = fs.openSync(filePath, 'r');
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.allocUnsafe(16384);
  const selected = [];
  let pending = '';
  let currentLine = 1;
  let usedBytes = 0;
  let done = false;

  const consumeLine = (line) => {
    if (currentLine > (endLine || currentLine)) return false;
    if (currentLine >= startLine) {
      const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
      const lineBytes = Buffer.byteLength(normalized, 'utf8') + (selected.length > 0 ? 1 : 0);
      if (usedBytes + lineBytes > maxBytes) return false;
      selected.push(normalized);
      usedBytes += lineBytes;
    }
    currentLine += 1;
    return true;
  };

  try {
    while (!done) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        pending += decoder.end();
        if (pending) done = !consumeLine(pending);
        break;
      }
      pending += decoder.write(buffer.subarray(0, bytesRead));
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        if (!consumeLine(line)) {
          done = true;
          break;
        }
      }
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return selected.join('\n');
}

function parseContextInclude(spec) {
  const value = String(spec || '').trim();
  const match = value.match(/^(.*?)(?:#L(\d+)(?:-L?(\d+))?)?$/u);
  if (!match || !match[1]) throw new Error(`invalid context include: ${value}`);
  const startLine = match[2] ? Number(match[2]) : 1;
  const endLine = match[3] ? Number(match[3]) : null;
  if (startLine < 1 || (endLine !== null && endLine < startLine)) {
    throw new Error(`invalid context line range: ${value}`);
  }
  return { path: match[1], startLine, endLine };
}

function buildTaskContext(options) {
  const taskId = safeTaskId(options.taskId);
  const maxBytes = boundedInteger(options.maxBytes, DEFAULT_CONTEXT_BYTES, {
    name: '--max-bytes', min: 512, max: 65536,
  });
  const state = readTaskState({ runsRoot: options.runsRoot, taskId });
  const statePath = path.join(options.runsRoot, taskId, 'state.json');
  const baseRoot = state.worktree && path.isAbsolute(state.worktree) ? state.worktree : state.project_root;
  const includes = normalizeTextList(options.includes);
  const lines = [];
  let truncated = false;
  const append = (line, maxChars = 1200) => {
    const normalized = clipText(line, maxChars);
    const candidate = [...lines, normalized].join('\n');
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes - 64) {
      truncated = true;
      return false;
    }
    lines.push(normalized);
    return true;
  };

  append('STATUS=OK');
  append('SIDE_EFFECTS=NONE');
  append(`TASK_ID=${state.task_id}`);
  // Keep recovery routing before optional evidence, including in a 512-byte capsule.
  for (const line of continuationFields(state)) append(line);
  append(`TASK_STATUS=${state.status}`);
  append(`CURRENT_PHASE=${state.current_phase}`);
  append(`PLAN_REVISION=${state.plan_revision}`);
  append(`WORKTREE=${state.worktree}`);
  append(`BRANCH=${state.branch}`);
  append(`CURRENT_STEP=${state.current_step}`);
  append(`NEXT_ACTION=${state.next_action}`, 900);
  append(`CONTEXT_BUDGET_BYTES=${maxBytes}`);
  append(`STATE_PATH=${statePath}`);
  append(`HANDOFF_PROMPT=In WORKTREE run pnpm agent -- task resume --task ${state.task_id}, then task context --task ${state.task_id}. Follow CONTINUATION_ACTION; continue authorized work without repeated confirmation. A new executor must acknowledge takeover before the current one stops.`);
  append('CAPSULE_BEGIN');

  for (const include of includes) {
    const parsed = parseContextInclude(include);
    if (path.isAbsolute(parsed.path)) throw new Error(`context include must be repo-relative: ${include}`);
    const resolved = path.resolve(baseRoot, parsed.path);
    if (!isPathInside(baseRoot, resolved)) {
      throw new Error(`context include must stay inside the task worktree: ${include}`);
    }
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`context include must be a real file: ${include}`);
    }
    const excerpt = readBoundedLineRange(resolved, {
      startLine: parsed.startLine,
      endLine: parsed.endLine,
      maxBytes: Math.max(256, Math.min(2048, Math.floor(maxBytes / 4))),
    });
    append(`## Included: ${parsed.path}#L${parsed.startLine}${parsed.endLine ? `-L${parsed.endLine}` : ''}`, 300);
    for (const line of excerpt.split('\n')) {
      if (!append(`  ${line}`, 400)) break;
    }
  }

  append('## Goal', 80);
  append(`  ${state.goal}`, 800);
  append('## Acceptance', 80);
  for (const criterion of state.acceptance_criteria) {
    if (!append(`  [${criterion.status === 'done' ? 'x' : ' '}] ${criterion.id}: ${criterion.text}`, 320)) break;
  }
  const recentEvidence = [];
  for (const step of state.steps) {
    for (const evidence of step.evidence || []) {
      recentEvidence.push(`${step.id}: ${clipText(evidence, 260)}`);
    }
  }
  for (const criterion of state.acceptance_criteria) {
    for (const evidence of criterion.evidence || []) {
      recentEvidence.push(`${criterion.id}: ${clipText(evidence, 260)}`);
    }
  }
  if (recentEvidence.length > 0) {
    append('## Recent Evidence', 80);
    for (const evidence of recentEvidence.slice(-8)) {
      if (!append(`  - ${evidence}`, 360)) break;
    }
  }
  const blockers = state.steps
    .filter((step) => ['blocked', 'verify_required', 'running'].includes(step.status))
    .map((step) => `${step.id}:${step.status}:${clipText(step.next_action, 180)}`);
  if (blockers.length > 0) {
    append('## Blockers', 80);
    append(`  ${blockers.join(' | ')}`, 900);
  }
  append('CAPSULE_END');
  if (truncated && Buffer.byteLength([...lines, 'TRUNCATED=true'].join('\n'), 'utf8') <= maxBytes) {
    lines.splice(lines.indexOf('CAPSULE_END'), 0, 'TRUNCATED=true');
  }
  const output = lines.join('\n');
  if (Buffer.byteLength(output, 'utf8') > maxBytes) {
    throw new Error('task context exceeded the requested byte budget');
  }
  return output;
}

function continuationFields(state) {
  const steps = state.steps || [];
  const unresolved = steps.filter(step => ['blocked', 'verify_required'].includes(step.status));
  // A recorded, verified-independent cleanup deferral permits QA, not task completion.
  const entry = (state.phase_history || []).at(-1);
  const deferred = entry?.phase === state.current_phase && ['qa', 'devops'].includes(state.current_phase)
    ? entry.deferred_cleanup : null;
  const isDeferredCleanup = step => deferred?.step_id === step.id
    && step.status === 'blocked'
    && step.failures?.[deferred.failure_index]?.execution_state === 'not_started';
  const blocking = unresolved.some(step => !isDeferredCleanup(step));
  let action = 'CONTINUE_CURRENT_TASK';
  if (state.status === 'completed') action = 'TASK_COMPLETE';
  else if (state.status === 'cleanup_pending') action = 'RESOLVE_BLOCKER';
  else if (blocking || (state.status === 'blocked' && !unresolved.length)) action = 'RESOLVE_BLOCKER';
  else if (steps.length && steps.every(step => step.status === 'done')
    && (state.acceptance_criteria || []).every(item => item.status === 'done')) action = 'RUN_COMPLETION_GUARD';
  return [
    `RESUME_COMMAND=pnpm agent -- task resume --task ${safeTaskId(state.task_id)}`,
    `AUTO_CONTINUE=${['CONTINUE_CURRENT_TASK', 'RUN_COMPLETION_GUARD'].includes(action)}`,
    `CONTINUATION_ACTION=${action}`,
  ];
}

function formatTransitionOutput(state) {
  return [
    'STATUS=TRANSITIONED',
    `TASK_ID=${state.task_id}`,
    `CURRENT_PHASE=${state.current_phase}`,
    `NEXT_ACTION=${state.next_action}`,
    ...continuationFields(state),
    'CONTEXT_REFRESH_REQUIRED=true',
    // Refresh the capsule at every boundary; a phase change alone does not require a new executor.
    'CONTEXT_HANDOFF_REQUIRED=false',
    `CONTEXT_COMMAND=pnpm agent -- task context --task ${state.task_id}`,
    `WORKTREE=${state.worktree || state.project_root || ''}`,
    `ACTIVATE_ROLE=${state.current_phase.toUpperCase()}`,
    'CONTINUATION_PROMPT=Refresh context, activate the current phase and execute the next authorized step in the current task. If a fresh executor is needed, wait for its takeover acknowledgement; otherwise continue inline within the context budget. Preserve blockers and completion gates.',
  ].join('\n');
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '');
}

function readFileTail(filePath, maxBytes) {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(descriptor);
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    if (length === 0) return '';
    fs.readSync(descriptor, buffer, 0, length, stat.size - length);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function hashFile(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(65536);
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function executeTaskCommand(options) {
  const taskId = safeTaskId(options.taskId);
  const name = String(options.name || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(name)) {
    throw new Error('exec name must use 1-80 lowercase letters, numbers, dots, underscores, or hyphens');
  }
  const command = Array.isArray(options.command) ? options.command.map((part) => String(part)) : [];
  if (command.length === 0 || !command[0]) throw new Error('exec requires a command after --');
  const maxSummaryBytes = boundedInteger(options.maxSummaryBytes, DEFAULT_SUMMARY_BYTES, {
    name: '--max-summary-bytes', min: 256, max: 65536,
  });
  const maxSummaryLines = boundedInteger(options.maxSummaryLines, DEFAULT_SUMMARY_LINES, {
    name: '--max-summary-lines', min: 1, max: 400,
  });
  const state = readTaskState({ runsRoot: options.runsRoot, taskId });
  const taskDir = path.join(options.runsRoot, taskId);
  const evidenceDir = path.join(taskDir, 'evidence');
  ensureRealDirectory(evidenceDir);
  if (!isPathInside(taskDir, evidenceDir)) throw new Error('task evidence path escapes the task directory');
  const logPath = path.join(evidenceDir, `${name}.log`);
  if (fs.existsSync(logPath)) throw new Error(`task exec log already exists: ${logPath}`);
  const cwd = path.resolve(state.worktree || state.project_root);
  const cwdStat = fs.lstatSync(cwd);
  if (cwdStat.isSymbolicLink() || !cwdStat.isDirectory()) throw new Error(`exec cwd must be a real directory: ${cwd}`);

  const descriptor = fs.openSync(logPath, 'wx', 0o600);
  const startedAt = Date.now();
  let result;
  try {
    result = spawnSync(command[0], command.slice(1), {
      cwd,
      env: process.env,
      shell: false,
      stdio: ['ignore', descriptor, descriptor],
      windowsHide: true,
    });
  } finally {
    fs.closeSync(descriptor);
  }
  const durationMs = Date.now() - startedAt;
  const exitCode = result.error ? 127 : (typeof result.status === 'number' ? result.status : 1);
  const rawTail = readFileTail(logPath, Math.max(65536, maxSummaryBytes * 8));
  const summary = clipSummary(stripAnsi(rawTail), maxSummaryBytes, maxSummaryLines);
  return {
    status: exitCode === 0 && !result.error ? 'OK' : 'FAILED',
    taskId,
    name,
    exitCode,
    durationMs,
    logPath,
    logBytes: fs.statSync(logPath).size,
    logSha256: hashFile(logPath),
    summary,
    spawnError: result.error ? result.error.message : '',
  };
}

function parseCliArgs(argv) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const options = {
    command: normalizedArgv[0] || '',
    steps: [],
    acceptanceCriteria: [],
    constraints: [],
    evidence: [],
    includes: [],
    execCommand: [],
    auto: false,
    force: false,
  };
  const valueKeys = new Map([
    ['task', 'taskId'], ['desc', 'goal'], ['type', 'taskType'], ['status', 'status'],
    ['step-id', 'stepId'], ['acceptance-id', 'acceptanceId'], ['acceptance', 'acceptance'],
    ['constraint', 'constraint'], ['evidence', 'evidenceItem'], ['next', 'nextAction'],
    ['error', 'error'], ['replay', 'replay'], ['phase', 'phase'], ['reason', 'reason'],
    ['failure-kind', 'failureKind'], ['execution-state', 'executionState'],
    ['call-id', 'callId'], ['recovery-evidence', 'recoveryEvidence'],
    ['defer-cleanup-step', 'deferCleanupStep'], ['cleanup-evidence', 'cleanupEvidence'],
    ['name', 'name'], ['max-bytes', 'maxBytes'], ['max-summary-bytes', 'maxSummaryBytes'],
    ['max-summary-lines', 'maxSummaryLines'],
  ]);
  for (let index = 1; index < normalizedArgv.length; index += 1) {
    const arg = normalizedArgv[index];
    if (arg === '--auto') options.auto = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--') {
      if (options.command !== 'exec') throw new Error('-- command separator is only valid for exec');
      options.execCommand = normalizedArgv.slice(index + 1);
      break;
    } else if (arg === '--include') {
      const value = normalizedArgv[++index];
      if (!value) throw new Error('--include requires a value');
      options.includes.push(value);
    }
    else if (arg === '--step' && options.command === 'checkpoint') {
      const value = normalizedArgv[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      options.stepId = value;
    } else if (arg === '--step' || arg === '--verify-step' || arg === '--add-step' || arg === '--add-verify-step') {
      const value = normalizedArgv[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      options.steps.push({
        title: value,
        replay: ['--verify-step', '--add-verify-step'].includes(arg) ? 'verify_first' : 'safe',
      });
    } else if (arg === '--add-acceptance') {
      const value = normalizedArgv[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      options.acceptanceCriteria.push(value);
    } else if (arg.startsWith('--') && arg.includes('=')) {
      const [rawKey, ...parts] = arg.slice(2).split('=');
      if (['step', 'verify-step', 'add-step', 'add-verify-step'].includes(rawKey)) {
        const value = parts.join('=');
        if (!value) throw new Error(`--${rawKey} requires a value`);
        if (rawKey === 'step' && options.command === 'checkpoint') options.stepId = value;
        else options.steps.push({
          title: value,
          replay: ['verify-step', 'add-verify-step'].includes(rawKey) ? 'verify_first' : 'safe',
        });
        continue;
      }
      if (rawKey === 'add-acceptance') {
        const value = parts.join('=');
        if (!value) throw new Error('--add-acceptance requires a value');
        options.acceptanceCriteria.push(value);
        continue;
      }
      if (rawKey === 'include') {
        const value = parts.join('=');
        if (!value) throw new Error('--include requires a value');
        options.includes.push(value);
        continue;
      }
      const key = valueKeys.get(rawKey);
      if (!key) throw new Error(`unknown option: --${rawKey}`);
      const value = parts.join('=');
      if (key === 'acceptance') options.acceptanceCriteria.push(value);
      else if (key === 'constraint') options.constraints.push(value);
      else if (key === 'evidenceItem') options.evidence.push(value);
      else options[key] = value;
    } else if (arg.startsWith('--')) {
      const rawKey = arg.slice(2);
      const key = valueKeys.get(rawKey);
      if (!key) throw new Error(`unknown option: ${arg}`);
      const value = normalizedArgv[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      if (key === 'acceptance') options.acceptanceCriteria.push(value);
      else if (key === 'constraint') options.constraints.push(value);
      else if (key === 'evidenceItem') options.evidence.push(value);
      else options[key] = value;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return options;
}

function runtimeContext(cwd = process.cwd()) {
  const mainRoot = getMainRepoRoot(cwd);
  const worktree = getWorktreeRoot(cwd);
  const config = loadConfig({ repoRoot: worktree });
  const tmpRoot = resolveContainerPath(config, mainRoot, 'tmp');
  const lockDir = resolveRuntimePath(config, mainRoot, config.worktree && config.worktree.lockDir, 'agent-locks');
  return {
    runsRoot: path.join(tmpRoot, 'agent-task-runs'),
    lockDir,
    projectRoot: mainRoot,
    worktree,
    branch: getCurrentBranch(worktree),
  };
}

function printHelp() {
  console.log(`Usage:
  node infra/scripts/agent-runner/agent-task.js paths [--task <id>] (read-only; does not evaluate permissions)
  node infra/scripts/agent-runner/agent-task.js context --task <id> [--max-bytes <bytes>] [--include <path#Lx-Ly>]...
  node infra/scripts/agent-runner/agent-task.js start --task <id> --desc <goal> [--phase <phase>] [--type <type>] [--acceptance <criterion>] --step <safe-step> [--verify-step <effect-step>]
  node infra/scripts/agent-runner/agent-task.js checkpoint --task <id> [--step <S1>] [--acceptance-id <AC1>] --status <status> [--evidence <text>] [--next <action>]
    Failure: --failure-kind <tool_error|policy_denied|unknown_result> --execution-state <not_started|started|unknown> [--call-id <id>]
    Recovery: --recovery-evidence <verified external outcome or restored authorization>
  node infra/scripts/agent-runner/agent-task.js exec --task <id> --name <evidence-name> -- <command...>
  node infra/scripts/agent-runner/agent-task.js resume [--task <id>|--auto]
  node infra/scripts/agent-runner/agent-task.js extend --task <id> --reason <why> [--add-step <safe-step>] [--add-verify-step <effect-step>] [--add-acceptance <criterion>]
  node infra/scripts/agent-runner/agent-task.js transition --task <id> --phase <phase> --evidence <milestone>
    Independent cleanup only: --defer-cleanup-step <S1> --cleanup-evidence <why QA is independent and retained files are protected>
  node infra/scripts/agent-runner/agent-task.js finish --task <id>
  node infra/scripts/agent-runner/agent-task.js cancel --task <id> --force

Repeat step, acceptance, constraint, and evidence options as needed.
Mutation tasks require at least one explicit --acceptance; diagnose, research, and operation tasks may use the goal by default.
Provide --step, --acceptance-id, or both. A done step and acceptance can share one evidence checkpoint.
Safe steps may be retried after interruption. Verify steps must be checked before replay.
New tasks default to type=mutation; use diagnose, research, or operation only for work without tracked-file changes.
diagnose, research, and operation are work classification types, not filesystem permission modes.
start, checkpoint, and resume can write task state and locks even for those types.
Single-session read-only investigations do not require start or resume; use paths only when recording locations need clarification.`);
}

function printResumeState(state, statePath) {
  console.log('STATUS=RESUMED');
  console.log(`TASK_ID=${state.task_id}`);
  console.log(`TASK_STATUS=${state.status}`);
  console.log(`CURRENT_PHASE=${state.current_phase}`);
  for (const line of continuationFields(state)) console.log(line);
  console.log(`PLAN_REVISION=${state.plan_revision}`);
  console.log(`STATE_PATH=${statePath}`);
  console.log(`GOAL=${state.goal}`);
  console.log(`CONSTRAINTS=${state.constraints.join(' | ')}`);
  console.log(`COMPLETED_STEPS=${state.steps.filter((step) => step.status === 'done').map((step) => step.id).join(',')}`);
  console.log(`CURRENT_STEP=${state.current_step}`);
  if (state.last_error) console.log(`LAST_ERROR=${state.last_error.message}`);
  console.log(`NEXT_ACTION=${state.next_action}`);
}

function main(argv = process.argv.slice(2)) {
  const cli = parseCliArgs(argv);
  if (cli.help || !cli.command) {
    printHelp();
    return 0;
  }
  const context = runtimeContext();
  if (cli.command === 'context') {
    if (!cli.taskId) throw new Error('context requires --task <id>');
    console.log(buildTaskContext({ ...context, ...cli }));
    return 0;
  }
  if (cli.command === 'exec') {
    if (!cli.taskId) throw new Error('exec requires --task <id>');
    const result = executeTaskCommand({ ...context, ...cli, command: cli.execCommand });
    console.log(`STATUS=${result.status}`);
    console.log(`TASK_ID=${result.taskId}`);
    console.log(`NAME=${result.name}`);
    console.log(`EXIT_CODE=${result.exitCode}`);
    console.log(`DURATION_MS=${result.durationMs}`);
    console.log(`LOG_PATH=${result.logPath}`);
    console.log(`LOG_BYTES=${result.logBytes}`);
    console.log(`LOG_SHA256=${result.logSha256}`);
    if (result.spawnError) console.log(`SPAWN_ERROR=${result.spawnError}`);
    console.log('SUMMARY_BEGIN');
    if (result.summary) console.log(result.summary);
    console.log('SUMMARY_END');
    return result.exitCode;
  }
  if (cli.command === 'paths') {
    // Resolve only: even checking a task through taskPaths() can create its root.
    const statePath = cli.taskId === undefined ? null
      : path.join(context.runsRoot, safeTaskId(cli.taskId), 'state.json');
    console.log('STATUS=OK');
    console.log('SUMMARY=Task recording paths resolved without writes; permissions not evaluated.');
    console.log('SIDE_EFFECTS=NONE');
    console.log(`PROJECT_ROOT=${context.projectRoot}`);
    console.log(`TASK_RUNS_ROOT=${context.runsRoot}`);
    console.log(`TASK_LOCK_ROOT=${context.lockDir}`);
    if (statePath) console.log(`STATE_PATH=${statePath}`);
    console.log('PERMISSION_STATUS=NOT_EVALUATED');
    console.log('NEXT_ACTION=Compare these paths with the active writable roots before authorized task recording; this report grants no permission.');
    return 0;
  }
  if (cli.command === 'start') {
    const state = createTask({ ...context, ...cli });
    console.log('STATUS=STARTED');
    console.log(`TASK_ID=${state.task_id}`);
    console.log(`STATE_PATH=${path.join(context.runsRoot, state.task_id, 'state.json')}`);
    console.log(`CURRENT_PHASE=${state.current_phase}`);
    console.log(`PLAN_REVISION=${state.plan_revision}`);
    console.log(`CURRENT_STEP=${state.current_step}`);
    console.log(`NEXT_ACTION=${state.next_action}`);
    return 0;
  }
  if (cli.command === 'checkpoint') {
    const state = checkpointTask({ ...context, ...cli });
    console.log('STATUS=CHECKPOINTED');
    console.log(`TASK_ID=${state.task_id}`);
    console.log(`TASK_STATUS=${state.status}`);
    console.log(`CURRENT_STEP=${state.current_step}`);
    console.log(`NEXT_ACTION=${state.next_action}`);
    return 0;
  }
  if (cli.command === 'extend') {
    if (!cli.taskId) throw new Error('extend requires --task <id>');
    const state = extendTask({ ...context, ...cli });
    console.log('STATUS=EXTENDED');
    console.log(`TASK_ID=${state.task_id}`);
    console.log(`PLAN_REVISION=${state.plan_revision}`);
    console.log(`CURRENT_STEP=${state.current_step}`);
    console.log(`NEXT_ACTION=${state.next_action}`);
    return 0;
  }
  if (cli.command === 'transition') {
    if (!cli.taskId) throw new Error('transition requires --task <id>');
    if (!cli.phase) throw new Error('transition requires --phase <phase>');
    const state = transitionTaskPhase({ ...context, ...cli });
    console.log(formatTransitionOutput(state));
    return 0;
  }
  if (cli.command === 'resume') {
    if (!cli.taskId && !cli.auto) throw new Error('resume requires --task <id> or --auto');
    const audit = require('../worktree-tools/worktree-audit').auditManagedWorktrees({
      mainRoot: context.projectRoot,
      cwd: context.worktree,
      apply: true,
      excludeBranch: context.branch,
      skipWorktreePath: context.worktree,
    });
    const state = resumeTask({ ...context, taskId: cli.taskId });
    if (!state) {
      console.log('STATUS=NONE');
      return 0;
    }
    printResumeState(state, path.join(context.runsRoot, state.task_id, 'state.json'));
    console.log(`WORKTREE_AUDIT_STATUS=${audit.status}`);
    const cleaned = audit.records.filter((record) => record.state === 'cleaned');
    if (cleaned.length > 0) console.log(`AUDIT_CLEANED=${cleaned.map((record) => record.branch).join(',')}`);
    const recovery = audit.records.filter((record) => record.state === 'recovery_required');
    if (recovery.length > 0) console.log(`AUDIT_RECOVERY_REQUIRED=${recovery.map((record) => record.branch).join(',')}`);
    return 0;
  }
  if (cli.command === 'finish') {
    if (!cli.taskId) throw new Error('finish requires --task <id>');
    const result = finishTask({ ...context, taskId: cli.taskId });
    console.log(`STATUS=${result.status}`);
    console.log(`TASK_ID=${result.taskId}`);
    if (result.blockers) console.log(`BLOCKERS=${result.blockers.join(',')}`);
    if (result.guardOutput) console.log(`GUARD_OUTPUT=${result.guardOutput.replace(/\s+/gu, ' ').trim()}`);
    if (result.reason) console.log(`REASON=${result.reason}`);
    if (result.nextAction) console.log(`NEXT_ACTION=${result.nextAction}`);
    return result.status === 'OK' ? 0 : 1;
  }
  if (cli.command === 'cancel') {
    if (!cli.taskId) throw new Error('cancel requires --task <id>');
    const result = cancelTask({ ...context, taskId: cli.taskId, force: cli.force });
    console.log(`STATUS=${result.status}`);
    console.log(`TASK_ID=${result.taskId}`);
    return 0;
  }
  throw new Error(`unknown command: ${cli.command}`);
}

module.exports = {
  SCHEMA_VERSION,
  TASK_TYPES,
  TASK_PHASES,
  buildTaskContext,
  bindTaskLocation,
  cancelTask,
  checkpointTask,
  completionBlockers,
  createTask,
  executeTaskCommand,
  extendTask,
  finishTask,
  formatTransitionOutput,
  listTaskStates,
  parseCliArgs,
  readTaskState,
  runMutationCompletionGuard,
  resumeTask,
  runtimeContext,
  safeTaskId,
  selectTaskState,
  transitionTaskPhase,
  validateState,
  writeAtomicState,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error('STATUS=BLOCKED');
    if (error.candidates) console.error(`CANDIDATES=${error.candidates.join(',')}`);
    console.error(`REASON=${error.message}`);
    process.exitCode = 1;
  }
}

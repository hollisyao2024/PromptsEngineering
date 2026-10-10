#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const { loadConfig, resolveRepoRoot } = require('../shared/config');
const { getMainRepoRoot, readSessions } = require('../worktree-tools/worktree-core');
const {
  auditManagedWorktrees,
  normalizeTaskId,
  sessionTaskIds,
} = require('../worktree-tools/worktree-audit');

const MAIN_BRANCHES = new Set(['main', 'master', 'develop']);

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.error) throw result.error;

  if (result.status !== 0 && !options.allowFailure) {
    const stderr = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function splitStatusLines(statusOutput) {
  return String(statusOutput || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function buildCommands(kind) {
  if (kind === 'dirty') {
    return [
      'node infra/scripts/tdd-tools/tdd-sync.js',
      'node infra/scripts/tdd-tools/tdd-push.js',
      'node infra/scripts/qa-tools/generate-qa.js',
      'node infra/scripts/qa-tools/qa-verify.js',
      'node infra/scripts/qa-tools/qa-merge.js',
    ];
  }
  if (kind === 'unpushed') {
    return [
      'node infra/scripts/tdd-tools/tdd-push.js',
      'node infra/scripts/qa-tools/generate-qa.js',
      'node infra/scripts/qa-tools/qa-verify.js',
      'node infra/scripts/qa-tools/qa-merge.js',
    ];
  }
  if (kind === 'unmerged') {
    return [
      'node infra/scripts/qa-tools/generate-qa.js',
      'node infra/scripts/qa-tools/qa-verify.js',
      'node infra/scripts/qa-tools/qa-merge.js',
    ];
  }
  return [];
}

function block(reason, kind, meta = {}) {
  return {
    ok: false,
    status: 'BLOCKED',
    reason,
    nextCommands: buildCommands(kind),
    ...meta,
  };
}

const LIFECYCLE_BLOCKING_STATES = ['cleanup_pending', 'recovery_required'];

// The audit classifies head-drift only after proving the worktree is clean, has no
// commits outside the base branch and is not used by a live process or active task.
const SAFE_TO_REMOVE_REASONS = new Set(['head-drift']);

function describeLifecycleBlocker(session) {
  const branch = String(session.branch || '');
  const worktree = String(session.worktree || '');
  const auditReason = String(session.auditReason || '');
  const reason = auditReason || String(session.audit?.reason || '') || 'unknown';
  if (session.status === 'cleanup_pending') {
    return {
      branch,
      status: session.status,
      reason,
      verdict: 'RETRY_CLEANUP',
      worktree,
      nextCommands: ['pnpm agent -- worktree audit --apply'],
    };
  }
  if (SAFE_TO_REMOVE_REASONS.has(auditReason) && branch) {
    return {
      branch,
      status: session.status,
      reason,
      verdict: 'SAFE_TO_REMOVE',
      worktree,
      nextCommands: [`pnpm agent -- worktree remove ${branch}`],
    };
  }
  return {
    branch,
    status: session.status,
    reason,
    verdict: 'REVIEW_REQUIRED',
    worktree,
    nextCommands: [
      `git -C "${worktree}" status --short --branch`,
      `pnpm agent -- worktree resume ${branch || '<branch>'} --recover-as <new-branch>`,
    ],
  };
}

function lifecycleSessionsForTask(sessions, taskId) {
  const lifecycleSessions = Array.isArray(sessions) ? sessions : [];
  const normalizedTaskId = normalizeTaskId(taskId);
  if (!normalizedTaskId) return lifecycleSessions;
  return lifecycleSessions.filter((session) => sessionTaskIds(session).includes(normalizedTaskId));
}

function evaluateCompletionGuard(input) {
  const branch = String(input.branch || '').trim();
  const statusLines = Array.isArray(input.statusLines) ? input.statusLines : [];
  const dirty = statusLines.length > 0;
  const lifecycleSessions = lifecycleSessionsForTask(input.lifecycleSessions, input.taskId);
  const lifecycleBlockers = lifecycleSessions.filter((session) =>
    LIFECYCLE_BLOCKING_STATES.includes(session.status));

  if (!branch) {
    return block('当前不在普通分支上，无法确认 TDD/QA 流水线是否完成。', 'unmerged', {
      branch,
      dirty,
    });
  }

  if (lifecycleBlockers.length > 0) {
    const states = [...new Set(lifecycleBlockers.map((session) => session.status))].join(', ');
    const blockers = lifecycleBlockers.map(describeLifecycleBlocker);
    return {
      ...block(`存在未收敛的 worktree 生命周期状态：${states}。`, 'cleanup', {
        branch,
        dirty,
        lifecycleBranches: lifecycleBlockers.map((session) => session.branch),
        lifecycleBlockers: blockers,
        nextAction: 'SAFE_TO_REMOVE 已确认干净且无独有提交，可直接清理；REVIEW_REQUIRED 先检查并用 --recover-as 保留需要的改动；RETRY_CLEANUP 重试清理补偿。',
      }),
      // NEXT_COMMANDS is auto-run by tdd-finish; lifecycle recovery needs a human decision.
      manualCommands: [...new Set(blockers.flatMap((blocker) => blocker.nextCommands))],
    };
  }

  if (MAIN_BRANCHES.has(branch)) {
    if (dirty) {
      return block('主分支存在未提交改动，不能收口。', 'dirty', {
        branch,
        dirty,
        changedFiles: statusLines.length,
      });
    }
    return {
      ok: true,
      status: 'OK',
      reason: '当前位于主分支且工作区干净。',
      branch,
      dirty,
    };
  }

  if (dirty) {
    return block('当前任务分支还有未提交改动，必须继续 TDD/QA 流水线。', 'dirty', {
      branch,
      dirty,
      changedFiles: statusLines.length,
    });
  }

  const pushedToRemote = input.hasUpstream
    ? Number(input.aheadOfUpstream || 0) === 0
    : Boolean(input.remoteHeadMatchesHead);

  if (!pushedToRemote) {
    return block('当前任务分支尚未完整推送到远端，必须先执行 /tdd push。', 'unpushed', {
      branch,
      dirty,
      hasUpstream: Boolean(input.hasUpstream),
      aheadOfUpstream: Number(input.aheadOfUpstream || 0),
      remoteHeadMatchesHead: Boolean(input.remoteHeadMatchesHead),
    });
  }

  if (!input.headMergedToBase) {
    return block('当前任务分支尚未合入主分支，必须继续 /qa plan -> /qa verify -> /qa merge。', 'unmerged', {
      branch,
      dirty,
      baseRef: input.baseRef || '',
    });
  }

  return {
    ok: true,
    status: 'OK',
    reason: '当前任务分支已推送且已合入主分支。',
    branch,
    dirty,
    baseRef: input.baseRef || '',
  };
}

function refExists(repoRoot, ref) {
  return runGit(['rev-parse', '--verify', ref], {
    cwd: repoRoot,
    allowFailure: true,
  }).status === 0;
}

function resolveBaseRef(repoRoot, config) {
  const baseBranch = (config && config.baseBranch) || 'main';
  const remoteRef = `origin/${baseBranch}`;
  if (refExists(repoRoot, remoteRef)) return remoteRef;
  if (refExists(repoRoot, baseBranch)) return baseBranch;
  return '';
}

function getRemoteHead(repoRoot, branch) {
  if (!branch) return '';
  const result = runGit(['ls-remote', '--heads', 'origin', branch], {
    cwd: repoRoot,
    allowFailure: true,
  });
  if (result.status !== 0) return '';
  const firstLine = result.stdout.split('\n').find(Boolean);
  return firstLine ? firstLine.split(/\s+/)[0] : '';
}

function collectGitState(repoRoot) {
  const branch = runGit(['branch', '--show-current'], { cwd: repoRoot }).stdout.trim();
  const head = runGit(['rev-parse', 'HEAD'], { cwd: repoRoot }).stdout.trim();
  const statusLines = splitStatusLines(
    runGit(['status', '--porcelain'], { cwd: repoRoot }).stdout
  );
  const upstream = runGit(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    { cwd: repoRoot, allowFailure: true }
  );
  const hasUpstream = upstream.status === 0 && upstream.stdout.trim().length > 0;
  let aheadOfUpstream = 0;

  if (hasUpstream) {
    const ahead = runGit(['rev-list', '--count', `${upstream.stdout.trim()}..HEAD`], {
      cwd: repoRoot,
      allowFailure: true,
    });
    aheadOfUpstream = ahead.status === 0 ? Number(ahead.stdout.trim() || 0) : 0;
  }
  const remoteHead = hasUpstream ? '' : getRemoteHead(repoRoot, branch);

  const config = loadConfig({ repoRoot });
  const baseRef = resolveBaseRef(repoRoot, config);
  const merged = baseRef
    ? runGit(['merge-base', '--is-ancestor', 'HEAD', baseRef], {
      cwd: repoRoot,
      allowFailure: true,
    }).status === 0
    : false;

  return {
    branch,
    statusLines,
    hasUpstream,
    aheadOfUpstream,
    remoteHeadMatchesHead: Boolean(remoteHead && remoteHead === head),
    baseRef,
    headMergedToBase: merged,
  };
}

function collectLifecycleState(repoRoot) {
  const mainRoot = getMainRepoRoot(repoRoot);
  const config = loadConfig({ repoRoot: mainRoot });
  const audit = auditManagedWorktrees({
    mainRoot,
    config,
    cwd: repoRoot,
    apply: true,
    skipWorktreePath: repoRoot,
  });
  return {
    audit,
    lifecycleSessions: mergeLifecycleSessions(readSessions(config, mainRoot), audit.records),
  };
}

function mergeLifecycleSessions(sessions, records) {
  const auditRecords = Array.isArray(records) ? records : [];
  const reasonByBranch = new Map(auditRecords
    .filter((record) => record.branch)
    .map((record) => [record.branch, record.reason || '']));
  const persisted = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => LIFECYCLE_BLOCKING_STATES.includes(session.status))
    .map((session) => ({ ...session, auditReason: reasonByBranch.get(session.branch) || '' }));
  const persistedBranches = new Set(persisted.map((session) => session.branch));
  const synthetic = auditRecords
    .filter((record) => LIFECYCLE_BLOCKING_STATES.includes(record.state))
    .filter((record) => !persistedBranches.has(record.branch))
    .map((record) => ({
      ...(record.session || {}),
      branch: record.branch || record.path,
      worktree: record.path || record.session?.worktree || '',
      status: record.state,
      auditReason: record.reason || '',
    }));
  return [...persisted, ...synthetic];
}

function parseArgs(argv) {
  const args = { taskId: '' };
  let taskScopeRequested = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--task' || value === '--task-id') {
      taskScopeRequested = true;
      args.taskId = argv[index + 1] || '';
      index += 1;
    } else if (value.startsWith('--task=')) {
      taskScopeRequested = true;
      args.taskId = value.slice('--task='.length);
    } else if (value.startsWith('--task-id=')) {
      taskScopeRequested = true;
      args.taskId = value.slice('--task-id='.length);
    }
  }
  if (taskScopeRequested && !args.taskId) {
    throw new Error('completion guard task scope requires a task id');
  }
  args.taskId = normalizeTaskId(args.taskId);
  return args;
}

function formatResult(result) {
  const lines = [`STATUS=${result.status}`];
  if (result.branch !== undefined) lines.push(`BRANCH=${result.branch || '(detached)'}`);
  if (result.reason) lines.push(`REASON=${result.reason}`);
  if (result.baseRef) lines.push(`BASE_REF=${result.baseRef}`);
  if (result.changedFiles) lines.push(`CHANGED_FILES=${result.changedFiles}`);
  if (result.lifecycleBranches && result.lifecycleBranches.length) {
    lines.push(`LIFECYCLE_BRANCHES=${result.lifecycleBranches.join(',')}`);
  }
  for (const blocker of result.lifecycleBlockers || []) {
    lines.push(`LIFECYCLE_BLOCKER=${[
      blocker.branch,
      blocker.status,
      blocker.reason,
      blocker.verdict,
      blocker.worktree,
    ].join('|')}`);
  }
  if (result.nextAction) lines.push(`NEXT_ACTION=${result.nextAction}`);
  if (result.manualCommands && result.manualCommands.length) {
    lines.push('MANUAL_COMMANDS=');
    for (const command of result.manualCommands) {
      lines.push(`  ${command}`);
    }
  }
  if (result.nextCommands && result.nextCommands.length) {
    lines.push('NEXT_COMMANDS=');
    for (const command of result.nextCommands) {
      lines.push(`  ${command}`);
    }
  }
  return lines;
}

function printResult(result) {
  for (const line of formatResult(result)) console.log(line);
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
    const lifecycle = collectLifecycleState(repoRoot);
    const state = { ...collectGitState(repoRoot), ...lifecycle, taskId: args.taskId };
    const result = evaluateCompletionGuard(state);
    printResult(result);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error('STATUS=BLOCKED');
    console.error(`REASON=${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  describeLifecycleBlocker,
  evaluateCompletionGuard,
  collectLifecycleState,
  formatResult,
  mergeLifecycleSessions,
  lifecycleSessionsForTask,
  parseArgs,
  splitStatusLines,
};

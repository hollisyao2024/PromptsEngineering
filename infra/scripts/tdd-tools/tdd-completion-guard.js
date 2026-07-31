#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const { loadConfig, resolveRepoRoot } = require('../shared/config');
const {
  getBranchIntegrationState,
  getMainRepoRoot,
  getPullRequestState,
  isSamePath,
  readSessions,
} = require('../worktree-tools/worktree-core');
const { reconcilePendingCleanups } = require('../worktree-tools/deferred-cleanup-state');

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
  if (kind === 'cleanup-pending') {
    return ['node infra/scripts/tdd-tools/tdd-completion-guard.js'];
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

function evaluateCompletionGuard(input) {
  const branch = String(input.branch || '').trim();
  const statusLines = Array.isArray(input.statusLines) ? input.statusLines : [];
  const dirty = statusLines.length > 0;
  const pendingCleanupCount = Number(input.pendingCleanupCount || 0);

  if (!branch) {
    return block('当前不在普通分支上，无法确认 TDD/QA 流水线是否完成。', 'unmerged', {
      branch,
      dirty,
    });
  }

  if (pendingCleanupCount > 0) {
    return block('仍有 worktree 清理尚未收敛，完成门禁拒绝通过。', 'cleanup-pending', {
      branch,
      dirty,
      pendingCleanupCount,
      pendingCleanupBranches: input.pendingCleanupBranches || [],
    });
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

  const integratedToBase = Boolean(
    input.headMergedToBase
    || input.headPatchEquivalentToBase
    || input.pullRequestMerged
  );
  if (!integratedToBase) {
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
  const integration = baseRef
    ? getBranchIntegrationState(repoRoot, 'HEAD', baseRef)
    : { mergedByAncestry: false, patchEquivalent: false };
  const mainRoot = getMainRepoRoot(repoRoot);
  const session = readSessions(config, mainRoot).find((item) => item.branch === branch);
  const prState = session && session.pr && (!session.head || session.head === head)
    ? getPullRequestState(mainRoot, session.pr, branch)
    : { merged: false };

  return {
    branch,
    statusLines,
    hasUpstream,
    aheadOfUpstream,
    remoteHeadMatchesHead: Boolean(remoteHead && remoteHead === head),
    baseRef,
    headMergedToBase: integration.mergedByAncestry,
    headPatchEquivalentToBase: integration.patchEquivalent,
    pullRequestMerged: prState.merged,
  };
}

function printResult(result) {
  console.log(`STATUS=${result.status}`);
  if (result.branch !== undefined) console.log(`BRANCH=${result.branch || '(detached)'}`);
  if (result.reason) console.log(`REASON=${result.reason}`);
  if (result.baseRef) console.log(`BASE_REF=${result.baseRef}`);
  if (result.changedFiles) console.log(`CHANGED_FILES=${result.changedFiles}`);
  if (result.nextCommands && result.nextCommands.length) {
    console.log('NEXT_COMMANDS=');
    for (const command of result.nextCommands) {
      console.log(`  ${command}`);
    }
  }
}

function main() {
  try {
    const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
    const mainRoot = getMainRepoRoot(repoRoot);
    const config = loadConfig({ repoRoot: mainRoot });
    const cleanup = reconcilePendingCleanups({
      config,
      mainRoot,
      skipWorktreePath: isSamePath(repoRoot, mainRoot) ? '' : repoRoot,
    });
    const state = {
      ...collectGitState(repoRoot),
      pendingCleanupCount: cleanup.pending.length,
      pendingCleanupBranches: cleanup.pending,
    };
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
  evaluateCompletionGuard,
  splitStatusLines,
};

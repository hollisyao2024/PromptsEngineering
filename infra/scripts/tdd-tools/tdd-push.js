#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');
const { analyzeReviewGate, GATE_RESULT } = require('./tdd-review-gate');
const {
  assertSessionCanResume,
  getMainRepoRoot,
  writeSession,
} = require('../worktree-tools/worktree-core');
const { loadConfig, resolveRepoRoot } = require('../shared/config');
const {
  buildGitHubGitEnv,
  loadProjectGitHubToken,
  sanitizeGitHubRemoteUrl,
} = require('../shared/github-auth');
const { createGitHubBackend, repoApiPath } = require('../shared/github-api');

const repoRoot = resolveRepoRoot({ scriptDir: __dirname });

// ==================== Git 工具 ====================

function runGit(args, options = {}) {
  const cwd = options.cwd || repoRoot;
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: buildGitHubGitEnv({ repoRoot, cwd, args, env: process.env }),
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed with exit ${result.status}`);
  }

  return result.stdout;
}

function getWorkingTreeStatusLines() {
  const status = runGit(['status', '--porcelain'], { capture: true }).trim();
  return status ? status.split('\n').filter(Boolean) : [];
}

function parseCliArgs(argv) {
  let scope = 'session';
  let dryRun = false;
  let baseBranch = '';
  let committedOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--committed-only') {
      committedOnly = true;
      continue;
    }
    if (arg === '--project') {
      scope = 'project';
      continue;
    }
    if (arg === '--scope' && argv[i + 1]) {
      scope = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--scope=')) {
      scope = arg.split('=')[1];
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--base' && argv[i + 1]) {
      baseBranch = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--base=')) {
      baseBranch = arg.split('=')[1];
      continue;
    }
  }

  return {
    scope: scope === 'project' ? 'project' : 'session',
    dryRun,
    baseBranch,
    committedOnly,
  };
}

// ==================== Push ====================

function pushBranch() {
  runGit(['push', 'origin', 'HEAD']);
}

// ==================== PR 自动创建 ====================

/**
 * 执行 gh CLI 命令（使用项目级 GH_TOKEN）
 */
function runGh(args) {
  const result = spawnSync('gh', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    stdio: 'pipe',
  });
  return result;
}

function getCurrentBranch() {
  return runGit(['branch', '--show-current'], { capture: true }).trim();
}

function isMainBranch(branch, baseBranch = 'main') {
  return branch === baseBranch;
}

const BRANCH_TYPE_PREFIXES = {
  feature: 'feat',
  feat: 'feat',
  fix: 'fix',
  hotfix: 'fix',
  bugfix: 'fix',
  docs: 'docs',
  doc: 'docs',
  refactor: 'refactor',
  test: 'test',
  tests: 'test',
  perf: 'perf',
  build: 'build',
  ci: 'ci',
  style: 'style',
  chore: 'chore',
};

function humanizeBranchPart(part) {
  return part
    .replace(/[-_]\d{8}$/, '')
    .replace(/[-_/]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * 从分支名推导 Conventional Commits 主题：
 * - feature/TASK-DOMAIN-NNN-desc → { type: feat, scope: domain, desc, taskId }
 * - <prefix>/desc（feature/fix/docs/refactor/...）→ 对应类型，去掉末尾 8 位日期
 * - 其他 → chore，描述取完整分支名
 */
function parseBranchSubject(branch) {
  const branchName = String(branch || '').trim();
  const taskMatch = branchName.match(/^feature\/(TASK-([A-Z]+)-\d+)(?:[-_](.+))?$/i);
  if (taskMatch) {
    return {
      type: 'feat',
      scope: taskMatch[2].toLowerCase(),
      taskId: taskMatch[1].toUpperCase(),
      desc: taskMatch[3] ? humanizeBranchPart(taskMatch[3]) : '',
    };
  }

  const prefixMatch = branchName.match(/^([A-Za-z]+)\/(.+)$/);
  const type = prefixMatch && BRANCH_TYPE_PREFIXES[prefixMatch[1].toLowerCase()];
  if (type) {
    return { type, scope: '', taskId: '', desc: humanizeBranchPart(prefixMatch[2]) };
  }

  return { type: 'chore', scope: '', taskId: '', desc: humanizeBranchPart(branchName) || 'detached head' };
}

function buildAutoCommitMessage(branch) {
  const subject = parseBranchSubject(branch);
  if (subject.taskId) {
    return `${subject.type}: ${subject.desc || subject.taskId} (${subject.taskId})`;
  }
  return `${subject.type}: ${subject.desc}`;
}

function autoCommitWorkingTreeIfNeeded(branch, options = {}) {
  if (options.committedOnly) {
    console.log('仅推送已有提交；保留本地索引及未提交内容。');
    return { committed: false, commitMessage: '', changedFiles: 0, retainedWorkingTree: true };
  }
  const statusLines = (options.getWorkingTreeStatusLines || getWorkingTreeStatusLines)();
  if (!statusLines.length) {
    return {
      committed: false,
      commitMessage: '',
      changedFiles: 0,
    };
  }

  const commitMessage = buildAutoCommitMessage(branch);
  if (options.dryRun) {
    console.log('\x1b[33m[DRY RUN] 检测到未提交改动，正式执行时将自动 git add -A 并创建提交。\x1b[0m');
    console.log(`\x1b[33m[DRY RUN] Auto-Commit-Message: ${commitMessage}\x1b[0m`);
    console.log(`\x1b[33m[DRY RUN] Changed-Files-In-Working-Tree: ${statusLines.length}\x1b[0m`);
    return {
      committed: false,
      commitMessage,
      changedFiles: statusLines.length,
    };
  }

  console.log(`\x1b[33m检测到工作区存在 ${statusLines.length} 个未提交改动，开始自动提交到当前分支。\x1b[0m`);
  runGit(['add', '-A']);
  runGit(['commit', '-m', commitMessage]);
  console.log(`\x1b[32m✓ 已自动提交当前工作区改动：${commitMessage}\x1b[0m`);

  return {
    committed: true,
    commitMessage,
    changedFiles: statusLines.length,
  };
}

/**
 * 检查当前分支是否已有 open PR（gh 或 GitHub API）
 */
async function findOpenPullRequest(branch, { backend, runGh: _runGh = runGh }) {
  if (backend.mode === 'api') {
    const head = encodeURIComponent(`${backend.owner}:${branch}`);
    const prs = await backend.apiRequest(
      'GET',
      repoApiPath(backend, `/pulls?head=${head}&state=open&per_page=10`),
      { token: backend.token }
    );
    if (!Array.isArray(prs) || prs.length === 0) return null;
    return { number: prs[0].number, url: prs[0].html_url || prs[0].url || '', body: prs[0].body || '' };
  }

  const args = ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,body'];
  const result = _runGh(args);
  if (result.status !== 0) {
    throw new Error(`查询当前分支 PR 失败：${(result.stderr || result.stdout || '').trim()}`);
  }
  const prs = JSON.parse(result.stdout || '[]');
  return prs.length > 0 ? { number: prs[0].number, url: prs[0].url, body: prs[0].body || '' } : null;
}

function getReviewSection(reviewDecision) {
  return [
    '### Review Gate',
    `- Gate-Result: ${reviewDecision.gateResult}`,
    `- Reason: ${reviewDecision.reason}`,
    `- Base-Ref: ${reviewDecision.baseRef}`,
  ].join('\n');
}

function mergeReviewSectionIntoBody(body, reviewDecision) {
  const reviewSection = getReviewSection(reviewDecision);
  const reviewSectionRegex = /### Review Gate[\s\S]*?(?=\n### |\s*$)/;
  if (reviewSectionRegex.test(body)) {
    return body.replace(reviewSectionRegex, reviewSection);
  }
  return `${body.trim()}\n\n${reviewSection}\n`;
}

async function updatePrReviewSection(pr, reviewDecision, { backend, runGh: _runGh = runGh }) {
  const nextBody = mergeReviewSectionIntoBody(pr.body || '', reviewDecision);
  if (backend.mode === 'api') {
    await backend.apiRequest('PATCH', repoApiPath(backend, `/pulls/${pr.number}`), {
      token: backend.token,
      body: { body: nextBody },
    });
    return;
  }
  const result = _runGh(['pr', 'edit', String(pr.number), '--body', nextBody]);
  if (result.status !== 0) {
    throw new Error(`更新 PR #${pr.number} Review Gate 失败：${(result.stderr || '').trim()}`);
  }
}

function printReviewDecision(reviewDecision) {
  const label = {
    [GATE_RESULT.REQUIRED]:      'REVIEW_REQUIRED',
    [GATE_RESULT.PENDING_MODEL]: 'PENDING_MODEL_REVIEW',
    [GATE_RESULT.SKIPPED]:       'REVIEW_SKIPPED',
  }[reviewDecision.gateResult] || reviewDecision.gateResult;

  console.log(`\u001b[36mGate-Result: ${reviewDecision.gateResult}\u001b[0m`);
  console.log(`\u001b[36mReason: ${reviewDecision.reason}\u001b[0m`);
  console.log(`\u001b[36mDecision: ${label}\u001b[0m`);

  if (reviewDecision.gateResult === GATE_RESULT.REQUIRED) {
    console.log('\u001b[33m下一步：hotfix 分支，执行当前 CLI 对应的 code review 命令，Approved 后才能标记 TDD_DONE。\u001b[0m');
  } else if (reviewDecision.gateResult === GATE_RESULT.PENDING_MODEL) {
    console.log('\u001b[33m下一步：模型语义判断——读取 git diff，对照 10 类高风险域决定 REQUIRED 或 OPTIONAL。\u001b[0m');
  } else {
    console.log('\u001b[33m下一步：明确跳过 code review，仍需保证 lint / typecheck / 定向测试已通过。\u001b[0m');
  }
}

/**
 * 从分支名生成 PR 标题；与自动提交共用 parseBranchSubject，任务分支带 scope。
 */
function buildPrTitle(branch) {
  const subject = parseBranchSubject(branch);
  const type = subject.scope ? `${subject.type}(${subject.scope})` : subject.type;
  return `${type}: ${subject.desc || subject.taskId}`;
}

/**
 * 获取 remote URL 用于生成手动 PR 链接
 */
function getRemoteUrl() {
  try {
    const url = runGit(['remote', 'get-url', 'origin'], { capture: true }).trim();
    return sanitizeGitHubRemoteUrl(url);
  } catch {
    return '';
  }
}

/**
 * Push 后自动创建 PR，失败时降级为输出手动链接
 */
function buildPrCreateArgs({ title, body, branch, baseBranch }) {
  return [
    'pr', 'create',
    '--title', title,
    '--body', body,
    '--head', branch,
    '--base', baseBranch,
  ];
}

function buildPrBody(title, reviewDecision) {
  return [
    '### 概要',
    `- ${title}`,
    '',
    '### 变更内容',
    '_见 commit 历史_',
    '',
    '### 文档回写',
    '- CHANGELOG: 见本次变更；发布行为以项目 release 配置为准',
    '',
    getReviewSection(reviewDecision),
  ].join('\n');
}

/**
 * 确保当前分支存在指向配置主干的 open PR：已存在则同步 Review Gate，否则创建。
 * gh 不可用时使用 GH_TOKEN 走 GitHub API；任何失败都抛出，由调用方阻断。
 */
async function ensurePullRequest({ branch, baseBranch, reviewDecision, backend, runGh: _runGh = runGh }) {
  const existing = await findOpenPullRequest(branch, { backend, runGh: _runGh });
  if (existing) {
    await updatePrReviewSection(existing, reviewDecision, { backend, runGh: _runGh });
    return { status: 'existing', pr: { number: existing.number, url: existing.url } };
  }

  const title = buildPrTitle(branch);
  const body = buildPrBody(title, reviewDecision);

  if (backend.mode === 'api') {
    const created = await backend.apiRequest('POST', repoApiPath(backend, '/pulls'), {
      token: backend.token,
      body: { title, body, head: branch, base: baseBranch },
    });
    return { status: 'created', pr: { number: created.number, url: created.html_url || created.url || '' } };
  }

  // --head 显式指定分支，避免 upstream tracking 未设置时 gh 报错
  const result = _runGh(buildPrCreateArgs({ title, body, branch, baseBranch }));
  if (result.status !== 0) {
    throw new Error(`gh pr create 失败：${(result.stderr || result.stdout || '').trim()}`);
  }
  const url = (result.stdout || '').trim().split('\n').pop();
  const numberMatch = url.match(/\/pull\/(\d+)/);
  return { status: 'created', pr: { number: numberMatch ? Number(numberMatch[1]) : null, url } };
}

// ==================== 主流程 ====================

async function main() {
  let branch = '';
  try {
    loadProjectGitHubToken({ repoRoot });
    const cliArgs = parseCliArgs(process.argv.slice(2));
    const scopeLabel = cliArgs.scope === 'project' ? 'project（项目模式）' : 'session（会话模式）';
    branch = getCurrentBranch();
    const mainRoot = getMainRepoRoot(repoRoot);
    const lifecycleConfig = loadConfig({ repoRoot: mainRoot });
    const baseBranch = lifecycleConfig.baseBranch || 'main';
    const reviewBaseBranch = cliArgs.baseBranch || baseBranch;
    console.log(`\x1b[36m/tdd push 作用域：${scopeLabel}。本次仅操作当前分支与对应 PR。\x1b[0m`);
    if (isMainBranch(branch, baseBranch)) {
      throw new Error(`当前位于主干分支 ${branch}，禁止执行 /tdd push。请先切换到 feature/* 或 fix/* 分支。`);
    }
    assertSessionCanResume(lifecycleConfig, mainRoot, branch);

    const autoCommitResult = autoCommitWorkingTreeIfNeeded(branch, {
      dryRun: cliArgs.dryRun,
      committedOnly: cliArgs.committedOnly,
    });
    const reviewDecision = analyzeReviewGate({
      baseBranch: reviewBaseBranch,
      branchName: branch,
    });

    if (cliArgs.dryRun) {
      console.log('\x1b[33m[DRY RUN] /tdd push 预览：\x1b[0m');
      if (autoCommitResult.retainedWorkingTree) {
        console.log('- committed-only：仅推送已有提交，不改变本地索引或文件');
      } else if (!autoCommitResult.changedFiles) {
        console.log('- 工作区干净：不会创建自动提交');
      }
      console.log('- 将执行: push 当前分支 → 创建 PR');
      printReviewDecision(reviewDecision);
      console.log('\x1b[33m[DRY RUN] 未执行任何操作\x1b[0m');
      return;
    }

    // 推送前确定 GitHub 后端：gh 与 GH_TOKEN 都不可用时直接阻断，不留下无 PR 的推送
    const backend = createGitHubBackend({ remoteUrl: getRemoteUrl() });
    if (backend.mode === 'api') {
      console.log('\x1b[33mgh CLI 不可用，已使用 .env.local 的 GH_TOKEN 走 GitHub API 创建/更新 PR\x1b[0m');
    }

    pushBranch();

    const prResult = await ensurePullRequest({ branch, baseBranch, reviewDecision, backend });
    console.log(`\u001b[32m✓ PR ${prResult.status === 'created' ? '已创建' : '已存在'}：${prResult.pr.url}\u001b[0m`);
    printReviewDecision(reviewDecision);

    writeSession(lifecycleConfig, mainRoot, {
      phase: 'tdd',
      branch,
      worktree: repoRoot,
      status: 'in_progress',
      step: 'pushed',
      pr: prResult.pr.number ? `#${prResult.pr.number}` : prResult.pr.url,
      head: runGit(['rev-parse', 'HEAD'], { capture: true }).trim(),
    });

    console.log(`\u001b[32m/tdd push 完成：代码已推送到远端。\u001b[0m`);
  } catch (error) {
    console.error(`\u001b[31m/tdd push 失败: ${error.message}\u001b[0m`);
    const remoteUrl = getRemoteUrl();
    console.log('STATUS=BLOCKED');
    if (remoteUrl && branch) {
      console.log(`NEXT_ACTION=修复上述原因后重新执行 pnpm agent -- tdd push（幂等），或手动创建 PR：${remoteUrl}/pull/new/${branch}`);
    } else {
      console.log('NEXT_ACTION=修复上述原因后重新执行 pnpm agent -- tdd push');
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseCliArgs,
  autoCommitWorkingTreeIfNeeded,
  buildAutoCommitMessage,
  buildPrCreateArgs,
  buildPrTitle,
  ensurePullRequest,
  main,
};

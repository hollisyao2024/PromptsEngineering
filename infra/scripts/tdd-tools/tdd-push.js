#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { analyzeReviewGate, REVIEW_CLASS } = require('./tdd-review-gate');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const envLocalPath = path.join(repoRoot, '.env.local');

// ==================== 项目级 GH_TOKEN 加载 ====================

/**
 * 从 .env.local 读取 GH_TOKEN 并注入 process.env
 * 覆盖 shell 中可能存在的其他仓库 token
 */
function loadProjectGhToken() {
  try {
    if (!fs.existsSync(envLocalPath)) return;
    const content = fs.readFileSync(envLocalPath, 'utf8');
    const match = content.match(/^GH_TOKEN=(.+)$/m);
    if (match && match[1].trim()) {
      process.env.GH_TOKEN = match[1].trim();
    }
  } catch {
    // 静默忽略，GH_TOKEN 缺失会在 createPullRequest 中降级处理
  }
}

// ==================== Git 工具 ====================

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
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

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
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
  };
}

// ==================== Push ====================

function getAuthenticatedRemoteUrl() {
  const token = process.env.GH_TOKEN;
  if (!token) return null;
  try {
    let remoteUrl = runGit(['remote', 'get-url', 'origin'], { capture: true }).trim();
    // 剥离已嵌入的旧 token（形如 https://x-access-token:PAT@github.com/...）
    remoteUrl = remoteUrl.replace(/^https:\/\/[^@]+@github\.com\//, 'https://github.com/');
    if (!remoteUrl.startsWith('https://github.com/')) return null;
    return remoteUrl.replace('https://github.com/', `https://x-access-token:${token}@github.com/`);
  } catch {
    return null;
  }
}

function pushBranch() {
  const authUrl = getAuthenticatedRemoteUrl();
  if (authUrl) {
    runGit(['push', authUrl, 'HEAD']);
  } else {
    runGit(['push', 'origin', 'HEAD']);
  }
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

function isMainBranch(branch) {
  return ['main', 'master', 'develop'].includes(branch);
}

function buildAutoCommitMessage(branch) {
  const branchName = branch.trim();
  const taskMatch = branchName.match(/^feature\/(TASK-[A-Z]+-\d+)(?:[-_](.+))?$/i);
  if (taskMatch) {
    const taskId = taskMatch[1].toUpperCase();
    const desc = taskMatch[2]
      ? taskMatch[2].replace(/[-_]/g, ' ').trim()
      : 'auto commit before /tdd push';
    return `feat: ${desc} (${taskId})`;
  }

  const featureMatch = branchName.match(/^feature\/(.+)$/);
  if (featureMatch) {
    const desc = featureMatch[1].replace(/[-_]/g, ' ').trim();
    return `feat: ${desc}`;
  }

  const fixMatch = branchName.match(/^fix\/(.+)$/);
  if (fixMatch) {
    const desc = fixMatch[1].replace(/[-_]/g, ' ').trim();
    return `fix: ${desc}`;
  }

  return `chore: auto-commit before /tdd push (${branchName || 'detached-head'})`;
}

function autoCommitWorkingTreeIfNeeded(branch, options = {}) {
  const statusLines = getWorkingTreeStatusLines();
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
 * 检查当前分支是否已有 PR
 */
function prAlreadyExists(branch) {
  const result = runGh(['pr', 'list', '--head', branch, '--json', 'number,url']);
  if (result.status !== 0) return null;
  try {
    const prs = JSON.parse(result.stdout);
    return prs.length > 0 ? prs[0] : null;
  } catch {
    return null;
  }
}

function getReviewSection(reviewDecision) {
  return [
    '### Review Gate',
    `- Review-Class: ${reviewDecision.reviewClass}`,
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

function getPrBody(prNumber) {
  const result = runGh(['pr', 'view', String(prNumber), '--json', 'body']);
  if (result.status !== 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return parsed.body || '';
  } catch {
    return null;
  }
}

function updatePrReviewSection(prNumber, reviewDecision) {
  const currentBody = getPrBody(prNumber);
  if (currentBody == null) {
    return false;
  }
  const nextBody = mergeReviewSectionIntoBody(currentBody, reviewDecision);
  const result = runGh(['pr', 'edit', String(prNumber), '--body', nextBody]);
  return result.status === 0;
}

function printReviewDecision(reviewDecision) {
  const label = {
    [REVIEW_CLASS.REQUIRED]: 'REVIEW_REQUIRED',
    [REVIEW_CLASS.OPTIONAL_SKIPPED]: 'REVIEW_OPTIONAL',
    [REVIEW_CLASS.SKIPPED]: 'REVIEW_SKIPPED',
  }[reviewDecision.reviewClass];

  console.log(`\u001b[36mReview-Class: ${reviewDecision.reviewClass}\u001b[0m`);
  console.log(`\u001b[36mReason: ${reviewDecision.reason}\u001b[0m`);
  console.log(`\u001b[36mDecision: ${label}\u001b[0m`);

  if (reviewDecision.reviewClass === REVIEW_CLASS.REQUIRED) {
    console.log('\u001b[33m下一步：执行当前 CLI 对应的 code review 命令，Approved 后才能标记 TDD_DONE。\u001b[0m');
  } else {
    console.log('\u001b[33m下一步：可跳过 code review，但仍需保证 lint / typecheck / 定向测试已通过。\u001b[0m');
  }
}

/**
 * 从分支名生成 PR 标题
 * - feature/TASK-DOMAIN-NNN-desc → feat(domain): desc
 * - feature/TASK-DOMAIN-NNN      → feat(domain): TASK-DOMAIN-NNN
 * - feature/desc                  → feat: desc
 * - fix/desc                      → fix: desc
 * - fallback                      → chore: update from <branch>
 */
function buildPrTitle(branch) {
  // feature/TASK-DOMAIN-001 或 feature/TASK-DOMAIN-001-some-desc
  const taskMatch = branch.match(/^feature\/(TASK-([A-Z]+)-\d+)(?:[-_](.+))?$/i);
  if (taskMatch) {
    const taskId = taskMatch[1];
    const scope = taskMatch[2].toLowerCase();
    const desc = taskMatch[3]
      ? taskMatch[3].replace(/[-_]/g, ' ').trim()
      : taskId;
    return `feat(${scope}): ${desc}`;
  }

  // feature/some-desc
  const featureMatch = branch.match(/^feature\/(.+)$/);
  if (featureMatch) {
    const desc = featureMatch[1].replace(/[-_]/g, ' ').trim();
    return `feat: ${desc}`;
  }

  // fix/some-desc
  const fixMatch = branch.match(/^fix\/(.+)$/);
  if (fixMatch) {
    const desc = fixMatch[1].replace(/[-_]/g, ' ').trim();
    return `fix: ${desc}`;
  }

  return `chore: update from ${branch}`;
}

/**
 * 获取 remote URL 用于生成手动 PR 链接
 */
function getRemoteUrl() {
  try {
    const url = runGit(['remote', 'get-url', 'origin'], { capture: true }).trim();
    // https://github.com/owner/repo.git → https://github.com/owner/repo
    return url.replace(/\.git$/, '');
  } catch {
    return '';
  }
}

/**
 * Push 后自动创建 PR，失败时降级为输出手动链接
 */
function createPullRequest(reviewDecision) {
  const branch = getCurrentBranch();

  // 主干分支不创建 PR
  if (isMainBranch(branch)) {
    console.log('\u001b[33m跳过 PR 创建：当前在主干分支。\u001b[0m');
    return;
  }

  // 检查 gh CLI 是否可用
  const ghCheck = spawnSync('gh', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
  if (ghCheck.status !== 0) {
    const remoteUrl = getRemoteUrl();
    if (remoteUrl) {
      console.log(`\u001b[33m⚠ gh CLI 不可用，请手动创建 PR：${remoteUrl}/pull/new/${branch}\u001b[0m`);
    }
    return;
  }

  // 检查是否已有 PR
  const existingPr = prAlreadyExists(branch);
  if (existingPr) {
    const reviewSectionUpdated = updatePrReviewSection(existingPr.number, reviewDecision);
    console.log(`\u001b[32m✓ PR 已存在：${existingPr.url}\u001b[0m`);
    if (!reviewSectionUpdated) {
      console.log('\u001b[33m⚠ 未能更新现有 PR 的 Review Gate 记录，请手动同步以下信息到 PR 描述：\u001b[0m');
      console.log(`\u001b[33m  Review-Class: ${reviewDecision.reviewClass}\u001b[0m`);
      console.log(`\u001b[33m  Reason: ${reviewDecision.reason}\u001b[0m`);
      console.log(`\u001b[33m  Base-Ref: ${reviewDecision.baseRef}\u001b[0m`);
    }
    return;
  }

  // 组装 PR 标题和正文
  const title = buildPrTitle(branch);
  const body = [
    '### 概要',
    `- ${title}`,
    '',
    '### 变更内容',
    '_见 commit 历史_',
    '',
    '### 文档回写',
    '- CHANGELOG: 由 `/qa merge` 自动生成',
    '',
    getReviewSection(reviewDecision),
  ].join('\n');

  // 创建 PR（--head 显式指定分支，避免 upstream tracking 未设置时 gh 报错）
  const result = runGh(['pr', 'create', '--title', title, '--body', body, '--head', branch]);

  if (result.status === 0) {
    const prUrl = (result.stdout || '').trim();
    console.log(`\u001b[32m✓ PR 已创建：${prUrl}\u001b[0m`);
  } else {
    // 降级：输出手动创建链接
    const remoteUrl = getRemoteUrl();
    const errMsg = (result.stderr || '').trim();
    console.log(`\u001b[33m⚠ PR 创建失败${errMsg ? `（${errMsg}）` : ''}。\u001b[0m`);
    if (remoteUrl) {
      console.log(`\u001b[33m  请手动创建：${remoteUrl}/pull/new/${branch}\u001b[0m`);
    }
  }
}

// ==================== 主流程 ====================

function main() {
  try {
    loadProjectGhToken();
    const cliArgs = parseCliArgs(process.argv.slice(2));
    const scopeLabel = cliArgs.scope === 'project' ? 'project（项目模式）' : 'session（会话模式）';
    const branch = getCurrentBranch();
    console.log(`\x1b[36m/tdd push 作用域：${scopeLabel}。本次仅操作当前分支与对应 PR。\x1b[0m`);
    if (isMainBranch(branch)) {
      throw new Error(`当前位于主干分支 ${branch}，禁止执行 /tdd push。请先切换到 feature/* 或 fix/* 分支。`);
    }

    const autoCommitResult = autoCommitWorkingTreeIfNeeded(branch, {
      dryRun: cliArgs.dryRun,
    });
    const reviewDecision = analyzeReviewGate({
      baseBranch: cliArgs.baseBranch,
      branchName: branch,
    });

    if (cliArgs.dryRun) {
      console.log('\x1b[33m[DRY RUN] /tdd push 预览：\x1b[0m');
      if (!autoCommitResult.changedFiles) {
        console.log('- 工作区干净：不会创建自动提交');
      }
      console.log('- 将执行: push 当前分支 → 创建 PR');
      printReviewDecision(reviewDecision);
      console.log('\x1b[33m[DRY RUN] 未执行任何操作\x1b[0m');
      return;
    }

    pushBranch();

    // 自动创建 PR（失败不阻断，push 已完成）
    createPullRequest(reviewDecision);
    printReviewDecision(reviewDecision);

    console.log(`\u001b[32m/tdd push 完成：代码已推送到远端。\u001b[0m`);
  } catch (error) {
    console.error(`\u001b[31m/tdd push 失败: ${error.message}\u001b[0m`);
    process.exit(1);
  }
}

main();


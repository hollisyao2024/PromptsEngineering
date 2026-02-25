#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
    stdio: options.capture ? 'pipe' : 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed with exit ${result.status}`);
  }

  return result.stdout;
}

function ensureCleanWorkingTree() {
  const status = runGit(['status', '--porcelain'], { capture: true });
  if (status.trim()) {
    throw new Error('工作区存在未提交的变动，请在运行 /tdd push 前清理（commit 或 stash）。');
  }
}

function parseCliArgs(argv) {
  let scope = 'session';
  let dryRun = false;

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
  }

  return {
    scope: scope === 'project' ? 'project' : 'session',
    dryRun,
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
function createPullRequest() {
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
    console.log(`\u001b[32m✓ PR 已存在：${existingPr.url}\u001b[0m`);
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
    console.log(`\x1b[36m/tdd push 作用域：${scopeLabel}。本次仅操作当前分支与对应 PR。\x1b[0m`);
    ensureCleanWorkingTree();

    if (cliArgs.dryRun) {
      console.log('\x1b[33m[DRY RUN] /tdd push 预览：\x1b[0m');
      console.log('- 将执行: push 当前分支 → 创建 PR');
      console.log('\x1b[33m[DRY RUN] 未执行任何操作\x1b[0m');
      return;
    }

    pushBranch();

    // 自动创建 PR（失败不阻断，push 已完成）
    createPullRequest();

    console.log(`\u001b[32m/tdd push 完成：代码已推送到远端。\u001b[0m`);
  } catch (error) {
    console.error(`\u001b[31m/tdd push 失败: ${error.message}\u001b[0m`);
    process.exit(1);
  }
}

main();

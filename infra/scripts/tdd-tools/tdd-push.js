#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
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
  const positional = [];

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
    positional.push(arg);
  }

  return {
    scope: scope === 'project' ? 'project' : 'session',
    dryRun,
    positional
  };
}

// ==================== 版本管理 ====================

function readPackageVersion() {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return { pkg, version: pkg.version };
}

function bumpPatchVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`当前版本 "${version}" 不是三段数字格式，无法自动递增。`);
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function normalizeVersion(version) {
  const trimmed = version.trim().replace(/^v/, '');
  if (!trimmed.match(/^\d+\.\d+\.\d+(?:[-+].+)?$/)) {
    throw new Error(`无效版本格式 "${version}"，需要 SemVer（x.y.z）格式。`);
  }
  return trimmed;
}

function prepareTargetVersion(currentVersion, args) {
  if (!args.length) {
    return bumpPatchVersion(currentVersion);
  }

  const [maybeVersion] = args;
  if (maybeVersion === 'bump') {
    return bumpPatchVersion(currentVersion);
  }

  if (maybeVersion.match(/^v?\d+\.\d+\.\d+(?:[-+].+)?$/)) {
    return normalizeVersion(maybeVersion);
  }

  return bumpPatchVersion(currentVersion);
}

function extractReleaseNote(args) {
  if (!args.length) {
    return '';
  }

  if (args[0] === 'bump') {
    return args.slice(1).join(' ').trim();
  }

  if (args[0].match(/^v?\d+\.\d+\.\d+(?:[-+].+)?$/)) {
    return args.slice(1).join(' ').trim();
  }

  return args.join(' ').trim();
}

// ==================== 文件操作 ====================

function updatePackageVersion(pkg, targetVersion) {
  pkg.version = targetVersion;
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

function insertChangelogEntry(targetVersion, note) {
  const raw = fs.readFileSync(changelogPath, 'utf8');
  const today = new Date().toISOString().slice(0, 10);
  const sanitizedNote = note || `发布版本 v${targetVersion}`;
  const entry = `## [v${targetVersion}] - ${today}\n\n### 更新\n- ${sanitizedNote}\n\n---\n\n`;

  const marker = raw.indexOf('\n## [');
  if (marker === -1) {
    const trimmed = raw.trimEnd();
    fs.writeFileSync(changelogPath, `${trimmed}\n\n${entry}`, 'utf8');
    return;
  }

  const prefix = raw.slice(0, marker).trimEnd();
  const suffix = raw.slice(marker);
  const payload = `${prefix}\n\n${entry}${suffix}`;
  fs.writeFileSync(changelogPath, payload, 'utf8');
}

// ==================== Git 发布操作 ====================

function ensureTagDoesNotExist(tagName) {
  const existing = runGit(['tag', '--list', tagName], { capture: true }).trim();
  if (existing) {
    throw new Error(`Tag ${tagName} 已存在，请先删除或选择其他版本号。`);
  }
}

function stageFiles() {
  runGit(['add', 'package.json', 'CHANGELOG.md']);
}

function commitRelease(targetVersion) {
  runGit(['commit', '-m', `chore(release): v${targetVersion}`]);
}

function createTag(tagName, note) {
  runGit(['tag', '-a', tagName, '-m', note]);
}

function pushBranchAndTags(tagName) {
  runGit(['push', 'origin', 'HEAD']);
  runGit(['push', 'origin', tagName]);
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
 * - fallback                      → releaseNote
 */
function buildPrTitle(branch, releaseNote) {
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

  return releaseNote || `chore: release from ${branch}`;
}

/**
 * 从 CHANGELOG.md 提取指定版本的条目内容
 */
function extractChangelogEntry(version) {
  try {
    const raw = fs.readFileSync(changelogPath, 'utf8');
    const versionHeader = `## [v${version}]`;
    const start = raw.indexOf(versionHeader);
    if (start === -1) return '';

    // 从版本头到下一个 --- 分隔线
    const afterHeader = raw.slice(start);
    const endMarker = afterHeader.indexOf('\n---');
    const entry = endMarker !== -1
      ? afterHeader.slice(0, endMarker).trim()
      : afterHeader.trim();

    // 去掉版本头行本身，只保留内容
    const lines = entry.split('\n');
    return lines.slice(1).join('\n').trim();
  } catch {
    return '';
  }
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
function createPullRequest(targetVersion, releaseNote) {
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
  const title = buildPrTitle(branch, releaseNote);
  const changelogEntry = extractChangelogEntry(targetVersion);
  const body = [
    '### 概要',
    `- ${releaseNote}`,
    '',
    '### 变更内容',
    changelogEntry || '_见 CHANGELOG.md_',
    '',
    '### 文档回写',
    `- CHANGELOG: v${targetVersion} 条目已追加`,
  ].join('\n');

  // 创建 PR
  const result = runGh(['pr', 'create', '--title', title, '--body', body]);

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
    const args = cliArgs.positional;
    const scopeLabel = cliArgs.scope === 'project' ? 'project（项目模式）' : 'session（会话模式）';
    console.log(`\x1b[36m/tdd push 作用域：${scopeLabel}。本次仅操作当前分支与对应 PR。\x1b[0m`);
    ensureCleanWorkingTree();
    const { pkg, version: currentVersion } = readPackageVersion();
    const targetVersion = prepareTargetVersion(currentVersion, args);
    if (targetVersion === currentVersion) {
      throw new Error(`目标版本 (${targetVersion}) 与当前版本一致，请指定更高的版本。`);
    }

    const releaseNote = extractReleaseNote(args) || `发布新版 v${targetVersion}`;

    if (cliArgs.dryRun) {
      console.log('\x1b[33m[DRY RUN] /tdd push 预览：\x1b[0m');
      console.log(`- 当前版本: ${currentVersion}`);
      console.log(`- 目标版本: ${targetVersion}`);
      console.log(`- 版本说明: ${releaseNote}`);
      console.log('- 将执行: 更新 package.json/CHANGELOG.md -> commit -> tag -> push -> 创建 PR');
      return;
    }

    updatePackageVersion(pkg, targetVersion);
    insertChangelogEntry(targetVersion, releaseNote);

    stageFiles();
    commitRelease(targetVersion);

    const tagName = `v${targetVersion}`;
    ensureTagDoesNotExist(tagName);
    createTag(tagName, releaseNote);
    pushBranchAndTags(tagName);

    // 自动创建 PR（失败不阻断，push/tag 已完成）
    createPullRequest(targetVersion, releaseNote);

    console.log(`\u001b[32m/tdd push 完成：v${targetVersion} 已打 tag 并推送到远端。\u001b[0m`);
  } catch (error) {
    console.error(`\u001b[31m/tdd push 失败: ${error.message}\u001b[0m`);
    process.exit(1);
  }
}

main();

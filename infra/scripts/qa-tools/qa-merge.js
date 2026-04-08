#!/usr/bin/env node

/**
 * /qa merge — 合并当前分支的 PR 到 main
 *
 * 双策略自动降级：
 *   策略 A: gh pr merge --squash --delete-branch（需 token 有 merge 权限）
 *   策略 B: 本地 git merge --squash + push + gh pr close（权限不足时自动降级）
 *
 * 用法：
 *   pnpm run qa:merge                  # 默认 session 模式（合并当前分支对应 PR）
 *   pnpm run qa:merge -- --project     # 项目模式（同样仅合并当前分支对应 PR）
 *   pnpm run qa:merge -- --dry-run     # 预览操作，不执行
 *   pnpm run qa:merge -- --skip-checks # 跳过发布门禁检查
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const envLocalPath = path.join(repoRoot, '.env.local');

// ==================== 主仓库根路径检测 ====================

function getMainRepoRoot() {
  const result = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) return repoRoot;
  const gitCommonDir = result.stdout.trim();
  if (path.isAbsolute(gitCommonDir)) {
    return path.dirname(gitCommonDir);
  }
  return repoRoot;
}

// ==================== 项目级 GH_TOKEN 加载 ====================

function loadProjectGhToken() {
  try {
    if (!fs.existsSync(envLocalPath)) return;
    const content = fs.readFileSync(envLocalPath, 'utf8');
    const match = content.match(/^GH_TOKEN=(.+)$/m);
    if (match && match[1].trim()) {
      process.env.GH_TOKEN = match[1].trim();
    }
  } catch {
    // 静默忽略
  }
}

// ==================== Git 工具 ====================

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = options.capture ? (result.stderr || '').trim() : '';
    throw new Error(
      `git ${args.join(' ')} failed (exit ${result.status})${stderr ? `: ${stderr}` : ''}`
    );
  }

  return result.stdout;
}

function runGh(args) {
  const result = spawnSync('gh', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    stdio: 'pipe',
  });
  return result;
}

function formatGhError(result, args) {
  const stderr = (result.stderr || '').trim();
  const stdout = (result.stdout || '').trim();
  const details = stderr || stdout || `exit ${result.status ?? 'unknown'}`;
  return `gh ${args.join(' ')} failed: ${details}`;
}

function getCurrentBranch() {
  return runGit(['branch', '--show-current'], { capture: true, cwd: process.cwd() }).trim();
}

function isMainBranch(branch) {
  return ['main', 'master', 'develop'].includes(branch);
}

function getRemoteUrl() {
  try {
    const url = runGit(['remote', 'get-url', 'origin'], { capture: true }).trim();
    return url.replace(/\.git$/, '');
  } catch {
    return '';
  }
}

// ==================== qa-merge 专用函数 ====================

function parseArgs(argv) {
  let scope = 'session';
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
    }
  }

  return {
    scope: scope === 'project' ? 'project' : 'session',
    skipChecks: argv.includes('--skip-checks'),
    dryRun: argv.includes('--dry-run'),
  };
}

function ensureGhAvailable() {
  const result = spawnSync('gh', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error(
      'gh CLI 未安装或不可用。\n' +
      '  qa-merge 依赖 gh CLI 查找和操作 PR。\n' +
      '  安装指南：https://cli.github.com'
    );
  }
}

function ensureCleanWorkingTree() {
  const status = runGit(['status', '--porcelain'], { capture: true });
  if (status.trim()) {
    throw new Error(
      '工作区有未提交的变动，请先提交后重试：\n' +
      '  git add docs/ && git commit -m "docs(qa): 更新 QA 文档"'
    );
  }
}

function ensureCleanWorkingTreeAt(targetPath, label = targetPath) {
  const status = runGit(['status', '--porcelain'], { capture: true, cwd: targetPath });
  if (status.trim()) {
    throw new Error(
      `${label} 存在未提交的变动，请先清理后重试。\n` +
      `  目标路径: ${targetPath}`
    );
  }
}

function findOpenPR(branch) {
  const args = [
    'pr', 'list',
    '--head', branch,
    '--json', 'number,title,body,url,mergeable',
    '--state', 'open',
  ];
  const result = runGh(args);
  if (result.status !== 0) {
    throw new Error(
      `查询当前分支的 PR 失败。\n${formatGhError(result, args)}`
    );
  }
  try {
    const prs = JSON.parse(result.stdout);
    return prs.length > 0 ? prs[0] : null;
  } catch (error) {
    throw new Error(
      `解析当前分支的 PR 列表失败。\n` +
      `gh 返回了不可解析的 JSON：${error.message}`
    );
  }
}

function autoRebaseOnMain(currentBranch, dryRun) {
  console.log('\x1b[36m获取最新 origin/main...\x1b[0m');
  runGit(['fetch', 'origin', 'main']);

  const behindOutput = runGit(
    ['rev-list', '--count', 'HEAD..origin/main'],
    { capture: true }
  );
  const commitsBehind = parseInt(behindOutput.trim(), 10) || 0;

  if (commitsBehind === 0) {
    console.log('\x1b[32m分支已与 main 同步，无需 rebase\x1b[0m');
    return { rebased: false, commitsBehind: 0 };
  }

  console.log(
    `\x1b[33m当前分支落后 origin/main ${commitsBehind} 个提交，` +
    `${dryRun ? '需要' : '正在执行'} rebase...\x1b[0m`
  );

  if (dryRun) {
    return { rebased: false, commitsBehind };
  }

  const originalHead = runGit(['rev-parse', 'HEAD'], { capture: true }).trim();

  try {
    runGit(['rebase', 'origin/main']);
  } catch {
    console.error('\x1b[31mrebase 过程中发现冲突，正在中止...\x1b[0m');
    try { runGit(['rebase', '--abort']); } catch { /* ignore */ }
    try { runGit(['reset', '--hard', originalHead]); } catch { /* ignore */ }
    throw new Error(
      '自动 rebase 失败：当前分支与 origin/main 存在冲突。\n' +
      '请手动解决冲突后重试：\n' +
      '  git rebase origin/main\n' +
      '  # 解决冲突后：git rebase --continue\n' +
      '  git push --force-with-lease'
    );
  }

  try {
    console.log('\x1b[36m推送 rebase 后的分支 (force-with-lease)...\x1b[0m');
    runGit(['push', '--force-with-lease', 'origin', currentBranch]);
  } catch (pushError) {
    console.error('\x1b[31mforce-push 失败，正在恢复分支状态...\x1b[0m');
    try { runGit(['reset', '--hard', originalHead]); } catch { /* ignore */ }
    throw new Error(
      `rebase 成功但 force-push 失败：${pushError.message}\n` +
      '分支已恢复到 rebase 前的状态。\n' +
      `请检查远程权限后手动执行：git push --force-with-lease origin ${currentBranch}`
    );
  }

  console.log(
    `\x1b[32m自动 rebase 完成：已将 ${commitsBehind} 个 main 提交合入分支基底并推送\x1b[0m`
  );
  return { rebased: true, commitsBehind };
}

function checkPrState(prNumber) {
  const result = runGh(['pr', 'view', String(prNumber), '--json', 'state']);
  if (result.status !== 0) return null;
  try {
    const data = JSON.parse(result.stdout);
    return data.state || null;
  } catch {
    return null;
  }
}

function runPreMergeChecks() {
  console.log('\x1b[36m运行发布门禁检查 (qa:check-defect-blockers)...\x1b[0m');
  const result = spawnSync('pnpm', ['run', 'qa:check-defect-blockers'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  return result.status === 0;
}

function buildCommitMessage(pr) {
  const header = `${pr.title} (#${pr.number})`;
  let summary = '';
  if (pr.body) {
    const lines = pr.body.split('\n');
    const summaryStart = lines.findIndex((l) => /^###?\s*概要/i.test(l));
    if (summaryStart !== -1) {
      const rest = lines.slice(summaryStart + 1);
      const nextSection = rest.findIndex((l) => /^###?\s/.test(l));
      const summaryLines = nextSection !== -1 ? rest.slice(0, nextSection) : rest.slice(0, 5);
      summary = summaryLines
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n');
    }
  }

  const parts = [header];
  if (summary) parts.push('', summary);
  parts.push('', 'Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>');

  return parts.join('\n');
}

function tryGhMerge(prNumber) {
  console.log(`\x1b[36m尝试 gh pr merge #${prNumber} --squash...\x1b[0m`);
  const result = runGh([
    'pr', 'merge', String(prNumber),
    '--squash',
    '--delete-branch',
  ]);

  if (result.status === 0) {
    console.log('\x1b[32m  gh pr merge 成功\x1b[0m');
    return true;
  }

  const stderr = (result.stderr || '').trim();
  if (
    stderr.includes('Resource not accessible') ||
    stderr.includes('mergePullRequest') ||
    stderr.includes('403')
  ) {
    console.log('\x1b[33m  gh pr merge 权限不足，切换到本地合并策略...\x1b[0m');
  } else {
    console.log(`\x1b[33m  gh pr merge 失败 (${stderr})，切换到本地合并策略...\x1b[0m`);
  }
  return false;
}

function findWorktreePathByBranch(branchName, mainRepoRoot) {
  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: mainRepoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) return null;

  let currentPath = null;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice(9).trim();
      continue;
    }

    if (line.startsWith('branch ')) {
      const currentBranch = line.slice(7).trim().replace('refs/heads/', '');
      if (currentBranch === branchName) {
        return currentPath;
      }
    }
  }

  return null;
}

function resolveMainWorkspacePath(mainRepoRoot) {
  return findWorktreePathByBranch('main', mainRepoRoot) || mainRepoRoot;
}

function hasWorkspaceDependencies(workspacePath) {
  return (
    fs.existsSync(path.join(workspacePath, 'node_modules')) &&
    fs.existsSync(path.join(workspacePath, 'apps', 'web', 'node_modules'))
  );
}

function ensureWorkspaceDependencies(workspacePath, label = workspacePath) {
  if (hasWorkspaceDependencies(workspacePath)) {
    return;
  }

  console.log(`\x1b[33m${label} 缺少依赖目录，正在执行 pnpm install --frozen-lockfile...\x1b[0m`);
  const result = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
    cwd: workspacePath,
    encoding: 'utf8',
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(
      `${label} 依赖安装失败（exit ${result.status}）。\n` +
      `  目标路径: ${workspacePath}\n` +
      '请检查网络、registry 或 lockfile 后重试。'
    );
  }
}

// ==================== 同步本地 main ====================

function syncLocalMain(mainWorkspacePath) {
  if (path.resolve(mainWorkspacePath) !== path.resolve(process.cwd())) {
    // main 已在其他 worktree 中 checkout，不能在当前 feature 工作区执行 checkout main
    // 用 `fetch --prune origin`（不加 refspec）才能清理所有过期 remote tracking ref（包括已删除的 feature 分支）
    console.log(`\x1b[36m同步 main 工作区：${mainWorkspacePath}\x1b[0m`);
    runGit(['fetch', '--prune', 'origin'], { cwd: mainWorkspacePath });
    runGit(['merge', '--ff-only', 'origin/main'], { cwd: mainWorkspacePath });
  } else {
    console.log('\x1b[36m切换到 main 并拉取最新代码...\x1b[0m');
    runGit(['checkout', 'main']);
    // 用 `fetch --prune` + `merge` 替代 `pull --prune origin main`：
    // `pull --prune origin main` 只 prune main refspec 范围内的引用，不清理其他已删除的 feature 分支
    runGit(['fetch', '--prune', 'origin']);
    runGit(['merge', '--ff-only', 'origin/main']);
  }
}

function localSquashMerge(featureBranch, pr, mainWorkspacePath, mainRepoRoot) {
  const commitMsg = buildCommitMessage(pr);

  try {
    syncLocalMain(mainWorkspacePath);

    console.log(`\x1b[36m执行 git merge --squash ${featureBranch}...\x1b[0m`);
    runGit(['merge', '--squash', featureBranch], { cwd: mainWorkspacePath });

    console.log('\x1b[36m提交 squash merge...\x1b[0m');
    runGit(['commit', '-m', commitMsg], { cwd: mainWorkspacePath });

    console.log('\x1b[36m推送到 origin main...\x1b[0m');
    runGit(['push', 'origin', 'main'], { cwd: mainWorkspacePath });
  } catch (error) {
    console.error('\x1b[31m合并过程中出错，尝试回滚...\x1b[0m');
    try {
      runGit(['merge', '--abort'], { capture: true, cwd: mainWorkspacePath });
    } catch { /* 可能不在 merge 状态 */ }
    try {
      runGit(['reset', '--hard', 'origin/main'], { cwd: mainWorkspacePath });
    } catch { /* 忽略 */ }
    try {
      runGit(['checkout', featureBranch]);
    } catch { /* 忽略 */ }
    throw error;
  }

  closeAndCleanup(featureBranch, pr, commitMsg);
}

function closeAndCleanup(featureBranch, pr, commitMsg) {
  console.log(`\x1b[36m关闭 PR #${pr.number}...\x1b[0m`);
  const closeResult = runGh([
    'pr', 'close', String(pr.number),
    '--comment',
    `Squash merged locally to main.\n\nCommit message:\n\`\`\`\n${commitMsg}\n\`\`\``,
  ]);
  if (closeResult.status !== 0) {
    console.log('\x1b[33m  PR 关闭失败（不影响合并结果）\x1b[0m');
  }

  console.log(`\x1b[36m删除远程分支 ${featureBranch}...\x1b[0m`);
  try {
    runGit(['push', 'origin', '--delete', featureBranch], { capture: true });
  } catch {
    console.log('\x1b[33m  远程分支删除失败（可能已删除）\x1b[0m');
  }
}

function getLatestMainCommit(mainWorkspacePath) {
  return runGit(['rev-parse', '--short', 'HEAD'], { capture: true, cwd: mainWorkspacePath }).trim();
}

// ==================== Worktree 清理 ====================

function cleanupWorktree(featureBranch, mainRepoRoot) {
  try {
    const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: mainRepoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (result.status !== 0) return;

    let currentPath = null;
    let found = false;
    for (const line of result.stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        currentPath = line.slice(9).trim();
      } else if (line.startsWith('branch ')) {
        const branchName = line.slice(7).trim().replace('refs/heads/', '');
        if (branchName === featureBranch && currentPath !== mainRepoRoot) {
          found = true;
          break;
        }
      }
    }

    if (!found || !currentPath) return;

    if (process.cwd().startsWith(currentPath)) {
      try {
        console.log(`\x1b[36m释放当前 worktree 对分支 ${featureBranch} 的占用...\x1b[0m`);
        runGit(['switch', '--detach', 'origin/main'], { cwd: currentPath });
      } catch (err) {
        console.log(`\x1b[33m  切换为 detached HEAD 失败（${err.message}），继续尝试清理\x1b[0m`);
      }
    }

    console.log(`\x1b[36m清理 worktree: ${currentPath}\x1b[0m`);
    spawnSync('git', ['worktree', 'remove', '--force', currentPath], {
      cwd: mainRepoRoot,
      encoding: 'utf8',
      stdio: 'inherit',
    });
    spawnSync('git', ['worktree', 'prune'], {
      cwd: mainRepoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    console.log('\x1b[32m  Worktree 已清理\x1b[0m');

    const cwd = process.cwd();
    if (cwd.startsWith(currentPath)) {
      console.log('');
      console.log(`\x1b[33m提示：当前目录对应的 worktree 已被清理，请切回主目录：\x1b[0m`);
      console.log(`  cd ${mainRepoRoot}`);
    }
  } catch (err) {
    console.log(`\x1b[33m  Worktree 清理跳过（${err.message}）\x1b[0m`);
  }
}

function cleanupOrphanWorktreeDirs(mainRepoRoot) {
  const worktreesDir = path.join(mainRepoRoot, '.worktrees');
  if (!fs.existsSync(worktreesDir)) return [];

  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: mainRepoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  const validPaths = new Set();
  if (result.status === 0) {
    for (const line of result.stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        validPaths.add(path.resolve(line.slice(9).trim()));
      }
    }
  }

  const removed = [];
  for (const entry of fs.readdirSync(worktreesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(worktreesDir, entry.name);
    if (validPaths.has(path.resolve(candidate))) continue;

    try {
      fs.rmSync(candidate, { recursive: true, force: true });
      removed.push(candidate);
    } catch (err) {
      console.log(`\x1b[33m  孤儿 worktree 目录清理失败（${candidate}: ${err.message}）\x1b[0m`);
    }
  }

  try {
    if (fs.existsSync(worktreesDir) && fs.readdirSync(worktreesDir).length === 0) {
      fs.rmdirSync(worktreesDir);
    }
  } catch {
    // ignore
  }

  if (removed.length > 0) {
    console.log('\x1b[32m  已清理孤儿 worktree 目录:\x1b[0m');
    removed.forEach((item) => console.log(`    - ${item}`));
  }

  return removed;
}

function ensurePrimaryWorkspaceOnMain(mainWorkspacePath) {
  try {
    const current = runGit(['branch', '--show-current'], {
      capture: true,
      cwd: mainWorkspacePath,
    }).trim();
    if (current !== 'main') {
      runGit(['switch', 'main'], { cwd: mainWorkspacePath });
    }
  } catch (err) {
    console.log(`\x1b[33m  回到 main 失败（${err.message}）\x1b[0m`);
  }
}

function printCleanupSummary(mainRepoRoot) {
  const branchResult = spawnSync(
    'git',
    ['branch', '--list', 'feature/*', 'fix/*'],
    { cwd: mainRepoRoot, encoding: 'utf8', stdio: 'pipe' }
  );
  const branches = (branchResult.stdout || '')
    .split('\n')
    .map((item) => item.trim().replace(/^\*\s*/, ''))
    .filter(Boolean);

  const worktreeResult = spawnSync(
    'git',
    ['worktree', 'list', '--porcelain'],
    { cwd: mainRepoRoot, encoding: 'utf8', stdio: 'pipe' }
  );
  const worktreeCount = (worktreeResult.stdout || '')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .length;

  const stashResult = spawnSync(
    'git',
    ['stash', 'list'],
    { cwd: mainRepoRoot, encoding: 'utf8', stdio: 'pipe' }
  );
  const stashCount = (stashResult.stdout || '')
    .split('\n')
    .filter(Boolean)
    .length;

  console.log('');
  console.log('\x1b[36m仓库清理摘要:\x1b[0m');
  console.log(`  当前主分支: main`);
  console.log(`  剩余本地 feature/fix 分支: ${branches.length}`);
  console.log(`  剩余 worktree 数量: ${worktreeCount}`);
  console.log(`  stash 数量: ${stashCount}`);
}

// ==================== 版本管理（从 tdd-push.js 迁移） ====================

function bumpPatchVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`当前版本 "${version}" 不是三段数字格式，无法自动递增。`);
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function insertChangelogEntry(mainRepoRoot, targetVersion, note) {
  const changelogPath = path.join(mainRepoRoot, 'CHANGELOG.md');
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

function getPrTitle(prNumber) {
  const result = runGh(['pr', 'view', String(prNumber), '--json', 'title', '--jq', '.title']);
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return null;
}

function formatAgentStateQaValidatedEntry(prNumber, commitHash, date) {
  return `- [x] QA_VALIDATED — Go (0 blockers) qa:verify ${date}; PR #${prNumber}, commit ${commitHash}`;
}

function upsertQaValidatedEntry(content, prNumber, commitHash, date) {
  const uncheckedPattern = /- \[ \] (5\. QA_VALIDATED[^\n]*)/;
  if (uncheckedPattern.test(content)) {
    return content.replace(
      uncheckedPattern,
      `- [x] $1 — PR #${prNumber}, commit ${commitHash}, ${date}`
    );
  }

  const trimmed = content.trimEnd();
  const separator = trimmed ? '\n\n' : '';
  return `${trimmed}${separator}${formatAgentStateQaValidatedEntry(prNumber, commitHash, date)}\n`;
}

function updateAgentState(mainRepoRoot, prNumber, commitHash) {
  const agentStatePath = path.join(mainRepoRoot, 'docs', 'AGENT_STATE.md');
  try {
    if (!fs.existsSync(agentStatePath)) {
      console.log('\x1b[33m  警告：/docs/AGENT_STATE.md 不存在，跳过自动更新\x1b[0m');
      return false;
    }

    const content = fs.readFileSync(agentStatePath, 'utf8');
    const date = new Date().toISOString().slice(0, 10);
    const updated = upsertQaValidatedEntry(content, prNumber, commitHash, date);

    if (updated === content) {
      console.log('\x1b[33m  警告：AGENT_STATE.md 中未找到待勾选的 QA_VALIDATED 条目（可能已勾选）\x1b[0m');
      return false;
    }

    fs.writeFileSync(agentStatePath, updated, 'utf8');
    console.log('\x1b[32m  AGENT_STATE.md 已更新（QA_VALIDATED）\x1b[0m');
    return true;
  } catch (err) {
    console.log(`\x1b[33m  警告：自动更新 AGENT_STATE.md 失败（${err.message}），请手动勾选\x1b[0m`);
    return false;
  }
}

function commitReleaseAndTag(mainRepoRoot, version, note) {
  runGit(['add', 'package.json', 'CHANGELOG.md', 'docs/AGENT_STATE.md'], {
    cwd: mainRepoRoot,
  });
  runGit(['commit', '-m', `chore(release): v${version}`], {
    cwd: mainRepoRoot,
  });
  runGit(['tag', '-a', `v${version}`, '-m', note || `Release v${version}`], {
    cwd: mainRepoRoot,
  });
}

function pushMainAndTag(mainRepoRoot, tagName) {
  runGit(['push', 'origin', 'main'], { cwd: mainRepoRoot });
  runGit(['push', 'origin', tagName], { cwd: mainRepoRoot });
}

// ==================== 摘要输出 ====================

function getResumableBranches(mergedBranch, mainRepoRoot) {
  const branchResult = spawnSync(
    'git', ['branch', '--list', 'feature/*', 'fix/*'],
    { cwd: mainRepoRoot, encoding: 'utf8', stdio: 'pipe' }
  );
  const branches = (branchResult.stdout || '')
    .split('\n')
    .map(b => b.trim().replace(/^\*\s*/, ''))
    .filter(b => b && b !== mergedBranch);

  const stashResult = spawnSync(
    'git', ['stash', 'list', '--format=%gd: %s'],
    { cwd: mainRepoRoot, encoding: 'utf8', stdio: 'pipe' }
  );
  const stashes = (stashResult.stdout || '')
    .split('\n')
    .filter(s => s.trim());

  return { branches, stashes };
}

function printSummary(pr, featureBranch, commitHash, strategy, agentStateUpdated, version, mainRepoRoot) {
  console.log('');
  console.log('\x1b[32m' + '='.repeat(60) + '\x1b[0m');
  console.log('\x1b[32m/qa merge 完成\x1b[0m');
  console.log('\x1b[32m' + '='.repeat(60) + '\x1b[0m');
  console.log(`  PR:     #${pr.number} ${pr.title}`);
  console.log(`  分支:   ${featureBranch} → main`);
  console.log(
    `  策略:   ${strategy === 'gh' ? 'gh pr merge --squash' : '本地 git merge --squash'}`
  );
  console.log(`  提交:   ${commitHash}`);
  if (version) {
    console.log(`  版本:   v${version}`);
  }
  console.log(
    `  状态:   ${agentStateUpdated ? '\x1b[32m✓ AGENT_STATE.md 已更新（QA_VALIDATED）\x1b[0m' : '\x1b[33m⚠ AGENT_STATE.md 更新失败，请手动勾选 QA_VALIDATED\x1b[0m'}`
  );
  console.log('');
  console.log('\x1b[33m下一步:\x1b[0m');
  console.log('  激活 DevOps 专家执行部署 (/devops 或 /ship dev)');
  console.log('\x1b[32m' + '='.repeat(60) + '\x1b[0m');

  const { branches, stashes } = getResumableBranches(featureBranch, mainRepoRoot);
  if (branches.length > 0 || stashes.length > 0) {
    console.log('');
    console.log('\x1b[33m未完成的开发任务:\x1b[0m');
    branches.forEach(b => {
      console.log(`  \x1b[36m${b}\x1b[0m  →  /tdd resume ${b}`);
    });
    stashes.forEach(s => {
      console.log(`  \x1b[35m${s}\x1b[0m`);
    });
    if (branches.length === 1 && stashes.length === 0) {
      console.log('');
      console.log(`\x1b[32m建议继续: /tdd resume ${branches[0]}\x1b[0m`);
    }
  }
}

// ==================== 主流程 ====================

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));

    // Step 1: 检测主仓库根路径 + worktree 环境
    const mainRepoRoot = getMainRepoRoot();
    const _gitCdResult = spawnSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe',
    });
    const isInWorktree = _gitCdResult.status === 0 &&
      path.isAbsolute(_gitCdResult.stdout.trim());
    if (isInWorktree) {
      console.log(`\x1b[36m检测到 worktree 环境，主仓库：${mainRepoRoot}\x1b[0m`);
    }
    const mainWorkspacePath = resolveMainWorkspacePath(mainRepoRoot);
    if (path.resolve(mainWorkspacePath) !== path.resolve(process.cwd())) {
      console.log(`\x1b[36mmain 当前位于独立 worktree：${mainWorkspacePath}\x1b[0m`);
    }

    // Step 2: 加载 GH_TOKEN
    loadProjectGhToken();

    // Step 3: 确保 gh CLI 可用
    ensureGhAvailable();

    // Step 4: 确保工作区干净
    ensureCleanWorkingTree();
    if (path.resolve(mainWorkspacePath) !== path.resolve(process.cwd())) {
      ensureCleanWorkingTreeAt(mainWorkspacePath, 'main 工作区');
      ensureWorkspaceDependencies(mainWorkspacePath, 'main 工作区');
    }

    // Step 5: 验证当前分支
    const currentBranch = getCurrentBranch();
    if (isMainBranch(currentBranch)) {
      throw new Error(
        `当前在主干分支 (${currentBranch})，/qa merge 只能在 feature/fix 分支上执行。\n\n` +
        `  如需推送文档 / 配置等小改动：git push origin ${currentBranch}\n` +
        `  如需推送代码变更：请先 git stash，再 /tdd new-branch 创建 feature 分支，走正常 PR 流程。`
      );
    }

    // Step 6: 查找 open PR
    const pr = findOpenPR(currentBranch);
    if (!pr) {
      throw new Error(
        `当前分支 (${currentBranch}) 没有 open PR。\n` +
        '请先执行 /tdd push 创建 PR，或检查 PR 是否已被合并/关闭。'
      );
    }
    console.log(`\x1b[32m找到 PR #${pr.number}: ${pr.title}\x1b[0m`);
    console.log(`  URL: ${pr.url}`);

    // Step 7: 自动 rebase（确保 feature 分支基于最新 main）
    const rebaseResult = autoRebaseOnMain(currentBranch, args.dryRun);

    // Step 8: rebase 后重新检查 PR 合并状态
    if (rebaseResult.rebased) {
      console.log('\x1b[36m等待 GitHub 更新 PR 状态...\x1b[0m');
      spawnSync('sleep', ['3'], { stdio: 'inherit' });

      const updatedPr = findOpenPR(currentBranch);
      if (!updatedPr) {
        throw new Error(
          `rebase 并 force-push 后找不到 PR。\n` +
          `分支 ${currentBranch} 的 PR 可能已被关闭，请检查 GitHub。`
        );
      }
      if (updatedPr.mergeable === 'CONFLICTING') {
        throw new Error(
          `PR #${pr.number} 在自动 rebase 后仍存在合并冲突，请手动检查并解决。`
        );
      }
      Object.assign(pr, updatedPr);
    } else if (!args.dryRun && pr.mergeable === 'CONFLICTING') {
      throw new Error(
        `PR #${pr.number} 存在合并冲突且分支已与 main 同步。\n` +
        '冲突可能来自 PR 自身的文件变更，请手动检查并解决。'
      );
    }

    // Step 9: 运行发布门禁检查
    if (!args.skipChecks) {
      const checksPassed = runPreMergeChecks();
      if (!checksPassed) {
        throw new Error(
          '发布门禁检查未通过（存在 P0 阻塞缺陷或 NFR 未达标）。\n' +
          '请先修复阻塞问题后重试，或使用 --skip-checks 跳过检查。'
        );
      }
      console.log('\x1b[32m发布门禁检查通过\x1b[0m');
    } else {
      console.log('\x1b[33m跳过发布门禁检查 (--skip-checks)\x1b[0m');
    }

    const scopeLabel = args.scope === 'project' ? 'project（项目模式）' : 'session（会话模式）';
    console.log(`\x1b[36m/qa merge 作用域：${scopeLabel}。本次仅处理当前分支对应的 PR。\x1b[0m`);

    // Step 10: Dry run
    if (args.dryRun) {
      console.log('');
      console.log('\x1b[33m[DRY RUN] 将执行以下操作:\x1b[0m');
      if (rebaseResult.commitsBehind > 0) {
        console.log(`  0. rebase 到 origin/main（落后 ${rebaseResult.commitsBehind} 个提交）+ force-push`);
      } else {
        console.log('  0. 分支已与 main 同步，无需 rebase');
      }
      console.log(`  1. squash merge PR #${pr.number} (${currentBranch}) → main`);
      console.log('  2. 同步本地 main');
      console.log('  3. 清理 worktree（如有）');
      console.log(`  4. 删除分支 ${currentBranch}`);
      console.log('  5. 版本递增 + CHANGELOG + AGENT_STATE + tag');
      console.log('  6. push main + tag');
      console.log('\x1b[33m[DRY RUN] 未执行任何操作\x1b[0m');
      return;
    }

    // Step 11-12: 执行合并（双策略 + 防竞态）
    let strategy;
    const ghMerged = tryGhMerge(pr.number);

    if (ghMerged) {
      strategy = 'gh';
      syncLocalMain(mainWorkspacePath);
    } else {
      // 防竞态：gh 可能超时但实际已完成合并
      const prState = checkPrState(pr.number);
      if (prState === 'MERGED') {
        console.log('\x1b[32m  检测到 PR 已被合并（gh 超时但操作成功）\x1b[0m');
        strategy = 'gh';
        syncLocalMain(mainWorkspacePath);
      } else {
        strategy = 'local';
        localSquashMerge(currentBranch, pr, mainWorkspacePath, mainRepoRoot);
      }
    }

    // Step 13: 清理 worktree（在删分支前，必须先移除 worktree）
    cleanupWorktree(currentBranch, mainRepoRoot);
    cleanupOrphanWorktreeDirs(mainRepoRoot);

    // worktree 模式：切换 VSCode 窗口回主仓库
    if (isInWorktree) {
      spawnSync('code', ['-r', mainRepoRoot], { encoding: 'utf8', stdio: 'pipe' });
    }

    // Step 14: 清理本地 feature 分支（两种策略都需要）
    try {
      runGit(['branch', '-d', currentBranch], { capture: true, cwd: mainWorkspacePath });
    } catch {
      try {
        runGit(['branch', '-D', currentBranch], { capture: true, cwd: mainWorkspacePath });
      } catch {
        console.log(`\x1b[33m  本地分支 ${currentBranch} 删除失败（可手动执行）\x1b[0m`);
      }
    }

    ensurePrimaryWorkspaceOnMain(mainWorkspacePath);
    cleanupOrphanWorktreeDirs(mainRepoRoot);

    // Step 15: 版本递增 + CHANGELOG + AGENT_STATE + tag
    const packageJsonPath = path.join(mainWorkspacePath, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const currentVersion = pkg.version;
    const newVersion = bumpPatchVersion(currentVersion);

    // Release note 从 PR 标题提取
    const releaseNote = getPrTitle(pr.number) || pr.title || `Release v${newVersion}`;

    // 更新 package.json
    pkg.version = newVersion;
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    console.log(`\x1b[32m  版本递增: ${currentVersion} → ${newVersion}\x1b[0m`);

    // 更新 CHANGELOG
    insertChangelogEntry(mainWorkspacePath, newVersion, releaseNote);
    console.log('\x1b[32m  CHANGELOG.md 已更新\x1b[0m');

    // 更新 AGENT_STATE
    const commitHash = getLatestMainCommit(mainWorkspacePath);
    const agentStateUpdated = updateAgentState(mainWorkspacePath, pr.number, commitHash);

    // Step 16: commit + tag
    commitReleaseAndTag(mainWorkspacePath, newVersion, releaseNote);
    console.log(`\x1b[32m  Release commit + tag v${newVersion} 已创建\x1b[0m`);

    // Step 17: push main + tag
    const tagName = `v${newVersion}`;
    pushMainAndTag(mainWorkspacePath, tagName);
    console.log('\x1b[32m  已推送 main + tag 到远端\x1b[0m');

    printSummary(
      pr,
      currentBranch,
      commitHash,
      strategy,
      agentStateUpdated,
      newVersion,
      mainWorkspacePath
    );
    printCleanupSummary(mainRepoRoot);
  } catch (error) {
    console.error(`\x1b[31m/qa merge 失败: ${error.message}\x1b[0m`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  findOpenPR,
  findWorktreePathByBranch,
  resolveMainWorkspacePath,
  formatGhError,
  formatAgentStateQaValidatedEntry,
  upsertQaValidatedEntry,
};

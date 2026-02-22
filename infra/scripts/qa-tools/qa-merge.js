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
    // 静默忽略，GH_TOKEN 缺失会在 gh 命令中降级处理
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
    const stderr = options.capture ? (result.stderr || '').trim() : '';
    throw new Error(
      `git ${args.join(' ')} failed (exit ${result.status})${stderr ? `: ${stderr}` : ''}`
    );
  }

  return result.stdout;
}

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

/**
 * 确保 gh CLI 可用（findOpenPR 等核心功能依赖它）
 */
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

/**
 * 查找当前分支对应的 open PR
 * @returns {{ number: number, title: string, body: string, url: string, mergeable: string } | null}
 */
function findOpenPR(branch) {
  const result = runGh([
    'pr', 'list',
    '--head', branch,
    '--json', 'number,title,body,url,mergeable',
    '--state', 'open',
  ]);
  if (result.status !== 0) return null;
  try {
    const prs = JSON.parse(result.stdout);
    return prs.length > 0 ? prs[0] : null;
  } catch {
    return null;
  }
}

/**
 * 自动 rebase 当前 feature 分支到 origin/main
 * @param {string} currentBranch - 当前 feature 分支名
 * @param {boolean} dryRun - 是否为 dry-run 模式
 * @returns {{ rebased: boolean, commitsBehind: number }}
 */
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

/**
 * 查询 PR 当前状态（用于防竞态检测）
 * @returns {'MERGED' | 'OPEN' | 'CLOSED' | null}
 */
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

/**
 * 运行发布前门禁检查（qa:check-defect-blockers）
 */
function runPreMergeChecks() {
  console.log('\x1b[36m运行发布门禁检查 (qa:check-defect-blockers)...\x1b[0m');
  const result = spawnSync('pnpm', ['run', 'qa:check-defect-blockers'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  return result.status === 0;
}

/**
 * 从 PR 信息构建 squash merge 的 commit message
 */
function buildCommitMessage(pr) {
  const header = `${pr.title} (#${pr.number})`;

  // 从 PR body 提取 ### 概要 段落
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

/**
 * 策略 A：使用 gh pr merge（需要 token 有 merge 权限）
 * @returns {boolean} true 表示成功
 */
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

/**
 * 策略 B：本地 git merge --squash + git push + gh pr close
 * 核心步骤失败时回滚
 */
function localSquashMerge(featureBranch, pr) {
  const commitMsg = buildCommitMessage(pr);

  try {
    console.log('\x1b[36m切换到 main 并拉取最新代码...\x1b[0m');
    runGit(['checkout', 'main']);
    runGit(['pull', 'origin', 'main']);

    console.log(`\x1b[36m执行 git merge --squash ${featureBranch}...\x1b[0m`);
    runGit(['merge', '--squash', featureBranch]);

    console.log('\x1b[36m提交 squash merge...\x1b[0m');
    runGit(['commit', '-m', commitMsg]);

    console.log('\x1b[36m推送到 origin main...\x1b[0m');
    runGit(['push', 'origin', 'main']);
  } catch (error) {
    // 回滚：还原到 merge 前状态
    console.error('\x1b[31m合并过程中出错，尝试回滚...\x1b[0m');
    try {
      runGit(['merge', '--abort'], { capture: true });
    } catch {
      /* 可能不在 merge 状态 */
    }
    try {
      runGit(['reset', '--hard', 'origin/main']);
    } catch {
      /* 忽略 */
    }
    try {
      runGit(['checkout', featureBranch]);
    } catch {
      /* 忽略 */
    }
    throw error;
  }

  // 以下操作失败不回滚
  closeAndCleanup(featureBranch, pr, commitMsg);
}

/**
 * 关闭 PR + 删除远程分支（非致命操作）
 */
function closeAndCleanup(featureBranch, pr, commitMsg) {
  // 关闭 PR
  console.log(`\x1b[36m关闭 PR #${pr.number}...\x1b[0m`);
  const closeResult = runGh([
    'pr', 'close', String(pr.number),
    '--comment',
    `Squash merged locally to main.\n\nCommit message:\n\`\`\`\n${commitMsg}\n\`\`\``,
  ]);
  if (closeResult.status !== 0) {
    console.log('\x1b[33m  PR 关闭失败（不影响合并结果）\x1b[0m');
  }

  // 删除远程分支
  console.log(`\x1b[36m删除远程分支 ${featureBranch}...\x1b[0m`);
  try {
    runGit(['push', 'origin', '--delete', featureBranch], { capture: true });
  } catch {
    console.log('\x1b[33m  远程分支删除失败（可能已删除）\x1b[0m');
  }
}

function getLatestMainCommit() {
  return runGit(['rev-parse', '--short', 'HEAD'], { capture: true }).trim();
}

function printSummary(pr, featureBranch, commitHash, strategy) {
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
  console.log('');
  console.log('\x1b[33m下一步:\x1b[0m');
  console.log('  1. 在 /docs/AGENT_STATE.md 中勾选 QA_VALIDATED');
  console.log('  2. 激活 DevOps 专家执行部署 (/devops 或 /ship dev)');
  console.log('\x1b[32m' + '='.repeat(60) + '\x1b[0m');
}

// ==================== 主流程 ====================

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));

    // Step 1: 加载 GH_TOKEN
    loadProjectGhToken();

    // Step 2: 确保 gh CLI 可用
    ensureGhAvailable();

    // Step 3: 确保工作区干净
    ensureCleanWorkingTree();

    // Step 4: 验证当前分支
    const currentBranch = getCurrentBranch();
    if (isMainBranch(currentBranch)) {
      throw new Error(
        `当前在主干分支 (${currentBranch})，请先切换到 feature/fix 分支。`
      );
    }

    // Step 5: 查找 open PR
    const pr = findOpenPR(currentBranch);
    if (!pr) {
      throw new Error(
        `当前分支 (${currentBranch}) 没有 open PR。\n` +
        '请先执行 /tdd push 创建 PR，或检查 PR 是否已被合并/关闭。'
      );
    }
    console.log(`\x1b[32m找到 PR #${pr.number}: ${pr.title}\x1b[0m`);
    console.log(`  URL: ${pr.url}`);

    // Step 6: 自动 rebase（确保 feature 分支基于最新 main）
    const rebaseResult = autoRebaseOnMain(currentBranch, args.dryRun);

    // Step 7: rebase 后重新检查 PR 合并状态
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

    // Step 8: 运行发布门禁检查
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

    // Step 9: Dry run
    if (args.dryRun) {
      console.log('');
      console.log('\x1b[33m[DRY RUN] 将执行以下操作:\x1b[0m');
      if (rebaseResult.commitsBehind > 0) {
        console.log(`  0. rebase 到 origin/main（落后 ${rebaseResult.commitsBehind} 个提交）+ force-push`);
      } else {
        console.log('  0. 分支已与 main 同步，无需 rebase');
      }
      console.log(`  1. squash merge PR #${pr.number} (${currentBranch}) → main`);
      console.log(`  2. 删除分支 ${currentBranch}`);
      console.log(`  3. commit message: ${pr.title} (#${pr.number})`);
      console.log('\x1b[33m[DRY RUN] 未执行任何操作\x1b[0m');
      return;
    }

    // Step 10-11: 执行合并（双策略 + 防竞态）
    let strategy;
    const ghMerged = tryGhMerge(pr.number);

    if (ghMerged) {
      strategy = 'gh';
      runGit(['checkout', 'main']);
      runGit(['pull', 'origin', 'main']);
    } else {
      // 防竞态：gh 可能超时但实际已完成合并
      const prState = checkPrState(pr.number);
      if (prState === 'MERGED') {
        console.log('\x1b[32m  检测到 PR 已被合并（gh 超时但操作成功）\x1b[0m');
        strategy = 'gh';
        runGit(['checkout', 'main']);
        runGit(['pull', 'origin', 'main']);
      } else {
        strategy = 'local';
        localSquashMerge(currentBranch, pr);
      }
    }

    // Step 12: 清理本地 feature 分支（两种策略都需要）
    try {
      runGit(['branch', '-d', currentBranch], { capture: true });
    } catch {
      try {
        runGit(['branch', '-D', currentBranch], { capture: true });
      } catch {
        console.log(`\x1b[33m  本地分支 ${currentBranch} 删除失败（可手动执行）\x1b[0m`);
      }
    }

    // Step 13: 输出摘要
    const commitHash = getLatestMainCommit();
    printSummary(pr, currentBranch, commitHash, strategy);
  } catch (error) {
    console.error(`\x1b[31m/qa merge 失败: ${error.message}\x1b[0m`);
    process.exit(1);
  }
}

main();

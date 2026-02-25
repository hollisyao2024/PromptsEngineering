#!/usr/bin/env node

/**
 * /tdd worktree remove — 移除指定的 worktree
 *
 * 用法：
 *   pnpm run tdd:worktree-remove -- feature/TASK-USER-001-add-login
 *   pnpm run tdd:worktree-remove -- feature/TASK-USER-001-add-login --force
 *
 * 也可被 qa-merge.js 内部调用其逻辑作为参考。
 */

const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

// ==================== 主仓库根路径检测 ====================

function getMainRepoRoot() {
  const result = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: repoRoot,
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

// ==================== Worktree 操作 ====================

function findWorktreeByBranch(branch, mainRoot) {
  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: mainRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) return null;

  let currentPath = null;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice(9).trim();
    } else if (line.startsWith('branch ')) {
      const branchName = line.slice(7).trim().replace('refs/heads/', '');
      if (branchName === branch && currentPath !== mainRoot) {
        return currentPath;
      }
    }
  }
  return null;
}

function hasUncommittedChanges(wtPath) {
  const result = spawnSync('git', ['-C', wtPath, 'status', '--porcelain'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function doRemove(wtPath, force, mainRoot) {
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(wtPath);

  const result = spawnSync('git', args, {
    cwd: mainRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`git worktree remove 失败 (exit ${result.status})`);
  }
}

function pruneWorktrees(mainRoot) {
  spawnSync('git', ['worktree', 'prune'], {
    cwd: mainRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

// ==================== 主流程 ====================

function main() {
  try {
    const argv = process.argv.slice(2);
    const force = argv.includes('--force');
    const target = argv.find((a) => !a.startsWith('--'));

    if (!target) {
      console.error('\x1b[31m错误：需要指定目标分支名或 worktree 路径\x1b[0m');
      console.error('用法：pnpm run tdd:worktree-remove -- <branch-name> [--force]');
      process.exit(1);
    }

    const mainRoot = getMainRepoRoot();

    // 尝试按分支名查找
    let wtPath = findWorktreeByBranch(target, mainRoot);

    // 如果按分支名找不到，尝试作为路径处理
    if (!wtPath) {
      const absTarget = path.isAbsolute(target) ? target : path.resolve(mainRoot, target);
      // 验证该路径是否是已知的 worktree
      const check = spawnSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: mainRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      if (check.status === 0 && check.stdout.includes(`worktree ${absTarget}`)) {
        wtPath = absTarget;
      }
    }

    if (!wtPath) {
      console.error(`\x1b[31m错误：找不到分支 "${target}" 对应的 worktree\x1b[0m`);
      console.error('使用 pnpm run tdd:worktree-list 查看活跃的 worktree');
      process.exit(1);
    }

    // 检查未提交变更
    if (!force && hasUncommittedChanges(wtPath)) {
      console.error(`\x1b[31m错误：worktree ${wtPath} 存在未提交的变更\x1b[0m`);
      console.error('请先 commit 或 stash，或使用 --force 强制移除');
      process.exit(1);
    }

    // 检查当前进程是否在被移除的 worktree 中
    const cwd = process.cwd();
    const isInsideWorktree = cwd.startsWith(wtPath);

    // 移除
    console.log(`\x1b[36m移除 worktree: ${wtPath}\x1b[0m`);
    doRemove(wtPath, force, mainRoot);
    pruneWorktrees(mainRoot);

    console.log('\x1b[32m✓ Worktree 已移除\x1b[0m');

    if (isInsideWorktree) {
      console.log('');
      console.log(`\x1b[33m提示：当前目录已被移除，请切回主目录：\x1b[0m`);
      console.log(`  cd ${mainRoot}`);
    }
  } catch (error) {
    console.error(`\x1b[31m/tdd worktree remove 失败: ${error.message}\x1b[0m`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { findWorktreeByBranch, hasUncommittedChanges, doRemove, pruneWorktrees, getMainRepoRoot };

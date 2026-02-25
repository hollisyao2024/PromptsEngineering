#!/usr/bin/env node

/**
 * /tdd resume — 恢复暂停的分支（自动感知 worktree vs stash 模式）
 *
 * 用法：
 *   pnpm run tdd:resume                               # 列出所有可恢复的分支
 *   pnpm run tdd:resume -- feature/TASK-USER-001      # 恢复指定分支
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

// ==================== Worktree 解析 ====================

function getWorktreeList(mainRoot) {
  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: mainRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) return [];

  const entries = [];
  let current = {};
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) entries.push(current);
      current = { path: line.slice(9).trim() };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5).trim().slice(0, 7);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).trim().replace('refs/heads/', '');
    }
  }
  if (current.path) entries.push(current);
  return entries;
}

function findWorktreeForBranch(branch, mainRoot) {
  const entries = getWorktreeList(mainRoot);
  return entries.find(
    (e) => e.branch === branch && e.path !== mainRoot && !e.path.includes('/.claude/')
  ) || null;
}

// ==================== Stash 解析 ====================

function getStashList(mainRoot) {
  const result = spawnSync('git', ['stash', 'list'], {
    cwd: mainRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) return [];

  return result.stdout
    .split('\n')
    .filter((line) => line.includes('WIP:'))
    .map((line) => {
      const match = line.match(/^(stash@\{\d+\}):\s*.*?:\s*WIP:\s*(.+)/);
      if (match) return { ref: match[1], branch: match[2].trim() };
      return null;
    })
    .filter(Boolean);
}

// ==================== 恢复操作 ====================

function resumeWorktree(branch, wtPath) {
  console.log('\x1b[32m✓ 找到 worktree（worktree 模式）\x1b[0m');
  console.log(`  分支:   ${branch}`);
  console.log(`  路径:   ${wtPath}`);
  console.log('');
  console.log('\x1b[33m请切换到 worktree 目录：\x1b[0m');
  console.log(`  cd ${wtPath}`);
}

function resumeStash(branch, mainRoot) {
  console.log('\x1b[36m恢复分支（stash 模式）...\x1b[0m');

  // 1. stash 当前变更（如有）
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: mainRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (status.stdout && status.stdout.trim()) {
    const currentBranch = spawnSync('git', ['branch', '--show-current'], {
      cwd: mainRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    }).stdout.trim();
    console.log(`  暂存当前分支 (${currentBranch}) 的变更...`);
    spawnSync('git', ['stash', 'push', '-m', `WIP: ${currentBranch}`], {
      cwd: mainRoot,
      stdio: 'inherit',
    });
  }

  // 2. checkout 目标分支
  const checkout = spawnSync('git', ['checkout', branch], {
    cwd: mainRoot,
    stdio: 'inherit',
  });
  if (checkout.status !== 0) {
    console.error(`\x1b[31m切换到分支 ${branch} 失败\x1b[0m`);
    process.exit(1);
  }

  // 3. rebase origin/main
  console.log('\x1b[36m执行 rebase origin/main...\x1b[0m');
  spawnSync('git', ['fetch', 'origin', 'main'], { cwd: mainRoot, stdio: 'pipe' });
  const rebase = spawnSync('git', ['rebase', 'origin/main'], {
    cwd: mainRoot,
    stdio: 'inherit',
  });
  if (rebase.status !== 0) {
    console.log('\x1b[33mrebase 出现冲突，请手动解决后执行 git rebase --continue\x1b[0m');
  }

  // 4. 恢复 stash（按分支名匹配）
  const stashes = getStashList(mainRoot);
  const matchStash = stashes.find((s) => s.branch === branch);
  if (matchStash) {
    console.log(`  恢复暂存：${matchStash.ref}`);
    spawnSync('git', ['stash', 'pop', matchStash.ref], {
      cwd: mainRoot,
      stdio: 'inherit',
    });
  }

  console.log(`\x1b[32m✓ 已恢复到分支 ${branch}，继续 TDD 开发\x1b[0m`);
}

// ==================== 列出可恢复目标 ====================

function listResumable(mainRoot) {
  const worktrees = getWorktreeList(mainRoot).filter(
    (e) => e.path !== mainRoot && !e.path.includes('/.claude/')
  );
  const stashes = getStashList(mainRoot);

  if (worktrees.length === 0 && stashes.length === 0) {
    console.log('\x1b[33m没有可恢复的分支\x1b[0m');
    console.log('使用 /tdd new-worktree 或 /tdd new-branch 创建新分支');
    return;
  }

  console.log('\x1b[36m可恢复的分支：\x1b[0m');

  if (worktrees.length > 0) {
    console.log('');
    console.log('  \x1b[32m[Worktree]\x1b[0m（直接 cd 到对应目录）');
    for (const wt of worktrees) {
      const relPath = path.relative(mainRoot, wt.path);
      console.log(`    ${(wt.branch || '?').padEnd(40)}  ${relPath}`);
    }
  }

  if (stashes.length > 0) {
    console.log('');
    console.log('  \x1b[33m[Stash]\x1b[0m（需要 checkout + stash pop）');
    for (const s of stashes) {
      console.log(`    ${s.branch.padEnd(40)}  ${s.ref}`);
    }
  }

  console.log('');
  console.log('用法：pnpm run tdd:resume -- <branch-name>');
}

// ==================== 主流程 ====================

function main() {
  try {
    const mainRoot = getMainRepoRoot();
    const rawArgs = process.argv.slice(2).filter((a) => a !== '--');
    const targetBranch = rawArgs[0];

    if (!targetBranch) {
      listResumable(mainRoot);
      return;
    }

    // 自动感知：worktree 优先
    const wt = findWorktreeForBranch(targetBranch, mainRoot);
    if (wt) {
      resumeWorktree(targetBranch, wt.path);
    } else {
      resumeStash(targetBranch, mainRoot);
    }
  } catch (error) {
    console.error(`\x1b[31m/tdd resume 失败: ${error.message}\x1b[0m`);
    process.exit(1);
  }
}

main();

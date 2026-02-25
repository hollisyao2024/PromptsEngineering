#!/usr/bin/env node

/**
 * /tdd new-worktree — 创建 Git Worktree 用于 TDD 并行开发
 *
 * 用法：
 *   pnpm run tdd:new-worktree -- TASK-USER-001 add-login        # 有 TASK ID
 *   pnpm run tdd:new-worktree -- "" "fix login bug" --fix        # 无 TASK，fix 分支
 *   pnpm run tdd:new-worktree -- "" "dark mode"                  # 无 TASK，feature 分支
 *   pnpm run tdd:new-worktree -- TASK-USER-001 --dry-run         # 预览，不创建
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

// ==================== 主仓库根路径检测 ====================

/**
 * 检测主仓库根目录（解决从 worktree 内调用时路径嵌套问题）
 * - 主仓库中：git-common-dir 返回 "." 或 ".git"（相对路径）
 * - worktree 中：返回主仓库 .git 的绝对路径
 */
function getMainRepoRoot() {
  const result = spawnSync('git', ['rev-parse', '--git-common-dir'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    return repoRoot; // fallback
  }
  const gitCommonDir = result.stdout.trim();
  if (path.isAbsolute(gitCommonDir)) {
    return path.dirname(gitCommonDir); // worktree → 主仓库根
  }
  return repoRoot; // 已在主仓库
}

// ==================== 参数解析 ====================

function slugify(input) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getTaskId(argv) {
  const envId = process.env.TASK_ID;
  if (envId) return envId.trim().toUpperCase();
  const argId = argv[0];
  if (argId && argId.toUpperCase().startsWith('TASK-')) return argId.trim().toUpperCase();
  return null;
}

function getBranchSuffix(argv, hasTask) {
  const envSuffix = process.env.TASK_SHORT;
  if (envSuffix) return slugify(envSuffix);
  // 有 TASK 时，描述在 argv[1]；无 TASK 时，描述在 argv[0]（如果 argv[0] 不是 TASK ID）或 argv[1]
  const idx = hasTask ? 1 : (argv[0] && !argv[0].toUpperCase().startsWith('TASK-') && argv[0] !== '' ? 0 : 1);
  const argSuffix = argv[idx];
  if (argSuffix) return slugify(argSuffix);
  return '';
}

function parseArgs(argv) {
  let dryRun = false;
  let isFix = false;
  let newWindow = false;
  const positional = [];

  for (const arg of argv) {
    if (arg === '--') continue; // pnpm 传递的分隔符
    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--fix') { isFix = true; continue; }
    if (arg === '--new-window' || arg === '-n') { newWindow = true; continue; }
    positional.push(arg);
  }

  return { dryRun, isFix, newWindow, positional };
}

// ==================== 分支与 Worktree ====================

function buildBranchName(taskId, suffix, isFix) {
  if (taskId) {
    return `feature/${taskId}${suffix ? `-${suffix}` : ''}`;
  }
  if (suffix) {
    return isFix ? `fix/${suffix}` : `feature/${suffix}`;
  }
  return null;
}

function buildWorktreePath(branch, mainRoot) {
  // 去掉 feature/ 或 fix/ 前缀，/ → -，≤50 字符
  let name = branch.replace(/^(feature|fix)\//, '');
  name = name.replace(/\//g, '-');
  if (name.length > 50) name = name.slice(0, 50);
  return path.join(mainRoot, '.worktrees', name);
}

function branchExists(name) {
  const result = spawnSync('git', ['rev-parse', '--verify', name], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return result.status === 0;
}

function worktreeAlreadyMounted(wtPath, mainRoot) {
  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: mainRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) return false;
  const lines = result.stdout.split('\n');
  for (const line of lines) {
    if (line.startsWith('worktree ') && line.slice(9).trim() === wtPath) {
      return true;
    }
  }
  return false;
}

function createWorktree(wtPath, branch, mainRoot) {
  // 确保 .worktrees/ 目录存在
  const worktreesDir = path.join(mainRoot, '.worktrees');
  fs.mkdirSync(worktreesDir, { recursive: true });

  let result;
  if (branchExists(branch)) {
    // 分支已存在：直接关联
    result = spawnSync('git', ['worktree', 'add', wtPath, branch], {
      cwd: mainRoot,
      encoding: 'utf8',
      stdio: 'inherit',
    });
  } else {
    // 分支不存在：创建新分支（基于 origin/main 或 HEAD）
    const base = branchExists('origin/main') ? 'origin/main' : 'HEAD';
    result = spawnSync('git', ['worktree', 'add', '-b', branch, wtPath, base], {
      cwd: mainRoot,
      encoding: 'utf8',
      stdio: 'inherit',
    });
  }

  if (result.status !== 0) {
    throw new Error(`git worktree add 失败 (exit ${result.status})`);
  }
}

function setupEnvSymlink(wtPath, mainRoot) {
  const mainEnv = path.join(mainRoot, '.env.local');
  const wtEnv = path.join(wtPath, '.env.local');

  if (!fs.existsSync(mainEnv)) {
    console.log('\x1b[33m提示：主目录不存在 .env.local，跳过 symlink 创建\x1b[0m');
    return;
  }

  try {
    // 计算从 worktree 到主目录 .env.local 的相对路径
    const relPath = path.relative(wtPath, mainEnv);
    fs.symlinkSync(relPath, wtEnv);
    console.log('\x1b[32m✓ .env.local symlink 已创建\x1b[0m');
  } catch (err) {
    console.log(`\x1b[33m提示：.env.local symlink 创建失败（${err.message}），请手动处理\x1b[0m`);
  }
}

// ==================== 主流程 ====================

function main() {
  try {
    const { dryRun, isFix, newWindow, positional } = parseArgs(process.argv.slice(2));
    const mainRoot = getMainRepoRoot();

    const taskId = getTaskId(positional);
    const suffix = getBranchSuffix(positional, !!taskId);

    const branchName = buildBranchName(taskId, suffix, isFix);
    if (!branchName) {
      console.error('\x1b[31m错误：需要提供 TASK ID 或描述。\x1b[0m');
      console.error('用法：');
      console.error('  pnpm run tdd:new-worktree -- TASK-USER-001 add-login');
      console.error('  pnpm run tdd:new-worktree -- "" "fix login bug" --fix');
      console.error('  pnpm run tdd:new-worktree -- "" "dark mode"');
      process.exit(1);
    }

    const wtPath = buildWorktreePath(branchName, mainRoot);

    // 检查重复
    if (worktreeAlreadyMounted(wtPath, mainRoot)) {
      console.log(`\x1b[33mWorktree 已存在：${wtPath}\x1b[0m`);
      const codeArgs = newWindow ? [wtPath] : ['-r', wtPath];
      spawnSync('code', codeArgs, { encoding: 'utf8', stdio: 'pipe' });
      console.log(`\x1b[32m✓ 已在 VSCode ${newWindow ? '新窗口' : '当前窗口'}中打开已有 worktree 目录\x1b[0m`);
      return;
    }

    // Dry-run
    if (dryRun) {
      console.log('\x1b[33m[DRY RUN] /tdd new-worktree 预览：\x1b[0m');
      console.log(`  分支:     ${branchName}`);
      console.log(`  路径:     ${wtPath}`);
      console.log(`  主仓库:   ${mainRoot}`);
      console.log(`  分支存在: ${branchExists(branchName) ? '是' : '否（将新建）'}`);
      console.log('\x1b[33m[DRY RUN] 未执行任何操作\x1b[0m');
      return;
    }

    // 创建 worktree
    console.log(`\x1b[36m创建 worktree: ${branchName} → ${wtPath}\x1b[0m`);
    createWorktree(wtPath, branchName, mainRoot);

    // 设置 .env.local symlink
    setupEnvSymlink(wtPath, mainRoot);

    // 输出结果
    console.log('');
    console.log('\x1b[32m' + '='.repeat(60) + '\x1b[0m');
    console.log('\x1b[32mWorktree 创建成功\x1b[0m');
    console.log('\x1b[32m' + '='.repeat(60) + '\x1b[0m');
    console.log(`  分支:   ${branchName}`);
    console.log(`  路径:   ${wtPath}`);
    console.log('');
    console.log('\x1b[33m下一步:\x1b[0m');
    console.log('  pnpm install          # 如需安装依赖');
    console.log('  # 开始 TDD 开发...');
    console.log('  /tdd push             # 推代码 + 创建 PR（不含版本递增）');
    console.log('  /qa merge             # 合并到 main（自动版本递增 + 清理 worktree）');
    console.log('\x1b[32m' + '='.repeat(60) + '\x1b[0m');

    // 自动在 VSCode 中打开 worktree 目录
    const codeArgs = newWindow ? [wtPath] : ['-r', wtPath];
    const openResult = spawnSync('code', codeArgs, { encoding: 'utf8', stdio: 'pipe' });
    if (openResult.status === 0) {
      console.log(`\x1b[32m✓ 已在 VSCode ${newWindow ? '新窗口' : '当前窗口'}中打开 worktree 目录\x1b[0m`);
    }
  } catch (error) {
    console.error(`\x1b[31m/tdd new-worktree 失败: ${error.message}\x1b[0m`);
    process.exit(1);
  }
}

main();

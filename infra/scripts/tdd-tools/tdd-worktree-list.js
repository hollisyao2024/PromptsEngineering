#!/usr/bin/env node

/**
 * /tdd worktree list — 列出所有活跃的 TDD 并行 worktree
 *
 * 用法：
 *   pnpm run tdd:worktree-list
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

// ==================== 主流程 ====================

function main() {
  try {
    const mainRoot = getMainRepoRoot();

    const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: mainRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    if (result.status !== 0) {
      throw new Error('git worktree list 失败');
    }

    // 解析 porcelain 格式
    const entries = [];
    let current = {};
    for (const line of result.stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) entries.push(current);
        current = { path: line.slice(9).trim() };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5).trim().slice(0, 7); // 7 位缩写
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).trim().replace('refs/heads/', '');
      } else if (line === 'bare') {
        current.bare = true;
      }
    }
    if (current.path) entries.push(current);

    // 过滤：排除主工作区和 .claude/ 下的条目
    const filtered = entries.filter((e) => {
      if (e.path === mainRoot) return false;
      if (e.path.includes('/.claude/')) return false;
      return true;
    });

    if (filtered.length === 0) {
      console.log('\x1b[33m当前无活跃并行 worktree\x1b[0m');
      console.log('使用 /tdd new-worktree 创建新的并行开发环境');
      return;
    }

    console.log('\x1b[36m活跃 worktree 列表：\x1b[0m');
    console.log('');
    console.log('  分支名' + ' '.repeat(32) + '路径' + ' '.repeat(26) + 'HEAD');
    console.log('  ' + '-'.repeat(90));

    for (const entry of filtered) {
      const branch = (entry.branch || '(detached)').padEnd(38);
      const relPath = path.relative(mainRoot, entry.path).padEnd(28);
      const head = entry.head || '???????';
      console.log(`  ${branch}  ${relPath}  ${head}`);
    }

    console.log('');
    console.log(`\x1b[33m共 ${filtered.length} 个并行 worktree\x1b[0m`);
  } catch (error) {
    console.error(`\x1b[31m/tdd worktree list 失败: ${error.message}\x1b[0m`);
    process.exit(1);
  }
}

main();

#!/usr/bin/env node
const { execSync, spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function slugify(input) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// 过滤 pnpm 传递的 "--" 分隔符和 flag 参数，保留位置参数
const positionalArgs = process.argv.slice(2).filter((a) => a !== '--' && !a.startsWith('--'));

function getTaskId() {
  const envId = process.env.TASK_ID;
  if (envId) return envId.trim().toUpperCase();
  const argId = positionalArgs[0];
  if (argId && argId.toUpperCase().startsWith('TASK-')) return argId.trim().toUpperCase();
  return null;
}

function getBranchSuffix() {
  const envSuffix = process.env.TASK_SHORT;
  if (envSuffix) return slugify(envSuffix);
  const argSuffix = positionalArgs[1];
  if (argSuffix) return slugify(argSuffix);
  return '';
}

function getDescription() {
  // 无 TASK ID 时，positionalArgs[0] 作为描述（如果不是 TASK-* 开头且非空）
  const arg = positionalArgs[0];
  if (arg && arg !== '' && !arg.toUpperCase().startsWith('TASK-')) {
    return slugify(arg);
  }
  // 也检查 positionalArgs[1]（当 positionalArgs[0] 为空字符串时）
  const arg2 = positionalArgs[1];
  if (arg2) {
    return slugify(arg2);
  }
  return '';
}

function branchExists(name) {
  try {
    execSync(`git rev-parse --verify ${name}`, { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const isFix = process.argv.includes('--fix');
  const taskId = getTaskId();

  let branchName;

  if (taskId) {
    // 有 TASK ID 模式：feature/TASK-XXX[-suffix]
    const suffix = getBranchSuffix();
    branchName = `feature/${taskId}${suffix ? `-${suffix}` : ''}`;
  } else {
    // 无 TASK ID 模式：从描述生成分支名
    const desc = getDescription();
    if (!desc) {
      console.error('需要提供 TASK_ID（如 TASK-EXPORT-004）或描述文本。');
      console.error('用法：');
      console.error('  pnpm run tdd:new-branch -- TASK-USER-001 add-login');
      console.error('  pnpm run tdd:new-branch -- "fix login bug" --fix');
      console.error('  pnpm run tdd:new-branch -- "dark mode feature"');
      process.exit(1);
    }
    branchName = isFix ? `fix/${desc}` : `feature/${desc}`;
  }

  if (branchExists(branchName)) {
    console.error(`分支 ${branchName} 已存在，请先切换或删除它。`);
    process.exit(1);
  }

  const result = spawnSync('git', ['checkout', '-b', branchName, 'main'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status);
  }

  console.log(`已创建并切换到分支 ${branchName}`);
}

main();

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

function getTaskId() {
  const envId = process.env.TASK_ID;
  if (envId) return envId.trim().toUpperCase();
  const argId = process.argv[2];
  if (argId) return argId.trim().toUpperCase();
  return null;
}

function getBranchSuffix() {
  const envSuffix = process.env.TASK_SHORT;
  if (envSuffix) return slugify(envSuffix);
  const argSuffix = process.argv[3];
  if (argSuffix) return slugify(argSuffix);
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
  const taskId = getTaskId();
  if (!taskId || !taskId.startsWith('TASK-')) {
    console.error('需要提供 TASK_ID（如 TASK-EXPORT-004）。可通过 TASK_ID 环境变量或第一个参数传入。');
    process.exit(1);
  }

  const suffix = getBranchSuffix();
  const branchName = `feature/${taskId}${suffix ? `-${suffix}` : ''}`;

  if (branchExists(branchName)) {
    console.error(`分支 ${branchName} 已存在，请先切换或删除它。`);
    process.exit(1);
  }

  const result = spawnSync('git', ['checkout', '-b', branchName], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status);
  }

  console.log(`已创建并切换到分支 ${branchName}`);
}

main();

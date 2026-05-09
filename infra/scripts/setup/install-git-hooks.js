#!/usr/bin/env node
/**
 * 安装/更新 Git pre-commit hook（doc-aware 版本）。
 *
 * 复制 infra/scripts/git-hooks/<name> 到主仓库 .git/hooks/<name>，
 * 自动 chmod +x。已存在的 hook 会被覆盖（前提：内容来自模板或允许覆盖）。
 *
 * 用法：
 *   node infra/scripts/setup/install-git-hooks.js            # 安装/更新所有 hook
 *   node infra/scripts/setup/install-git-hooks.js --dry-run  # 仅打印计划
 *   node infra/scripts/setup/install-git-hooks.js --force    # 即使非模板托管的 hook 也覆盖
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { resolveRepoRoot } = require('../shared/config');

const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
const hooksSrcDir = path.join(repoRoot, 'infra/scripts/git-hooks');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

const TEMPLATE_MARKER = 'infra/scripts/setup/install-git-hooks.js';

function resolveGitHooksDir() {
  // 主仓库 .git/hooks（worktree 共享主 .git 的 hooks 路径）
  let gitDir;
  try {
    gitDir = execSync('git rev-parse --git-common-dir', {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    console.error(`❌ 无法定位 .git 目录：${error.message}`);
    process.exit(1);
  }
  if (!path.isAbsolute(gitDir)) {
    gitDir = path.resolve(repoRoot, gitDir);
  }
  return path.join(gitDir, 'hooks');
}

function shouldOverwrite(targetPath) {
  if (force) return true;
  if (!fs.existsSync(targetPath)) return true;
  const content = fs.readFileSync(targetPath, 'utf8');
  // 已带模板标记 → 安全覆盖
  if (content.includes(TEMPLATE_MARKER)) return true;
  return false;
}

function installHook(hookName, srcPath, destDir) {
  const destPath = path.join(destDir, hookName);
  const action = !fs.existsSync(destPath) ? 'install' : 'update';

  if (!shouldOverwrite(destPath)) {
    console.warn(
      `⚠️  ${hookName}: 目标已存在且非模板托管（无 ${TEMPLATE_MARKER} 标记），跳过。`
    );
    console.warn(
      `   如需强制覆盖请加 --force；备份建议：cp "${destPath}" "${destPath}.bak"`
    );
    return { hookName, status: 'skipped' };
  }

  if (dryRun) {
    console.log(`🟡 [dry-run] ${action} ${hookName} ← ${path.relative(repoRoot, srcPath)}`);
    return { hookName, status: 'planned' };
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  fs.chmodSync(destPath, 0o755);
  console.log(`✅ ${action === 'install' ? '已安装' : '已更新'} ${hookName} → ${path.relative(repoRoot, destPath)}`);
  return { hookName, status: action === 'install' ? 'installed' : 'updated' };
}

function main() {
  if (!fs.existsSync(hooksSrcDir)) {
    console.error(`❌ 未找到模板源目录: ${path.relative(repoRoot, hooksSrcDir)}`);
    process.exit(1);
  }

  const destDir = resolveGitHooksDir();
  const entries = fs
    .readdirSync(hooksSrcDir)
    .filter((name) => !name.startsWith('.') && !name.endsWith('.md'))
    .map((name) => ({ name, src: path.join(hooksSrcDir, name) }))
    .filter(({ src }) => fs.statSync(src).isFile());

  if (entries.length === 0) {
    console.warn(`⚠️  ${path.relative(repoRoot, hooksSrcDir)} 下没有可安装的 hook 文件。`);
    return;
  }

  console.log(`ℹ️  安装目标: ${destDir}`);
  console.log(`ℹ️  模板源:   ${path.relative(repoRoot, hooksSrcDir)}`);
  if (dryRun) console.log(`ℹ️  dry-run 模式：仅展示计划，不写文件。`);
  if (force) console.log(`ℹ️  --force：覆盖非模板托管的 hook。`);
  console.log('');

  const results = entries.map(({ name, src }) => installHook(name, src, destDir));
  const counters = results.reduce(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }),
    {}
  );

  console.log('');
  console.log(
    `📊 完成: ${entries.length} 个 hook，${
      Object.entries(counters)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ')
    }`
  );
}

main();

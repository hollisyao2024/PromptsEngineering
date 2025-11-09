#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');

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

function main() {
  try {
    ensureCleanWorkingTree();
    const args = process.argv.slice(2);
    const { pkg, version: currentVersion } = readPackageVersion();
    const targetVersion = prepareTargetVersion(currentVersion, args);
    if (targetVersion === currentVersion) {
      throw new Error(`目标版本 (${targetVersion}) 与当前版本一致，请指定更高的版本。`);
    }

    const releaseNote = extractReleaseNote(args) || `发布新版 v${targetVersion}`;
    updatePackageVersion(pkg, targetVersion);
    insertChangelogEntry(targetVersion, releaseNote);

    stageFiles();
    commitRelease(targetVersion);

    const tagName = `v${targetVersion}`;
    ensureTagDoesNotExist(tagName);
    createTag(tagName, releaseNote);
    pushBranchAndTags(tagName);

    console.log(`\u001b[32m/tdd push 完成：v${targetVersion} 已打 tag 并推送到远端。\u001b[0m`);
  } catch (error) {
    console.error(`\u001b[31m/tdd push 失败: ${error.message}\u001b[0m`);
    process.exit(1);
  }
}

main();

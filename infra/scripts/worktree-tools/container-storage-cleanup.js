#!/usr/bin/env node
'use strict';

/**
 * Prune disposable container-layer data without touching reusable package caches,
 * active worktree state, or database backups.  It is intentionally dry-run by
 * default; callers must pass --apply after inspecting its plan.
 */
const fs = require('fs');
const path = require('path');
const { loadConfig, getMainRepoRoot, resolveContainerPath } = require('../shared/config');
const { safeRemoveTreeNoFollow, isPathInside } = require('./worktree-core');

const PROTECTED_TMP_NAMES = new Set([
  'agent-locks', 'agent-task-runs', 'worktree-sessions', 'server-dev', 'dev-app', 'dev-app-win',
  'dev-app-logs', 'devops-runs', 'scan-manifests',
]);

function parsePositiveInt(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} 必须是正整数`);
  return parsed;
}

function parseArgs(argv) {
  const options = { apply: false, tmpDays: undefined, releaseKeep: undefined, prArtifactDays: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--tmp-days' || arg === '--release-keep' || arg === '--pr-artifact-days') {
      const key = arg === '--tmp-days' ? 'tmpDays' : arg === '--release-keep' ? 'releaseKeep' : 'prArtifactDays';
      options[key] = parsePositiveInt(argv[++index], arg);
    } else if (arg.startsWith('--tmp-days=')) options.tmpDays = parsePositiveInt(arg.slice(11), '--tmp-days');
    else if (arg.startsWith('--release-keep=')) options.releaseKeep = parsePositiveInt(arg.slice(15), '--release-keep');
    else if (arg.startsWith('--pr-artifact-days=')) options.prArtifactDays = parsePositiveInt(arg.slice(19), '--pr-artifact-days');
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

function isExpired(modified, now, days) {
  return new Date(modified).getTime() < now.getTime() - days * 24 * 60 * 60 * 1000;
}

function buildTmpCleanupPlan(entries, { now = new Date(), tmpDays = 7 } = {}) {
  const plan = { remove: [], keep: [] };
  for (const entry of entries) {
    if (PROTECTED_TMP_NAMES.has(entry.name) || !isExpired(entry.modified, now, tmpDays)) plan.keep.push(entry);
    else plan.remove.push({ ...entry, reason: `tmp 超过 ${tmpDays} 天且非运行态目录` });
  }
  return plan;
}

function releaseGroup(name) {
  return name.replace(/(?:\.tar\.gz(?:\.sha256)?|-linux-amd64-glibc-installer\.run(?:\.sha256)?|-ubuntu-amd64-installer\.run(?:\.sha256)?|-install\.desktop)$/i, '');
}

function buildArtifactCleanupPlan({ releases = [], privateEdition = [] }, { now = new Date(), releaseKeep = 2, prArtifactDays = 7 } = {}) {
  const plan = { remove: [], keep: [] };
  const groups = new Map();
  for (const entry of releases) {
    const key = releaseGroup(entry.name);
    const group = groups.get(key) || { entries: [], modified: 0 };
    group.entries.push(entry);
    group.modified = Math.max(group.modified, new Date(entry.modified).getTime());
    groups.set(key, group);
  }
  const keptGroups = new Set([...groups.entries()].sort((a, b) => b[1].modified - a[1].modified).slice(0, releaseKeep).map(([key]) => key));
  for (const [key, group] of groups) {
    const target = keptGroups.has(key) ? plan.keep : plan.remove;
    for (const entry of group.entries) target.push(keptGroups.has(key) ? entry : { ...entry, reason: `企业版发布产物仅保留最新 ${releaseKeep} 组` });
  }
  for (const entry of privateEdition) {
    if (/^pr-\d+$/i.test(entry.name) && isExpired(entry.modified, now, prArtifactDays)) {
      plan.remove.push({ ...entry, reason: `已关闭 PR 的产物超过 ${prArtifactDays} 天` });
    } else {
      plan.keep.push(entry);
    }
  }
  return plan;
}

function readEntries(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).map((dirent) => {
    const itemPath = path.join(root, dirent.name);
    const stat = fs.lstatSync(itemPath);
    return { name: dirent.name, path: itemPath, modified: stat.mtime, isDirectory: dirent.isDirectory(), isSymbolicLink: stat.isSymbolicLink() };
  });
}

function removeEntry(entry, allowedRoot) {
  if (!isPathInside(allowedRoot, entry.path) || entry.isSymbolicLink) {
    throw new Error(`拒绝删除越界或链接路径：${entry.path}`);
  }
  if (entry.isDirectory) safeRemoveTreeNoFollow(entry.path, { allowedRoot });
  else fs.rmSync(entry.path, { force: true });
}

function cleanupContainerStorage({ cwd = process.cwd(), options = {}, now = new Date() } = {}) {
  const mainRoot = getMainRepoRoot(cwd);
  const config = loadConfig({ repoRoot: mainRoot });
  const retention = config.containerRetention || {};
  const resolved = {
    tmpDays: options.tmpDays || retention.tmpDays || 7,
    releaseKeep: options.releaseKeep || retention.privateReleaseKeep || 2,
    prArtifactDays: options.prArtifactDays || retention.prArtifactDays || 7,
  };
  const tmpRoot = resolveContainerPath(config, mainRoot, 'tmp');
  const artifactsRoot = resolveContainerPath(config, mainRoot, 'artifacts');
  const privateRoot = path.join(artifactsRoot, 'private-edition');
  const tmpPlan = buildTmpCleanupPlan(readEntries(tmpRoot), { now, ...resolved });
  const artifactPlan = buildArtifactCleanupPlan({
    releases: readEntries(path.join(privateRoot, 'releases')),
    privateEdition: readEntries(privateRoot).filter((entry) => entry.name !== 'releases'),
  }, { now, ...resolved });
  const remove = [...tmpPlan.remove, ...artifactPlan.remove];
  if (options.apply) {
    for (const entry of tmpPlan.remove) removeEntry(entry, tmpRoot);
    for (const entry of artifactPlan.remove) removeEntry(entry, artifactsRoot);
  }
  return { apply: Boolean(options.apply), retention: resolved, remove, keep: [...tmpPlan.keep, ...artifactPlan.keep] };
}

function printHelp() {
  console.log('Usage: node infra/scripts/worktree-tools/container-storage-cleanup.js [--apply] [--tmp-days N] [--release-keep N] [--pr-artifact-days N]');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  const result = cleanupContainerStorage({ options });
  console.log(`MODE=${result.apply ? 'APPLY' : 'DRY_RUN'}`);
  console.log(`REMOVE_COUNT=${result.remove.length}`);
  for (const entry of result.remove) console.log(`REMOVE ${entry.path} :: ${entry.reason}`);
  console.log(`KEEP_COUNT=${result.keep.length}`);
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(`container cleanup failed: ${error.message}`); process.exit(1); }
}

module.exports = { buildArtifactCleanupPlan, buildTmpCleanupPlan, cleanupContainerStorage, parseArgs, releaseGroup };

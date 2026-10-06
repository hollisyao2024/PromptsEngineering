#!/usr/bin/env node
/**
 * tdd commit：提交已暂存的改动，提交身份只来自 git 已有身份或 .env.local 的 GH_TOKEN 所属账号。
 *
 * git 没有身份时，作者与提交者取自 GH_TOKEN 所属 GitHub 账号，只经本次 git 进程的环境变量传递，
 * 不写任何 git 配置；两者都没有时阻断，不退回 git 自动探测或手填身份。
 */
'use strict';

const { spawnSync } = require('child_process');
const { resolveRepoRoot } = require('../shared/config');
const { getProjectGitHubToken } = require('../shared/github-auth');
const { resolveCommitIdentity } = require('../shared/github-identity');
const { exitOnHelp } = require('../shared/cli-help');

const USAGE = [
  'Usage: pnpm agent -- tdd commit [git commit 选项...]',
  '',
  '提交已暂存的改动，选项原样转发给 git commit。',
  'git 没有提交身份时，作者与提交者取自 .env.local 中 GH_TOKEN 所属的 GitHub 账号，只在本次提交内生效，不写任何 git 配置；',
  'git 已有显式身份时保持不变；两者都没有时阻断，不退回 git 自动探测。',
  '不接受 --author：作者只来自 git 已有身份或 GH_TOKEN 账号。',
].join('\n');

// git 允许长选项缩写（--au 即 --author），按前缀一并拦截；-- 之后是路径，不再检查。
function overridesAuthor(arg) {
  if (!arg.startsWith('--')) return false;
  const name = arg.slice(2).split('=')[0];
  return name.length >= 2 && 'author'.startsWith(name);
}

function hasAuthorOverride(argv) {
  const separator = argv.indexOf('--');
  const own = separator === -1 ? argv : argv.slice(0, separator);
  return own.some(overridesAuthor);
}

function oneLine(value) {
  return String(value).replace(/\s*\n\s*/gu, ' ').trim();
}

function tailOf(text, limit = 300) {
  const value = oneLine(text || '');
  return value.length > limit ? `…${value.slice(-limit)}` : value;
}

function report(log, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== '') log(`${key}=${oneLine(value)}`);
  }
}

function blocked(log, { summary, nextAction, source }) {
  report(log, { STATUS: 'BLOCKED', SUMMARY: summary, NEXT_ACTION: nextAction, IDENTITY_SOURCE: source });
  return 1;
}

function main({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  repoRoot = resolveRepoRoot({ scriptDir: __dirname, cwd }),
  env = process.env,
  stdio = 'inherit',
  lookup,
  log = console.log,
} = {}) {
  if (hasAuthorOverride(argv)) {
    return blocked(log, {
      summary: '不接受 --author：提交作者只来自 git 已有身份或 GH_TOKEN 所属账号',
      nextAction: '去掉 --author 后重试',
    });
  }

  const args = ['commit', ...argv];
  const token = getProjectGitHubToken({ repoRoot, cwd, env });
  let resolved;
  try {
    resolved = resolveCommitIdentity({ args, cwd, env, token, lookup });
  } catch (error) {
    return blocked(log, {
      summary: error.message,
      nextAction: '确认 .env.local 的 GH_TOKEN 有效且能访问 api.github.com 后重试；不要改用手填身份',
      source: 'unresolved',
    });
  }
  if (resolved.source === 'unresolved') {
    return blocked(log, {
      summary: 'git 没有提交身份，且未从 .env.local 读取到 GH_TOKEN，无法推导提交身份',
      nextAction: '在仓库 .env.local 配置 GH_TOKEN 后重试；不要改用手填身份或 git 自动探测',
      source: 'unresolved',
    });
  }

  const commit = spawnSync('git', args, { cwd, env: resolved.env, encoding: 'utf8', stdio });
  if (commit.error) {
    return blocked(log, {
      summary: `无法启动 git commit：${commit.error.message}`,
      nextAction: '确认 git 可用后重试',
      source: resolved.source,
    });
  }
  if (commit.status !== 0) {
    const detail = tailOf(commit.stderr || commit.stdout);
    const exit = commit.signal ? `信号 ${commit.signal}` : `退出码 ${commit.status}`;
    return blocked(log, {
      summary: `git commit 失败（${exit}）${detail ? `：${detail}` : ''}`,
      nextAction: '按 git 输出修复（常见：没有暂存变更、hook 未通过）后重试',
      source: resolved.source,
    });
  }

  const head = spawnSync('git', ['log', '-1', '--format=%H%n%h %s'], { cwd, env, encoding: 'utf8', stdio: 'pipe' });
  const [sha = '', brief = ''] = head.status === 0 ? String(head.stdout).trim().split('\n') : [];
  const { identity } = resolved;
  report(log, {
    STATUS: 'OK',
    SUMMARY: brief ? `已提交 ${brief}` : '已提交',
    NEXT_ACTION: '继续开发；交付时依次执行 pnpm agent -- tdd sync、tdd push',
    IDENTITY_SOURCE: resolved.source,
    IDENTITY: identity ? `${identity.name} <${identity.email}>` : undefined,
    COMMIT: sha,
  });
  return 0;
}

if (require.main === module) {
  exitOnHelp(USAGE);
  process.exitCode = main();
}

module.exports = { main };

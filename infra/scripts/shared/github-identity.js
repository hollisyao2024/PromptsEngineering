'use strict';

/**
 * 提交身份：git 没有身份时，由 .env.local 的 GH_TOKEN 所属 GitHub 账号补齐。
 *
 * - 只对 commit 与注解 tag 生效；git 已有显式身份的角色（作者 / 提交者）保持不动。
 * - 只通过本次 git 进程的 GIT_AUTHOR_* / GIT_COMMITTER_* 环境变量传递，不写任何 git 配置，也不落盘缓存。
 * - 账号查询放在子进程里完成：buildGitHubGitEnv 是同步接口，而 GitHub API 请求是异步的；
 *   令牌只经子进程环境变量传递，不进 argv，输出与错误中的令牌一律替换为 ***。
 * - 有令牌却查不到账号时抛错（fail closed），不退回 git 自动探测（EMAIL、主机名）或任何手填身份；
 *   没有令牌时返回 unresolved，由调用方决定是否阻断（tdd commit 阻断，buildGitHubGitEnv 保持 git 原行为）。
 */

const { spawnSync } = require('child_process');

const PROBE_FLAG = '--probe';
const PROBE_TOKEN_ENV = 'XIRANG_GITHUB_IDENTITY_TOKEN';
const LOOKUP_TIMEOUT_MS = 15000;
const LOOKUP_ERROR_PREFIX = '无法由 GH_TOKEN 推导提交身份';

const ROLES = Object.freeze({
  author: Object.freeze({ envPrefix: 'GIT_AUTHOR', identVar: 'GIT_AUTHOR_IDENT' }),
  committer: Object.freeze({ envPrefix: 'GIT_COMMITTER', identVar: 'GIT_COMMITTER_IDENT' }),
});

// 注解 tag 由 -a/-s/-u/-m/-F（及长选项）创建；删除、列出、校验不会写 tagger。
const TAG_ANNOTATE_LONG = new Set(['--annotate', '--sign']);
const TAG_ANNOTATE_VALUE_LONG = new Set(['--message', '--file', '--local-user']);
const TAG_NON_CREATING_LONG = new Set(['--delete', '--list', '--verify']);
const TAG_ANNOTATE_SHORT = new Set(['a', 's']);
const TAG_ANNOTATE_VALUE_SHORT = new Set(['m', 'F', 'u']);
const TAG_NON_CREATING_SHORT = new Set(['d', 'l', 'v']);

// GitHub 登录名：字母数字开头结尾，中间可含连字符；企业托管账号还可能含下划线。
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/u;

const identityCache = new Map();

function clearIdentityCache() {
  identityCache.clear();
}

function redact(text, token) {
  const value = String(text ?? '');
  return token ? value.split(token).join('***') : value;
}

function lookupFailure(detail, token) {
  return new Error(`${LOOKUP_ERROR_PREFIX}：${redact(detail, token)}`);
}

function isAnnotatedTagCommand(args) {
  let annotated = false;
  let skipNext = false;
  for (const arg of args.slice(1)) {
    if (arg === '--') break;
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (arg.startsWith('--')) {
      const name = arg.split('=')[0];
      if (TAG_NON_CREATING_LONG.has(name)) return false;
      if (TAG_ANNOTATE_LONG.has(name)) annotated = true;
      if (TAG_ANNOTATE_VALUE_LONG.has(name)) {
        annotated = true;
        skipNext = !arg.includes('=');
      }
      continue;
    }
    if (arg.length > 1 && arg.startsWith('-')) {
      const flags = [...arg.slice(1)];
      for (const [index, flag] of flags.entries()) {
        if (TAG_NON_CREATING_SHORT.has(flag)) return false;
        if (TAG_ANNOTATE_SHORT.has(flag)) annotated = true;
        if (TAG_ANNOTATE_VALUE_SHORT.has(flag)) {
          annotated = true;
          skipNext = index === flags.length - 1;
          break;
        }
      }
    }
  }
  return annotated;
}

// commit 需要作者与提交者；注解 tag 只需要提交者（tagger）；其余命令不需要身份。
function identityRolesForGitArgs(args = []) {
  const [command] = args;
  if (command === 'commit') return ['author', 'committer'];
  if (command === 'tag' && isAnnotatedTagCommand(args)) return ['committer'];
  return [];
}

// 让 git 自己判断：useConfigOnly 关闭 EMAIL / 主机名自动探测，只认配置或 GIT_* 环境变量里的显式身份。
function hasExplicitIdentity(role, { cwd = process.cwd(), env = process.env } = {}) {
  if (!Object.hasOwn(ROLES, role)) throw new Error(`unknown identity role: ${role}`);
  const result = spawnSync('git', ['-c', 'user.useConfigOnly=true', 'var', ROLES[role].identVar], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return !result.error && result.status === 0;
}

// 与 git 自己清理姓名的规则一致：控制字符与 < > 换成空格，去掉首尾的 . , : ; " ' \ 与空白。
function cleanIdentityText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s.,:;"'\\]+|[\s.,:;"'\\]+$/gu, '');
}

// 与 GitHub 自己为该账号生成的 noreply 提交身份一致，squash 合并产生的提交同样使用它。
function identityFromAccount(account) {
  const login = account && typeof account.login === 'string' ? account.login : '';
  const id = account ? account.id : undefined;
  if (!LOGIN_PATTERN.test(login) || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error('GitHub 账号信息不完整：缺少有效的 login 或 id');
  }
  return {
    name: cleanIdentityText(account.name) || login,
    email: `${id}+${login}@users.noreply.github.com`,
    login,
  };
}

function normalizeIdentity(identity) {
  const name = identity && typeof identity.name === 'string' ? identity.name.trim() : '';
  const email = identity && typeof identity.email === 'string' ? identity.email.trim() : '';
  if (!name || !email) throw new Error('提交身份无效：缺少姓名或邮箱');
  return { ...identity, name, email };
}

function unchanged(env, source) {
  return { env, source, filledRoles: [], identity: null };
}

/**
 * 按 git 子命令判断是否需要补身份，并返回补好身份的新环境（不修改传入的 env）。
 * source：not-needed 无需身份；configured git 已有显式身份；github-token 已由令牌账号补齐；
 * unresolved 需要身份但没有令牌，由调用方决定如何阻断。
 */
function resolveCommitIdentity({
  args = [],
  cwd = process.cwd(),
  env = process.env,
  token = '',
  lookup = lookupGitHubCommitIdentity,
} = {}) {
  const roles = identityRolesForGitArgs(args);
  if (roles.length === 0) return unchanged(env, 'not-needed');

  const missing = roles.filter((role) => !hasExplicitIdentity(role, { cwd, env }));
  if (missing.length === 0) return unchanged(env, 'configured');
  if (!token) return unchanged(env, 'unresolved');

  const identity = normalizeIdentity(lookup({ token, env }));
  const filled = { ...env };
  for (const role of missing) {
    filled[`${ROLES[role].envPrefix}_NAME`] = identity.name;
    filled[`${ROLES[role].envPrefix}_EMAIL`] = identity.email;
  }

  const rejected = missing.filter((role) => !hasExplicitIdentity(role, { cwd, env: filled }));
  if (rejected.length > 0) {
    throw new Error(`提交身份无效：git 不接受该姓名或邮箱（${rejected.join('、')}）`);
  }
  return { env: filled, source: 'github-token', filledRoles: missing, identity };
}

function parseProbeReply(stdout) {
  const lines = String(stdout || '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  try {
    const parsed = JSON.parse(lines[lines.length - 1]);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function isFilledString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function tailOf(text, limit = 200) {
  const value = String(text || '').trim();
  return value.length > limit ? `…${value.slice(-limit)}` : value;
}

// 同一进程内同一令牌只查一次；失败不缓存。查询在子进程中完成，令牌只经子进程环境变量传递。
function lookupGitHubCommitIdentity({
  token,
  env = process.env,
  timeoutMs = LOOKUP_TIMEOUT_MS,
  spawn = spawnSync,
} = {}) {
  if (!token) throw lookupFailure('未提供 GH_TOKEN（请在仓库 .env.local 中配置）', token);
  if (identityCache.has(token)) return { ...identityCache.get(token) };

  const childEnv = { ...env, [PROBE_TOKEN_ENV]: token };
  delete childEnv.GH_TOKEN;
  delete childEnv.GITHUB_TOKEN;
  const result = spawn(process.execPath, [__filename, PROBE_FLAG], {
    env: childEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    windowsHide: true,
  }) || {};

  if (result.error) {
    throw lookupFailure(
      result.error.code === 'ETIMEDOUT'
        ? `查询 GitHub 账号超时（${timeoutMs}ms）`
        : `无法启动账号查询进程（${result.error.message}）`,
      token
    );
  }

  const reply = parseProbeReply(result.stdout);
  if (!reply) {
    if (result.status === 0) throw lookupFailure('无法解析账号查询结果', token);
    const exit = result.signal ? `信号 ${result.signal}` : `退出码 ${result.status}`;
    const detail = tailOf(result.stderr);
    throw lookupFailure(`账号查询进程异常退出（${exit}）${detail ? `：${detail}` : ''}`, token);
  }
  if (reply.ok === false) {
    throw lookupFailure(`GitHub 账号查询失败：${reply.message || '未知错误'}`, token);
  }
  if (result.status !== 0 || reply.ok !== true || !isFilledString(reply.name) || !isFilledString(reply.email)) {
    throw lookupFailure('无法解析账号查询结果', token);
  }

  const identity = { name: reply.name, email: reply.email };
  if (typeof reply.login === 'string') identity.login = reply.login;
  identityCache.set(token, identity);
  return { ...identity };
}

// 子进程入口：向 GitHub 查询令牌所属账号，向 stdout 输出一行 JSON；令牌只来自环境变量。
async function runProbe({
  env = process.env,
  write = (line) => process.stdout.write(`${line}\n`),
  request,
} = {}) {
  const reply = (payload) => write(JSON.stringify(payload));
  const token = env[PROBE_TOKEN_ENV];
  if (!token) {
    reply({ ok: false, status: 0, message: '未收到 GH_TOKEN 令牌' });
    return 1;
  }

  try {
    const call = request || require('./github-api').githubApiRequest;
    const identity = identityFromAccount(await call('GET', '/user', { token }));
    reply({ ok: true, ...identity });
    return 0;
  } catch (error) {
    reply({
      ok: false,
      status: Number.isInteger(error && error.statusCode) ? error.statusCode : 0,
      message: redact(error && error.message, token),
    });
    return 1;
  }
}

if (require.main === module && process.argv[2] === PROBE_FLAG) {
  runProbe().then((code) => {
    process.exitCode = code;
  });
}

module.exports = {
  LOOKUP_TIMEOUT_MS,
  PROBE_FLAG,
  PROBE_TOKEN_ENV,
  clearIdentityCache,
  hasExplicitIdentity,
  identityFromAccount,
  identityRolesForGitArgs,
  lookupGitHubCommitIdentity,
  resolveCommitIdentity,
  runProbe,
};

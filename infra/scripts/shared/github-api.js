'use strict';

/**
 * GitHub 访问后端：优先使用项目 GH_TOKEN 调用 REST API，无令牌时保留 gh CLI 兼容路径。
 * tdd push 与 qa merge 共用，保证两端在同一环境下行为一致。
 */

const https = require('https');
const { spawnSync } = require('child_process');
const { buildProxyEnvironment } = require('../../../tooling/xirang/system-proxy');

function isGhAvailable() {
  const result = spawnSync('gh', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
  return !result.error && result.status === 0;
}

function parseGitHubRepoSlug(remoteUrl) {
  const normalized = String(remoteUrl || '').trim().replace(/\.git$/, '');
  const match = normalized.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/]+)$/i);
  if (!match || !match.groups) return null;
  return {
    owner: match.groups.owner,
    repo: match.groups.repo,
  };
}

// 代理偶发断连时仅重试幂等请求；仍经同一代理，绝不直连回退。
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD']);
const TRANSIENT_PROXY_ERROR_CODES = new Set([
  'ECONNRESET', // 含 socket hang up 与 TLS 握手前断开
  'ETIMEDOUT',
  'EPIPE',
  'ECONNREFUSED',
  'ECONNABORTED',
]);
const DEFAULT_PROXY_RETRY_DELAYS_MS = [500, 1500];

function githubApiRequestAttempt(method, apiPath, { token = process.env.GH_TOKEN, body, userAgent = 'xirang-agent', env = process.env, proxyOptions = {} } = {}) {
  return new Promise((resolve, reject) => {
    if (!token) {
      reject(new Error('GH_TOKEN is required for GitHub API fallback'));
      return;
    }

    const proxyEnv = buildProxyEnvironment({ ...proxyOptions, env, target: 'https://api.github.com/' });
    const selectedProxy = proxyEnv.https_proxy;
    if (selectedProxy) {
      const [major, minor] = process.versions.node.split('.').map(Number);
      if (!(major > 24 || (major === 24 && minor >= 5) || (major === 22 && minor >= 21))) {
        reject(new Error('GITHUB_PROXY_UNSUPPORTED_RUNTIME: use Node 24.5+ or 22.21+'));
        return;
      }
      if (!/^https?:\/\//i.test(selectedProxy)) {
        reject(new Error('GITHUB_PROXY_UNSUPPORTED: API proxy must use an http:// or https:// URL'));
        return;
      }
    }
    // Scoped agent also works when this process started before proxy discovery.
    // Never change the global agent used by unrelated application traffic.
    let agent;
    try { agent = new https.Agent({ proxyEnv, keepAlive: false }); }
    catch {
      reject(new Error('GITHUB_PROXY_INVALID: check proxy configuration'));
      return;
    }
    const payload = body === undefined ? '' : JSON.stringify(body);
    const request = https.request(
      {
        hostname: 'api.github.com',
        path: apiPath,
        method,
        agent,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => {
          agent.destroy();
          let data = null;
          if (raw.trim()) {
            try {
              data = JSON.parse(raw);
            } catch {
              data = raw;
            }
          }

          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(data);
            return;
          }

          const message =
            data && typeof data === 'object' && data.message ? data.message : raw.trim();
          const error = new Error(
            `GitHub API ${method} ${apiPath} failed (${response.statusCode}): ${message}`
          );
          error.statusCode = response.statusCode;
          error.response = data;
          reject(error);
        });
      }
    );

    const timeoutError = () => Object.assign(new Error('GitHub API request timed out'), { code: 'ETIMEDOUT' });
    request.setTimeout(30000, () => request.destroy(timeoutError()));
    const deadline = setTimeout(() => request.destroy(timeoutError()), 30000);
    deadline.unref();
    request.on('close', () => clearTimeout(deadline));
    request.on('error', (error) => {
      agent.destroy();
      // Do not include proxy URLs (which may contain credentials) in diagnostics.
      if (!selectedProxy) {
        reject(error);
        return;
      }
      const proxyError = new Error(`GITHUB_PROXY_REQUEST_FAILED: ${error.code || 'connection failed'}`);
      proxyError.code = error.code;
      proxyError.proxyRequestFailed = true;
      reject(proxyError);
    });
    if (payload) request.write(payload);
    request.end();
  });
}

async function githubApiRequest(method, apiPath, options = {}) {
  const {
    requestAttempt = githubApiRequestAttempt,
    proxyRetryDelaysMs = DEFAULT_PROXY_RETRY_DELAYS_MS,
  } = options;
  const maxAttempts = IDEMPOTENT_METHODS.has(String(method).toUpperCase()) ? proxyRetryDelaysMs.length + 1 : 1;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await requestAttempt(method, apiPath, options);
    } catch (error) {
      if (!error || !error.proxyRequestFailed) throw error;
      if (attempt < maxAttempts && TRANSIENT_PROXY_ERROR_CODES.has(error.code)) {
        await new Promise((resolve) => setTimeout(resolve, proxyRetryDelaysMs[attempt - 1]));
        continue;
      }
      const final = new Error(`${error.message}; attempts=${attempt}; no direct retry`);
      final.code = error.code;
      throw final;
    }
  }
}

function createGitHubBackend({
  ghAvailable,
  token = process.env.GH_TOKEN,
  remoteUrl = '',
  apiRequest = githubApiRequest,
} = {}) {
  if (!token) {
    // 仅无令牌时探测 CLI；已选 API 后不切换后端或鉴权身份。
    if (ghAvailable === undefined ? isGhAvailable() : ghAvailable) return { mode: 'gh' };
    throw new Error(
      '未读取到 GH_TOKEN，且 gh CLI 未安装或不可用。\n' +
      '  请在仓库根目录 .env.local 配置 GH_TOKEN，以使用 GitHub REST API。'
    );
  }

  const slug = parseGitHubRepoSlug(remoteUrl);
  if (!slug) {
    throw new Error(`无法从 origin remote 解析 GitHub 仓库：${remoteUrl || '<empty>'}`);
  }

  return {
    mode: 'api',
    token,
    owner: slug.owner,
    repo: slug.repo,
    apiRequest,
  };
}

function repoApiPath(backend, suffix) {
  return `/repos/${encodeURIComponent(backend.owner)}/${encodeURIComponent(backend.repo)}${suffix}`;
}

module.exports = {
  createGitHubBackend,
  githubApiRequest,
  isGhAvailable,
  parseGitHubRepoSlug,
  repoApiPath,
};

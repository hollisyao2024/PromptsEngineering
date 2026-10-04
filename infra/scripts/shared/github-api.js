'use strict';

/**
 * GitHub 访问后端：优先 gh CLI，缺失时使用项目 GH_TOKEN 直连 GitHub REST API。
 * tdd push 与 qa merge 共用，保证两端在同一环境下行为一致。
 */

const https = require('https');
const { spawnSync } = require('child_process');

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

function githubApiRequest(method, apiPath, { token = process.env.GH_TOKEN, body, userAgent = 'xirang-agent' } = {}) {
  return new Promise((resolve, reject) => {
    if (!token) {
      reject(new Error('GH_TOKEN is required for GitHub API fallback'));
      return;
    }

    const payload = body === undefined ? '' : JSON.stringify(body);
    const request = https.request(
      {
        hostname: 'api.github.com',
        path: apiPath,
        method,
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

    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function createGitHubBackend({
  ghAvailable = isGhAvailable(),
  token = process.env.GH_TOKEN,
  remoteUrl = '',
  apiRequest = githubApiRequest,
} = {}) {
  if (ghAvailable) return { mode: 'gh' };

  if (!token) {
    throw new Error(
      'gh CLI 未安装或不可用，且未从 .env.local 读取到 GH_TOKEN。\n' +
      '  安装 gh CLI，或在仓库根目录 .env.local 配置 GH_TOKEN。'
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

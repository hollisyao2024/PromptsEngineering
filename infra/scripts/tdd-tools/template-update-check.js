'use strict';

/**
 * 息壤模板更新提醒：仓库级 finish 成功后只读比对本地 lock 与官方 manifest 的作业包版本。
 * 只提醒、不更新；任何失败都降级为 UNKNOWN，绝不改变 finish 的结果。
 * 匿名获取：不读取、不发送项目 GH_TOKEN，与官方模板同步的匿名原则一致。
 */

const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { resolveContainerPath } = require('../shared/config');
const { parseGitHubRepoSlug } = require('../shared/github-api');
const { buildProxyEnvironment } = require('../../../tooling/xirang/system-proxy');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = 'template-update-check.json';
const FETCH_TIMEOUT_MS = 10000;
const MAX_MANIFEST_BYTES = 256 * 1024;
const VERSION_PATTERN = /^\d+(?:\.\d+){0,3}$/;

function compareVersions(left, right) {
  if (!VERSION_PATTERN.test(String(left)) || !VERSION_PATTERN.test(String(right))) return null;
  const a = String(left).split('.').map(Number);
  const b = String(right).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function manifestUrl(upstream) {
  const slug = parseGitHubRepoSlug(upstream && upstream.repository);
  const branch = String((upstream && upstream.branch) || '');
  // 仅接受 GitHub 仓库与安全分支名，避免把配置内容拼进任意 URL。
  if (!slug || !/^[\w./-]+$/.test(branch) || branch.includes('..')) return null;
  return `https://raw.githubusercontent.com/${slug.owner}/${slug.repo}/${branch}/agent/manifest.json`;
}

function readLocalVersion(mainRoot) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(mainRoot, 'xirang.lock.json'), 'utf8'));
    const version = lock && lock.packages && lock.packages.agent && lock.packages.agent.version;
    return typeof version === 'string' && VERSION_PATTERN.test(version) ? version : null;
  } catch {
    return null;
  }
}

function cachePath(config, mainRoot) {
  try {
    const tmp = resolveContainerPath(config, mainRoot, 'tmp');
    // 不为缓存创建容器目录：只读检查不得产生目录副作用。
    return fs.existsSync(tmp) && fs.lstatSync(tmp).isDirectory() ? path.join(tmp, CACHE_FILE) : null;
  } catch {
    return null;
  }
}

function readCache(file, url, now) {
  if (!file) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const age = now - Number(data.checkedAt);
    if (data.url !== url || !(age >= 0 && age < CACHE_TTL_MS) || !VERSION_PATTERN.test(String(data.remoteVersion))) return null;
    return data.remoteVersion;
  } catch {
    return null;
  }
}

function writeCache(file, url, remoteVersion, now) {
  if (!file) return;
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify({ url, remoteVersion, checkedAt: now }, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch {
    // 缓存失败不影响提醒结果。
    try { fs.rmSync(temp, { force: true }); } catch { /* ignore */ }
  }
}

// 默认获取器：匿名 HTTPS GET，复用系统代理解析，不携带任何认证头。
function fetchManifestHttps(url, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    let agent;
    try {
      const proxyEnv = buildProxyEnvironment({ env, target: url, useGitConfig: false });
      const [major, minor] = process.versions.node.split('.').map(Number);
      // 旧版 Node 会静默忽略 proxyEnv 而直连；已选代理时宁可放弃也不绕过代理。
      if (proxyEnv.https_proxy && !(major > 24 || (major === 24 && minor >= 5) || (major === 22 && minor >= 21))) {
        reject(new Error('proxy-unsupported-runtime'));
        return;
      }
      agent = new https.Agent({ proxyEnv, keepAlive: false });
    } catch {
      reject(new Error('proxy-invalid'));
      return;
    }
    const request = https.get(url, { agent, headers: { 'User-Agent': 'xirang-agent', Accept: 'application/json' } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        agent.destroy();
        reject(new Error(`http-${response.statusCode}`));
        return;
      }
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > MAX_MANIFEST_BYTES) request.destroy(new Error('manifest-too-large'));
      });
      response.on('end', () => {
        agent.destroy();
        try { resolve(JSON.parse(raw)); } catch { reject(new Error('manifest-invalid-json')); }
      });
    });
    request.setTimeout(FETCH_TIMEOUT_MS, () => request.destroy(new Error('timeout')));
    request.on('error', (error) => {
      agent.destroy();
      // 不输出代理 URL，避免泄露其中可能包含的凭据。
      reject(new Error(error.code || error.message || 'request-failed'));
    });
  });
}

async function checkTemplateUpdate({ config, mainRoot, env = process.env, now = Date.now(), fetchManifest = fetchManifestHttps } = {}) {
  const template = (config && config.template) || {};
  if (env.XIRANG_TEMPLATE_UPDATE_CHECK === '0') return { status: 'SKIPPED', reason: 'disabled' };
  if (template.role === 'source') return { status: 'SKIPPED', reason: 'template-source' };

  const localVersion = readLocalVersion(mainRoot);
  if (!localVersion) return { status: 'UNKNOWN', reason: 'no-local-version' };
  const url = manifestUrl(template.upstream);
  if (!url) return { status: 'UNKNOWN', reason: 'unsupported-upstream' };

  const file = cachePath(config, mainRoot);
  let remoteVersion = readCache(file, url, now);
  if (!remoteVersion) {
    try {
      const manifest = await fetchManifest(url, { env });
      remoteVersion = manifest && manifest.version;
    } catch (error) {
      return { status: 'UNKNOWN', reason: `fetch-failed:${String(error && error.message).replace(/[|\r\n]/g, ' ').slice(0, 80)}` };
    }
    if (!VERSION_PATTERN.test(String(remoteVersion))) return { status: 'UNKNOWN', reason: 'invalid-remote-version' };
    writeCache(file, url, remoteVersion, now);
  }

  const order = compareVersions(localVersion, remoteVersion);
  if (order === null) return { status: 'UNKNOWN', reason: 'invalid-version' };
  return { status: order < 0 ? 'AVAILABLE' : 'CURRENT', localVersion, remoteVersion };
}

function formatTemplateUpdateLine(result) {
  if (result.status === 'AVAILABLE') {
    return `TEMPLATE_UPDATE=AVAILABLE|${result.localVersion}->${result.remoteVersion}|说“更新息壤模板”`;
  }
  if (result.status === 'CURRENT') return `TEMPLATE_UPDATE=CURRENT|${result.localVersion}`;
  return `TEMPLATE_UPDATE=${result.status}|${result.reason}`;
}

function shouldReportTemplateUpdate(exitCode, options = {}) {
  return exitCode === 0 && !options.dryRun;
}

module.exports = {
  CACHE_TTL_MS,
  checkTemplateUpdate,
  compareVersions,
  fetchManifestHttps,
  formatTemplateUpdateLine,
  manifestUrl,
  shouldReportTemplateUpdate,
};

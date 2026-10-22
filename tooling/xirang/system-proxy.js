'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const proxyKeys = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY'];
const WINDOWS_PROXY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const platformLabel = platform => (platform === 'win32' ? 'Windows' : 'macOS');
const invalidProxy = () => new Error('SYSTEM_PROXY_INVALID: enabled proxy has an invalid host or port');

function readSystemProxy(platform = process.platform) {
  if (platform === 'win32') {
    // Absolute path: never resolve reg.exe through PATH or the current directory.
    const reg = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    const result = spawnSync(reg, ['query', WINDOWS_PROXY_KEY], {
      encoding: 'utf8', timeout: 3000, maxBuffer: 256 * 1024, stdio: 'pipe', windowsHide: true,
    });
    if (result.error || result.status !== 0) throw new Error('SYSTEM_PROXY_UNAVAILABLE: cannot read Windows proxy settings');
    return result.stdout;
  }
  const result = spawnSync('/usr/sbin/scutil', ['--proxy'], {
    encoding: 'utf8', timeout: 3000, maxBuffer: 128 * 1024, stdio: 'pipe',
  });
  if (result.error || result.status !== 0) throw new Error('SYSTEM_PROXY_UNAVAILABLE: cannot read macOS proxy settings');
  return result.stdout;
}

function readGitProxy({ cwd, env, target }) {
  const result = spawnSync('git', ['config', '--get-urlmatch', 'http.proxy', target], {
    cwd, env, encoding: 'utf8', timeout: 3000, maxBuffer: 64 * 1024, stdio: 'pipe',
  });
  // A missing value is distinct from an explicitly empty proxy (direct access).
  if (result.status === 0) return result.stdout.trim();
  if (result.status === 1) return undefined;
  throw new Error('GIT_PROXY_CONFIG_UNAVAILABLE: cannot read Git proxy configuration');
}

function systemValues(text) {
  const fields = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/);
    if (match) fields[match[1]] = match[2];
  }
  return fields;
}

function proxyUrl(fields, kind) {
  if (fields[`${kind}Enable`] !== '1') return undefined;
  const host = fields[`${kind}Proxy`] || '';
  const port = fields[`${kind}Port`] || '';
  // System host fields must not contain URL userinfo, paths or control characters.
  if (!/^[a-z\d.:[\]-]+$/i.test(host) || !/^\d+$/.test(port) || +port < 1 || +port > 65535) throw invalidProxy();
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  try { return new URL(`http://${bracketed}:${port}`).href.replace(/\/$/, ''); }
  catch { throw invalidProxy(); }
}

function normalizeEnvironment(env) {
  const out = { ...env };
  for (const key of ['http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) {
    const upper = key.toUpperCase();
    if (own(out, key) || own(out, upper)) out[key] = out[upper] = own(out, key) ? out[key] : out[upper];
  }
  // Git/curl support ALL_PROXY; Node's built-in HTTP proxy agent needs protocol-specific fields.
  if (out.all_proxy) {
    for (const key of ['http_proxy', 'https_proxy']) {
      if (!own(out, key)) out[key] = out[key.toUpperCase()] = out.all_proxy;
    }
  }
  if ((out.http_proxy || out.https_proxy) && !own(out, 'NODE_USE_ENV_PROXY')) out.NODE_USE_ENV_PROXY = '1';
  return out;
}

function macosProxy(text) {
  const fields = systemValues(text);
  const httpProxy = proxyUrl(fields, 'HTTP');
  const httpsProxy = proxyUrl(fields, 'HTTPS');
  if (fields.ProxyAutoConfigEnable === '1' || fields.ProxyAutoDiscoveryEnable === '1') {
    throw new Error('SYSTEM_PROXY_UNSUPPORTED: PAC/WPAD requires an explicit HTTP(S) proxy');
  }
  if (!httpProxy && !httpsProxy && fields.SOCKSEnable === '1') {
    throw new Error('SYSTEM_PROXY_UNSUPPORTED: SOCKS-only system settings require an explicit HTTP(S) proxy for GitHub API');
  }
  const array = String(text).match(/ExceptionsList\s*:\s*<array>\s*\{([^}]*)\}/);
  const exceptions = array ? [...array[1].matchAll(/^\s*\d+\s*:\s*(.+?)\s*$/gm)].map(m => m[1]) : [];
  return { httpProxy, httpsProxy, exceptions };
}

// `reg query` lists "    <name>    <REG_TYPE>    <data>"; subkey lines start with HKEY_ and are skipped.
function windowsValues(text) {
  const fields = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^ {4}(.+?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/);
    if (match) fields[match[1]] = (match[3] || '').trim();
  }
  return fields;
}

function windowsProxyUrl(value) {
  // ProxyServer entries are host:port, optionally scheme-prefixed; userinfo and paths are rejected.
  const match = value.replace(/^https?:\/\//i, '').match(/^(\[[\da-f:.]+\]|[a-z\d.-]+):(\d+)\/?$/i);
  if (!match || +match[2] < 1 || +match[2] > 65535) throw invalidProxy();
  try { return new URL(`http://${match[1]}:${match[2]}`).href.replace(/\/$/, ''); }
  catch { throw invalidProxy(); }
}

function windowsProxy(text) {
  const fields = windowsValues(text);
  // WinINet prefers AutoConfigURL over the manual server, so PAC must not be silently ignored.
  if (fields.AutoConfigURL) throw new Error('SYSTEM_PROXY_UNSUPPORTED: PAC requires an explicit HTTP(S) proxy');
  const enabled = /^0x[\da-f]+$/i.test(fields.ProxyEnable || '') && parseInt(fields.ProxyEnable, 16) !== 0;
  if (!enabled || !fields.ProxyServer) return { exceptions: [] };
  const entries = fields.ProxyServer.split(';').map(entry => entry.trim()).filter(Boolean);
  let httpProxy;
  let httpsProxy;
  if (entries.some(entry => entry.includes('='))) {
    // Per-protocol form: protocols that are not listed connect directly, as in WinINet.
    const byProtocol = Object.fromEntries(entries.map(entry => {
      const index = entry.indexOf('=');
      return [entry.slice(0, index).trim().toLowerCase(), entry.slice(index + 1).trim()];
    }));
    if (byProtocol.http) httpProxy = windowsProxyUrl(byProtocol.http);
    if (byProtocol.https) httpsProxy = windowsProxyUrl(byProtocol.https);
    if (!httpProxy && !httpsProxy && byProtocol.socks) {
      throw new Error('SYSTEM_PROXY_UNSUPPORTED: SOCKS-only system settings require an explicit HTTP(S) proxy for GitHub API');
    }
  } else {
    httpProxy = httpsProxy = windowsProxyUrl(entries[0]);
  }
  // no_proxy only supports a leading "*." wildcard; patterns such as 127.* cannot be expressed.
  const exceptions = String(fields.ProxyOverride || '').split(';').map(value => value.trim()).filter(Boolean);
  return { httpProxy, httpsProxy, exceptions: exceptions.filter(value => value === '*' || !/\*/.test(value.replace(/^\*\./, '.'))) };
}

function buildProxyEnvironment({
  env = process.env, cwd = process.cwd(), target = 'https://github.com/',
  platform = process.platform, readSystemProxy: readSystem = readSystemProxy,
  readGitProxy: readGit = readGitProxy, useGitConfig = true,
} = {}) {
  // Explicit process settings (including empty values) always suppress auto-discovery.
  if (proxyKeys.some(key => own(env, key))) return normalizeEnvironment(env);
  if (useGitConfig) {
    const configured = readGit({ cwd, env, target });
    if (configured !== undefined) return normalizeEnvironment({ ...env, https_proxy: configured });
  }
  if (env.XIRANG_SYSTEM_PROXY === '0' || (platform !== 'darwin' && platform !== 'win32')) return { ...env };
  let text;
  try { text = readSystem(platform); }
  catch {
    // Reader errors may carry raw settings; report only the platform.
    throw new Error(`SYSTEM_PROXY_UNAVAILABLE: cannot read ${platformLabel(platform)} proxy settings; configure a proxy explicitly or set XIRANG_SYSTEM_PROXY=0`);
  }
  const { httpProxy, httpsProxy, exceptions } = platform === 'win32' ? windowsProxy(text) : macosProxy(text);
  const out = { ...env };
  if (httpProxy) out.http_proxy = httpProxy;
  if (httpsProxy) out.https_proxy = httpsProxy;
  if ((httpProxy || httpsProxy) && !own(env, 'no_proxy') && !own(env, 'NO_PROXY')) {
    // <local> applies to unqualified hostnames, never the fixed public GitHub hosts.
    // Keep CIDR for Git/curl; GitHub API uses a DNS hostname, not a literal IP.
    out.no_proxy = [...new Set(exceptions.filter(value => value !== '<local>').map(value => value.replace(/^\*\./, '.')))].join(',');
  }
  return normalizeEnvironment(out);
}

module.exports = { buildProxyEnvironment };

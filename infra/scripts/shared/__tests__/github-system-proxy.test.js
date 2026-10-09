const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const dns = require('node:dns');
const { spawn } = require('node:child_process');
const { buildProxyEnvironment } = require('../../../../tooling/xirang/system-proxy');
const { buildGitHubGitEnv, buildGitHubShellEnv } = require('../github-auth');
const { githubApiRequest } = require('../github-api');
const { buildAnonymousGitEnvironment } = require('../../../../tooling/xirang/anonymous-git');

const system = `<dictionary> {
 HTTPEnable : 1
 HTTPProxy : 127.0.0.1
 HTTPPort : 17897
 HTTPSEnable : 1
 HTTPSProxy : 127.0.0.1
 HTTPSPort : 17897
 ExceptionsList : <array> {
  0 : localhost
  1 : *.example.com
  2 : 10.0.0.0/8
  3 : <local>
 }
 ProxyAutoConfigEnable : 0
}`;
const options = { platform: 'darwin', readSystemProxy: () => system, readGitProxy: () => undefined };

test('disabled/no system proxy and other platforms preserve direct access', () => {
  assert.equal(buildProxyEnvironment({ ...options, env: {}, readSystemProxy: () => '<dictionary> {\n HTTPEnable : 0\n}' }).https_proxy, undefined);
  assert.deepEqual(buildProxyEnvironment({ ...options, env: {}, platform: 'linux', readSystemProxy: () => { throw Error('must not probe'); } }), {});
  assert.deepEqual(buildProxyEnvironment({ ...options, env: { XIRANG_SYSTEM_PROXY: '0' }, readSystemProxy: () => { throw Error('must not probe'); } }), { XIRANG_SYSTEM_PROXY: '0' });
});

test('reads current enabled proxy, normalizes bypass and never mutates input', () => {
  const env = { KEEP: 'value' };
  const out = buildProxyEnvironment({ ...options, env });
  assert.equal(out.https_proxy, 'http://127.0.0.1:17897');
  assert.equal(out.HTTPS_PROXY, out.https_proxy);
  assert.match(out.no_proxy, /localhost/);
  assert.match(out.no_proxy, /\.example\.com/);
  assert.equal(out.NODE_USE_ENV_PROXY, '1');
  assert.deepEqual(env, { KEEP: 'value' });
  assert.equal(buildProxyEnvironment({ ...options, env: {}, readSystemProxy: () => system.replaceAll('17897', '17898') }).https_proxy, 'http://127.0.0.1:17898');
});

test('explicit proxies, empty opt-out and NO_PROXY win without system discovery', () => {
  const readSystemProxy = () => { throw Error('must not probe'); };
  const out = buildProxyEnvironment({ ...options, readSystemProxy, env: { https_proxy: 'http://explicit:80', HTTPS_PROXY: 'http://other:81', NO_PROXY: 'github.com' } });
  assert.equal(out.HTTPS_PROXY, 'http://explicit:80');
  assert.equal(out.no_proxy, 'github.com');
  assert.equal(buildProxyEnvironment({ ...options, readSystemProxy, env: { https_proxy: '' } }).https_proxy, '');
  assert.equal(buildProxyEnvironment({ ...options, env: { NO_PROXY: '*' } }).no_proxy, '*');
});

test('Git explicit proxy including empty direct config precedes system defaults', () => {
  const out = buildProxyEnvironment({ ...options, env: {}, readGitProxy: () => 'http://git-config:8080' });
  assert.equal(out.https_proxy, 'http://git-config:8080');
  assert.equal(buildProxyEnvironment({ ...options, env: {}, readGitProxy: () => '' }).https_proxy, '');
});

test('ALL_PROXY is propagated for Node; opt-out retains explicitly configured proxy', () => {
  const out = buildProxyEnvironment({ ...options, env: { ALL_PROXY: 'http://explicit:8080', XIRANG_SYSTEM_PROXY: '0' } });
  assert.equal(out.https_proxy, 'http://explicit:8080');
  assert.equal(out.http_proxy, 'http://explicit:8080');
});

test('system disabled addresses are ignored and IPv6 proxy hosts are bracketed', () => {
  const disabled = system.replace('HTTPSEnable : 1', 'HTTPSEnable : 0');
  assert.equal(buildProxyEnvironment({ ...options, env: {}, readSystemProxy: () => disabled }).https_proxy, undefined);
  const out = buildProxyEnvironment({ ...options, env: {}, readSystemProxy: () => system.replaceAll('127.0.0.1', '::1') });
  assert.equal(out.https_proxy, 'http://[::1]:17897');
});

test('API direct and NO_PROXY paths resolve target directly without using global proxy agent', async (t) => {
  const lookups = [];
  t.mock.method(dns, 'lookup', (hostname, options, callback) => {
    lookups.push(hostname);
    process.nextTick(() => callback(Object.assign(new Error('test DNS stop'), { code: 'ENOTFOUND' })));
  });
  for (const env of [
    { XIRANG_SYSTEM_PROXY: '0' },
    { https_proxy: 'http://proxy.invalid:1234', NO_PROXY: 'api.github.com' },
    { https_proxy: 'http://proxy.invalid:1234', NO_PROXY: '*' },
  ]) {
    await assert.rejects(githubApiRequest('GET', '/user', { token: 'test-only', env, proxyOptions: { readGitProxy: () => undefined } }));
  }
  assert.deepEqual(lookups, ['api.github.com', 'api.github.com', 'api.github.com']);
});

test('bad enabled proxies and unsupported PAC/SOCKS-only configuration fail explicitly', () => {
  for (const value of [system.replaceAll('17897', '99999'), system.replaceAll('127.0.0.1', 'user:secret@proxy'), 'ProxyAutoConfigEnable : 1', 'SOCKSEnable : 1']) {
    assert.throws(() => buildProxyEnvironment({ ...options, env: {}, readSystemProxy: () => value }), /PROXY/);
  }
  assert.throws(() => buildProxyEnvironment({ ...options, env: {}, readSystemProxy: () => { throw Error('secret'); } }), /SYSTEM_PROXY_UNAVAILABLE/);
});

test('public Git operations and shell children get proxy without a GitHub token', () => {
  const base = { repoRoot: '/nonexistent-proxy-test', cwd: process.cwd(), env: {}, proxyOptions: options };
  assert.equal(buildGitHubGitEnv({ ...base, args: ['ls-remote', 'https://github.com/example/public.git'] }).https_proxy, 'http://127.0.0.1:17897');
  assert.equal(buildGitHubShellEnv(base).https_proxy, 'http://127.0.0.1:17897');
  assert.equal(buildGitHubShellEnv({ ...base, discoverProxy: false }).https_proxy, undefined);
});

test('anonymous fetch retains proxy and continues stripping credentials and Git overrides', () => {
  const out = buildAnonymousGitEnvironment({ GH_TOKEN: 'secret', GITHUB_TOKEN: 'secret', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraheader', GIT_CONFIG_VALUE_0: 'secret' }, options);
  assert.equal(out.https_proxy, 'http://127.0.0.1:17897');
  assert.equal(out.GH_TOKEN, undefined);
  assert.equal(out.GITHUB_TOKEN, undefined);
  assert.equal(out.GIT_CONFIG_NOSYSTEM, '1');
  assert.ok(!Object.values(out).includes('secret'));
});

test('API and Git actually CONNECT through selected proxy; refusal never falls back', { timeout: 15000 }, async (t) => {
  const connections = [];
  const server = http.createServer();
  server.on('connect', (req, socket) => {
    connections.push({ url: req.url, headers: req.headers });
    socket.end('HTTP/1.1 502 Proxy unavailable\r\nContent-Length: 0\r\n\r\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = { ...process.env, https_proxy: `http://127.0.0.1:${server.address().port}`, HTTPS_PROXY: `http://127.0.0.1:${server.address().port}`, NO_PROXY: '', no_proxy: '', XIRANG_SYSTEM_PROXY: '0' };
  await assert.rejects(githubApiRequest('GET', '/user', { token: 'test-only-secret', env }), /PROXY|502/);
  assert.equal(connections.length, 1);
  assert.equal(connections[0].url, 'api.github.com:443');
  assert.equal(connections[0].headers.authorization, undefined);
  const gitEnv = buildAnonymousGitEnvironment(env);
  const code = await new Promise((resolve, reject) => {
    const child = spawn('git', ['ls-remote', 'https://github.com/example/public.git'], { env: gitEnv, stdio: 'ignore' });
    child.on('error', reject); child.on('exit', resolve);
  });
  assert.notEqual(code, 0);
  assert.equal(connections.length, 2);
  assert.equal(connections[1].url, 'github.com:443');
});

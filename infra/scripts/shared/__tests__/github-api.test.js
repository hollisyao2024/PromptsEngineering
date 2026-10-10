'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createGitHubBackend } = require('../github-api');

const remoteUrl = 'https://github.com/owner/repo.git';

test('project token selects REST API even when gh is available', () => {
  const apiRequest = async () => ({});
  for (const ghAvailable of [true, false]) {
    const backend = createGitHubBackend({ token: 'project-token', ghAvailable, remoteUrl, apiRequest });
    assert.deepEqual(backend, { mode: 'api', token: 'project-token', owner: 'owner', repo: 'repo', apiRequest });
  }
});

test('token path never probes or invokes gh', () => {
  const result = spawnSync(process.execPath, ['-e', `
    require('node:child_process').spawnSync = () => { throw new Error('unexpected gh probe'); };
    const { createGitHubBackend } = require(${JSON.stringify(require.resolve('../github-api'))});
    const backend = createGitHubBackend({ token: 'project-token', remoteUrl: ${JSON.stringify(remoteUrl)} });
    require('node:assert/strict').equal(backend.mode, 'api');
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('missing token preserves explicit CLI compatibility and otherwise fails', () => {
  assert.deepEqual(createGitHubBackend({ token: '', ghAvailable: true, remoteUrl }), { mode: 'gh' });
  assert.throws(() => createGitHubBackend({ token: '', ghAvailable: false, remoteUrl }), /GH_TOKEN/);
});

test('invalid remote with token fails even when gh is available', () => {
  for (const remoteUrl of ['', 'https://gitlab.com/owner/repo.git']) {
    assert.throws(() => createGitHubBackend({ token: 'project-token', ghAvailable: true, remoteUrl }), /origin remote/);
  }
});

const http = require('node:http');
const { githubApiRequest } = require('../github-api');

function proxyError(code) {
  const error = new Error(`GITHUB_PROXY_REQUEST_FAILED: ${code}`);
  error.code = code;
  error.proxyRequestFailed = true;
  return error;
}

test('proxied GET retries a transient reset through the same attempt path and returns success', async () => {
  const calls = [];
  const requestAttempt = async (method, apiPath, options) => {
    calls.push({ method, apiPath, env: options.env });
    if (calls.length === 1) throw proxyError('ECONNRESET');
    return { login: 'ok' };
  };
  const env = { https_proxy: 'http://127.0.0.1:1' };
  const result = await githubApiRequest('GET', '/user', { token: 't', env, requestAttempt, proxyRetryDelaysMs: [0, 0] });
  assert.deepEqual(result, { login: 'ok' });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.env === env && call.method === 'GET'));
});

test('proxied write requests are never retried and keep the proxy failure prefix', async () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    let count = 0;
    const requestAttempt = async () => { count += 1; throw proxyError('ECONNRESET'); };
    await assert.rejects(
      githubApiRequest(method, '/repos/o/r/pulls', { token: 't', requestAttempt, proxyRetryDelaysMs: [0, 0] }),
      (error) => /^GITHUB_PROXY_REQUEST_FAILED: ECONNRESET; attempts=1; no direct retry$/.test(error.message)
    );
    assert.equal(count, 1, method);
  }
});

test('non-transient proxy errors, direct errors and HTTP errors are not retried', async () => {
  const cases = [
    proxyError('ERR_PROXY_TUNNEL'),
    Object.assign(new Error('direct reset'), { code: 'ECONNRESET' }),
    Object.assign(new Error('GitHub API GET /user failed (500): boom'), { statusCode: 500 }),
  ];
  for (const failure of cases) {
    let count = 0;
    const requestAttempt = async () => { count += 1; throw failure; };
    await assert.rejects(githubApiRequest('GET', '/user', { token: 't', requestAttempt, proxyRetryDelaysMs: [0, 0] }));
    assert.equal(count, 1, failure.message);
  }
});

test('real proxy: GET reset after tunnel retries via proxy only, bounded to 3 attempts', { timeout: 15000 }, async (t) => {
  const connections = [];
  const server = http.createServer();
  server.on('connect', (req, socket) => {
    connections.push(req.url);
    socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
    setTimeout(() => socket.destroy(), 5);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const proxy = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, https_proxy: proxy, HTTPS_PROXY: proxy, NO_PROXY: '', no_proxy: '', XIRANG_SYSTEM_PROXY: '0' };

  await assert.rejects(
    githubApiRequest('GET', '/user', { token: 'test-only-secret', env, proxyRetryDelaysMs: [1, 1] }),
    (error) => /^GITHUB_PROXY_REQUEST_FAILED: ECONNRESET; attempts=3; no direct retry$/.test(error.message)
  );
  assert.deepEqual(connections, ['api.github.com:443', 'api.github.com:443', 'api.github.com:443']);

  connections.length = 0;
  await assert.rejects(
    githubApiRequest('POST', '/repos/o/r/pulls', { token: 'test-only-secret', env, body: {}, proxyRetryDelaysMs: [1, 1] }),
    /attempts=1; no direct retry/
  );
  assert.deepEqual(connections, ['api.github.com:443']);
});

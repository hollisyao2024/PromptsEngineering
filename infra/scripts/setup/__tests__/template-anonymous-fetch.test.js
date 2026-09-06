'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const cp = require('node:child_process');
const { promisify } = require('node:util');
const execFile = promisify(cp.execFile);
const sync = require('../template-sync');

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-anonymous-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function git(cwd, args, env = process.env) {
  return cp.execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('anonymous environment removes credentials and inherited Git control without mutating its caller', () => {
  const input = Object.freeze({
    PATH: process.env.PATH,
    GH_TOKEN: 'invalid-test-credential',
    GITHUB_TOKEN: 'invalid-test-credential',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: 'Authorization: test-only',
    GIT_CONFIG_PARAMETERS: "'http.extraHeader'='Cookie: test-only'",
    GIT_CONFIG_GLOBAL: '/test-only/global',
    GIT_CONFIG_SYSTEM: '/test-only/system',
    GIT_DIR: '/test-only/repo',
    GIT_WORK_TREE: '/test-only/worktree',
    GIT_TEMPLATE_DIR: '/test-only/templates',
    GIT_ASKPASS: '/test-only/askpass',
    SSH_ASKPASS: '/test-only/askpass',
    GCM_INTERACTIVE: 'Always',
    GIT_SSL_NO_VERIFY: '1',
    GIT_SSL_CERT: '/test-only/client-cert',
    GIT_SSL_KEY: '/test-only/client-key',
    GIT_TRACE: '/test-only/trace',
    HTTPS_PROXY: 'http://127.0.0.1:7890',
    GIT_SSL_CAINFO: '/test-only/ca.pem',
    GIT_SSL_CAPATH: '/test-only/ca',
  });
  const env = sync.buildAnonymousGitEnvironment(input);
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GIT_DIR', 'GIT_WORK_TREE',
    'GIT_TEMPLATE_DIR', 'GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_CONFIG_PARAMETERS',
    'GIT_SSL_NO_VERIFY', 'GIT_SSL_CERT', 'GIT_SSL_KEY', 'GIT_TRACE']) {
    assert.ok(!(key in env), key + ' must be absent');
  }
  assert.equal(env.GIT_CONFIG_GLOBAL, os.devNull);
  assert.equal(env.GIT_CONFIG_SYSTEM, os.devNull);
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GCM_INTERACTIVE, 'Never');
  assert.equal(env.HTTPS_PROXY, input.HTTPS_PROXY);
  assert.equal(env.GIT_SSL_CAINFO, input.GIT_SSL_CAINFO);
  assert.equal(env.GIT_SSL_CAPATH, input.GIT_SSL_CAPATH);
  assert.ok(input.GH_TOKEN === 'invalid-test-credential');
  assert.ok(input.GIT_CONFIG_VALUE_0 === 'Authorization: test-only');
  const withoutToken = sync.buildAnonymousGitEnvironment({ PATH: process.env.PATH });
  assert.ok(!('GH_TOKEN' in withoutToken));
  assert.equal(withoutToken.GIT_CONFIG_GLOBAL, os.devNull);
});

test('official snapshot uses anonymous environment for init, fetch and checkout without reading project token', (t) => {
  const root = scratch(t);
  // A subprocess keeps the mocked transport and test-only token out of other tests.
  const program = `
    const assert = require('node:assert/strict');
    const cp = require('node:child_process');
    const fs = require('node:fs');
    const read = fs.readFileSync;
    fs.readFileSync = function(file, ...args) {
      assert.ok(!String(file).endsWith('.env.local'), 'must not read project token');
      return read.call(this, file, ...args);
    };
    const calls = [];
    const sha = 'a'.repeat(40);
    cp.spawnSync = (command, args, options) => {
      assert.ok(!options.env.GH_TOKEN && !options.env.GITHUB_TOKEN, 'no token');
      assert.equal(options.env.GIT_CONFIG_GLOBAL, require('node:os').devNull);
      assert.equal(options.env.GIT_CONFIG_SYSTEM, require('node:os').devNull);
      calls.push(args);
      return { status: 0, stdout: args[0] === 'rev-parse' ? sha + '\\n' : '', stderr: '' };
    };
    const sync = require(process.argv[1]);
    const audit = {};
    const result = sync.fetchTemplateSnapshot({
      audit, repository: sync.EXPECTED_UPSTREAM.repository, branch: 'main',
      runDirectory: process.argv[2], targetRoot: process.argv[2],
    });
    assert.equal(result.commit, sha);
    assert.equal(audit.authMode, 'ANONYMOUS');
    assert.equal(calls.filter(args => args[0] === 'fetch').length, 1);
    assert.ok(calls.some(args => args[0] === 'checkout' && args.includes(sha)));
    console.log('ANONYMOUS_ROUTE_OK');
  `;
  const result = cp.spawnSync(process.execPath, ['-e', program, require.resolve('../template-sync'), root], {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: 'invalid-test-credential', GITHUB_TOKEN: 'invalid-test-credential' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ANONYMOUS_ROUTE_OK/u);
  const withoutToken = { ...process.env };
  delete withoutToken.GH_TOKEN;
  delete withoutToken.GITHUB_TOKEN;
  const noTokenResult = cp.spawnSync(process.execPath,
    ['-e', program, require.resolve('../template-sync'), root],
    { encoding: 'utf8', env: withoutToken });
  assert.equal(noTokenResult.status, 0, noTokenResult.stderr);
});

async function serveGit(t, root, reject) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ authorization: Boolean(req.headers.authorization), cookie: Boolean(req.headers.cookie) });
    if (reject) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fixture"' });
      res.end('authentication required');
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    const backend = cp.spawn('git', ['http-backend'], {
      env: {
        ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers['content-type'] || '',
        CONTENT_LENGTH: req.headers['content-length'] || '',
        GIT_PROTOCOL: req.headers['git-protocol'] || '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks = [];
    backend.stdout.on('data', chunk => chunks.push(chunk));
    backend.stderr.resume();
    backend.on('error', () => { res.writeHead(500); res.end(); });
    backend.on('close', () => {
      if (res.writableEnded) return;
      const data = Buffer.concat(chunks);
      const end = data.indexOf('\r\n\r\n');
      if (end < 0) { res.writeHead(500); res.end(); return; }
      let status = 200;
      for (const line of data.subarray(0, end).toString().split('\r\n')) {
        const index = line.indexOf(':');
        const key = line.slice(0, index);
        const value = line.slice(index + 1).trim();
        if (key.toLowerCase() === 'status') status = Number.parseInt(value, 10);
        else res.setHeader(key, value);
      }
      res.writeHead(status);
      res.end(data.subarray(end + 4));
    });
    req.pipe(backend.stdin);
    backend.stdin.on('error', () => {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { url: 'http://127.0.0.1:' + server.address().port + '/upstream/', requests };
}

for (const reject of [false, true]) {
  test('anonymous Git HTTP ' + (reject ? '401 blocks without credential retry' : 'fetch succeeds without auth headers'),
    { timeout: 20000 }, async (t) => {
      const root = scratch(t);
      const upstream = path.join(root, 'upstream');
      const target = path.join(root, 'target');
      fs.mkdirSync(upstream);
      fs.mkdirSync(target);
      git(upstream, ['init', '--quiet', '--initial-branch=main']);
      fs.writeFileSync(path.join(upstream, 'sentinel.txt'), 'public template fixture\n');
      git(upstream, ['add', '.']);
      git(upstream, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
        '-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'public fixture']);
      const sha = git(upstream, ['rev-parse', 'HEAD']);
      git(target, ['init', '--quiet']);
      const { url, requests } = await serveGit(t, root, reject);
      const poisonedConfig = path.join(root, 'poisoned.gitconfig');
      fs.writeFileSync(poisonedConfig, [
        '[http]', 'extraHeader = Authorization: test-only', 'extraHeader = Cookie: test-only',
        '[credential]', 'helper = !exit 97',
        '[url "http://127.0.0.1:1/"]', 'insteadOf = ' + url, '',
      ].join('\n'));
      const env = sync.buildAnonymousGitEnvironment({
        ...process.env, GH_TOKEN: 'invalid-test-credential',
        GIT_CONFIG_GLOBAL: poisonedConfig, GIT_CONFIG_SYSTEM: poisonedConfig,
        GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader',
        GIT_CONFIG_VALUE_0: 'Authorization: test-only',
        GIT_ASKPASS: path.join(root, 'must-not-run'),
      });
      // Test-only loopback transport; production permits HTTPS exclusively.
      const outcome = await execFile('git', ['-c', 'protocol.http.allow=always',
        'fetch', '--quiet', '--depth=1', url, 'refs/heads/main'],
      { cwd: target, env, encoding: 'utf8', timeout: 10000 })
        .then(() => 0, error => error.code);
      assert.ok(reject ? outcome !== 0 : outcome === 0, 'HTTP outcome must match fixture');
      assert.ok(requests.length > 0, 'request must reach local Git service, not URL rewrite');
      assert.ok(requests.every(request => !request.authorization && !request.cookie), 'no credentials on wire');
      if (reject) {
        assert.equal(requests.length, 1, 'no authenticated retry after 401');
        assert.equal(git(target, ['status', '--porcelain']), '');
      } else {
        assert.equal(git(target, ['rev-parse', 'FETCH_HEAD']), sha);
      }
    });
}

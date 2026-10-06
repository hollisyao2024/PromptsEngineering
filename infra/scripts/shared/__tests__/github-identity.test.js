'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  PROBE_FLAG,
  PROBE_TOKEN_ENV,
  clearIdentityCache,
  hasExplicitIdentity,
  identityFromAccount,
  identityRolesForGitArgs,
  lookupGitHubCommitIdentity,
  resolveCommitIdentity,
  runProbe,
} = require('../github-identity');

const MODULE_PATH = path.resolve(__dirname, '..', 'github-identity.js');
const TOKEN = 'ghp_identityTestToken0123456789';
const IDENTITY = Object.freeze({
  name: 'Octo Cat',
  email: '4242+octo-cat@users.noreply.github.com',
  login: 'octo-cat',
});

// 隔离的 git 环境：没有系统/全局配置、HOME 是一次性目录，本机自己的身份不可能混进来。
function gitEnv(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'identity-home-')),
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    ...extra,
  };
}

function git(args, cwd, env) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function createRepo(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-repo-'));
  git(['init', '-q', '-b', 'main'], dir, env);
  return dir;
}

function recordingLookup(calls) {
  return ({ token }) => {
    calls.push(token);
    return { ...IDENTITY };
  };
}

// 预加载桩：替换 https.request，记录请求并返回预设响应，让子进程边界的测试完全不联网。
const HTTPS_STUB_SOURCE = `
'use strict';
const fs = require('node:fs');
const https = require('node:https');
const { EventEmitter } = require('node:events');
https.request = (options, callback) => {
  const request = new EventEmitter();
  request.write = () => {};
  request.end = () => {
    fs.writeFileSync(process.env.STUB_CAPTURE, JSON.stringify({
      hostname: options.hostname,
      path: options.path,
      method: options.method,
      authorization: options.headers.Authorization,
    }));
    const response = new EventEmitter();
    response.statusCode = Number(process.env.STUB_STATUS);
    response.setEncoding = () => {};
    process.nextTick(() => {
      callback(response);
      response.emit('data', process.env.STUB_BODY);
      response.emit('end');
    });
  };
  return request;
};
`;

function stubbedChildEnv({ status, body }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-stub-'));
  const stub = path.join(dir, 'stub-https.js');
  const capture = path.join(dir, 'request.json');
  fs.writeFileSync(stub, HTTPS_STUB_SOURCE);
  return {
    capture,
    env: {
      ...process.env,
      NODE_OPTIONS: `--require ${stub}`,
      STUB_CAPTURE: capture,
      STUB_STATUS: String(status),
      STUB_BODY: JSON.stringify(body),
    },
  };
}

test('identityRolesForGitArgs asks for identities only on commit and annotated tag', () => {
  assert.deepEqual(identityRolesForGitArgs(['commit', '-m', 'x']), ['author', 'committer']);
  assert.deepEqual(
    identityRolesForGitArgs(['commit', '--no-verify', '-m', 'chore(release): v1.0.0']),
    ['author', 'committer']
  );

  for (const args of [
    ['tag', '-a', 'v1.0.0', '-m', 'note'],
    ['tag', '-am', 'note', 'v1.0.0'],
    ['tag', '-m', 'note', 'v1.0.0'],
    ['tag', '--annotate', 'v1.0.0'],
    ['tag', '--message=note', 'v1.0.0'],
    ['tag', '-s', 'v1.0.0'],
  ]) {
    assert.deepEqual(identityRolesForGitArgs(args), ['committer'], args.join(' '));
  }

  for (const args of [
    [],
    ['status'],
    ['add', '-A'],
    ['fetch', 'origin'],
    ['push', 'origin', 'HEAD'],
    ['merge', '--ff-only', 'origin/main'],
    ['merge', '--squash', 'feature/x'],
    ['commit-tree', 'HEAD^{tree}'],
    ['tag'],
    ['tag', 'v1.0.0'],
    ['tag', '-d', 'v1.0.0'],
    ['tag', '--list', 'v*'],
    ['tag', '-l', '--sort=-creatordate'],
  ]) {
    assert.deepEqual(identityRolesForGitArgs(args), [], args.join(' '));
  }
});

test('hasExplicitIdentity checks each role on its own and never counts auto-detected values', () => {
  const env = gitEnv({ EMAIL: 'auto-detected@example.test' });
  const bare = createRepo(env);
  assert.equal(hasExplicitIdentity('author', { cwd: bare, env }), false);
  assert.equal(hasExplicitIdentity('committer', { cwd: bare, env }), false);

  const authorOnly = { ...env, GIT_AUTHOR_NAME: 'Human', GIT_AUTHOR_EMAIL: 'human@example.test' };
  assert.equal(hasExplicitIdentity('author', { cwd: bare, env: authorOnly }), true);
  assert.equal(hasExplicitIdentity('committer', { cwd: bare, env: authorOnly }), false);

  const configured = createRepo(env);
  git(['config', 'user.name', 'Local Name'], configured, env);
  git(['config', 'user.email', 'local@example.test'], configured, env);
  assert.equal(hasExplicitIdentity('author', { cwd: configured, env }), true);
  assert.equal(hasExplicitIdentity('committer', { cwd: configured, env }), true);

  const partial = createRepo(env);
  git(['config', 'user.name', 'Only Name'], partial, env);
  assert.equal(hasExplicitIdentity('author', { cwd: partial, env }), false, 'a name without an email is not an identity');
  assert.equal(hasExplicitIdentity('committer', { cwd: partial, env }), false);

  assert.throws(() => hasExplicitIdentity('tagger', { cwd: bare, env }), /unknown identity role/u);
});

test('resolveCommitIdentity fills both roles of a commit from the token account when git has no identity', () => {
  const env = gitEnv();
  const repo = createRepo(env);
  const calls = [];

  const resolved = resolveCommitIdentity({
    args: ['commit', '-m', 'x'],
    cwd: repo,
    env,
    token: TOKEN,
    lookup: recordingLookup(calls),
  });

  assert.equal(resolved.source, 'github-token');
  assert.deepEqual(resolved.filledRoles, ['author', 'committer']);
  assert.deepEqual(resolved.identity, IDENTITY);
  assert.deepEqual(calls, [TOKEN]);
  assert.equal(resolved.env.GIT_AUTHOR_NAME, IDENTITY.name);
  assert.equal(resolved.env.GIT_AUTHOR_EMAIL, IDENTITY.email);
  assert.equal(resolved.env.GIT_COMMITTER_NAME, IDENTITY.name);
  assert.equal(resolved.env.GIT_COMMITTER_EMAIL, IDENTITY.email);
  assert.equal(env.GIT_AUTHOR_NAME, undefined, 'the caller environment is never mutated');
  assert.equal(hasExplicitIdentity('author', { cwd: repo, env: resolved.env }), true);
  assert.equal(hasExplicitIdentity('committer', { cwd: repo, env: resolved.env }), true);
});

test('resolveCommitIdentity gives an annotated tag only the committer identity', () => {
  const env = gitEnv();
  const repo = createRepo(env);
  const calls = [];

  const resolved = resolveCommitIdentity({
    args: ['tag', '-a', 'v1.0.0', '-m', 'note'],
    cwd: repo,
    env,
    token: TOKEN,
    lookup: recordingLookup(calls),
  });

  assert.equal(resolved.source, 'github-token');
  assert.deepEqual(resolved.filledRoles, ['committer']);
  assert.equal(resolved.env.GIT_COMMITTER_NAME, IDENTITY.name);
  assert.equal(resolved.env.GIT_COMMITTER_EMAIL, IDENTITY.email);
  assert.equal(resolved.env.GIT_AUTHOR_NAME, undefined);
  assert.equal(resolved.env.GIT_AUTHOR_EMAIL, undefined);
});

test('resolveCommitIdentity respects an identity git already has and never queries GitHub for it', () => {
  const env = gitEnv();
  const configured = createRepo(env);
  git(['config', 'user.name', 'Local Name'], configured, env);
  git(['config', 'user.email', 'local@example.test'], configured, env);
  const calls = [];

  const resolved = resolveCommitIdentity({
    args: ['commit', '-m', 'x'],
    cwd: configured,
    env,
    token: TOKEN,
    lookup: recordingLookup(calls),
  });
  assert.equal(resolved.source, 'configured');
  assert.deepEqual(resolved.filledRoles, []);
  assert.equal(resolved.env, env, 'the environment is returned untouched');
  assert.deepEqual(calls, []);

  // 只有作者来自显式环境变量时，只补提交者，不改动作者。
  const bare = createRepo(env);
  const authorOnly = { ...env, GIT_AUTHOR_NAME: 'Human', GIT_AUTHOR_EMAIL: 'human@example.test' };
  const partial = resolveCommitIdentity({
    args: ['commit', '-m', 'x'],
    cwd: bare,
    env: authorOnly,
    token: TOKEN,
    lookup: recordingLookup(calls),
  });
  assert.equal(partial.source, 'github-token');
  assert.deepEqual(partial.filledRoles, ['committer']);
  assert.equal(partial.env.GIT_AUTHOR_NAME, 'Human');
  assert.equal(partial.env.GIT_AUTHOR_EMAIL, 'human@example.test');
  assert.equal(partial.env.GIT_COMMITTER_NAME, IDENTITY.name);
  assert.deepEqual(calls, [TOKEN]);
});

test('resolveCommitIdentity does nothing for commands that need no identity and leaves tokenless commits to the caller', () => {
  const env = gitEnv();
  const repo = createRepo(env);
  const calls = [];

  for (const args of [['status'], ['merge', '--squash', 'feature/x'], ['tag', 'v1.0.0'], ['push', 'origin', 'HEAD']]) {
    const resolved = resolveCommitIdentity({ args, cwd: repo, env, token: TOKEN, lookup: recordingLookup(calls) });
    assert.equal(resolved.source, 'not-needed', args.join(' '));
    assert.equal(resolved.env, env);
  }

  const tokenless = resolveCommitIdentity({
    args: ['commit', '-m', 'x'],
    cwd: repo,
    env,
    token: '',
    lookup: recordingLookup(calls),
  });
  assert.equal(tokenless.source, 'unresolved');
  assert.equal(tokenless.env, env);
  assert.deepEqual(calls, []);
});

test('resolveCommitIdentity fails closed when the lookup fails or yields an unusable identity', () => {
  const env = gitEnv();
  const repo = createRepo(env);

  assert.throws(
    () => resolveCommitIdentity({
      args: ['commit', '-m', 'x'],
      cwd: repo,
      env,
      token: TOKEN,
      lookup: () => {
        throw new Error('lookup exploded');
      },
    }),
    /lookup exploded/u
  );

  for (const identity of [{ name: 'Octo Cat', email: '' }, { name: '', email: IDENTITY.email }, null]) {
    assert.throws(
      () => resolveCommitIdentity({ args: ['commit', '-m', 'x'], cwd: repo, env, token: TOKEN, lookup: () => identity }),
      /提交身份无效/u
    );
  }
});

test('identityFromAccount builds the noreply identity GitHub itself uses for the account', () => {
  assert.deepEqual(identityFromAccount({ login: 'octo-cat', id: 4242, name: 'Octo Cat' }), IDENTITY);
  assert.equal(identityFromAccount({ login: 'octo-cat', id: 4242, name: null }).name, 'octo-cat');
  assert.equal(identityFromAccount({ login: 'octo-cat', id: 4242, name: ' <>\n ' }).name, 'octo-cat');
  assert.equal(identityFromAccount({ login: 'octo-cat', id: 4242, name: 'Octo <Cat>\n' }).name, 'Octo Cat');

  for (const bad of [
    null,
    {},
    { login: '', id: 1 },
    { login: 'a b', id: 1 },
    { login: 'octo-cat', id: 0 },
    { login: 'octo-cat', id: '4242' },
    { login: 'octo-cat', id: 1.5 },
  ]) {
    assert.throws(() => identityFromAccount(bad), /GitHub 账号/u, JSON.stringify(bad));
  }
});

test('lookupGitHubCommitIdentity asks through a child process that gets the token only via its environment', () => {
  clearIdentityCache();
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: `${JSON.stringify({ ok: true, ...IDENTITY })}\n`, stderr: '' };
  };

  const identity = lookupGitHubCommitIdentity({
    token: TOKEN,
    env: { PATH: '/usr/bin', GH_TOKEN: 'ambient-secret', GITHUB_TOKEN: 'ambient-secret-2', HTTPS_PROXY: 'http://127.0.0.1:1' },
    timeoutMs: 5000,
    spawn,
  });

  assert.deepEqual(identity, IDENTITY);
  assert.equal(calls.length, 1);
  const [{ command, args, options }] = calls;
  assert.equal(command, process.execPath);
  assert.deepEqual(args, [MODULE_PATH, PROBE_FLAG]);
  assert.equal(JSON.stringify(args).includes(TOKEN), false, 'the token never appears in argv');
  assert.equal(options.env[PROBE_TOKEN_ENV], TOKEN);
  assert.equal(options.env.GH_TOKEN, undefined);
  assert.equal(options.env.GITHUB_TOKEN, undefined);
  assert.equal(options.env.HTTPS_PROXY, 'http://127.0.0.1:1', 'the rest of the environment is preserved');
  assert.equal(options.timeout, 5000);

  // 同一进程内同一令牌只查一次；换一个令牌要重新查。
  lookupGitHubCommitIdentity({ token: TOKEN, spawn });
  assert.equal(calls.length, 1);
  lookupGitHubCommitIdentity({ token: `${TOKEN}-other`, spawn });
  assert.equal(calls.length, 2);
});

test('lookupGitHubCommitIdentity throws a clear Chinese error and never falls back to another identity', () => {
  const failures = [
    { result: { error: Object.assign(new Error('spawnSync node ETIMEDOUT'), { code: 'ETIMEDOUT' }), status: null }, expect: /超时/u },
    { result: { status: 1, stdout: `${JSON.stringify({ ok: false, status: 401, message: 'GitHub API GET /user failed (401): Bad credentials' })}\n` }, expect: /401.*Bad credentials/u },
    { result: { status: 1, stdout: `${JSON.stringify({ ok: false, status: 0, message: `connect ECONNREFUSED ${TOKEN}` })}\n` }, expect: /\*\*\*/u },
    { result: { status: 0, stdout: 'not json at all' }, expect: /无法解析/u },
    { result: { status: 0, stdout: `${JSON.stringify({ ok: true, name: 'Octo Cat' })}\n` }, expect: /无法解析/u },
    { result: { error: new Error('spawn EACCES'), status: null }, expect: /无法启动/u },
    { result: { status: 3, stdout: '', stderr: 'boom: probe crashed\n' }, expect: /异常退出（退出码 3）：boom: probe crashed$/u },
    { result: { status: 1, stdout: '', stderr: `fatal: bad ${TOKEN} here` }, expect: /异常退出（退出码 1）：fatal: bad \*\*\* here$/u },
    { result: { status: null, signal: 'SIGKILL', stdout: '', stderr: '' }, expect: /异常退出（信号 SIGKILL）$/u },
  ];

  for (const { result, expect } of failures) {
    clearIdentityCache();
    assert.throws(
      () => lookupGitHubCommitIdentity({ token: TOKEN, spawn: () => result }),
      (error) => {
        assert.match(error.message, /无法由 GH_TOKEN 推导提交身份/u);
        assert.match(error.message, expect);
        assert.equal(error.message.includes(TOKEN), false, 'the token never appears in the error');
        return true;
      }
    );
  }

  // 失败不缓存：下一次调用仍会真正查询。
  clearIdentityCache();
  let attempts = 0;
  const flaky = () => {
    attempts += 1;
    return attempts === 1
      ? { status: 1, stdout: `${JSON.stringify({ ok: false, status: 0, message: 'offline' })}\n` }
      : { status: 0, stdout: `${JSON.stringify({ ok: true, ...IDENTITY })}\n` };
  };
  assert.throws(() => lookupGitHubCommitIdentity({ token: TOKEN, spawn: flaky }), /offline/u);
  assert.deepEqual(lookupGitHubCommitIdentity({ token: TOKEN, spawn: flaky }), IDENTITY);
  assert.equal(attempts, 2);

  assert.throws(() => lookupGitHubCommitIdentity({ token: '' }), /GH_TOKEN/u);
});

test('lookupGitHubCommitIdentity works across the real process boundary without touching the network', () => {
  clearIdentityCache();
  const { capture, env } = stubbedChildEnv({ status: 200, body: { login: 'octo-cat', id: 4242, name: 'Octo Cat' } });

  const identity = lookupGitHubCommitIdentity({ token: TOKEN, env });

  assert.deepEqual(identity, IDENTITY);
  assert.deepEqual(JSON.parse(fs.readFileSync(capture, 'utf8')), {
    hostname: 'api.github.com',
    path: '/user',
    method: 'GET',
    authorization: `Bearer ${TOKEN}`,
  });
});

test('lookupGitHubCommitIdentity reports a rejected token across the process boundary without echoing it', () => {
  clearIdentityCache();
  const { capture, env } = stubbedChildEnv({ status: 401, body: { message: 'Bad credentials' } });

  assert.throws(
    () => lookupGitHubCommitIdentity({ token: TOKEN, env }),
    (error) => {
      assert.match(error.message, /无法由 GH_TOKEN 推导提交身份/u);
      assert.match(error.message, /401/u);
      assert.match(error.message, /Bad credentials/u);
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    }
  );
  assert.ok(fs.existsSync(capture), 'the stub saw the request, so the test never reached the real network');
});

test('runProbe prints one JSON line for success and for every failure shape', async () => {
  const lines = [];
  const write = (line) => lines.push(line);
  const requests = [];

  const ok = await runProbe({
    env: { [PROBE_TOKEN_ENV]: TOKEN },
    write,
    request: async (method, apiPath, options) => {
      requests.push({ method, apiPath, token: options.token });
      return { login: 'octo-cat', id: 4242, name: 'Octo Cat' };
    },
  });
  assert.equal(ok, 0);
  assert.deepEqual(JSON.parse(lines[0]), { ok: true, ...IDENTITY });
  assert.deepEqual(requests, [{ method: 'GET', apiPath: '/user', token: TOKEN }]);

  const denied = await runProbe({
    env: { [PROBE_TOKEN_ENV]: TOKEN },
    write,
    request: async () => {
      throw Object.assign(new Error(`boom ${TOKEN}`), { statusCode: 401 });
    },
  });
  assert.equal(denied, 1);
  assert.deepEqual({ ...JSON.parse(lines[1]), message: undefined }, { ok: false, status: 401, message: undefined });
  assert.equal(lines[1].includes(TOKEN), false, 'the probe redacts the token from its own failure output');

  const missing = await runProbe({
    env: {},
    write,
    request: async () => {
      throw new Error('must not be called without a token');
    },
  });
  assert.equal(missing, 1);
  assert.match(JSON.parse(lines[2]).message, /令牌/u);

  const malformed = await runProbe({ env: { [PROBE_TOKEN_ENV]: TOKEN }, write, request: async () => ({ login: 'octo-cat' }) });
  assert.equal(malformed, 1);
  assert.match(JSON.parse(lines[3]).message, /GitHub 账号/u);
});

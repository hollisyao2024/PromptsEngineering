const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  buildGitHubGitEnv,
  buildGitHubShellEnv,
  firstRemoteTarget,
  getProjectEnvLocalCandidates,
  getProjectGitHubToken,
  loadProjectGitHubToken,
  parseEnvContent,
  sanitizeGitHubRemoteUrl,
  shouldInjectGitHubAuth,
} = require('../github-auth');

function createGitRepo(remoteUrl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-auth-test-'));
  const init = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  assert.equal(init.status, 0, init.stderr);
  const remote = spawnSync('git', ['remote', 'add', 'origin', remoteUrl], {
    cwd: dir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  assert.equal(remote.status, 0, remote.stderr);
  return dir;
}

test('parseEnvContent supports GH token lines', () => {
  const parsed = parseEnvContent('A=1\nexport GH_TOKEN=\"from-file\" # local token\n# nope\n');
  assert.equal(parsed.GH_TOKEN, 'from-file');
});

test('getProjectGitHubToken prefers repo .env.local over process env', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'github-auth-env-'));
  fs.writeFileSync(path.join(repoRoot, '.env.local'), 'GH_TOKEN=from-file\n');
  const token = getProjectGitHubToken({
    repoRoot,
    env: { GH_TOKEN: 'from-shell' },
  });
  assert.equal(token, 'from-file');
});

test('firstRemoteTarget skips common git options', () => {
  assert.equal(firstRemoteTarget(['fetch', '--prune', 'origin']), 'origin');
  assert.equal(firstRemoteTarget(['push', '--force-with-lease', 'origin', 'branch']), 'origin');
  assert.equal(firstRemoteTarget(['ls-remote', '--heads', 'origin']), 'origin');
});

test('shouldInjectGitHubAuth only matches GitHub remote network operations', () => {
  const githubRepo = createGitRepo('https://github.com/example/repo.git');
  const otherRepo = createGitRepo('https://gitlab.com/example/repo.git');

  assert.equal(shouldInjectGitHubAuth({ cwd: githubRepo, args: ['fetch', 'origin'] }), true);
  assert.equal(shouldInjectGitHubAuth({ cwd: githubRepo, args: ['status'] }), false);
  assert.equal(shouldInjectGitHubAuth({ cwd: otherRepo, args: ['fetch', 'origin'] }), false);
});

test('sanitizeGitHubRemoteUrl removes embedded credentials for display links', () => {
  assert.equal(
    sanitizeGitHubRemoteUrl('https://x-access-token:secret@github.com/example/repo.git'),
    'https://github.com/example/repo'
  );
  assert.equal(
    sanitizeGitHubRemoteUrl('git@github.com:example/repo.git'),
    'https://github.com/example/repo'
  );
});

test('buildGitHubGitEnv injects token via git config env, not command args', () => {
  const repoRoot = createGitRepo('https://github.com/example/repo.git');
  fs.writeFileSync(path.join(repoRoot, '.env.local'), 'GH_TOKEN=secret-token\n');

  const env = buildGitHubGitEnv({
    repoRoot,
    cwd: repoRoot,
    args: ['push', 'origin', 'HEAD'],
    env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'Test' },
  });

  assert.equal(env.GIT_CONFIG_COUNT, '2');
  assert.equal(env.GIT_CONFIG_KEY_1, 'http.https://github.com/.extraheader');
  assert.match(env.GIT_CONFIG_VALUE_1, /^AUTHORIZATION: basic /);
  assert.equal(env.GH_TOKEN, 'secret-token');
});

test('buildGitHubShellEnv prepares gh and nested git commands for GitHub origin', () => {
  const repoRoot = createGitRepo('https://github.com/example/repo.git');
  fs.writeFileSync(path.join(repoRoot, '.env.local'), 'GH_TOKEN=shell-token\n');

  const env = buildGitHubShellEnv({
    repoRoot,
    cwd: repoRoot,
    env: { GH_TOKEN: 'wrong-token' },
  });

  assert.equal(env.GH_TOKEN, 'shell-token');
  assert.equal(env.GIT_CONFIG_COUNT, '1');
  assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
});

test('loadProjectGitHubToken skips a linked-worktree placeholder and preserves explicit overrides', () => {
  const mainRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'github-auth-main-'));
  const worktreeRoot = `${mainRoot}-worktree`;
  try {
    spawnSync('git', ['init', '-b', 'main'], { cwd: mainRoot, encoding: 'utf8', stdio: 'pipe' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: mainRoot });
    spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: mainRoot });
    fs.writeFileSync(path.join(mainRoot, 'README.md'), '# test\n');
    fs.writeFileSync(path.join(mainRoot, '.env.local'), 'GH_TOKEN=main-token # comment\n');
    spawnSync('git', ['add', 'README.md'], { cwd: mainRoot, encoding: 'utf8', stdio: 'pipe' });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: mainRoot, encoding: 'utf8', stdio: 'pipe' });
    const worktree = spawnSync('git', ['worktree', 'add', worktreeRoot, '-b', 'test/worktree'], {
      cwd: mainRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.equal(worktree.status, 0, worktree.stderr);
    fs.writeFileSync(path.join(worktreeRoot, '.env.local'), 'GH_TOKEN=ghp_xxx\n');

    const candidates = getProjectEnvLocalCandidates({ repoRoot: worktreeRoot, cwd: worktreeRoot });
    assert.ok(candidates.includes(path.join(worktreeRoot, '.env.local')));
    assert.ok(candidates.includes(path.join(fs.realpathSync(mainRoot), '.env.local')));

    const env = {};
    const token = loadProjectGitHubToken({ repoRoot: worktreeRoot, cwd: worktreeRoot, env });
    assert.equal(token, 'main-token');
    assert.equal(env.GH_TOKEN, 'main-token');

    fs.writeFileSync(path.join(worktreeRoot, '.env.local'), 'GH_TOKEN=worktree-token\n');
    const overridden = loadProjectGitHubToken({ repoRoot: worktreeRoot, cwd: worktreeRoot, env: {} });
    assert.equal(overridden, 'worktree-token');
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', worktreeRoot], {
      cwd: mainRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    fs.rmSync(worktreeRoot, { recursive: true, force: true });
    fs.rmSync(mainRoot, { recursive: true, force: true });
  }
});

test('getProjectGitHubToken ignores a placeholder file before using a process token', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'github-auth-placeholder-'));
  fs.writeFileSync(path.join(repoRoot, '.env.local'), 'GH_TOKEN=github_pat_xxx\n');

  assert.deepEqual(
    getProjectEnvLocalCandidates({ repoRoot, cwd: repoRoot }),
    [path.join(repoRoot, '.env.local')],
    'a non-Git fixture must not inherit credentials from the template repository',
  );

  const token = getProjectGitHubToken({
    repoRoot,
    cwd: repoRoot,
    env: { GH_TOKEN: 'from-shell' },
  });

  assert.equal(token === 'from-shell', true, 'placeholder must fall through to the supplied process token');
});

// ---- 提交身份：commit 与注解 tag 在 git 没有身份时，由 .env.local 的 GH_TOKEN 所属账号补齐 ----

const IDENTITY = Object.freeze({
  name: 'Octo Cat',
  email: '4242+octo-cat@users.noreply.github.com',
  login: 'octo-cat',
});

// 隔离的 git 环境：没有系统/全局配置、HOME 是一次性目录，本机自己的身份不可能混进来。
function hermeticEnv(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'github-auth-home-')),
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    ...extra,
  };
}

function gitIn(cwd, env, args) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function createTokenRepo(token = 'secret-token') {
  const repoRoot = createGitRepo('https://github.com/example/repo.git');
  fs.writeFileSync(path.join(repoRoot, '.env.local'), `GH_TOKEN=${token}\n`);
  return repoRoot;
}

function recordingLookup(calls) {
  return ({ token }) => {
    calls.push(token);
    return { ...IDENTITY };
  };
}

test('buildGitHubGitEnv gives a commit the GH_TOKEN account identity when git has none, without leaking the token', () => {
  const env = hermeticEnv();
  const repoRoot = createTokenRepo();
  const calls = [];

  const built = buildGitHubGitEnv({
    repoRoot,
    cwd: repoRoot,
    args: ['commit', '-m', 'feat: x'],
    env,
    identityLookup: recordingLookup(calls),
  });

  assert.deepEqual(calls, ['secret-token']);
  assert.equal(built.GIT_AUTHOR_NAME, IDENTITY.name);
  assert.equal(built.GIT_AUTHOR_EMAIL, IDENTITY.email);
  assert.equal(built.GIT_COMMITTER_NAME, IDENTITY.name);
  assert.equal(built.GIT_COMMITTER_EMAIL, IDENTITY.email);
  assert.equal(built.GH_TOKEN, undefined, 'a local commit does not need the token in its environment');
  assert.equal(built.GIT_CONFIG_COUNT, undefined, 'a local commit gets no remote auth header');
  assert.equal(env.GIT_AUTHOR_NAME, undefined, 'the caller environment is never mutated');
});

test('buildGitHubGitEnv gives an annotated tag only the committer identity', () => {
  const env = hermeticEnv();
  const repoRoot = createTokenRepo();
  const calls = [];

  const built = buildGitHubGitEnv({
    repoRoot,
    cwd: repoRoot,
    args: ['tag', '-a', 'v1.0.0', '-m', 'Release v1.0.0'],
    env,
    identityLookup: recordingLookup(calls),
  });

  assert.deepEqual(calls, ['secret-token']);
  assert.equal(built.GIT_COMMITTER_NAME, IDENTITY.name);
  assert.equal(built.GIT_COMMITTER_EMAIL, IDENTITY.email);
  assert.equal(built.GIT_AUTHOR_NAME, undefined);
  assert.equal(built.GIT_AUTHOR_EMAIL, undefined);
});

test('buildGitHubGitEnv leaves a commit alone when git already has an identity', () => {
  const env = hermeticEnv();
  const repoRoot = createTokenRepo();
  gitIn(repoRoot, env, ['config', 'user.name', 'Local Name']);
  gitIn(repoRoot, env, ['config', 'user.email', 'local@example.test']);

  const built = buildGitHubGitEnv({
    repoRoot,
    cwd: repoRoot,
    args: ['commit', '-m', 'feat: x'],
    env,
    identityLookup: () => assert.fail('an identity git already has must not trigger a GitHub lookup'),
  });

  assert.equal(built, env);
});

test('buildGitHubGitEnv does no identity lookup for commands that need none, and the push header is unchanged', () => {
  const env = hermeticEnv();
  const repoRoot = createTokenRepo();
  const calls = [];
  const identityLookup = recordingLookup(calls);

  for (const args of [
    ['status', '--porcelain'],
    ['add', '-A'],
    ['merge', '--ff-only', 'origin/main'],
    ['merge', '--abort'],
    ['tag', 'v1.0.0'],
    ['rev-parse', 'HEAD'],
  ]) {
    const built = buildGitHubGitEnv({ repoRoot, cwd: repoRoot, args, env, identityLookup });
    assert.equal(built, env, args.join(' '));
  }

  const pushed = buildGitHubGitEnv({ repoRoot, cwd: repoRoot, args: ['push', 'origin', 'HEAD'], env, identityLookup });
  assert.equal(pushed.GIT_CONFIG_COUNT, '1');
  assert.equal(pushed.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  assert.equal(pushed.GIT_AUTHOR_NAME, undefined);
  assert.deepEqual(calls, []);
});

test('buildGitHubGitEnv does no identity lookup for a commit when no GH_TOKEN is available', () => {
  const env = hermeticEnv();
  const repoRoot = createGitRepo('https://github.com/example/repo.git');

  const built = buildGitHubGitEnv({
    repoRoot,
    cwd: repoRoot,
    args: ['commit', '-m', 'feat: x'],
    env,
    identityLookup: () => assert.fail('no token means nothing to look up'),
  });

  assert.equal(built, env);
});

test('buildGitHubGitEnv fails closed when the identity lookup fails instead of falling back to another identity', () => {
  const env = hermeticEnv({ EMAIL: 'auto-detected@example.test' });
  const repoRoot = createTokenRepo();

  assert.throws(
    () => buildGitHubGitEnv({
      repoRoot,
      cwd: repoRoot,
      args: ['commit', '-m', 'feat: x'],
      env,
      identityLookup: () => {
        throw new Error('无法由 GH_TOKEN 推导提交身份：offline');
      },
    }),
    /无法由 GH_TOKEN 推导提交身份：offline/u
  );
});

test('a real commit and annotated tag made with the built env carry the GH_TOKEN account identity and leave git config alone', () => {
  const env = hermeticEnv();
  const repoRoot = createTokenRepo();
  fs.writeFileSync(path.join(repoRoot, 'a.txt'), 'hello\n');
  gitIn(repoRoot, env, ['add', 'a.txt']);
  const identityLookup = () => ({ ...IDENTITY });

  const commitArgs = ['commit', '-m', 'feat: x'];
  gitIn(repoRoot, buildGitHubGitEnv({ repoRoot, cwd: repoRoot, args: commitArgs, env, identityLookup }), commitArgs);
  assert.equal(
    gitIn(repoRoot, env, ['log', '-1', '--format=%an|%ae|%cn|%ce']),
    `${IDENTITY.name}|${IDENTITY.email}|${IDENTITY.name}|${IDENTITY.email}`
  );

  const tagArgs = ['tag', '-a', 'v1.0.0', '-m', 'Release v1.0.0'];
  gitIn(repoRoot, buildGitHubGitEnv({ repoRoot, cwd: repoRoot, args: tagArgs, env, identityLookup }), tagArgs);
  assert.equal(
    gitIn(repoRoot, env, ['for-each-ref', 'refs/tags/v1.0.0', '--format=%(taggername)|%(taggeremail)']),
    `${IDENTITY.name}|<${IDENTITY.email}>`
  );

  assert.equal(fs.readFileSync(path.join(repoRoot, '.git', 'config'), 'utf8').includes('[user]'), false);
});

function collectScriptSources(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectScriptSources(full, found);
    else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) found.push(full);
  }
  return found;
}

test('every script that creates commits or annotated tags builds its git env through the identity-aware helpers', () => {
  const scriptsRoot = path.resolve(__dirname, '..', '..');
  const creators = new Map();
  for (const file of collectScriptSources(scriptsRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    if (/\[\s*['"](?:commit|tag)['"]\s*,/u.test(source)) {
      creators.set(path.relative(scriptsRoot, file).split(path.sep).join('/'), source);
    }
  }

  for (const known of ['qa-tools/qa-merge.js', 'tdd-tools/tdd-push.js', 'tdd-tools/tdd-commit.js']) {
    assert.ok(creators.has(known), `${known} is a known commit site; the scan must find it`);
  }
  for (const [name, source] of creators) {
    assert.match(
      source,
      /buildGitHubGitEnv\(|resolveCommitIdentity\(/u,
      `${name} creates commits or tags, so its git env must come from buildGitHubGitEnv or resolveCommitIdentity`
    );
  }
});

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
  getProjectGitHubToken,
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
  const parsed = parseEnvContent('A=1\nexport GH_TOKEN=\"from-file\"\n# nope\n');
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

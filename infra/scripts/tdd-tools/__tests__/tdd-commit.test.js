'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { main } = require('../tdd-commit');

const SCRIPT = path.resolve(__dirname, '..', 'tdd-commit.js');
const TOKEN = 'ghp_tddCommitTestToken0123456789';
const IDENTITY = Object.freeze({
  name: 'Octo Cat',
  email: '4242+octo-cat@users.noreply.github.com',
  login: 'octo-cat',
});
const IDENTITY_LINE = 'Octo Cat <4242+octo-cat@users.noreply.github.com>';

// 隔离的 git 环境：没有系统/全局配置、HOME 是一次性目录，本机自己的身份不可能混进来。
function hermeticEnv(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tdd-commit-home-')),
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

function createRepo(env, { token = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdd-commit-repo-'));
  git(['init', '-q', '-b', 'main'], dir, env);
  if (token) fs.writeFileSync(path.join(dir, '.env.local'), `GH_TOKEN=${token}\n`);
  return dir;
}

function stageFile(repo, env, name = 'a.txt', content = 'hello\n') {
  fs.writeFileSync(path.join(repo, name), content);
  git(['add', name], repo, env);
}

function commitCount(repo, env) {
  const result = spawnSync('git', ['rev-list', '--all', '--count'], { cwd: repo, env, encoding: 'utf8', stdio: 'pipe' });
  return result.status === 0 ? Number(result.stdout.trim()) : 0;
}

function parseReport(lines) {
  const report = {};
  for (const line of lines) {
    const match = /^([A-Z_]+)=(.*)$/u.exec(line);
    if (match) report[match[1]] = match[2];
  }
  return report;
}

function run(repo, env, argv, overrides = {}) {
  const lines = [];
  const lookupCalls = [];
  const exitCode = main({
    argv,
    repoRoot: repo,
    cwd: repo,
    env,
    stdio: 'pipe',
    lookup: ({ token }) => {
      lookupCalls.push(token);
      return { ...IDENTITY };
    },
    log: (line) => lines.push(String(line)),
    ...overrides,
  });
  return { exitCode, report: parseReport(lines), lookupCalls };
}

function configValue(repo, env, key) {
  const result = spawnSync('git', ['config', '--get', key], { cwd: repo, env, encoding: 'utf8', stdio: 'pipe' });
  return result.status === 0 ? result.stdout.trim() : null;
}

test('tdd commit authors the commit as the GH_TOKEN account when git has no identity, without writing git config', () => {
  const env = hermeticEnv();
  const repo = createRepo(env, { token: TOKEN });
  stageFile(repo, env);

  const { exitCode, report, lookupCalls } = run(repo, env, ['-m', 'feat: demo']);

  assert.equal(exitCode, 0);
  assert.equal(report.STATUS, 'OK');
  assert.equal(report.IDENTITY_SOURCE, 'github-token');
  assert.equal(report.IDENTITY, IDENTITY_LINE);
  assert.match(report.SUMMARY, /feat: demo|已提交/u);
  assert.match(report.NEXT_ACTION, /tdd/u);
  assert.deepEqual(lookupCalls, [TOKEN]);

  assert.equal(report.COMMIT, git(['rev-parse', 'HEAD'], repo, env));
  assert.equal(
    git(['log', '-1', '--format=%an|%ae|%cn|%ce'], repo, env),
    `${IDENTITY.name}|${IDENTITY.email}|${IDENTITY.name}|${IDENTITY.email}`
  );
  assert.equal(git(['log', '-1', '--format=%B'], repo, env), 'feat: demo', 'the message is exactly what the caller passed');

  assert.equal(configValue(repo, env, 'user.name'), null);
  assert.equal(configValue(repo, env, 'user.email'), null);
  assert.equal(fs.readFileSync(path.join(repo, '.git', 'config'), 'utf8').includes('[user]'), false);
  assert.equal(report.SUMMARY.includes(TOKEN) || JSON.stringify(report).includes(TOKEN), false, 'the token never reaches the output');
});

test('tdd commit keeps an identity git already has and does not query GitHub', () => {
  const env = hermeticEnv();
  const repo = createRepo(env, { token: TOKEN });
  git(['config', 'user.name', 'Local Name'], repo, env);
  git(['config', 'user.email', 'local@example.test'], repo, env);
  stageFile(repo, env);

  const { exitCode, report, lookupCalls } = run(repo, env, ['-m', 'chore: local identity']);

  assert.equal(exitCode, 0);
  assert.equal(report.STATUS, 'OK');
  assert.equal(report.IDENTITY_SOURCE, 'configured');
  assert.equal(report.IDENTITY, undefined);
  assert.deepEqual(lookupCalls, []);
  assert.equal(git(['log', '-1', '--format=%an|%ae|%cn|%ce'], repo, env), 'Local Name|local@example.test|Local Name|local@example.test');
});

test('tdd commit blocks without running git when git has no identity and no GH_TOKEN is available', () => {
  const env = hermeticEnv({ EMAIL: 'auto-detected@example.test' });
  const repo = createRepo(env);
  stageFile(repo, env);

  const { exitCode, report, lookupCalls } = run(repo, env, ['-m', 'feat: must not be authored by auto-detection']);

  assert.notEqual(exitCode, 0);
  assert.equal(report.STATUS, 'BLOCKED');
  assert.equal(report.IDENTITY_SOURCE, 'unresolved');
  assert.match(report.SUMMARY, /GH_TOKEN/u);
  assert.match(report.NEXT_ACTION, /\.env\.local/u);
  assert.deepEqual(lookupCalls, []);
  assert.equal(commitCount(repo, env), 0, 'no commit exists, so git auto-detection never authored one');
});

test('tdd commit blocks and creates no commit when the GitHub account lookup fails', () => {
  const env = hermeticEnv();
  const repo = createRepo(env, { token: TOKEN });
  stageFile(repo, env);

  const { exitCode, report } = run(repo, env, ['-m', 'feat: offline'], {
    lookup: () => {
      throw new Error('无法由 GH_TOKEN 推导提交身份：GitHub 账号查询失败（HTTP 401）：Bad credentials');
    },
  });

  assert.notEqual(exitCode, 0);
  assert.equal(report.STATUS, 'BLOCKED');
  assert.match(report.SUMMARY, /Bad credentials/u);
  assert.match(report.NEXT_ACTION, /GH_TOKEN/u);
  assert.equal(commitCount(repo, env), 0);
});

test('tdd commit rejects --author in every spelling because the author comes only from the GH_TOKEN account', () => {
  const env = hermeticEnv();
  const repo = createRepo(env, { token: TOKEN });
  stageFile(repo, env);

  for (const argv of [
    ['--author', 'Someone <someone@example.test>', '-m', 'x'],
    ['--author=Someone <someone@example.test>', '-m', 'x'],
  ]) {
    const { exitCode, report, lookupCalls } = run(repo, env, argv);
    assert.notEqual(exitCode, 0, argv.join(' '));
    assert.equal(report.STATUS, 'BLOCKED');
    assert.match(report.SUMMARY, /--author/u);
    assert.deepEqual(lookupCalls, []);
    assert.equal(commitCount(repo, env), 0);
  }
});

test('tdd commit reports a failing git commit as BLOCKED with the git exit code, still without persisting identity', () => {
  const env = hermeticEnv();
  const repo = createRepo(env, { token: TOKEN });
  stageFile(repo, env);
  git(['-c', 'user.name=Seed', '-c', 'user.email=seed@example.test', 'commit', '-q', '-m', 'seed'], repo, env);

  const { exitCode, report } = run(repo, env, ['-m', 'chore: nothing is staged']);

  assert.notEqual(exitCode, 0);
  assert.equal(report.STATUS, 'BLOCKED');
  assert.match(report.SUMMARY, /git commit/u);
  assert.match(report.SUMMARY, /退出码 1/u);
  assert.equal(report.COMMIT, undefined);
  assert.equal(commitCount(repo, env), 1);
  assert.equal(configValue(repo, env, 'user.name'), null);
});

test('tdd commit forwards commit options such as -a and --no-verify untouched', () => {
  const env = hermeticEnv();
  const repo = createRepo(env, { token: TOKEN });
  stageFile(repo, env, 'tracked.txt', 'v1\n');
  git(['-c', 'user.name=Seed', '-c', 'user.email=seed@example.test', 'commit', '-q', '-m', 'seed'], repo, env);
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'v2\n');

  const { exitCode, report } = run(repo, env, ['-a', '--no-verify', '-m', 'fix: pick up the unstaged change']);

  assert.equal(exitCode, 0);
  assert.equal(report.STATUS, 'OK');
  assert.equal(git(['show', 'HEAD:tracked.txt'], repo, env), 'v2');
  assert.equal(git(['log', '-1', '--format=%an'], repo, env), IDENTITY.name);
});

test('tdd commit --help prints usage and exits 0 before touching anything', () => {
  for (const flag of ['--help', '-h']) {
    const result = spawnSync(process.execPath, [SCRIPT, flag], {
      cwd: os.tmpdir(),
      env: hermeticEnv(),
      encoding: 'utf8',
      stdio: 'pipe',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: pnpm agent -- tdd commit/u);
    assert.match(result.stdout, /GH_TOKEN/u);
  }
});

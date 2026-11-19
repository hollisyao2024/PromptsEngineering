'use strict';

// 预期取自任务 template-update-reminder 的用户验收口径：
// AC1 有新版 → AVAILABLE|本地->远端；AC2 最新 → CURRENT，失败 → UNKNOWN 且不抛错；
// AC3 24 小时缓存命中不联网，模板源角色 → SKIPPED。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CACHE_TTL_MS,
  checkTemplateUpdate,
  compareVersions,
  formatTemplateUpdateLine,
  shouldReportTemplateUpdate,
} = require('../template-update-check');

const UPSTREAM = { repository: 'https://github.com/hollisyao2024/PromptsEngineering.git', branch: 'main' };
const MANIFEST_URL = 'https://raw.githubusercontent.com/hollisyao2024/PromptsEngineering/main/agent/manifest.json';

function fixture({ localVersion = '3.17.20', role = 'consumer', lock = true } = {}) {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-update-check-'));
  const mainRoot = path.join(container, 'repo');
  const tmpDir = path.join(container, 'tmp');
  fs.mkdirSync(mainRoot);
  fs.mkdirSync(tmpDir);
  if (lock) {
    fs.writeFileSync(path.join(mainRoot, 'xirang.lock.json'), JSON.stringify({ packages: { agent: { version: localVersion } } }));
  }
  const config = { template: { role, upstream: UPSTREAM }, containerDirs: { tmp: tmpDir, worktrees: path.join(container, 'worktrees') } };
  return { container, mainRoot, tmpDir, config };
}

function fetcher(version, calls) {
  return async (url) => {
    calls.push(url);
    return { version };
  };
}

test('AC1 远端版本更高时输出 AVAILABLE 与本地->远端版本', async () => {
  const { mainRoot, config } = fixture();
  const calls = [];
  const result = await checkTemplateUpdate({ config, mainRoot, env: {}, fetchManifest: fetcher('3.17.35', calls) });
  assert.equal(result.status, 'AVAILABLE');
  assert.deepEqual(calls, [MANIFEST_URL]);
  assert.equal(formatTemplateUpdateLine(result), 'TEMPLATE_UPDATE=AVAILABLE|3.17.20->3.17.35|说“更新息壤模板”');
});

test('AC2 版本相同或本地更新时输出 CURRENT', async () => {
  for (const [local, remote] of [['3.17.35', '3.17.35'], ['3.18.0', '3.17.35']]) {
    const { mainRoot, config } = fixture({ localVersion: local });
    const result = await checkTemplateUpdate({ config, mainRoot, env: {}, fetchManifest: fetcher(remote, []) });
    assert.equal(result.status, 'CURRENT');
    assert.equal(formatTemplateUpdateLine(result), `TEMPLATE_UPDATE=CURRENT|${local}`);
  }
});

test('AC2 网络失败输出 UNKNOWN 且不抛错', async () => {
  const { mainRoot, config } = fixture();
  const result = await checkTemplateUpdate({
    config, mainRoot, env: {}, fetchManifest: async () => { throw new Error('ETIMEDOUT'); },
  });
  assert.equal(result.status, 'UNKNOWN');
  assert.match(formatTemplateUpdateLine(result), /^TEMPLATE_UPDATE=UNKNOWN\|fetch-failed/);
});

test('AC2 远端 manifest 无合法版本或缺少本地 lock 时输出 UNKNOWN', async () => {
  const bad = fixture();
  const badResult = await checkTemplateUpdate({ config: bad.config, mainRoot: bad.mainRoot, env: {}, fetchManifest: fetcher('latest', []) });
  assert.equal(badResult.status, 'UNKNOWN');
  const noLock = fixture({ lock: false });
  const noLockResult = await checkTemplateUpdate({ config: noLock.config, mainRoot: noLock.mainRoot, env: {}, fetchManifest: fetcher('3.17.35', []) });
  assert.equal(noLockResult.status, 'UNKNOWN');
  assert.match(formatTemplateUpdateLine(noLockResult), /no-local-version/);
});

test('AC2 上游不是 GitHub 仓库时输出 UNKNOWN 且不联网', async () => {
  const { mainRoot, config } = fixture();
  config.template.upstream = { repository: 'https://example.com/x.git', branch: 'main' };
  const calls = [];
  const result = await checkTemplateUpdate({ config, mainRoot, env: {}, fetchManifest: fetcher('3.17.35', calls) });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(calls.length, 0);
});

test('AC3 24 小时内命中缓存不联网，过期后重新获取', async () => {
  const { mainRoot, config } = fixture();
  const calls = [];
  const start = Date.parse('2026-11-19T00:00:00Z');
  await checkTemplateUpdate({ config, mainRoot, env: {}, now: start, fetchManifest: fetcher('3.17.35', calls) });
  const cached = await checkTemplateUpdate({ config, mainRoot, env: {}, now: start + CACHE_TTL_MS - 1, fetchManifest: fetcher('9.9.9', calls) });
  assert.equal(calls.length, 1);
  assert.equal(cached.remoteVersion, '3.17.35');
  const expired = await checkTemplateUpdate({ config, mainRoot, env: {}, now: start + CACHE_TTL_MS + 1, fetchManifest: fetcher('3.17.40', calls) });
  assert.equal(calls.length, 2);
  assert.equal(expired.remoteVersion, '3.17.40');
});

test('AC3 获取失败不写缓存，下次仍会联网', async () => {
  const { mainRoot, config } = fixture();
  const calls = [];
  await checkTemplateUpdate({ config, mainRoot, env: {}, fetchManifest: async (url) => { calls.push(url); throw new Error('x'); } });
  await checkTemplateUpdate({ config, mainRoot, env: {}, fetchManifest: fetcher('3.17.35', calls) });
  assert.equal(calls.length, 2);
});

test('AC3 模板源角色或显式关闭时输出 SKIPPED 且不联网', async () => {
  const source = fixture({ role: 'source' });
  const calls = [];
  const sourceResult = await checkTemplateUpdate({ config: source.config, mainRoot: source.mainRoot, env: {}, fetchManifest: fetcher('3.17.35', calls) });
  assert.equal(formatTemplateUpdateLine(sourceResult), 'TEMPLATE_UPDATE=SKIPPED|template-source');
  const off = fixture();
  const offResult = await checkTemplateUpdate({ config: off.config, mainRoot: off.mainRoot, env: { XIRANG_TEMPLATE_UPDATE_CHECK: '0' }, fetchManifest: fetcher('3.17.35', calls) });
  assert.equal(formatTemplateUpdateLine(offResult), 'TEMPLATE_UPDATE=SKIPPED|disabled');
  assert.equal(calls.length, 0);
});

test('compareVersions 按数字逐段比较', () => {
  assert.equal(compareVersions('3.17.9', '3.17.10'), -1);
  assert.equal(compareVersions('3.17.10', '3.17.10'), 0);
  assert.equal(compareVersions('4.0.0', '3.99.99'), 1);
  assert.equal(compareVersions('x', '1.0.0'), null);
});

test('仅 finish 成功且非 dry-run 时报告模板更新', () => {
  assert.equal(shouldReportTemplateUpdate(0, { dryRun: false }), true);
  assert.equal(shouldReportTemplateUpdate(1, { dryRun: false }), false);
  assert.equal(shouldReportTemplateUpdate(0, { dryRun: true }), false);
});

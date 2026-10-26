const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
async function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-release-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['v1', 'v2', 'v3']) fs.mkdirSync(path.join(root, name));
  const current = path.join(root, 'current'); fs.symlinkSync(path.join(root, 'v1'), current);
  const { releaseCurrent } = await import(pathToFileURL(path.resolve(__dirname, '../profiles/private/release.mjs')).href);
  return { root, current, releaseCurrent, options: { attempts: 1, delayMs: 0 } };
}
// Windows 无法用 rename 原子替换已有符号链接；此平台须在加锁和改动链接前明确拒绝。
async function windowsRefuses(t, platform) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-release-win-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'v2'));
  const current = path.join(root, 'current');
  const { releaseCurrent } = await import(pathToFileURL(path.resolve(__dirname, '../profiles/private/release.mjs')).href);
  await assert.rejects(releaseCurrent(path.join(root, 'v2'), current, 'http://localhost/health', { attempts: 1, delayMs: 0, platform, fetchImpl: async () => ({ ok: true }) }), /POSIX atomic symlink/);
  assert.equal(fs.existsSync(current), false);
  assert.equal(fs.existsSync(`${current}.release-lock`), false);
}
test('win32 release switching is refused before taking the lock or touching the link', t => windowsRefuses(t, 'win32'));
test('failed release restores previous link; overlapping releases are blocked', async t => {
  if (process.platform === 'win32') return windowsRefuses(t, process.platform);
  const f = await fixture(t), release = path.join(f.root, 'v2');
  await assert.rejects(f.releaseCurrent(release, f.current, 'http://localhost/health', { ...f.options, fetchImpl: async () => {
    await assert.rejects(f.releaseCurrent(path.join(f.root, 'v3'), f.current, 'http://localhost/health', f.options), /lock/);
    return { ok: false };
  } }), /Health check failed/);
  assert.equal(fs.readlinkSync(f.current), path.join(f.root, 'v1'));
});
test('failed health check must not roll back an externally changed release link', async t => {
  if (process.platform === 'win32') return windowsRefuses(t, process.platform);
  const f = await fixture(t);
  await assert.rejects(f.releaseCurrent(path.join(f.root, 'v2'), f.current, 'http://localhost/health', { ...f.options, fetchImpl: async () => {
    fs.unlinkSync(f.current); fs.symlinkSync(path.join(f.root, 'v3'), f.current); return { ok: false };
  } }), /changed externally/);
  assert.equal(fs.readlinkSync(f.current), path.join(f.root, 'v3'));
});

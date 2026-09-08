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
test('TC-ARCHPLAT-008 failed release restores previous link; overlapping releases are blocked', async t => {
  const f = await fixture(t), release = path.join(f.root, 'v2');
  await assert.rejects(f.releaseCurrent(release, f.current, 'http://localhost/health', { ...f.options, fetchImpl: async () => {
    await assert.rejects(f.releaseCurrent(path.join(f.root, 'v3'), f.current, 'http://localhost/health', f.options), /lock/);
    return { ok: false };
  } }), /Health check failed/);
  assert.equal(fs.readlinkSync(f.current), path.join(f.root, 'v1'));
});
test('TC-ARCHPLAT-008 failed health check must not roll back an externally changed release link', async t => {
  const f = await fixture(t);
  await assert.rejects(f.releaseCurrent(path.join(f.root, 'v2'), f.current, 'http://localhost/health', { ...f.options, fetchImpl: async () => {
    fs.unlinkSync(f.current); fs.symlinkSync(path.join(f.root, 'v3'), f.current); return { ok: false };
  } }), /changed externally/);
  assert.equal(fs.readlinkSync(f.current), path.join(f.root, 'v3'));
});

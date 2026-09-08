import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// The caller starts the release's process and provides its health URL.
// This helper only switches a release pointer; it does not deploy or restart services.
export async function releaseCurrent(releaseArg, currentArg, health, { fetchImpl = fetch, attempts = 10, delayMs = 1000 } = {}) {
  if (!releaseArg || !currentArg || !health) throw new Error('release-dir, current-link and health-url required');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 100 || !Number.isFinite(delayMs) || delayMs < 0) throw new Error('Invalid health check options');
  const release = fs.realpathSync(releaseArg);
  const requested = path.resolve(currentArg);
  const current = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
  if (!fs.statSync(release).isDirectory() || release === current || path.dirname(release) !== path.dirname(current)) throw new Error('Release and current must be distinct siblings');
  const url = new URL(health);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid health URL');
  const lock = `${current}.release-lock`;
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Release lock exists; inspect the owning process and release pointer before recovery'); throw error; }
  const temporary = `${current}.next-${crypto.randomUUID()}`;
  let old, switched = false;
  const pointer = () => {
    try { const stat = fs.lstatSync(current); if (!stat.isSymbolicLink()) throw new Error('current must be a symlink'); return fs.readlinkSync(current); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  };
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, release })); fs.fsyncSync(fd);
    old = pointer();
    fs.symlinkSync(release, temporary); fs.renameSync(temporary, current); switched = true;
    let healthy = false;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try { const response = await fetchImpl(url, { signal: AbortSignal.timeout(3000), redirect: 'error' }); healthy = response.ok; await response.body?.cancel(); } catch {}
      if (healthy) break;
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    if (pointer() !== release) throw new Error('Release link changed externally; preserve it and inspect the release state');
    if (!healthy) throw new Error('Health check failed');
    return { status: 'RELEASED', release };
  } catch (error) {
    if (switched) {
      if (pointer() !== release) throw new Error(`${error.message}; release link changed externally, automatic rollback blocked`);
      if (old !== undefined) { fs.symlinkSync(old, temporary); fs.renameSync(temporary, current); }
      else fs.unlinkSync(current);
    }
    throw error;
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    fs.closeSync(fd); fs.unlinkSync(lock);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const result = await releaseCurrent(...process.argv.slice(2)); console.log(`STATUS=${result.status}`); }
  catch (error) { console.error(`STATUS=BLOCKED\nREASON=${error.message}`); process.exitCode = 1; }
}

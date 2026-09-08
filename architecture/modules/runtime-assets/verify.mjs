import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
export function verifyAssets(root, entries, target) {
  if (!Array.isArray(entries)) throw new Error('Asset entries must be an array');
  const seen = new Set();
  for (const item of entries.filter(item => !target || item.target === target)) {
    if (!item.id || seen.has(item.id) || !/^[a-z0-9-]+$/.test(item.target || '') || !/^[a-f0-9]{64}$/.test(item.sha256 || '')) throw new Error('Invalid or duplicate asset identity');
    seen.add(item.id);
    if (!item.path || path.isAbsolute(item.path) || item.path.includes('\\') || item.path.split('/').some(s => !s || s === '.' || s === '..')) throw new Error('Unsafe asset path');
    let file = root;
    for (const part of item.path.split('/')) { file = path.join(file, part); if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Asset symlink rejected'); }
    if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== item.sha256) throw new Error(`Asset checksum mismatch: ${item.id}`);
  }
  if (target && seen.size === 0) throw new Error(`No verified assets for target: ${target}`);
  return seen.size;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { const root = path.dirname(fileURLToPath(import.meta.url)); console.log(`VERIFIED=${verifyAssets(root,JSON.parse(fs.readFileSync(path.join(root,'assets.json'),'utf8')),process.argv[2])}\nSTATUS=OK`); }
  catch(error) { console.error(`STATUS=BLOCKED\nREASON=${error.message}`); process.exitCode=1; }
}

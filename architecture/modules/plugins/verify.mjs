import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function verifyPlugin(root, manifest, { target, allowedPermissions = [] } = {}) {
  if (!/^[a-z][a-z0-9-]+$/.test(manifest.id) || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid plugin identity');
  if (!Array.isArray(manifest.targets) || !manifest.targets.length || manifest.targets.some(v => !/^[a-z0-9-]+$/.test(v))) throw new Error('Invalid plugin targets');
  if (target && !manifest.targets.includes(target)) throw new Error('Unsupported plugin target');
  if (!Array.isArray(manifest.permissions) || manifest.permissions.some(p => !allowedPermissions.includes(p))) throw new Error('Plugin permission not approved');
  if (manifest.signatureVerified !== false) throw new Error('Manifest cannot assert signature trust; use a signature verifier');
  if (typeof manifest.entry !== 'string' || path.isAbsolute(manifest.entry) || manifest.entry.includes('\\') || manifest.entry.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe plugin entry');
  let file = root; for (const part of manifest.entry.split('/')) { file = path.join(file,part); if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Plugin symlink rejected'); }
  if (!fs.statSync(file).isFile()) throw new Error('Plugin entry is not a file');
  return { id: manifest.id, signatureVerified: false };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { const root=path.dirname(fileURLToPath(import.meta.url)); console.log(JSON.stringify(verifyPlugin(root,JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'))))); console.log('STATUS=OK'); }
  catch(error) { console.error(`STATUS=BLOCKED\nREASON=${error.message}`); process.exitCode=1; }
}

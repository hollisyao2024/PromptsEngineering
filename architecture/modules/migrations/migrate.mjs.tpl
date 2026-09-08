import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const engine = '{{engine}}';
const root = path.dirname(fileURLToPath(import.meta.url));
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
export function loadMigrations() {
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'migrations.json'), 'utf8'));
  if (!Array.isArray(registry)) throw new Error('Migration registry must be an array');
  const ids = new Set(); let previous = '';
  const result = registry.map(item => {
    if (!/^[0-9][a-zA-Z0-9_-]*$/.test(item.id) || !/^[0-9][a-zA-Z0-9_-]*\.sql$/.test(item.file) || ids.has(item.id) || item.id <= previous) throw new Error('Invalid, duplicate or unordered migration');
    ids.add(item.id); previous = item.id;
    const file = path.join(root, 'migrations', item.file);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Migration symlink rejected');
    const sql = fs.readFileSync(file, 'utf8');
    if (digest(sql) !== item.checksum) throw new Error(`Migration checksum mismatch: ${item.id}`);
    if (typeof item.transactional !== 'boolean') throw new Error('Migration transaction mode required');
    if (engine === 'sqlite' && !item.transactional) throw new Error('SQLite migrations must be transactional');
    return { ...item, sql };
  });
  const unregistered = fs.readdirSync(path.join(root, 'migrations')).filter(name => name.endsWith('.sql') && !registry.some(item => item.file === name));
  if (unregistered.length) throw new Error(`Unregistered migrations: ${unregistered.join(', ')}`);
  return result;
}
function preflight(migrations, history) {
  for (const row of history) {
    const migration = migrations.find(item => item.id === row.id);
    if (!migration || migration.checksum !== row.checksum || row.state !== 'applied') throw new Error(`Migration history needs recovery: ${row.id}`);
  }
  const applied = new Set(history.map(row => row.id));
  let gap = false;
  for (const migration of migrations) { if (!applied.has(migration.id)) gap = true; else if (gap) throw new Error('Migration history is not a contiguous prefix'); }
  return migrations.filter(item => !applied.has(item.id));
}
async function postgres(migrations, apply) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const { Client } = await import('pg'), client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect(); let locked = false;
  try {
    if (apply) { await client.query("SELECT pg_advisory_lock(hashtext('xirang_migrations'))"); locked = true; }
    const exists = (await client.query("SELECT to_regclass('public.xirang_migrations') AS name")).rows[0].name;
    const history = exists ? (await client.query('SELECT id, checksum, state FROM xirang_migrations ORDER BY id')).rows : [];
    const pending = preflight(migrations, history);
    console.log(`PENDING=${pending.map(item => item.id).join(',')}`);
    if (!apply) return;
    await client.query('CREATE TABLE IF NOT EXISTS xirang_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, state TEXT NOT NULL)');
    for (const item of pending) {
      if (item.transactional) {
        await client.query('BEGIN');
        try {
          await client.query(item.sql);
          await client.query('INSERT INTO xirang_migrations VALUES ($1,$2,$3)', [item.id,item.checksum,'applied']);
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      } else {
        await client.query('INSERT INTO xirang_migrations VALUES ($1,$2,$3)', [item.id,item.checksum,'running']);
        // A partially applied nontransactional migration remains running and blocks retries.
        await client.query(item.sql);
        await client.query('UPDATE xirang_migrations SET state=$2 WHERE id=$1', [item.id,'applied']);
      }
    }
  } finally { try { if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('xirang_migrations'))"); } finally { await client.end(); } }
}
async function sqlite(migrations, apply) {
  if (!process.env.SQLITE_PATH) throw new Error('SQLITE_PATH required');
  const { DatabaseSync } = await import('node:sqlite');
  if (!apply && !fs.existsSync(process.env.SQLITE_PATH)) { console.log(`PENDING=${migrations.map(item => item.id).join(',')}`); return; }
  const db = new DatabaseSync(process.env.SQLITE_PATH, { readOnly: !apply });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    if (apply) db.exec('BEGIN IMMEDIATE');
    try {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='xirang_migrations'").get();
      const history = exists ? db.prepare('SELECT id, checksum, state FROM xirang_migrations ORDER BY id').all() : [];
      const pending = preflight(migrations, history); console.log(`PENDING=${pending.map(item => item.id).join(',')}`);
      if (apply) {
        db.exec('CREATE TABLE IF NOT EXISTS xirang_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, state TEXT NOT NULL)');
        for (const item of pending) { db.exec(item.sql); db.prepare('INSERT INTO xirang_migrations VALUES (?,?,?)').run(item.id,item.checksum,'applied'); }
        db.exec('COMMIT');
      }
    } catch (error) { if (apply) db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
}
try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) throw new Error('Only --apply is supported; default is read-only preflight');
  const migrations = loadMigrations();
  await (engine === 'postgres' ? postgres : sqlite)(migrations, args.includes('--apply'));
  console.log(`STATUS=${args.includes('--apply') ? 'APPLIED' : 'PLANNED'}`);
} catch (error) { console.error(`STATUS=BLOCKED\nREASON=${error.message}`); process.exitCode = 1; }

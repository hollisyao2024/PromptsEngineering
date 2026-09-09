import {readdirSync,readFileSync,existsSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
export function diskMigrations(root) {
  if(!existsSync(root))throw new Error('Missing Prisma migrations directory');
  const migrations=[];
  for(const name of readdirSync(root).sort()) {
    const directory=path.join(root,name);
    if(lstatSync(directory).isSymbolicLink())throw new Error('Migration symlink');
    if(!lstatSync(directory).isDirectory())continue;
    if(!/^\d{14}_[a-zA-Z0-9_-]+$/.test(name))throw new Error('Invalid migration directory: '+name);
    const sql=path.join(directory,'migration.sql');
    if(!existsSync(sql)||lstatSync(sql).isSymbolicLink())throw new Error('Missing or linked migration.sql: '+name);
    migrations.push({name,checksum:createHash('sha256').update(readFileSync(sql)).digest('hex')});
  }
  return migrations;
}
export function verifyHistory(disk,history) {
  const applied=new Set();
  for(const row of history) {
    if(row.rolled_back_at)continue;
    if(!row.finished_at)throw new Error('Failed migration requires explicit recovery: '+row.migration_name);
    const item=disk.find(m=>m.name===row.migration_name);
    if(!item)throw new Error('Applied migration missing on disk: '+row.migration_name);
    if(item.checksum!==row.checksum)throw new Error('Applied migration checksum changed: '+item.name);
    if(applied.has(item.name))throw new Error('Duplicate completed migration: '+item.name);
    applied.add(item.name);
  }
  return {applied:[...applied],pending:disk.filter(m=>!applied.has(m.name)).map(m=>m.name)};
}

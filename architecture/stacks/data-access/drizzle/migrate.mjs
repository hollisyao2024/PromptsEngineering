import {existsSync,writeFileSync,unlinkSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {databaseUrl,sqliteUrl,postgresConfiguration} from './src/connection.mjs';
import {diskMigrations,verifyHistory} from './migration-history.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));process.chdir(root);
const action=process.argv[2]||'status';if(!['status','deploy'].includes(action)||process.argv.length>3)throw Error('Use status or deploy, without extra flags');
const url=databaseUrl(),marker=new URL('.migration-running.json',import.meta.url);
if(existsSync(marker))throw Error('Previous migration result requires explicit recovery; inspect database/SQL before removing .migration-running.json');
if('{{dialect}}'==='sqlite'&&url==='file::memory:')throw Error('Persistent SQLite file required for migrations');
const disk=diskMigrations(new URL('drizzle',import.meta.url),'{{dialect}}');
if('{{dialect}}'==='sqlite'&&action==='status'&&!existsSync(fileURLToPath(sqliteUrl(url)))){console.log(JSON.stringify({status:'OK',...verifyHistory(disk,[])}));process.exit(0);}
let close=()=>{},history=[],apply,databaseLock,uncertain=false;
try{
 if('{{dialect}}'==='postgresql'){
  const {Client}=await import('pg'),pgConfig=postgresConfiguration(url),client=new Client({...pgConfig,connectionTimeoutMillis:5000});await client.connect();close=()=>client.end();
  await client.query("SET lock_timeout = '10s'");
  await client.query("SELECT pg_advisory_lock(hashtext('xirang-drizzle-migrate'))");
  if((await client.query("SELECT to_regclass('_prisma_migrations') as existing")).rows[0].existing)throw Error('Prisma history exists; explicit history adoption required');
  if((await client.query("SELECT to_regclass($1) as existing",['"'+pgConfig.schema+'".__drizzle_migrations'])).rows[0].existing)history=(await client.query('SELECT id,hash,created_at FROM \"'+pgConfig.schema+'\".__drizzle_migrations ORDER BY id')).rows;
  const {drizzle}=await import('drizzle-orm/node-postgres'),{migrate}=await import('drizzle-orm/node-postgres/migrator');apply=()=>migrate(drizzle(client),{migrationsFolder:'./drizzle',migrationsSchema:pgConfig.schema});
 }else if('{{dialect}}'==='mysql'){
  const {createConnection}=await import('mysql2/promise'),client=await createConnection(url);close=()=>client.end();
  const [lock]=await client.query("SELECT GET_LOCK(CONCAT('xirang_drizzle_',DATABASE()),10) AS acquired");if(lock[0].acquired!==1)throw Error('Migration lock unavailable');
  const [tables]=await client.query('SHOW TABLES'),names=tables.flatMap(r=>Object.values(r));if(names.includes('_prisma_migrations'))throw Error('Prisma history exists; explicit history adoption required');
  if(names.includes('__drizzle_migrations'))[history]=await client.query('SELECT id,hash,created_at FROM __drizzle_migrations ORDER BY id');
  const {drizzle}=await import('drizzle-orm/mysql2'),{migrate}=await import('drizzle-orm/mysql2/migrator');apply=()=>migrate(drizzle(client),{migrationsFolder:'./drizzle'});
 }else{
  const file=fileURLToPath(sqliteUrl(url));databaseLock=(existsSync(file)?realpathSync(file):path.join(realpathSync(path.dirname(file)),path.basename(file)))+'-xirang-migration-lock.json';
  try{writeFileSync(databaseLock,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()})+'\n',{flag:'wx',mode:0o600});}catch(e){databaseLock=undefined;throw Error('SQLite database migration lock exists or is unavailable; active executor or explicit recovery required');}
  const {createClient}=await import('@libsql/client'),client=createClient({url:sqliteUrl(url)});close=()=>client.close();
  const names=(await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(r=>r.name);if(names.includes('_prisma_migrations'))throw Error('Prisma history exists; explicit history adoption required');
  if(names.includes('__drizzle_migrations'))history=(await client.execute('SELECT rowid AS id,hash,created_at FROM __drizzle_migrations ORDER BY rowid')).rows;
  const {drizzle}=await import('drizzle-orm/libsql'),{migrate}=await import('drizzle-orm/libsql/migrator');apply=()=>migrate(drizzle(client),{migrationsFolder:'./drizzle'});
 }
 const report=verifyHistory(disk,history);console.log(JSON.stringify({status:'OK',...report}));
 if(action==='deploy'&&report.pending.length){
  writeFileSync(marker,JSON.stringify({database:createHash('sha256').update(url).digest('hex'),pending:report.pending,startedAt:new Date().toISOString()})+'\n',{flag:'wx',mode:0o600});
  uncertain=true;await apply();unlinkSync(marker);uncertain=false;
 }
}finally{try{await close();}finally{if(databaseLock&&!uncertain)unlinkSync(databaseLock);}}

import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {diskMigrations,verifyHistory} from './migration-history.mjs';
import {loadEnvironment} from './environment.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));process.chdir(root);loadEnvironment();
const action=process.argv[2]||'status';
if(!['status','deploy','dev'].includes(action))throw new Error('Use status, deploy or dev');
if(!process.env.DATABASE_URL)throw new Error('Explicit DATABASE_URL required');
if(action==='dev' && '{{engine}}'==='postgres') {
  if(!process.env.SHADOW_DATABASE_URL || process.env.SHADOW_DATABASE_URL===process.env.DATABASE_URL)throw new Error('A separate SHADOW_DATABASE_URL is required');
}
const disk=diskMigrations(fileURLToPath(new URL('prisma/migrations',import.meta.url)));
let history=[];
if('{{engine}}'==='postgres') {
  const {Client}=await import('pg');const url=new URL(process.env.DATABASE_URL);
  const schema=url.searchParams.get('schema')||'public';
  const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
  await client.connect();
  try {history=(await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "'+schema.replaceAll('"','""')+'"."_prisma_migrations"')).rows;}
  catch(e){if(e.code!=='42P01')throw new Error('Unable to read migration history');}
  finally {await client.end();}
} else {
  const {default:Database}=await import('better-sqlite3');
  const url=process.env.DATABASE_URL;
  if(!url.startsWith('file:')||url==='file::memory:')throw new Error('Persistent SQLite file: URL required for migrations');
  const name=decodeURIComponent(url.slice(5));
  const {existsSync}=await import('node:fs');
  if(existsSync(name)) {
    const db=new Database(name,{readonly:true});
    try {if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'").get())history=db.prepare('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations').all();}
    finally {db.close();}
  }
}
const report=verifyHistory(disk,history);
console.log(JSON.stringify({status:'OK',...report}));
if(action!=='status') {
  const require=createRequire(import.meta.url);
  const cli=require.resolve('prisma/build/index.js');
  const extra=process.argv.slice(3);
  if(action==='deploy'&&extra.length || action==='dev'&&(extra.length!==2||extra[0]!=='--name'||!/^[a-zA-Z0-9_-]+$/.test(extra[1])))throw new Error('dev requires --name NAME; deploy takes no additional flags');
  const result=spawnSync(process.execPath,[cli,'migrate',action,...extra],{cwd:root,env:process.env,stdio:'inherit',shell:false});
  if(result.error||result.status!==0)process.exit(result.status||1);
}

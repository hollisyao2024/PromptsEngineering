import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,renameSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const target=process.env.XIRANG_CONSUMER,url=process.env.XIRANG_TEST_DATABASE_URL;
if(!target||!url)throw new Error('Explicit XIRANG_CONSUMER and XIRANG_TEST_DATABASE_URL required');
const config=JSON.parse(readFileSync(path.join(target,'architecture.config.json'),'utf8')),store=config.datastores.find(d=>d.access==='drizzle');
const dbRoot=path.join(target,store.path),api=config.applications.find(a=>a.id===config.example.api);
if(store.engine!=='sqlite'){
  const u=new URL(url);
  if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||!u.pathname.startsWith('/xirang_test_'))throw new Error('Tests only accept a loopback xirang_test_* PostgreSQL database');
}else if(!url.startsWith('file:')||!path.resolve(url.slice(5)).startsWith(path.resolve(target)+path.sep))throw new Error('SQLite test file must be inside the disposable consumer');
const load=p=>import(pathToFileURL(path.join(target,p)));
const {createDatabase,tasks,eq}=await load(store.path+'/dist/index.js');
const {createApp}=await load(api.path+'/dist/server.js');
const {createApiClient,ApiError}=await load('packages/api-client/dist/index.js');
const {readServerConfig}=await load('packages/config/dist/index.js');
const {redact}=await load('packages/observability/dist/index.js');
const token=randomUUID()+randomUUID(),db=createDatabase(url);
let server,client,anonymous,baseUrl;
const scoped='DATABASE_'+store.id.replaceAll('-','_').toUpperCase()+'_URL';
function migrate(action) {
  return spawnSync(process.execPath,['migrate.mjs',action],{cwd:dbRoot,env:{...process.env,DATABASE_URL:url,[scoped]:url},encoding:'utf8',timeout:60000,shell:false});
}
before(async()=>{
  const result=migrate('deploy');assert.equal(result.status,0,result.stderr);
  server=createApp({db,config:readServerConfig({NODE_ENV:'test',API_WRITE_TOKEN:token})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  baseUrl='http://127.0.0.1:'+server.address().port;
  client=createApiClient({baseUrl,token:()=>token});anonymous=createApiClient({baseUrl});
});
beforeEach(async()=>{await db.delete(tasks);});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));store.engine==='sqlite'?db.$client.close():await db.$client.end();});

// Local single-concurrency smoke only; not a production capacity benchmark.
test('local API latency smoke preserves CRUD results',async t=>{
 const crud=[],reads=[];
 const cycle=async i=>{const row=await client.create({title:'smoke-'+i,status:'todo'});const page=await client.list({pageSize:50});assert.ok(page.items.some(x=>x.id===row.id));const updated=await client.update(row.id,{title:row.title,status:'done',version:row.version});assert.equal(updated.version,row.version+1);assert.equal((await client.remove([row.id])).count,1);};
 for(let i=0;i<5;i++)await cycle(i);
 for(let i=0;i<30;i++){const start=performance.now();await cycle(i+5);crud.push(performance.now()-start);}
 for(let i=0;i<20;i++)await client.create({title:'list-'+i,status:'todo'});
 for(let i=0;i<50;i++){const start=performance.now(),page=await client.list({pageSize:50});assert.equal(page.total,20);assert.equal(page.items.length,20);reads.push(performance.now()-start);}
 const metric=values=>{const sorted=[...values].sort((a,b)=>a-b);return {samples:sorted.length,p95:sorted[Math.ceil(sorted.length*.95)-1],p99:sorted[Math.ceil(sorted.length*.99)-1]};};
 const results={engine:store.engine,concurrency:1,warmup:5,crud:metric(crud),read:metric(reads),errors:0};t.diagnostic(JSON.stringify(results));for(const item of [results.crud,results.read]){assert.ok(item.p95<500,'p95 must be <500ms');assert.ok(item.p99<1500,'p99 must be <1500ms');}
});

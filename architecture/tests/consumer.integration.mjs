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
const config=JSON.parse(readFileSync(path.join(target,'architecture.config.json'),'utf8')),store=config.datastores.find(d=>d.access==='prisma');
const dbRoot=path.join(target,store.path),api=config.applications.find(a=>a.id===config.example.api);
if(store.engine==='postgres'){
  const u=new URL(url);
  if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||!u.pathname.startsWith('/xirang_test_'))throw new Error('Tests only accept a loopback xirang_test_* PostgreSQL database');
}else if(!url.startsWith('file:')||!path.resolve(url.slice(5)).startsWith(path.resolve(target)+path.sep))throw new Error('SQLite test file must be inside the disposable consumer');
const load=p=>import(pathToFileURL(path.join(target,p)));
const {createDatabase}=await load(store.path+'/dist/index.js');
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
beforeEach(async()=>{await db.task.deleteMany();});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await db.$disconnect();});
test('TC-MONOPLAT-002/004/005 real API client CRUD, server paging, filters, sorting and optimistic update',async()=>{
  for(let i=0;i<14;i++)await client.create({title:'task-'+String(i).padStart(2,'0'),status:i%2?'doing':'todo'});
  const page=await client.list({page:1,pageSize:5,sort:'title',direction:'asc'});
  assert.equal(page.total,14);assert.equal(page.items.length,5);assert.equal(page.items[0].title,'task-05');
  const filtered=await client.list({status:'doing',search:'task-',pageSize:100});assert.equal(filtered.total,7);
  const original=page.items[0],updated=await client.update(original.id,{title:'updated',status:'done',version:original.version});
  assert.equal(updated.version,2);
  const race=await Promise.allSettled(['one','two'].map(title=>client.update(updated.id,{title,status:'done',version:updated.version})));
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(race.find(r=>r.status==='rejected').reason.status,409);
  await assert.rejects(client.update(original.id,{title:'stale',status:'todo',version:original.version}),e=>e instanceof ApiError&&e.status===409&&!!e.requestId);
  assert.equal((await client.remove([original.id])).count,1);
  assert.equal((await client.list()).total,13);
});
test('TC-MONOPLAT-005 ordered multi-column sort survives the API boundary',async()=>{
  for(const [title,status]of [['alpha','todo'],['omega','todo'],['first','done']])await client.create({title,status});
  const page=await client.list({sorts:'status:asc,title:desc'});
  assert.deepEqual(page.items.map(x=>x.title),['first','omega','alpha']);
  for(const sorts of ['unknown:asc','title:sideways','title:asc,title:desc','title:asc,status:desc,createdAt:asc,title:asc'])await assert.rejects(client.list({sorts}),e=>e.status===400);
});
test('TC-MONOPLAT-002 actual database transaction rollback and atomic batch delete',async()=>{
  const existing=await client.create({title:'preserve','status':'todo'});
  await assert.rejects(client.remove([existing.id,randomUUID()]),e=>e.status===409);
  assert.ok(await db.task.findUnique({where:{id:existing.id}}));
  const id=randomUUID();
  await assert.rejects(db.$transaction([db.task.create({data:{id,title:'first'}}),db.task.create({data:{id,title:'duplicate'}})]));
  assert.equal(await db.task.findUnique({where:{id}}),null);
});
test('TC-MONOPLAT-004/007 invalid input, auth, production reads and response contracts fail closed',async()=>{
  await assert.rejects(anonymous.create({title:'no auth',status:'todo'}),e=>e.status===401);
  await assert.rejects(createApiClient({baseUrl,token:()=>'incorrect'}).create({title:'bad',status:'todo'}),e=>e.status===403);
  for(const body of [{title:'',status:'todo'},{title:'x',status:'invalid'},{title:'x',status:'todo',extra:true},{title:'x'}])await assert.rejects(client.create(body),e=>e.status===400);
  for(const query of [{page:-1},{pageSize:1000},{sort:'unknown'}])await assert.rejects(client.list(query),e=>e.status===400);
  const tooLarge=await fetch(baseUrl+'/tasks',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({title:'x'.repeat(70000),status:'todo'})});assert.equal(tooLarge.status,413);
  const origin=await fetch(baseUrl+'/tasks',{headers:{origin:'https://untrusted.example'}});assert.equal(origin.status,403);
  const wrongResponse=await db.task.create({data:{title:'bad persisted status',status:'invalid'}});
  const response=await fetch(baseUrl+'/tasks');assert.equal(response.status,500);assert.equal((await response.json()).code,'RESPONSE_CONTRACT');
  await db.task.delete({where:{id:wrongResponse.id}});
  const production=createApp({db,config:readServerConfig({NODE_ENV:'production',API_WRITE_TOKEN:token})});
  await new Promise(resolve=>production.listen(0,'127.0.0.1',resolve));
  try{assert.equal((await fetch('http://127.0.0.1:'+production.address().port+'/tasks')).status,401);}finally{await new Promise(resolve=>production.close(resolve));}
  assert.throws(()=>readServerConfig({NODE_ENV:'unknown'}),/profile/);
  assert.throws(()=>readServerConfig({NODE_ENV:'production'}),/required/);
  const redacted=JSON.stringify(redact({token:'hidden',databaseUrl:'postgresql://user:secret@localhost/test',nested:{password:'hidden'}}));
  assert.ok(!redacted.includes('hidden')&&!redacted.includes('secret'));
});
test('TC-MONOPLAT-004 JSON Schema 2020 tuples, nested objects and formats are enforced',async()=>{
  const {validate,createContractValidator}=await load('packages/contracts/dist/index.js');
  const task={id:randomUUID(),title:'valid',status:'todo',version:1,createdAt:'not-a-date',updatedAt:new Date().toISOString()};
  assert.equal(validate('Task',task),false);
  const check=createContractValidator({Envelope:{type:'object',properties:{coordinates:{type:'array',prefixItems:[{type:'number'},{type:'number'}],items:false,minItems:2}},required:['coordinates'],additionalProperties:false}});
  assert.equal(check('Envelope',{coordinates:[1,2]}),true);
  assert.equal(check('Envelope',{coordinates:['bad',2]}),false);
  assert.equal(check('Envelope',{coordinates:[1,2,3]}),false);
});
test('TC-MONOPLAT-005 export honors filter/selection and neutralizes CSV formulas',async()=>{
  const row=await client.create({title:'=FORMULA()',status:'todo'});await client.create({title:'other',status:'done'});
  const selected=await client.export({},'selected',[row.id]);assert.equal(selected.count,1);assert.match(selected.csv,/'=FORMULA/);assert.ok(!selected.csv.includes('other'));
  const filtered=await client.export({status:'done'},'filtered');assert.equal(filtered.count,1);assert.ok(filtered.csv.includes('other'));
  await assert.rejects(anonymous.export({},'filtered'),e=>e.status===401);
});
test('TC-MONOPLAT-003 real migration ledger, repeat deployment, changed/missing/failed history',async()=>{
  assert.equal(migrate('deploy').status,0);
  const migration='20260909000000_init',file=path.join(dbRoot,'prisma/migrations',migration,'migration.sql'),original=readFileSync(file,'utf8');
  try {writeFileSync(file,original+'\n-- unauthorized history edit\n');const bad=migrate('status');assert.notEqual(bad.status,0);assert.match(bad.stderr,/checksum changed/);}
  finally {writeFileSync(file,original);}
  try {renameSync(file,file+'.held');const missing=migrate('status');assert.notEqual(missing.status,0);assert.match(missing.stderr,/Missing/);}finally {if(existsSync(file+'.held'))renameSync(file+'.held',file);}
  const id=randomUUID();
  await db.$executeRawUnsafe('INSERT INTO "_prisma_migrations" ("id","checksum","migration_name") VALUES ('+"'"+id+"','failed-test','failed_test')");
  try {const bad=migrate('status');assert.notEqual(bad.status,0);assert.match(bad.stderr,/Failed migration/);}
  finally {await db.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE "id" = '+"'"+id+"'");}
  assert.equal(migrate('status').status,0);
});
test('TC-MONOPLAT-001/006/007 source boundaries, generation freshness and host degradation',async()=>{
  const require=createRequire(import.meta.url),{checkProject}=require('../checks/project-check.js');
  assert.equal(checkProject(target,config).status,'OK',JSON.stringify(checkProject(target,config).failures));
  const publicFile=path.join(target,'packages/api-client/src/forbidden.ts');
  try {writeFileSync(publicFile,"import type {PrismaClient} from '@prisma/client';\nexport type Leak=PrismaClient;\n");assert.equal(checkProject(target,config).status,'BLOCKED');}
  finally {const {unlinkSync}=await import('node:fs');if(existsSync(publicFile))unlinkSync(publicFile);}
  const contractFile=path.join(target,'packages/contracts/openapi.json'),contract=readFileSync(contractFile,'utf8');
  try {const spec=JSON.parse(contract);spec.components.schemas.Task.properties.projectField={type:'string'};writeFileSync(contractFile,JSON.stringify(spec));const r=spawnSync(process.execPath,['generate.mjs','--check'],{cwd:path.dirname(contractFile),encoding:'utf8'});assert.notEqual(r.status,0);}
  finally {writeFileSync(contractFile,contract);}
  const platform=await load('packages/platform/src/index.ts');
  assert.equal((await platform.createBrowserPlatform().readTextFile()).reason,'unsupported');
  assert.throws(()=>platform.externalUrl('javascript:alert(1)'),/Unsupported/);
});
test('TC-MONOPLAT-004 cancellation and bounded list query count, with local performance evidence',async()=>{
  let operations=0;
  const measured=db.$extends({query:{task:{$allOperations({args,query}){operations++;return query(args);}}}});
  const {taskService}=await load(api.path+'/dist/tasks.js');
  await db.task.createMany({data:Array.from({length:1000},(_,i)=>({title:'scale-'+i,status:'todo'}))});
  const durations=[];
  for(let i=0;i<20;i++){const started=performance.now();await taskService(measured).list({page:i,pageSize:20});durations.push(performance.now()-started);}
  assert.equal(operations,40);
  durations.sort((a,b)=>a-b);
  console.log(JSON.stringify({evidence:'local-list-sample',engine:store.engine,rows:1000,concurrency:1,samples:20,p95Ms:durations[18],rssBytes:process.memoryUsage().rss,prisma:'7.10.0'}));
  const controller=new AbortController();controller.abort();
  await assert.rejects(client.list({},controller.signal),e=>e.name==='AbortError');
});

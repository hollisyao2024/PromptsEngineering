import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import path from 'node:path';
const target=process.env.XIRANG_CONSUMER,url=process.env.XIRANG_TEST_DATABASE_URL;
if(!target||!url)throw Error('Explicit disposable consumer/database required');
const config=JSON.parse(readFileSync(path.join(target,'architecture.config.json'))),store=config.datastores.find(d=>d.access==='prisma');
if(store.engine==='postgres'){const u=new URL(url);if(!['127.0.0.1','localhost'].includes(u.hostname)||!u.pathname.startsWith('/xirang_test_'))throw Error('Only disposable loopback databases allowed');}
else if(!url.startsWith('file:')||!path.resolve(url.slice(5)).startsWith(path.resolve(target)+path.sep))throw Error('SQLite must be inside consumer');
const load=p=>import(pathToFileURL(path.join(target,p))),modulePath=id=>config.modules.find(m=>m.id===id)?.path;
const {createDatabase}=await load(store.path+'/dist/index.js'),db=createDatabase(url);
before(()=>{const scoped='DATABASE_'+store.id.toUpperCase().replaceAll('-','_')+'_URL',r=spawnSync(process.execPath,['migrate.mjs','deploy'],{cwd:path.join(target,store.path),env:{...process.env,DATABASE_URL:url,[scoped]:url},encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stderr);});
after(()=>db.$disconnect());
test('TC-OSSKIT-001/002 Better Auth sessions, organization isolation, CASL conditional writes and deny-all',async()=>{
 const {createAuth}=await load(modulePath('auth')+'/dist/index.js'),baseURL='http://127.0.0.1:43291',auth=createAuth({database:db,secret:randomBytes(32).toString('hex'),baseURL,trustedOrigins:[baseURL],allowSignUp:true});
 const password=randomBytes(24).toString('hex'),suffix=randomUUID(),email='owner-'+suffix+'@example.invalid';
 const request=(route,body,cookie='',headers={})=>auth.handler(new Request(baseURL+'/api/auth/'+route,{method:body===undefined?'GET':'POST',headers:{origin:baseURL,'content-type':'application/json',cookie,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 const cookie=r=>r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 const a=await request('sign-up/email',{email,password,name:'Fixture A'});assert.equal(a.status,200);const jarA=cookie(a),userA=await a.json();
 const b=await request('sign-up/email',{email:'other-'+suffix+'@example.invalid',password,name:'Fixture B'});assert.equal(b.status,200);const jarB=cookie(b);
 assert.equal((await request('sign-in/email',{email,password:'wrong-password'})).status,401);
 assert.equal((await(await request('get-session',undefined,jarA)).json()).user.id,userA.user.id);
 const organization=await request('organization/create',{name:'Fixture',slug:'fixture-'+suffix},jarA);assert.equal(organization.status,200);const org=await organization.json();
 assert.equal((await request('organization/set-active',{organizationId:org.id},jarB)).status,403);
 const login=await request('sign-in/email',{email,password}),token=login.headers.get('set-auth-token');assert.ok(token);assert.equal((await(await request('get-session',undefined,'',{authorization:'Bearer '+token})).json()).user.id,userA.user.id);
 assert.equal((await request('sign-out',{},'',{authorization:'Bearer '+token})).status,200);assert.equal(await(await request('get-session',undefined,'',{authorization:'Bearer '+token})).json(),null);
 const {createAbility,whereAuthorized,authorizedDatabase,rulesForActor}=await load(modulePath('authorization')+'/dist/index.js');
 const ids=[randomUUID(),randomUUID()];await db.task.createMany({data:ids.map((id,i)=>({id,title:'Fixture '+i}))});
 const scoped=authorizedDatabase(db),ability=createAbility([{action:['read','update'],subject:'Task',conditions:{id:ids[0]}}]);
 assert.deepEqual((await scoped.task.findMany({where:whereAuthorized(ability,'read','Task')})).map(r=>r.id),[ids[0]]);
 assert.equal((await scoped.task.updateMany({where:{AND:[whereAuthorized(ability,'update','Task'),{id:ids[1]}]},data:{title:'forbidden'}})).count,0);
 const denied=createAbility(rulesForActor({userId:userA.user.id,roles:[]}));assert.deepEqual(await scoped.task.findMany({where:whereAuthorized(denied,'read','Task')}),[]);
 await db.task.deleteMany({where:{id:{in:ids}}});
});
test('TC-STORAGE-003/005 Prisma metadata persists, enforces CAS and keeps immutable completed objects',async()=>{
 const {FileService,StorageRouter,createLocalProvider,createPrismaFileRepository}=await load(config.fileStorage.path+'/dist/index.js'),root=realpathSync(mkdtempSync(path.join(target,'storage-fixture-')));
 try{const provider=await createLocalProvider({directory:path.join(root,'objects')}),repository=createPrismaFileRepository(db.fileObject),router=new StorageRouter({local:provider},'local'),service=new FileService({router,repository});
 const upload=await service.createUpload('fixture-owner',{name:'hello.bin',size:4,contentType:'application/octet-stream'});await service.upload('fixture-owner',upload.file.id,Buffer.from([0,1,127,255]));await service.complete('fixture-owner',upload.file.id);
 const other=new FileService({router,repository:createPrismaFileRepository(db.fileObject)});assert.equal((await other.info('fixture-owner',upload.file.id)).state,'ready');await assert.rejects(other.info('foreign-owner',upload.file.id),e=>e.code==='NOT_FOUND');
 const record=await repository.get(upload.file.id),changes=await Promise.all([1,2].map(()=>repository.compareAndSwap(record.id,record.version,{...record,version:record.version+1})));assert.equal(changes.filter(Boolean).length,1);
 await service.delete('fixture-owner',upload.file.id);await service.delete('fixture-owner',upload.file.id);assert.equal((await service.info('fixture-owner',upload.file.id)).state,'deleted');
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('TC-OSSKIT-006 i18next instances and Pino request context stay isolated',async()=>{
 const {createI18n}=await load(modulePath('i18n')+'/src/index.ts');const [a,b]=await Promise.all([createI18n('zh-CN'),createI18n('en')]);assert.equal(a.t('common.save'),'保存');assert.equal(b.t('common.save'),'Save');await a.changeLanguage('en');assert.equal(b.language,'en');
 const {createLogger,withRequestContext,requestLogger,requestId}=await load(modulePath('logging')+'/dist/index.js'),lines=[],logger=createLogger('fixture',{write:chunk=>lines.push(chunk)});
 await Promise.all(['one','two'].map(id=>withRequestContext(logger,async()=>{await new Promise(r=>setTimeout(r,id==='one'?10:1));assert.equal(requestId(),id);requestLogger(logger).info({deep:{credentials:{secret:'private-value'},accessToken:'private-token'}},'fixture event');},id)));
 assert.equal(requestId(),undefined);assert.equal(lines.length,2);assert.equal(lines.some(v=>v.includes('private-')),false);assert.deepEqual(lines.map(v=>JSON.parse(v).requestId).sort(),['one','two']);
});
test('TC-OSSKIT-007 OpenTelemetry exports explicitly and shuts down once',async()=>{
 const root=modulePath('telemetry'),req=createRequire(path.join(target,root,'package.json')),{InMemorySpanExporter}=req('@opentelemetry/sdk-trace-base'),exporter=new InMemorySpanExporter(),{startTelemetry,traced}=await load(root+'/dist/index.js');
 assert.throws(()=>startTelemetry({serviceName:'fixture'}),/explicit/);const handle=startTelemetry({serviceName:'fixture',exporter});await traced('fixture.operation',async()=>42);assert.throws(()=>startTelemetry({serviceName:'duplicate',exporter}),/lifecycle/);
 // shutdown flushes the batch. Observe the exporter before it discards its in-memory records.
 let exported=0;const original=exporter.export.bind(exporter);exporter.export=(spans,callback)=>{exported+=spans.length;original(spans,callback);};await handle.shutdown();await handle.shutdown();assert.equal(exported,1);
});
test('TC-OSSKIT-007 MSW is opt-in and handles a real intercepted request',async()=>{
 const root=modulePath('api-mocks'),{createMockServer}=await load(root+'/src/node.ts'),{http,HttpResponse}=await load(root+'/src/index.ts'),server=createMockServer([http.get('https://fixture.invalid/data',()=>HttpResponse.json({ok:true}))]);
 server.listen({onUnhandledRequest:'error'});try{assert.deepEqual(await(await fetch('https://fixture.invalid/data')).json(),{ok:true});}finally{server.close();}
});

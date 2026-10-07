import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync,renameSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
const target=process.env.XIRANG_CONSUMER,url=process.env.XIRANG_TEST_DATABASE_URL;
if(!target||!url)throw Error('Explicit disposable consumer/database required');
const config=JSON.parse(readFileSync(path.join(target,'architecture.config.json'))),store=config.datastores.find(d=>d.access==='drizzle');if(!store)throw Error('Drizzle consumer required');
if(store.engine==='sqlite'){if(!url.startsWith('file:')||!path.resolve(url.slice(5)).startsWith(path.resolve(target)+path.sep))throw Error('SQLite must be inside disposable consumer');}
else{const u=new URL(url);if(!['127.0.0.1','localhost'].includes(u.hostname)||!u.pathname.startsWith('/xirang_test_'))throw Error('Disposable loopback database required');}
const load=p=>import(pathToFileURL(path.join(target,p))),modulePath=id=>config.modules.find(m=>m.id===id)?.path,dbRoot=path.join(target,store.path);
const data=await load(store.path+'/dist/index.js'),{tasks,sql,eq,and}=data,db=data.createDatabase(url);
const execute=query=>store.engine==='sqlite'?db.run(query):db.execute(query);
const migrate=(action,connection=url)=>spawnSync(process.execPath,['migrate.mjs',action],{cwd:dbRoot,env:{...process.env,DATABASE_URL:connection,['DATABASE_'+store.id.toUpperCase().replaceAll('-','_')+'_URL']:connection},encoding:'utf8',timeout:60000});
before(()=>{const r=migrate('deploy');assert.equal(r.status,0,r.stderr);assert.equal(migrate('deploy').status,0);});
after(async()=>{if(store.engine==='sqlite')db.$client.close();else await db.$client.end();});
test('transactions commit and rollback; migration hash/missing/unknown history block',async()=>{
 const id=randomUUID();await db.insert(tasks).values({id,title:'fixture'});
 await assert.rejects(db.transaction(async tx=>{await tx.update(tasks).set({title:'rollback'}).where(eq(tasks.id,id));throw Error('fixture rollback');}),/rollback/);
 assert.equal((await db.select().from(tasks).where(eq(tasks.id,id)))[0].title,'fixture');
 const journal=JSON.parse(readFileSync(path.join(dbRoot,'drizzle/meta/_journal.json'))),file=path.join(dbRoot,'drizzle',journal.entries[0].tag+'.sql'),original=readFileSync(file);
 try{writeFileSync(file,Buffer.concat([original,Buffer.from('\n-- tampered\n')]));const r=migrate('status');assert.notEqual(r.status,0);assert.match(r.stderr,/checksum/);}finally{writeFileSync(file,original);}
 assert.equal(migrate('status').status,0);
 try{renameSync(file,file+'.held');assert.match(migrate('status').stderr,/missing/i);}finally{renameSync(file+'.held',file);}
 await execute(sql`INSERT INTO ${sql.identifier('__drizzle_migrations')} (id,hash,created_at) VALUES (9999,'unknown',9999999999999)`);
 try{assert.match(migrate('status').stderr,/history missing/);}finally{await execute(sql`DELETE FROM ${sql.identifier('__drizzle_migrations')} WHERE id=9999`);}
 const marker=path.join(dbRoot,'.migration-running.json');try{writeFileSync(marker,'{}');assert.match(migrate('deploy').stderr,/explicit recovery/);}finally{rmSync(marker);}
 await db.delete(tasks).where(eq(tasks.id,id));
});
test('Better Auth sessions and organization isolation',async()=>{
 const {createAuth}=await load(modulePath('auth')+'/dist/index.js'),baseURL='http://127.0.0.1:43291',auth=createAuth({database:db,secret:randomBytes(32).toString('hex'),baseURL,trustedOrigins:[baseURL],allowSignUp:true}),password=randomBytes(24).toString('hex'),suffix=randomUUID();
 const request=(route,body,cookie='')=>auth.handler(new Request(baseURL+'/api/auth/'+route,{method:body===undefined?'GET':'POST',headers:{origin:baseURL,'content-type':'application/json',cookie},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 const cookie=r=>r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
 const a=await request('sign-up/email',{email:'owner-'+suffix+'@example.invalid',password,name:'Fixture A'});assert.equal(a.status,200,await a.clone().text());const jar=cookie(a),user=(await a.json()).user;
 const b=await request('sign-up/email',{email:'other-'+suffix+'@example.invalid',password,name:'Fixture B'});assert.equal(b.status,200,await b.clone().text());const other=cookie(b);
 assert.equal((await request('sign-in/email',{email:user.email,password:'wrong-password'})).status,401);
 assert.equal((await(await request('get-session',undefined,jar)).json()).user.id,user.id);
 const organization=await request('organization/create',{name:'Fixture',slug:'fixture-'+suffix},jar);assert.equal(organization.status,200,await organization.clone().text());const org=await organization.json();assert.equal((await request('organization/set-active',{organizationId:org.id},other)).status,403);
});
test('CASL SQL scope and rule precedence deny unauthorized reads/writes',async()=>{
 const {createAbility,whereAuthorized,rulesForActor}=await load(modulePath('authorization')+'/dist/index.js'),id=randomUUID();await db.insert(tasks).values({id,title:'authorized'});
 const denied=createAbility(rulesForActor({userId:'fixture',roles:[]}));assert.deepEqual(await db.select().from(tasks).where(whereAuthorized(denied,'read','Task',tasks)),[]);
 const ability=createAbility([{action:['read','update'],subject:'Task',conditions:{id}}]);assert.equal((await db.select().from(tasks).where(whereAuthorized(ability,'read','Task',tasks))).length,1);
 assert.equal(data.affectedRows(await db.update(tasks).set({title:'forbidden'}).where(and(whereAuthorized(ability,'update','Task',tasks),eq(tasks.id,randomUUID())))),0);
 const inverted=createAbility([{action:'read',subject:'Task'},{action:'read',subject:'Task',conditions:{id},inverted:true}]);assert.equal((await db.select().from(tasks).where(and(whereAuthorized(inverted,'read','Task',tasks),eq(tasks.id,id)))).length,0);
 assert.throws(()=>whereAuthorized(createAbility([{action:'read',subject:'Task',conditions:{id:{$regex:'.*'}}}]),'read','Task',tasks),/Unsupported/);
 assert.throws(()=>whereAuthorized(createAbility([{action:'read',subject:'Task',conditions:{id:{}}}]),'read','Task',tasks),/empty/);
 for(const conditions of [{$and:[false]},{$or:[null]},{id:{$eq:{}}},{id:{$in:[{}]}}])assert.throws(()=>whereAuthorized(createAbility([{action:'read',subject:'Task',conditions}]),'read','Task',tasks),/Invalid/);
 await db.delete(tasks).where(eq(tasks.id,id));
});
test('file metadata persists and enforces owner/store/version CAS',async()=>{
 const {FileService,StorageRouter,createLocalProvider,createDrizzleFileRepository}=await load(config.fileStorage.path+'/dist/index.js'),root=mkdtempSync(path.join(target,'storage-fixture-'));
 try{const provider=await createLocalProvider({directory:path.join(root,'objects')}),repository=createDrizzleFileRepository(db),router=new StorageRouter({local:provider},'local'),service=new FileService({router,repository});
 const upload=await service.createUpload('fixture-owner',{name:'hello.bin',size:4,contentType:'application/octet-stream'});await service.upload('fixture-owner',upload.file.id,Buffer.from([0,1,127,255]));await service.complete('fixture-owner',upload.file.id);
 assert.equal((await service.info('fixture-owner',upload.file.id)).state,'ready');await assert.rejects(service.info('foreign-owner',upload.file.id),e=>e.code==='NOT_FOUND');
 const record=await repository.get(upload.file.id),changes=await Promise.all([1,2].map(()=>repository.compareAndSwap(record.id,record.version,{...record,version:record.version+1})));assert.equal(changes.filter(Boolean).length,1);
 assert.equal(await repository.compareAndSwap(record.id,record.version+1,{...record,ownerId:'foreign-owner',version:record.version+2}),false);
 await assert.rejects(repository.create({...record,id:randomUUID()}),e=>e.code==='CONFLICT');
 await service.delete('fixture-owner',upload.file.id);await service.delete('fixture-owner',upload.file.id);
 }finally{rmSync(root,{recursive:true,force:true});}
});
if(modulePath('jobs'))test('pg-boss joins Drizzle transaction and rolls back queue writes',async()=>{
 const {prepareJobs,createJobs}=await load(modulePath('jobs')+'/dist/index.js'),schema='fixture_'+randomBytes(6).toString('hex'),options={connectionString:url,schema,onError:e=>{throw e;}};
 await prepareJobs(options);const jobs=await createJobs(options),definition={name:'fixture',parse:x=>x},id=randomUUID();
 try{await jobs.define(definition);await assert.rejects(db.transaction(async tx=>{await tx.insert(tasks).values({id,title:'queue rollback'});await jobs.enqueueInDrizzleTransaction(tx,definition,{value:1},id);throw Error('rollback');}),/rollback/);assert.equal((await db.select().from(tasks).where(eq(tasks.id,id))).length,0);
 const r=await db.execute(sql`SELECT id FROM ${sql.identifier(schema)}.job WHERE id=${id}`);assert.equal(r.rows.length,0);
 }finally{await jobs.close();await db.execute(sql`DROP SCHEMA ${sql.identifier(schema)} CASCADE`);}
});

test('database isolation and read-only SQLite status fail closed',{skip:!['postgres','sqlite'].includes(store.engine)},async()=>{
 if(store.engine==='postgres'){const custom=new URL(url);custom.searchParams.set('schema','unsupported');assert.throws(()=>data.createDatabase(custom.href),/dedicated PostgreSQL/);assert.match(migrate('status',custom.href).stderr,/dedicated PostgreSQL/);}
 if(store.engine==='sqlite'){
  const missing=path.join(target,'status-missing.sqlite');assert.equal(existsSync(missing),false);const result=migrate('status','file:'+missing);assert.equal(result.status,0,result.stderr);assert.equal(existsSync(missing),false);
  const lock=path.resolve(url.slice(5))+'-xirang-migration-lock.json';try{writeFileSync(lock,'{}',{flag:'wx'});assert.match(migrate('deploy').stderr,/database migration lock/);}finally{rmSync(lock);}
  assert.match(migrate('deploy','file::memory:').stderr,/Persistent SQLite/);
 }
});

test('native Kit appends and applies a second migration without resetting history',()=>{
 const core=store.engine==='postgres'?'pg':store.engine==='sqlite'?'sqlite':'mysql',table=core==='pg'?'pgTable':core==='sqlite'?'sqliteTable':'mysqlTable',integer=core==='mysql'?'int':'integer';
 writeFileSync(path.join(dbRoot,'src/schema/migration-probe.ts'),`import {${table},${integer}} from 'drizzle-orm/${core}-core';\nexport const migrationProbe=${table}('MigrationProbe',{id:${integer}('id').primaryKey().notNull()});\n`);
 const generate=spawnSync(process.execPath,['generate-migration.mjs','--name','probe'],{cwd:dbRoot,encoding:'utf8',timeout:60000});assert.equal(generate.status,0,generate.stderr);
 const result=migrate('deploy');assert.equal(result.status,0,result.stderr);const report=JSON.parse(migrate('status').stdout);assert.equal(report.applied.length,2);assert.deepEqual(report.pending,[]);assert.equal(migrate('deploy').status,0);
});

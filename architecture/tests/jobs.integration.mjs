import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
const target=process.env.XIRANG_CONSUMER;if(!target)throw Error('Explicit disposable consumer required');
const config=JSON.parse(readFileSync(path.join(target,'architecture.config.json'))),selection=config.modules.find(m=>m.id==='jobs'),root=path.join(target,selection.path),module=await import(pathToFileURL(path.join(root,'dist/index.js')));
const url=process.env.XIRANG_TEST_DATABASE_URL,redisPort=Number(process.env.XIRANG_TEST_REDIS_PORT);
if(selection.options.backend==='postgres'){const u=new URL(url);if(u.hostname!=='127.0.0.1'||!u.pathname.startsWith('/xirang_test_'))throw Error('Disposable loopback database required');}
else if(!Number.isInteger(redisPort)||redisPort<1024||redisPort>65535)throw Error('Disposable Redis port required');
const until=async check=>{const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw Error('Job completion timed out');};
const name='fixture-'+randomUUID(),schema='fixture_'+randomUUID().replaceAll('-','').slice(0,16),definition={name,parse(value){if(!value||typeof value.id!=='string'||typeof value.retry!=='boolean')throw Error('Invalid job payload');return {id:value.id,retry:value.retry};}};
test('TC-OSSKIT-003 selected queue validates, retries, deduplicates, cancels and reopens durable jobs',{timeout:90000},async t=>{
 const errors=[];let queue,worker;const done=new Set(),calls=new Map(),cancelled=randomUUID(),stable=randomUUID(),pending=randomUUID();
 const work=async data=>{calls.set(data.id,(calls.get(data.id)||0)+1);if(data.retry&&calls.get(data.id)===1)throw Error('intentional retry');done.add(data.id);};
 if(selection.options.provider==='pg-boss'){
  const options={connectionString:url,schema,onError:e=>errors.push(e.name)};await module.prepareJobs(options);queue=await module.createJobs(options);t.after(()=>queue?.close());await queue.define(definition);
  await assert.rejects(queue.enqueue(definition,{wrong:true},randomUUID()),/Invalid job payload/);
  await assert.rejects(queue.enqueue(definition,{id:'valid-payload',retry:false},'not-a-uuid'),/UUID job id/);
  await queue.enqueue(definition,{id:cancelled,retry:false},cancelled);await queue.cancel(name,cancelled);
  await queue.enqueue(definition,{id:stable,retry:true},stable);await queue.enqueue(definition,{id:stable,retry:true},stable);await queue.work(definition,work);await until(()=>done.has(stable));assert.equal(calls.get(stable),2);assert.equal(done.has(cancelled),false);
  await queue.close();queue=await module.createJobs(options);await queue.enqueue(definition,{id:pending,retry:false},pending);await queue.close();queue=await module.createJobs(options);await queue.work(definition,work);await until(()=>done.has(pending));
 }else{
  const options={connection:selection.options.backend==='redis'?{host:'127.0.0.1',port:redisPort}:{connectionString:url,schema},onError:e=>errors.push(e.name)};
  if(selection.options.backend==='postgres')await module.prepareJobs(url,schema);
  queue=module.createJobs(definition,options);t.after(()=>queue?.close());await queue.ready();
  await assert.rejects(queue.enqueue({wrong:true},randomUUID()),/Invalid job payload/);await queue.enqueue({id:cancelled,retry:false},cancelled);await queue.cancel(cancelled);
  const job=await queue.enqueue({id:stable,retry:true},stable);await queue.enqueue({id:stable,retry:true},stable);worker=queue.work(work);await until(()=>done.has(stable));await until(async()=>await job.getState()==='completed');assert.equal(calls.get(stable),2);assert.equal(done.has(cancelled),false);
  await queue.close();queue=module.createJobs(definition,options);await queue.ready();await queue.enqueue({id:pending,retry:false},pending);await queue.close();queue=module.createJobs(definition,options);await queue.ready();worker=queue.work(work);await until(()=>done.has(pending));
 }
});
if(selection.options.provider==='pg-boss')test('TC-OSSKIT-003 pg-boss enqueue joins the same Prisma transaction',async t=>{
 const store=config.datastores.find(d=>d.access==='prisma'),{createDatabase}=await import(pathToFileURL(path.join(target,store.path,'dist/index.js'))),db=createDatabase(url);t.after(()=>db.$disconnect());
 const options={connectionString:url,schema,onError:()=>{}},queue=await module.createJobs(options);t.after(()=>queue.close());await queue.define(definition);
 const req=createRequire(path.join(root,'package.json')),{PgBoss}=req('pg-boss'),inspector=new PgBoss({connectionString:url,schema,migrate:false});inspector.on('error',()=>{});await inspector.start();t.after(()=>inspector.stop());
 const rollback=randomUUID();await assert.rejects(db.$transaction(async tx=>{await tx.task.create({data:{id:rollback,title:'rollback'}});await queue.enqueueInTransaction(tx,definition,{id:rollback,retry:false},rollback);throw Error('rollback');}),/rollback/);
 assert.equal(await db.task.findUnique({where:{id:rollback}}),null);assert.equal(await inspector.getJobById(name,rollback),null);
 const committed=randomUUID();await db.$transaction(async tx=>{await tx.task.create({data:{id:committed,title:'committed'}});await queue.enqueueInTransaction(tx,definition,{id:committed,retry:false},committed);});assert.ok(await inspector.getJobById(name,committed));await db.task.delete({where:{id:committed}});
});

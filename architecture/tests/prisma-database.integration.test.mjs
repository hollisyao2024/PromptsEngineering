import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const target=process.env.XIRANG_CONSUMER,url=process.env.XIRANG_TEST_DATABASE_URL;
if(!target||!url)throw Error('Explicit disposable consumer/database required');
const config=JSON.parse(readFileSync(path.join(target,'architecture.config.json'))),store=config.datastores.find(d=>d.access==='prisma');
{const u=new URL(url);if(!['127.0.0.1','localhost'].includes(u.hostname)||!u.pathname.startsWith('/xirang_test_'))throw Error('Disposable loopback database required');}
const root=path.join(target,store.path),{createDatabase}=await import(pathToFileURL(path.join(root,'dist/index.js'))),db=createDatabase(url);
const migrate=action=>spawnSync(process.execPath,['migrate.mjs',action],{cwd:root,env:{...process.env,DATABASE_URL:url,['DATABASE_'+store.id.toUpperCase().replaceAll('-','_')+'_URL']:url},encoding:'utf8',timeout:60000});
before(()=>{const r=migrate('deploy');assert.equal(r.status,0,r.stderr);assert.equal(migrate('deploy').status,0);});
after(()=>db.$disconnect());
test('Prisma native driver CRUD, optimistic writes and transaction rollback',async()=>{
 const id=randomUUID();await db.task.create({data:{id,title:'fixture'}});
 try{assert.equal((await db.task.updateMany({where:{id,version:1},data:{title:'updated',version:2}})).count,1);assert.equal((await db.task.updateMany({where:{id,version:1},data:{title:'stale'}})).count,0);
 await assert.rejects(db.$transaction(async tx=>{await tx.task.update({where:{id},data:{title:'rollback'}});throw Error('fixture rollback');}),/rollback/);assert.equal((await db.task.findUnique({where:{id}})).title,'updated');
 }finally{await db.task.delete({where:{id}});}
});
test('Prisma repeat deployment and applied SQL integrity',()=>{
 const file=path.join(root,'prisma/migrations/20260909000000_init/migration.sql'),original=readFileSync(file);try{writeFileSync(file,Buffer.concat([original,Buffer.from('\n-- tampered\n')]));const r=migrate('status');assert.notEqual(r.status,0);assert.match(r.stderr,/checksum/);}finally{writeFileSync(file,original);}assert.equal(migrate('status').status,0);
});

test('Prisma accepts the API maximum 200-character title',async()=>{const id=randomUUID(),title='界'.repeat(200);try{await db.task.create({data:{id,title}});assert.equal((await db.task.findUnique({where:{id}})).title,title);}finally{await db.task.deleteMany({where:{id}});}});

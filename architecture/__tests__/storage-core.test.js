const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const core=()=>import('../modules/storage/node/src/index.ts');
test('TC-STORAGE-002 binary local roundtrip, pagination, missing object and traversal protection',async t=>{
  const {createLocalProvider,StorageError}=await core();const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'xirang-storage-core-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));const p=await createLocalProvider({directory:path.join(root,'objects')});
  const bytes=Buffer.from([0,255,128,10]);for(const key of ['b','a','c'])await p.put(key,{body:bytes,size:bytes.length,contentType:'application/octet-stream'});
  assert.deepEqual(Buffer.concat(await Array.fromAsync((await p.get('a')).body)),bytes);
  const page=await p.list({limit:2});assert.deepEqual(page.items.map(x=>x.key),['a','b']);assert.deepEqual((await p.list({limit:2,cursor:page.cursor})).items.map(x=>x.key),['c']);
  await p.delete('a');await p.delete('a');await assert.rejects(()=>p.head('a'),e=>e instanceof StorageError&&e.code==='NOT_FOUND');
  await assert.rejects(()=>p.put('../escape',{body:bytes,size:4,contentType:'application/octet-stream'}));
  await assert.rejects(()=>p.put('wrong',{body:bytes,size:3,contentType:'application/octet-stream'}));await assert.rejects(()=>p.head('wrong'));
  await fs.symlink(root,path.join(root,'link'));await assert.rejects(()=>createLocalProvider({directory:path.join(root,'link')}));
});
test('TC-STORAGE-003/004/005 immutable finalization, ownership, cancellation, reopen and default routing',async t=>{
  const {createLocalProvider,createFileRepository,StorageRouter,FileService}=await core();const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'xirang-storage-service-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));const a=await createLocalProvider({directory:path.join(root,'a')}),b=await createLocalProvider({directory:path.join(root,'b')});const repository=await createFileRepository(path.join(root,'records'));const router=new StorageRouter({a,b},'a');const service=new FileService({router,repository,maxSize:100});
  const input={name:'note.txt',size:5,contentType:'text/plain'};const session=await service.createUpload('alice',input);await service.upload('alice',session.file.id,Buffer.from('hello'));
  await assert.rejects(()=>service.complete('bob',session.file.id),e=>e.code==='NOT_FOUND');const ready=await service.complete('alice',session.file.id);assert.equal(ready.state,'ready');assert.equal((await service.complete('alice',ready.id)).id,ready.id);
  router.defaultStore='b';const next=await service.createUpload('alice',input);assert.equal((await repository.get(next.file.id)).storeId,'b');assert.equal((await repository.get(ready.id)).storeId,'a');
  const reopened=new FileService({router,repository:await createFileRepository(path.join(root,'records')),maxSize:100});assert.equal(Buffer.concat(await Array.fromAsync((await reopened.download('alice',ready.id)).body)).toString(),'hello');
  await assert.rejects(()=>service.upload('alice',ready.id,Buffer.from('later')),e=>e.code==='CONFLICT');await service.cancel('alice',next.file.id);await assert.rejects(()=>service.complete('alice',next.file.id));
  await service.delete('alice',ready.id);await assert.rejects(()=>service.download('alice',ready.id));assert.equal((await service.list('bob',{limit:10})).items.length,0);
});
test('TC-STORAGE-004/005/007 interrupted completion requires an expired lease, CAS recovery and explicit extensions',async t=>{
 const {createLocalProvider,createFileRepository,StorageRouter,FileService,runStorageExtension}=await core();const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'xirang-recovery-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));let now=Date.now();const provider=await createLocalProvider({directory:path.join(root,'objects')}),repository=await createFileRepository(path.join(root,'records')),service=new FileService({router:new StorageRouter({files:provider},'files'),repository,clock:()=>now});
 const u=await service.createUpload('alice',{name:'retry.txt',size:5,contentType:'text/plain'});
 await assert.rejects(service.complete('alice',u.file.id),e=>e.code==='NOT_FOUND');assert.equal((await service.info('alice',u.file.id)).state,'completing');await assert.rejects(service.recover('alice',u.file.id),e=>e.code==='CONFLICT');
 now+=300001;const results=await Promise.allSettled([service.recover('alice',u.file.id),service.recover('alice',u.file.id)]);assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal((await service.info('alice',u.file.id)).state,'pending');await service.upload('alice',u.file.id,Buffer.from('hello'));await service.complete('alice',u.file.id);
 const r=await repository.get(u.file.id);await provider.put(r.tempKey,{body:Buffer.from('later'),size:5,contentType:'text/plain'});assert.equal(Buffer.concat(await Array.fromAsync((await service.download('alice',u.file.id)).body)).toString(),'hello');
 assert.throws(()=>runStorageExtension(provider,'image.resize',{}),e=>e.code==='UNSUPPORTED');const extension={...provider,capabilities:{...provider.capabilities,extensions:['image.resize']},extension:async(name,input)=>({name,input})};assert.deepEqual(await runStorageExtension(extension,'image.resize',{width:10}),{name:'image.resize',input:{width:10}});assert.throws(()=>runStorageExtension(extension,'image.resize','x'.repeat(70000)),e=>e.code==='INVALID_INPUT');
 now+=1000000;const expired=await service.createUpload('alice',{name:'expiry',size:0,contentType:'text/plain'});now+=1000000;await assert.rejects(service.complete('alice',expired.file.id),e=>e.code==='EXPIRED');await service.cancel('alice',expired.file.id);
});

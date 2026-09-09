import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createLocalProvider,createFileRepository,StorageRouter,FileService} from '../dist/index.js';
test('file service persists a complete upload and denies another owner',async t=>{
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'xirang-file-test-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const provider=await createLocalProvider({directory:path.join(root,'objects')});
  const service=new FileService({router:new StorageRouter({local:provider},'local'),repository:await createFileRepository(path.join(root,'metadata'))});
  const upload=await service.createUpload('owner',{name:'hello.txt',contentType:'text/plain',size:5});await service.upload('owner',upload.file.id,Buffer.from('hello'));await service.complete('owner',upload.file.id);
  assert.equal(Buffer.concat(await Array.fromAsync((await service.download('owner',upload.file.id)).body)).toString(),'hello');
  await assert.rejects(()=>service.download('other',upload.file.id),e=>e.code==='NOT_FOUND');await service.delete('owner',upload.file.id);
});

import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { validKey,validSize,validContentType,pageLimit,call,StorageError } from '../contracts.ts';
import type { StorageProvider,ObjectInfo,PutInput,ListInput } from '../contracts.ts';
import { readable,sizeGuard } from '../streams.ts';
import { privateDirectory,readPrivate,atomicPrivate,withFileLock } from '../private-files.ts';
type Entry=ObjectInfo&{blob:string};
export async function createLocalProvider(options:{directory:string}):Promise<StorageProvider>{
  const root=await privateDirectory(options.directory);
  const filename=(key:string)=>path.join(root,createHash('sha256').update(validKey(key)).digest('hex')+'.json');
  const entry=async(key:string):Promise<Entry>=>{const data=JSON.parse(await readPrivate(filename(key))) as Entry;if(data.key!==key||!/^blob-[a-f0-9-]+$/.test(data.blob))throw new StorageError('CONFIGURATION','Corrupt local object metadata');return data;};
  const info=({blob:_,...data}:Entry):ObjectInfo=>data;
  return {
    name:'local',capabilities:{directUpload:false,multipart:false,resumable:false,extensions:[]},
    async put(key:string,input:PutInput){validKey(key);validSize(input.size);validContentType(input.contentType);input.signal?.throwIfAborted();
      return call(()=>withFileLock(filename(key)+'.lock',async()=>{
        const blob='blob-'+randomUUID(),target=path.join(root,blob),guard=sizeGuard(input.size);
        const handle=await fs.open(target,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
        let previous:Entry|undefined;try{previous=await entry(key);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT'){await handle.close();await fs.unlink(target);throw e;}}
        try{await pipeline(readable(input.body),guard.stream,handle.createWriteStream(),{signal:input.signal});const next:Entry={key,blob,size:input.size,contentType:input.contentType,etag:guard.digest(),modifiedAt:new Date().toISOString()};await atomicPrivate(filename(key),JSON.stringify(next));if(previous)await fs.unlink(path.join(root,previous.blob)).catch(()=>{});return info(next);}catch(e){await handle.close().catch(()=>{});await fs.unlink(target).catch(()=>{});throw e;}
      }));
    },
    async head(key){return call(async()=>info(await entry(key)));},
    async get(key,{signal}={}){return call(async()=>{signal?.throwIfAborted();const value=await entry(key);const handle=await fs.open(path.join(root,value.blob),constants.O_RDONLY|constants.O_NOFOLLOW);return {info:info(value),body:handle.createReadStream({signal})};});},
    async delete(key){await call(()=>withFileLock(filename(key)+'.lock',async()=>{let value:Entry;try{value=await entry(key);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}await fs.unlink(filename(key));await fs.unlink(path.join(root,value.blob)).catch(e=>{if(e.code!=='ENOENT')throw e;});}));},
    async list(input:ListInput={}){return call(async()=>{const limit=pageLimit(input.limit),items:ObjectInfo[]=[];const cursor=input.cursor||'';if(cursor)validKey(cursor);if(input.prefix&&input.prefix.length>1024)throw new StorageError('INVALID_INPUT');const dir=await fs.opendir(root);for await(const file of dir){input.signal?.throwIfAborted();if(!/^[a-f0-9]{64}\.json$/.test(file.name))continue;const value=JSON.parse(await readPrivate(path.join(root,file.name))) as Entry;if(value.key>cursor&&value.key.startsWith(input.prefix||'')){items.push(info(value));items.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);if(items.length>limit+1)items.pop();}}const more=items.length>limit;return {items:items.slice(0,limit),...(more?{cursor:items[limit-1].key}:{})};});}
  };
}

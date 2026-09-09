import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StorageError } from './contracts.ts';

export async function privateDirectory(directory:string):Promise<string>{
  if(!path.isAbsolute(directory))throw new StorageError('CONFIGURATION','Storage directory must be absolute');
  const root=path.resolve(directory);if(root===path.parse(root).root)throw new StorageError('CONFIGURATION','Root directory is not a storage directory');
  const parts=root.slice(path.parse(root).root.length).split(path.sep);let current=path.parse(root).root;
  for(const part of parts){current=path.join(current,part);try{const stat=await fs.lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw new StorageError('CONFIGURATION','Storage path contains a link or non-directory');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;await fs.mkdir(current,{mode:0o700});}}
  const stat=await fs.stat(root);if((stat.mode&0o077)!==0)throw new StorageError('CONFIGURATION','Storage directory must have private permissions (0700)');
  return root;
}
export async function readPrivate(file:string):Promise<string>{
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const s=await handle.stat();if(!s.isFile()||s.size>65536)throw new StorageError('CONFIGURATION','Invalid metadata file');return await handle.readFile('utf8');}finally{await handle.close();}
}
export async function atomicPrivate(file:string,value:string):Promise<void>{
  const tmp=path.join(path.dirname(file),'.tmp-'+randomUUID());const handle=await fs.open(tmp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(value);await handle.sync();}finally{await handle.close();}
  try{await fs.rename(tmp,file);}catch(e){await fs.unlink(tmp).catch(()=>{});throw e;}
}
export async function withFileLock<T>(file:string,fn:()=>Promise<T>):Promise<T>{
  let handle;try{handle=await fs.open(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new StorageError('CONFLICT','Metadata is locked; inspect stale lock before recovery');throw e;}
  try{await handle.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));await handle.sync();return await fn();}finally{await handle.close();await fs.unlink(file);}
}

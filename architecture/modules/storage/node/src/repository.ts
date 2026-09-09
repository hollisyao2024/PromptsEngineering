import * as fs from 'node:fs/promises';
import path from 'node:path';
import { StorageError,pageLimit,validKey,validSize,validContentType } from './contracts.ts';
import type {Page} from './contracts.ts';
import type {FileInfo} from './client.ts';
import { privateDirectory,readPrivate,atomicPrivate,withFileLock } from './private-files.ts';

export type FileState='pending'|'uploading'|'completing'|'ready'|'deleting'|'deleted'|'cancelled';
export interface FileRecord extends FileInfo {schemaVersion:1;state:FileState;ownerId:string;storeId:string;objectKey:string;tempKey:string;expiresAt:string;version:number;leaseUntil?:number}
export interface FileRepository {
  create(record:FileRecord):Promise<void>;
  get(id:string):Promise<FileRecord|undefined>;
  compareAndSwap(id:string,version:number,record:FileRecord):Promise<boolean>;
  list(ownerId:string,input?:{cursor?:string;limit?:number}):Promise<Page<FileRecord>>;
}
export function recordId(id:string):string {if(typeof id!=='string'||!/^[-a-f0-9]{36}$/.test(id))throw new StorageError('INVALID_INPUT','Invalid file ID');return id;}
export function parseRecord(value:string):FileRecord{
  const r=JSON.parse(value) as FileRecord;
  if(!r||typeof r!=='object'||r.schemaVersion!==1||!Number.isSafeInteger(r.version)||r.version<1||typeof r.ownerId!=='string'||!['pending','uploading','completing','ready','deleting','deleted','cancelled'].includes(r.state))throw new StorageError('CONFIGURATION','Invalid file metadata');
  recordId(r.id);validKey(r.objectKey);validKey(r.tempKey);validSize(r.size);validContentType(r.contentType);
  if(!r.ownerId||r.ownerId.length>255||typeof r.storeId!=='string'||!r.storeId||typeof r.name!=='string'||r.name.length>255||[r.createdAt,r.updatedAt,r.expiresAt].some(v=>typeof v!=='string'||!Number.isFinite(Date.parse(v)))||(r.leaseUntil!==undefined&&!Number.isFinite(r.leaseUntil)))throw new StorageError('CONFIGURATION','Invalid file metadata');return r;
}
export async function createFileRepository(directory:string):Promise<FileRepository>{
  const root=await privateDirectory(directory),file=(id:string)=>path.join(root,recordId(id)+'.json');
  async function get(id:string):Promise<FileRecord|undefined>{try{return parseRecord(await readPrivate(file(id)));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}}
  return {
    get,
    async create(record){parseRecord(JSON.stringify(record));await withFileLock(file(record.id)+'.lock',async()=>{if(await get(record.id))throw new StorageError('CONFLICT');await atomicPrivate(file(record.id),JSON.stringify(record));});},
    async compareAndSwap(id,version,record){parseRecord(JSON.stringify(record));return withFileLock(file(id)+'.lock',async()=>{const current=await get(id);if(!current||current.version!==version)return false;if(record.id!==id||record.version!==version+1||record.ownerId!==current.ownerId||record.storeId!==current.storeId)throw new StorageError('INVALID_INPUT','Invalid record transition');await atomicPrivate(file(id),JSON.stringify(record));return true;});},
    async list(ownerId,input={}){const limit=pageLimit(input.limit),items:FileRecord[]=[];if(input.cursor)recordId(input.cursor);const dir=await fs.opendir(root);for await(const entry of dir){if(!/^[-a-f0-9]{36}\.json$/.test(entry.name))continue;const r=await get(entry.name.slice(0,-5));if(r&&r.ownerId===ownerId&&r.state==='ready'&&r.id>(input.cursor||'')){items.push(r);items.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);if(items.length>limit+1)items.pop();}}return {items:items.slice(0,limit),...(items.length>limit?{cursor:items[limit-1].id}:{})};}
  };
}

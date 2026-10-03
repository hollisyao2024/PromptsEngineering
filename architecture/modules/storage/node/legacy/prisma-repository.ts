import {StorageError,pageLimit} from './contracts.ts';
import {parseRecord,recordId} from './repository.ts';
import type {FileRepository,FileRecord} from './repository.ts';
type Row={id:string;ownerId:string;storeId:string;objectKey:string;state:string;version:number;record:string};
export interface FileObjectDelegate {
  create(args:{data:Row}):Promise<unknown>;
  findUnique(args:{where:{id:string}}):Promise<Row|null>;
  updateMany(args:{where:{id:string;version:number;ownerId:string;storeId:string};data:Row}):Promise<{count:number}>;
  findMany(args:{where:{ownerId:string;state:string;id?:{gt:string}};orderBy:{id:'asc'};take:number}):Promise<Row[]>;
}
const row=(r:FileRecord):Row=>{parseRecord(JSON.stringify(r));return ({id:r.id,ownerId:r.ownerId,storeId:r.storeId,objectKey:r.objectKey,state:r.state,version:r.version,record:JSON.stringify(r)});};
function unpack(r:Row):FileRecord{const value=parseRecord(r.record);if(value.id!==r.id||value.ownerId!==r.ownerId||value.storeId!==r.storeId||value.version!==r.version||value.state!==r.state||value.objectKey!==r.objectKey)throw new StorageError('CONFIGURATION','Inconsistent file metadata');return value;}
export function createPrismaFileRepository(fileObject:FileObjectDelegate):FileRepository{
  return {
    async create(record){try{await fileObject.create({data:row(record)});}catch(e){if((e as {code?:string}).code==='P2002')throw new StorageError('CONFLICT');throw new StorageError('UNAVAILABLE','Metadata write failed',true);}},
    async get(id){recordId(id);const r=await fileObject.findUnique({where:{id}});return r?unpack(r):undefined;},
    async compareAndSwap(id,version,record){recordId(id);if(record.id!==id||record.version!==version+1)throw new StorageError('INVALID_INPUT');return (await fileObject.updateMany({where:{id,version,ownerId:record.ownerId,storeId:record.storeId},data:row(record)})).count===1;},
    async list(ownerId,input={}){const limit=pageLimit(input.limit);if(input.cursor)recordId(input.cursor);const rows=await fileObject.findMany({where:{ownerId,state:'ready',...(input.cursor?{id:{gt:input.cursor}}:{})},orderBy:{id:'asc'},take:limit+1});return {items:rows.slice(0,limit).map(unpack),...(rows.length>limit?{cursor:rows[limit-1].id}:{})};}
  };
}

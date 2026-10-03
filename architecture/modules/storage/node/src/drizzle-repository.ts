import {and,eq,gt,asc,isNull,fileObject,affectedRows,type Database} from '@project/database-{{datastore}}';
import {StorageError,pageLimit} from './contracts.ts';
import {parseRecord,recordId,type FileRepository,type FileRecord} from './repository.ts';
const row=(r:FileRecord)=>{parseRecord(JSON.stringify(r));return {id:r.id,ownerId:r.ownerId,storeId:r.storeId,objectKey:r.objectKey,state:r.state,version:r.version,record:JSON.stringify(r)};};
// Data semantics (ADR-035): the owner is the audit actor; a deleted record keeps its row with deletedAt/deletedBy.
const audit=(r:FileRecord)=>({updatedBy:r.ownerId,deletedAt:r.state==='deleted'?new Date():null,deletedBy:r.state==='deleted'?r.ownerId:null});
function unpack(r:typeof fileObject.$inferSelect){const value=parseRecord(r.record);if(value.id!==r.id||value.ownerId!==r.ownerId||value.storeId!==r.storeId||value.objectKey!==r.objectKey||value.state!==r.state||value.version!==r.version)throw new StorageError('CONFIGURATION','Inconsistent file metadata');return value;}
function duplicate(e:unknown):boolean{if(!e||typeof e!=='object')return false;const x=e as {code?:string;cause?:unknown};return ['23505','ER_DUP_ENTRY','SQLITE_CONSTRAINT','SQLITE_CONSTRAINT_UNIQUE','SQLITE_CONSTRAINT_PRIMARYKEY'].includes(x.code||'')||duplicate(x.cause);}
export function createDrizzleFileRepository(database:Database):FileRepository{return {
 async create(record){try{await database.insert(fileObject).values({...row(record),...audit(record),createdBy:record.ownerId});}catch(e){if(duplicate(e))throw new StorageError('CONFLICT');throw new StorageError('UNAVAILABLE','Metadata write failed',true);}},
 async get(id){recordId(id);const [r]=await database.select().from(fileObject).where(eq(fileObject.id,id)).limit(1);return r?unpack(r):undefined;},
 async compareAndSwap(id,version,record){recordId(id);if(record.id!==id||record.version!==version+1)throw new StorageError('INVALID_INPUT');return affectedRows(await database.update(fileObject).set({...row(record),...audit(record),updatedAt:new Date()}).where(and(eq(fileObject.id,id),eq(fileObject.version,version),eq(fileObject.ownerId,record.ownerId),eq(fileObject.storeId,record.storeId))))===1;},
 async list(ownerId,input={}){const limit=pageLimit(input.limit);if(input.cursor)recordId(input.cursor);const rows=await database.select().from(fileObject).where(and(eq(fileObject.ownerId,ownerId),eq(fileObject.state,'ready'),isNull(fileObject.deletedAt),input.cursor?gt(fileObject.id,input.cursor):undefined)).orderBy(asc(fileObject.id)).limit(limit+1);return {items:rows.slice(0,limit).map(unpack),...(rows.length>limit?{cursor:rows[limit-1].id}:{})};}
};}

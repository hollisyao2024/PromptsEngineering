import {tasks,and,eq,inArray,isNull,sql,asc,desc,count,affectedRows,type Database,type Transaction} from '@project/database-main';
import {randomUUID} from 'node:crypto';
import type {components} from '@project/contracts/types';
import {assertContract} from '@project/contracts';
type Query=components['schemas']['TaskQuery'];type Task=components['schemas']['Task'];
export class ServiceError extends Error {constructor(public readonly status:number,public readonly code:string,message:string){super(message);}}
export function queryFrom(params:URLSearchParams):Query {
 const allowed=new Set(['page','pageSize','search','title','status','sort','direction','sorts','scope','ids']);
 if([...params.keys()].some(k=>!allowed.has(k)||params.getAll(k).length!==1))throw new ServiceError(400,'INVALID_QUERY','查询参数无效或重复');
 const q={page:0,pageSize:10,sort:'createdAt',direction:'desc',...Object.fromEntries([...params].filter(([k])=>!['scope','ids'].includes(k)))};
 for(const k of ['page','pageSize'] as const)(q as Record<string,unknown>)[k]=Number(q[k]);assertContract('TaskQuery',q);return q as Query;
}
// Audit fields stay internal; the API contract exposes only business fields.
const dto=(row:typeof tasks.$inferSelect):Task=>({id:row.id,title:row.title,status:row.status as Task['status'],version:row.version,createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()});
// Soft delete: default reads and writes only see rows that are not deleted.
const live=()=>isNull(tasks.deletedAt);
const contains=(value:string)=>sql`${tasks.title} like ${'%'+value.replaceAll('!','!!').replaceAll('%','!%').replaceAll('_','!_')+'%'} escape '!'`;
const where=(q:Query)=>and(live(),...[...(q.search?[contains(q.search)]:[]),...(q.title?[contains(q.title)]:[]),...(q.status?[eq(tasks.status,q.status)]:[])]);
function order(q:Query){
 const fields=q.sorts?q.sorts.split(',').map(x=>x.split(':')):[[q.sort||'createdAt',q.direction||'desc']];
 if(fields.length>3||new Set(fields.map(([f])=>f)).size!==fields.length||fields.some(([f,d,...extra])=>!['title','status','createdAt'].includes(f)||!['asc','desc'].includes(d)||extra.length))throw new ServiceError(400,'INVALID_QUERY','排序字段无效或重复');
 return [...fields.map(([f,d])=>(d==='asc'?asc:desc)(tasks[f as 'title'|'status'|'createdAt'])),asc(tasks.id)];
}
const csv=(v:string)=>'"'+(/^[\s\u0000-\u001f]*[=+\-@]/u.test(v)?"'"+v:v).replaceAll('"','""')+'"';
const find=async(db:Database|Transaction,id:string)=>(await db.select().from(tasks).where(and(eq(tasks.id,id),live())).limit(1))[0];
export function taskService(db:Database,{actor='system'}:{actor?:string}={}){return {
 async list(q:Query){return db.transaction(async tx=>{const filter=where(q),items=await tx.select().from(tasks).where(filter).orderBy(...order(q)).offset((q.page||0)*(q.pageSize||10)).limit(q.pageSize||10),[total]=await tx.select({value:count()}).from(tasks).where(filter);return {items:items.map(dto),total:Number(total.value)};});},
 async create(body:components['schemas']['CreateTask']){if(!body.title.trim())throw new ServiceError(400,'INVALID_INPUT','标题不能为空');const id=randomUUID();return db.transaction(async tx=>{await tx.insert(tasks).values({...body,id,title:body.title.trim(),createdBy:actor,updatedBy:actor});return dto((await find(tx,id))!);});},
 async update(id:string,body:components['schemas']['UpdateTask']){if(!body.title.trim())throw new ServiceError(400,'INVALID_INPUT','标题不能为空');return db.transaction(async tx=>{const r=await tx.update(tasks).set({title:body.title.trim(),status:body.status,version:body.version+1,updatedAt:new Date(),updatedBy:actor}).where(and(eq(tasks.id,id),eq(tasks.version,body.version),live()));if(!affectedRows(r)){if(!await find(tx,id))throw new ServiceError(404,'NOT_FOUND','记录不存在');throw new ServiceError(409,'VERSION_CONFLICT','记录已被修改，请刷新后重试');}return dto((await find(tx,id))!);});},
 async remove(ids:string[]){return db.transaction(async tx=>{const now=new Date(),r=await tx.update(tasks).set({deletedAt:now,deletedBy:actor,updatedAt:now,updatedBy:actor,version:sql`${tasks.version}+1`}).where(and(inArray(tasks.id,ids),live())),n=affectedRows(r);if(n!==ids.length)throw new ServiceError(409,'SELECTION_CHANGED','部分记录已变化，请刷新后重试');return {count:n};});},
 async export(q:Query,scope:string,ids:string[]){if(!['page','filtered','selected'].includes(scope))throw new ServiceError(400,'INVALID_SCOPE','请选择导出范围');if(scope==='selected')assertContract('DeleteTasks',{ids});const filter=scope==='selected'?and(inArray(tasks.id,ids),live()):where(q),[total]=await db.select({value:count()}).from(tasks).where(filter);if(scope!=='page'&&Number(total.value)>1000)throw new ServiceError(400,'EXPORT_LIMIT','导出最多 1000 条，请缩小筛选范围');const rows=await db.select().from(tasks).where(filter).orderBy(...order(q)).limit(scope==='page'?q.pageSize||10:1000).offset(scope==='page'?(q.page||0)*(q.pageSize||10):0);return {filename:'tasks.csv',count:rows.length,csv:['ID,标题,状态,版本,创建时间',...rows.map(r=>[r.id,r.title,r.status,String(r.version),r.createdAt.toISOString()].map(csv).join(','))].join('\r\n')};}
};}

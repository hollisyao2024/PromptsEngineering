import type {PrismaClient,Prisma} from '@project/database-main';
import type {components} from '@project/contracts/types';
import {assertContract} from '@project/contracts';
type Query=components['schemas']['TaskQuery'];
type Task=components['schemas']['Task'];
export class ServiceError extends Error {constructor(public readonly status:number,public readonly code:string,message:string){super(message);}}
export function queryFrom(params:URLSearchParams):Query {
  const allowed=new Set(['page','pageSize','search','title','status','sort','direction','sorts','scope','ids']);
  if([...params.keys()].some(k=>!allowed.has(k)))throw new ServiceError(400,'INVALID_QUERY','不支持的查询条件');
  if([...params.keys()].some(k=>params.getAll(k).length!==1))throw new ServiceError(400,'INVALID_QUERY','查询参数不能重复');
  const q={page:0,pageSize:10,sort:'createdAt',direction:'desc',...Object.fromEntries([...params].filter(([k])=>k!=='scope'&&k!=='ids'))};
  for(const key of ['page','pageSize'] as const)(q as Record<string,unknown>)[key]=Number(q[key]);
  assertContract('TaskQuery',q);return q as Query;
}
const dto=(row:{id:string;title:string;status:string;version:number;createdAt:Date;updatedAt:Date}):Task=>({...row,status:row.status as Task['status'],createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()});
function where(q:Query):Prisma.TaskWhereInput {
  return {AND:[...(q.search?[{title:{contains:q.search}}]:[]),...(q.title?[{title:{contains:q.title}}]:[]),...(q.status?[{status:q.status}]:[])]};
}
function order(q:Query):Prisma.TaskOrderByWithRelationInput[] {
  const fields=q.sorts?q.sorts.split(',').map(item=>item.split(':')):[[q.sort||'createdAt',q.direction||'desc']];
  if(fields.length>3||new Set(fields.map(([field])=>field)).size!==fields.length||fields.some(([field,direction,...extra])=>!['title','status','createdAt'].includes(field)||!['asc','desc'].includes(direction)||extra.length))throw new ServiceError(400,'INVALID_QUERY','排序字段无效或重复');
  return [...fields.map(([field,direction])=>({[field]:direction})),{id:'asc'}];
}
const csv=(value:string)=>'"'+(/^[\s\u0000-\u001f]*[=+\-@]/u.test(value)?"'"+value:value).replaceAll('"','""')+'"';
export function taskService(db:PrismaClient) {
  return {
    async list(q:Query){
      const filter=where(q);
      const [items,total]=await db.$transaction([db.task.findMany({where:filter,orderBy:order(q),skip:(q.page||0)*(q.pageSize||10),take:q.pageSize||10}),db.task.count({where:filter})]);
      return {items:items.map(dto),total};
    },
    async create(body:components['schemas']['CreateTask']){
      if(!body.title.trim())throw new ServiceError(400,'INVALID_INPUT','标题不能为空');
      return dto(await db.task.create({data:{...body,title:body.title.trim()}}));
    },
    async update(id:string,body:components['schemas']['UpdateTask']){
      if(!body.title.trim())throw new ServiceError(400,'INVALID_INPUT','标题不能为空');
      return db.$transaction(async tx=>{
        const result=await tx.task.updateMany({where:{id,version:body.version},data:{title:body.title.trim(),status:body.status,version:{increment:1}}});
        if(!result.count){if(!await tx.task.findUnique({where:{id}}))throw new ServiceError(404,'NOT_FOUND','记录不存在');throw new ServiceError(409,'VERSION_CONFLICT','记录已被修改，请刷新后重试');}
        return dto(await tx.task.findUniqueOrThrow({where:{id}}));
      });
    },
    async remove(ids:string[]){
      // All IDs must exist; partial batches are rolled back rather than silently reported as complete.
      return db.$transaction(async tx=>{
        const result=await tx.task.deleteMany({where:{id:{in:ids}}});
        if(result.count!==ids.length)throw new ServiceError(409,'SELECTION_CHANGED','部分记录已变化，请刷新后重试');
        return result;
      });
    },
    async export(q:Query,scope:string,ids:string[]){
      if(!['page','filtered','selected'].includes(scope))throw new ServiceError(400,'INVALID_SCOPE','请选择导出范围');
      if(scope==='selected')assertContract('DeleteTasks',{ids});
      const filter=scope==='selected'?{id:{in:ids}}:where(q),count=await db.task.count({where:filter});
      if(scope!=='page'&&count>1000)throw new ServiceError(400,'EXPORT_LIMIT','导出最多 1000 条，请缩小筛选范围');
      const rows=await db.task.findMany({where:filter,orderBy:order(q),take:scope==='page'?q.pageSize||10:1000,...(scope==='page'?{skip:(q.page||0)*(q.pageSize||10)}:{})});
      return {filename:'tasks.csv',count:rows.length,csv:['ID,标题,状态,版本,创建时间',...rows.map(r=>[r.id,r.title,r.status,String(r.version),r.createdAt.toISOString()].map(csv).join(','))].join('\r\n')};
    },
  };
}

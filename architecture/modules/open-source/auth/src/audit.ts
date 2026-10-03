import {tryGetCurrentAuthEndpointContext} from '@better-auth/core/context';
// Data semantics (ADR-035): soft delete for identities and organizations, audited hard delete for short-lived credentials.
// Wrap the ORM adapter factory with softDeleteAdapter() and register the fields with xirangAudit() after organization().
const SOFT=new Set(['user','organization','member','invitation']);
const HARD=new Set(['session','account','verification']);
const AUDIT=['createdBy','updatedBy','deletedAt','deletedBy'];
type Row=Record<string,any>;
type Where={field:string;value:unknown;operator?:string;connector?:'AND'|'OR'}[];
const live=()=>({field:'deletedAt',value:null,operator:'eq',connector:'AND' as const});
const scoped=(model:string,where?:Where)=>SOFT.has(model)?[...(where||[]),live()]:where;
const strip=(data?:Row)=>{if(!data)return data;const copy={...data};for(const key of AUDIT)delete copy[key];return copy;};
async function actor():Promise<string>{
 try{const ctx:any=await tryGetCurrentAuthEndpointContext();return ctx?.context?.session?.user?.id||ctx?.context?.newSession?.user?.id||'system';}catch{return 'system';}
}
// Audit rows only record model, id, user and actor; tokens, passwords and verification values are never copied.
function wrap(adapter:any):any{
 const log=async(model:string,rows:Row[],by:string)=>{for(const row of rows)await adapter.create({model:'authAuditLog',data:{action:'delete',targetModel:model,targetId:String(row.id),userId:row.userId??null,actor:by,createdBy:by,updatedBy:by}});};
 const softDelete=async(p:any,many:boolean)=>{const by=await actor();const args={model:p.model,where:scoped(p.model,p.where),update:{deletedAt:new Date(),deletedBy:by,updatedBy:by}};return many?adapter.updateMany(args):adapter.update(args);};
 return {...adapter,
  create:async(p:any)=>{if(p.model==='authAuditLog')return adapter.create(p);const by=await actor();return adapter.create({...p,data:{...strip(p.data),createdBy:by,updatedBy:by}});},
  findOne:(p:any)=>adapter.findOne({...p,where:scoped(p.model,p.where)}),
  findMany:(p:any)=>adapter.findMany({...p,where:scoped(p.model,p.where)}),
  count:(p:any)=>adapter.count({...p,where:scoped(p.model,p.where)}),
  update:async(p:any)=>adapter.update({...p,where:scoped(p.model,p.where),update:{...strip(p.update),updatedBy:await actor()}}),
  updateMany:async(p:any)=>adapter.updateMany({...p,where:scoped(p.model,p.where),update:{...strip(p.update),updatedBy:await actor()}}),
  delete:async(p:any)=>{
   if(SOFT.has(p.model)){await softDelete(p,false);return;}
   if(!HARD.has(p.model))return adapter.delete(p);
   const by=await actor(),rows=await adapter.findMany({model:p.model,where:p.where});await adapter.delete(p);await log(p.model,rows,by);
  },
  deleteMany:async(p:any)=>{
   if(SOFT.has(p.model))return softDelete(p,true);
   if(!HARD.has(p.model))return adapter.deleteMany(p);
   const by=await actor(),rows=await adapter.findMany({model:p.model,where:p.where});const count=await adapter.deleteMany(p);await log(p.model,rows,by);return count;
  },
  ...(adapter.consumeOne?{consumeOne:async(p:any)=>{const row=await adapter.consumeOne(p);if(row&&HARD.has(p.model))await log(p.model,[row],await actor());return row;}}:{}),
  ...(adapter.incrementOne?{incrementOne:(p:any)=>adapter.incrementOne({...p,where:scoped(p.model,p.where)})}:{}),
  transaction:(callback:(trx:any)=>Promise<unknown>)=>adapter.transaction((trx:any)=>callback(wrap(trx))),
 };
}
export function softDeleteAdapter<F extends (options:any)=>any>(factory:F):F{
 return ((options:any)=>wrap(factory(options))) as F;
}
const field=(type:'string'|'date',extra:Row={})=>({type,required:false,input:false,...extra});
const by={createdBy:field('string',{defaultValue:'system'}),updatedBy:field('string',{defaultValue:'system'})};
const deleted={deletedAt:field('date'),deletedBy:field('string')};
const updatedAt={updatedAt:field('date',{required:true,defaultValue:()=>new Date(),onUpdate:()=>new Date()})};
const required=(type:'string'|'date',extra:Row={})=>({type,required:true,input:false,...extra});
export function xirangAudit(){
 return {id:'xirang-audit',schema:{
  user:{fields:{...by,...deleted}},
  organization:{fields:{...updatedAt,...by,...deleted}},
  member:{fields:{...updatedAt,...by,...deleted}},
  invitation:{fields:{...updatedAt,...by,...deleted}},
  session:{fields:by},account:{fields:by},verification:{fields:by},
  authAuditLog:{modelName:'authAuditLog',fields:{action:required('string'),targetModel:required('string'),targetId:required('string'),userId:field('string'),actor:required('string'),
   createdAt:required('date',{defaultValue:()=>new Date()}),updatedAt:required('date',{defaultValue:()=>new Date(),onUpdate:()=>new Date()}),...by}},
 }} as const;
}

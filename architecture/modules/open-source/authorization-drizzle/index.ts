import {createMongoAbility,type MongoAbility,type RawRuleOf} from '@casl/ability';
import {and,or,not,eq,ne,inArray,notInArray,gt,gte,lt,lte,isNull,isNotNull,sql,type SQL,type Column} from 'drizzle-orm';
export {subject,ForbiddenError,AbilityBuilder} from '@casl/ability';
export {rulesForActor,type Actor} from './policy.ts';
export type Action='read'|'create'|'update'|'delete'|'manage';
export type AppAbility=MongoAbility<[Action,string]>;
export function createAbility(rules:RawRuleOf<AppAbility>[]=[]):AppAbility{return createMongoAbility<AppAbility>(rules);}
// Only the documented flat SQL condition subset is accepted. Unsupported conditions throw.
const scalar=(value:unknown)=>value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||value instanceof Date&&!Number.isNaN(value.getTime());
function condition(value:Record<string,unknown>,columns:Record<string,Column>):SQL {
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Invalid authorization condition object');
 const all:SQL[]=[];
 for(const [field,v] of Object.entries(value)){
  if(['$and','$or'].includes(field)){if(!Array.isArray(v)||!v.length)throw Error('Invalid authorization condition');all.push((field==='$and'?and:or)(...v.map(x=>condition(x,columns)))!);continue;}
  const column=columns[field];if(!column)throw Error('Unknown authorization field');
  if(v!==null&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof Date)){
   if(!Object.keys(v).length)throw Error('Invalid empty authorization comparison');
   for(const [op,arg] of Object.entries(v)){
    if(['$in','$nin'].includes(op)){if(!Array.isArray(arg)||!arg.length||arg.some(x=>!scalar(x)))throw Error('Invalid authorization set');all.push((op==='$in'?inArray:notInArray)(column,arg));}
    else{const fn={$eq:eq,$ne:ne,$gt:gt,$gte:gte,$lt:lt,$lte:lte}[op];if(!fn)throw Error('Unsupported authorization operator');if(!scalar(arg))throw Error('Invalid authorization scalar');all.push(arg===null?(op==='$eq'?isNull(column):op==='$ne'?isNotNull(column):(()=>{throw Error('Invalid null comparison');})()):fn(column,arg));}
   }
  }else{if(!scalar(v))throw Error('Invalid authorization scalar');all.push(v===null?isNull(column):eq(column,v));}
 }
 return and(...all)||sql`1=1`;
}
// CASL rules are processed from highest priority to lowest; inverted rules cannot be bypassed.
export function whereAuthorized(ability:AppAbility,action:Action,model:string,columns:Record<string,Column>):SQL{
 const rules=ability.rulesFor(action,model);let result:SQL=sql`1=0`;
 for(const rule of [...rules].reverse()){
  if(rule.fields)throw Error('Field authorization requires explicit project policy');
  const match=rule.conditions?condition(rule.conditions,columns):sql`1=1`;
  result=rule.inverted?and(not(match),result)!:or(match,result)!;
 }
 return result;
}

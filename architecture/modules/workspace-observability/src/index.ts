import {randomUUID} from 'node:crypto';
const sensitive=/password|passwd|secret|token|authorization|cookie|api[-_]?key|email|phone|database.?url/i;
export function requestId(value:unknown):string {
  return typeof value==='string'&&/^[a-zA-Z0-9_-]{8,64}$/.test(value)?value:randomUUID();
}
export function redact(value:unknown,seen=new WeakSet<object>(),depth=0):unknown {
  if(depth>20)return '[MAX_DEPTH]';
  if(typeof value==='string')return value.replace(/\bBearer\s+\S+/gi,'Bearer [REDACTED]').replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi,'$1[REDACTED]@').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[EMAIL]');
  if(!value||typeof value!=='object')return typeof value==='bigint'?String(value):value;
  if(seen.has(value))return '[CIRCULAR]';seen.add(value);
  if(value instanceof Error)return {name:value.name,message:redact(value.message,seen,depth+1)};
  if(Array.isArray(value))return value.map(v=>redact(v,seen,depth+1));
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sensitive.test(k)?'[REDACTED]':redact(v,seen,depth+1)]));
}
export function createLogger(sink:(event:unknown)=>void=event=>console.log(JSON.stringify(event))) {
  return {emit(name:string,data:unknown={},level='info'){sink(redact({timestamp:new Date().toISOString(),name,level,data}));}};
}

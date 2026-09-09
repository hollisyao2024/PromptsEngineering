import pino,{type DestinationStream,type LoggerOptions,type Logger} from 'pino';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
const context=new AsyncLocalStorage<{requestId:string;logger:Logger}>();
const sensitive=/(?:password|secret|token|authorization|cookie|credential|api[-_]?key)/i;
// Bound recursion and size; logs deliberately omit raw Error messages and stack traces.
function scrub(value:unknown,seen=new WeakSet<object>(),depth=0):unknown{
 if(value===null||typeof value!=='object')return typeof value==='string'?value.slice(0,2048):value;
 if(value instanceof Error)return {name:value.name,code:'code' in value?String(value.code):undefined};
 if(depth>=8||seen.has(value))return '[truncated]';seen.add(value);
 if(Array.isArray(value))return value.slice(0,100).map(v=>scrub(v,seen,depth+1));
 return Object.fromEntries(Object.entries(value).slice(0,100).map(([k,v])=>[k,sensitive.test(k)?'[redacted]':scrub(v,seen,depth+1)]));
}
export function createLogger(service:string,destination?:DestinationStream,options:Pick<LoggerOptions,'level'>={}){
 if(!service)throw new Error('Logger service name is required');
 return pino({name:service,level:options.level||'info',base:undefined,formatters:{bindings:obj=>scrub(obj) as Record<string,unknown>,log:obj=>scrub(obj) as Record<string,unknown>},serializers:{err:e=>scrub(e),error:e=>scrub(e)}},destination);
}
export function withRequestContext<T>(logger:Logger,callback:()=>T,requestId=randomUUID()):T{
 const id=/^[a-zA-Z0-9-]{1,128}$/.test(requestId)?requestId:randomUUID();return context.run({requestId:id,logger:logger.child({requestId:id})},callback);
}
export function requestLogger(fallback:Logger){return context.getStore()?.logger||fallback;}
export function requestId(){return context.getStore()?.requestId;}

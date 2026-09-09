import {Readable,PassThrough} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {StorageError,call,validKey,validSize,validContentType,pageLimit,ttl} from './contracts.ts';
import type {StorageProvider,ObjectInfo,SignedRequest,PutInput,ListInput,ProviderName} from './contracts.ts';
import {readable,sizeGuard} from './streams.ts';
export interface CloudCredentials {accessKeyId:string;secretAccessKey:string;sessionToken?:string;expiration?:Date}
export interface CloudOptions {bucket:string;region:string;endpoint?:string;publicEndpoint?:string;credentials?:()=>Promise<CloudCredentials>;allowHTTP?:boolean;forcePathStyle?:boolean}
export function endpoint(value:string|undefined,allowHTTP=false):string|undefined {
  if(!value)return undefined;const u=new URL(value);
  if((u.protocol!=='https:'&&!(allowHTTP&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new StorageError('CONFIGURATION','Invalid storage endpoint');
  return u.origin;
}
export function cloudOptions(o:CloudOptions):CloudOptions {
  if(!o.bucket||!/^[-a-z0-9.]{3,100}$/.test(o.bucket)||!/^[-a-z0-9]{2,64}$/.test(o.region))throw new StorageError('CONFIGURATION','Bucket and region are required');
  endpoint(o.endpoint,o.allowHTTP);endpoint(o.publicEndpoint,o.allowHTTP);
  const internal=(value:string)=>/internal|privatelink|vpce[.-]|localhost|^127\.|^10\.|^192\.168\.|^172\.(?:1[6-9]|2[0-9]|3[01])\./.test(new URL(value).hostname);
  if(!o.allowHTTP&&((o.endpoint&&internal(o.endpoint)&&!o.publicEndpoint)||(o.publicEndpoint&&internal(o.publicEndpoint))))throw new StorageError('CONFIGURATION','A public storage endpoint is required for browser signatures');return o;
}
export function expiresIn(seconds:number,credentials?:CloudCredentials):number{
  ttl(seconds);if(!credentials?.expiration)return seconds;const remaining=Math.floor((credentials.expiration.getTime()-Date.now())/1000)-10;
  if(!Number.isFinite(remaining)||remaining<1)throw new StorageError('CONFIGURATION','Storage credentials expired');return Math.min(seconds,remaining);
}
export function signed(method:'PUT'|'GET',url:string,headers:Record<string,string>,seconds:number):SignedRequest{return {method,url,headers,expiresAt:new Date(Date.now()+seconds*1000).toISOString()};}
export function fromHeaders(key:string,h:Headers):ObjectInfo {
  const raw=h.get('content-length'),size=raw===null?NaN:Number(raw);if(!Number.isSafeInteger(size)||size<0)throw new StorageError('UNAVAILABLE','Storage response has no valid content length');
  return {key,size,contentType:h.get('content-type')||'application/octet-stream',etag:h.get('etag')||undefined,modifiedAt:h.get('last-modified')||undefined};
}
async function responseOK(r:Response){if(!r.ok){await r.body?.cancel();throw {status:r.status};}}
export function signedProvider(name:ProviderName,operations:{
  sign:(method:'PUT'|'GET',key:string,input:{contentType?:string;size?:number;expiresIn:number},publicURL:boolean)=>Promise<SignedRequest>;
  head:StorageProvider['head'];delete:StorageProvider['delete'];list:StorageProvider['list'];
}):StorageProvider{
  const provider:StorageProvider={
    name,capabilities:{directUpload:true,multipart:false,resumable:false,extensions:[]},
    signUpload:(key,input)=>call(async()=>{validKey(key);validSize(input.size);validContentType(input.contentType);ttl(input.expiresIn);return operations.sign('PUT',key,input,true);}),
    signDownload:(key,input)=>call(async()=>{validKey(key);ttl(input.expiresIn);return operations.sign('GET',key,input,true);}),
    head:(key,opts)=>call(async()=>{validKey(key);opts?.signal?.throwIfAborted();return operations.head(key,opts);}),
    delete:(key,opts)=>call(async()=>{validKey(key);opts?.signal?.throwIfAborted();try{await operations.delete(key,opts);}catch(e){if((e as {status?:number;statusCode?:number}).status!==404&&(e as {statusCode?:number}).statusCode!==404)throw e;}}),
    list:(input={})=>call(async()=>{pageLimit(input.limit);if(input.prefix&&input.prefix.length>1024)throw new StorageError('INVALID_INPUT');if(input.cursor&&input.cursor.length>8192)throw new StorageError('INVALID_INPUT');input.signal?.throwIfAborted();return operations.list(input);}),
    async get(key,{signal}={}){return call(async()=>{validKey(key);const auth=await operations.sign('GET',key,{expiresIn:300},false);const response=await fetch(auth.url,{headers:auth.headers,signal:AbortSignal.any([AbortSignal.timeout(300000),...(signal?[signal]:[])])});await responseOK(response);if(!response.body)throw new StorageError('UNAVAILABLE');try{return {info:fromHeaders(key,response.headers),body:Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)};}catch(error){await response.body.cancel();throw error;}});},
    async put(key,input:PutInput){return call(async()=>{
      validKey(key);validSize(input.size);validContentType(input.contentType);const auth=await operations.sign('PUT',key,{size:input.size,contentType:input.contentType,expiresIn:300},false);
      const guard=sizeGuard(input.size),bridge=new PassThrough(),signal=AbortSignal.any([AbortSignal.timeout(300000),...(input.signal?[input.signal]:[])]);
      const copying=pipeline(readable(input.body),guard.stream,bridge,{signal});
      const headers={...auth.headers,'content-type':input.contentType,'content-length':String(input.size)};
      const sending=(async()=>{const response=await fetch(auth.url,{method:'PUT',headers,body:bridge as unknown as BodyInit,duplex:'half',signal} as RequestInit);await responseOK(response);await response.body?.cancel();return response;})();
      try{const [,response]=await Promise.all([copying,sending]);return {key,size:input.size,contentType:input.contentType,etag:response.headers.get('etag')||undefined};}catch(e){bridge.destroy();await Promise.allSettled([copying,sending]);throw e;}
    });}
  };return provider;
}

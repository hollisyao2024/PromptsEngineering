import type { Readable } from 'node:stream';

export type ErrorCode = 'INVALID_INPUT'|'NOT_FOUND'|'FORBIDDEN'|'CONFLICT'|'EXPIRED'|'UNSUPPORTED'|'UNAVAILABLE'|'ABORTED'|'CONFIGURATION';
export class StorageError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  constructor(code: ErrorCode, message: string = code, retryable = false) { super(message); this.name='StorageError'; this.code=code; this.retryable=retryable; }
}
export type ProviderName = 'local'|'s3'|'aliyun-oss'|'tencent-cos';
export interface ObjectInfo { key:string; size:number; contentType:string; etag?:string; modifiedAt?:string }
export interface ListInput { prefix?:string; cursor?:string; limit?:number; signal?:AbortSignal }
export interface Page<T> { items:T[]; cursor?:string }
export interface PutInput { body:Readable|Uint8Array|string; size:number; contentType:string; signal?:AbortSignal }
export interface ObjectDownload { body:Readable; info:ObjectInfo }
export interface SignedRequest { method:'PUT'|'GET'; url:string; headers:Record<string,string>; expiresAt:string }
export interface Capabilities { directUpload:boolean; multipart:boolean; resumable:boolean; extensions:readonly string[] }
export interface StorageProvider {
  readonly name:ProviderName;
  readonly capabilities:Capabilities;
  put(key:string,input:PutInput):Promise<ObjectInfo>;
  get(key:string,options?:{signal?:AbortSignal}):Promise<ObjectDownload>;
  head(key:string,options?:{signal?:AbortSignal}):Promise<ObjectInfo>;
  delete(key:string,options?:{signal?:AbortSignal}):Promise<void>;
  list(input?:ListInput):Promise<Page<ObjectInfo>>;
  signUpload?(key:string,input:{size:number;contentType:string;expiresIn:number}):Promise<SignedRequest>;
  signDownload?(key:string,input:{expiresIn:number}):Promise<SignedRequest>;
  extension?<T=unknown>(name:string,input:unknown):Promise<T>;
}
export function validKey(key:string):string {
  if(typeof key!=='string'||!key||Buffer.byteLength(key)>1024||key.startsWith('/')||/[\\%?#\x00-\x1f\x7f]/.test(key)||key.split('/').some(p=>!p||p==='.'||p==='..'))throw new StorageError('INVALID_INPUT','Invalid object key');
  return key;
}
export function validSize(size:number,max=1024*1024*1024):number {
  if(!Number.isSafeInteger(size)||size<0||size>max)throw new StorageError('INVALID_INPUT','Invalid file size');return size;
}
export function validContentType(value:string):string {
  if(typeof value!=='string'||value.length>200||!/^[-\w.+]+\/[-\w.+]+(?:; ?charset=[-\w]+)?$/.test(value))throw new StorageError('INVALID_INPUT','Invalid content type');return value;
}
export function pageLimit(value=50):number { if(!Number.isInteger(value)||value<1||value>200)throw new StorageError('INVALID_INPUT','Page limit must be 1..200');return value; }
export function ttl(value:number):number {if(!Number.isInteger(value)||value<1||value>3600)throw new StorageError('INVALID_INPUT','Expiry must be 1..3600 seconds');return value;}
export function sdkError(error:unknown):StorageError {
  if(error instanceof StorageError)return error;
  const e=error as {name?:string;code?:string;status?:number;statusCode?:number;$metadata?:{httpStatusCode?:number}};
  const status=e?.statusCode||e?.status||e?.$metadata?.httpStatusCode;
  if(e?.name==='AbortError'||e?.code==='ABORT_ERR')return new StorageError('ABORTED');
  if(status===404||['NoSuchKey','NotFound','ENOENT'].includes(e?.code||e?.name||''))return new StorageError('NOT_FOUND');
  if(status===401||status===403)return new StorageError('FORBIDDEN');
  if(status===409||status===412)return new StorageError('CONFLICT');
  return new StorageError('UNAVAILABLE','Storage request failed',status===429||status===undefined||status>=500);
}
export async function call<T>(fn:()=>Promise<T>):Promise<T>{try{return await fn();}catch(e){throw sdkError(e);}}

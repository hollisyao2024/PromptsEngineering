import COS from 'cos-nodejs-sdk-v5';
import {StorageError} from '../contracts.ts';
import {cloudOptions,signedProvider,signed,expiresIn} from '../cloud.ts';
import type {CloudOptions} from '../cloud.ts';
export function createTencentCOSProvider(options:CloudOptions){
  const o=cloudOptions(options);
  async function client(publicURL=false){if(!o.credentials)throw new StorageError('CONFIGURATION','COS credential provider is required');const credentials=await o.credentials();return {credentials,sdk:new COS({SecretId:credentials.accessKeyId,SecretKey:credentials.secretAccessKey,SecurityToken:credentials.sessionToken,Protocol:o.allowHTTP?'http:':'https:',Domain:(publicURL?(o.publicEndpoint||o.endpoint):o.endpoint)?.replace(/^https?:\/\//,''),Timeout:60000,ForceSignHost:true})};}
  const args=(key:string)=>({Bucket:o.bucket,Region:o.region,Key:key});
  return signedProvider('tencent-cos',{
    async sign(method,key,input,publicURL){const {sdk,credentials}=await client(publicURL),seconds=expiresIn(input.expiresIn,credentials),headers:Record<string,string>=method==='PUT'?{'Content-Type':input.contentType!}:{};const url=await new Promise<string>((resolve,reject)=>sdk.getObjectUrl({...args(key),Method:method,Expires:seconds,Headers:method==='PUT'?{...headers,'Content-Length':String(input.size)}:headers,Query:method==='GET'?{'response-content-disposition':'attachment'}:undefined},(error,result)=>error?reject(error):resolve(result.Url)));return signed(method,url,headers,seconds);},
    async head(key){const {sdk}=await client(),r=await sdk.headObject(args(key)),h=r.headers||{};return {key,size:Number(h['content-length']),contentType:String(h['content-type']||'application/octet-stream'),etag:r.ETag,modifiedAt:String(h['last-modified']||'')};},
    async delete(key){const {sdk}=await client();await sdk.deleteObject(args(key));},
    async list(input={}){const {sdk}=await client();const r=await sdk.getBucket({Bucket:o.bucket,Region:o.region,Prefix:input.prefix,Marker:input.cursor,MaxKeys:input.limit||50});return {items:(r.Contents||[]).map(v=>({key:v.Key,size:Number(v.Size),contentType:'application/octet-stream',etag:v.ETag,modifiedAt:v.LastModified})),cursor:r.IsTruncated==='true'?r.NextMarker:undefined};}
  });
}

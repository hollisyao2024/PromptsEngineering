import OSS from 'ali-oss';
import {StorageError} from '../contracts.ts';
import {cloudOptions,signedProvider,signed,expiresIn} from '../cloud.ts';
import type {CloudOptions} from '../cloud.ts';
export function createAliyunOSSProvider(options:CloudOptions){
  const o=cloudOptions(options);
  async function client(publicURL=false){if(!o.credentials)throw new StorageError('CONFIGURATION','OSS credential provider is required');const credentials=await o.credentials();const sdk=new OSS({bucket:o.bucket,region:o.region.startsWith('oss-')?o.region:'oss-'+o.region,endpoint:publicURL?(o.publicEndpoint||o.endpoint):o.endpoint,accessKeyId:credentials.accessKeyId,accessKeySecret:credentials.secretAccessKey,stsToken:credentials.sessionToken,authorizationV4:true,refreshSTSTokenInterval:60000,secure:!o.allowHTTP,timeout:60000});return {sdk,credentials};}
  return signedProvider('aliyun-oss',{
    async sign(method,key,input,publicURL){const {sdk,credentials}=await client(publicURL),seconds=expiresIn(input.expiresIn,credentials),headers:Record<string,string>=method==='PUT'?{'Content-Type':input.contentType!}:{};return signed(method,await sdk.signatureUrlV4(method,seconds,{headers:method==='PUT'?{...headers,'Content-Length':String(input.size)}:headers,queries:method==='GET'?{'response-content-disposition':'attachment'}:undefined},key,method==='PUT'?['content-length']:[]),headers,seconds);},
    async head(key){const {sdk}=await client(),r=await sdk.head(key),h=r.res.headers as Record<string,string>;return {key,size:Number(h['content-length']),contentType:String(h['content-type']||'application/octet-stream'),etag:String(h.etag||''),modifiedAt:String(h['last-modified']||'')};},
    async delete(key){const {sdk}=await client();await sdk.delete(key);},
    async list(input={}){const {sdk}=await client();const r=await sdk.listV2({prefix:input.prefix,'continuation-token':input.cursor,'max-keys':input.limit||50},{});return {items:(r.objects||[]).map(v=>({key:v.name,size:Number(v.size),contentType:'application/octet-stream',etag:v.etag,modifiedAt:v.lastModified})),cursor:r.isTruncated?r.nextContinuationToken:undefined};}
  });
}

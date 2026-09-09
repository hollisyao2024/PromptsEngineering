import {S3Client,HeadObjectCommand,DeleteObjectCommand,ListObjectsV2Command,PutObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {cloudOptions,signedProvider,signed,expiresIn} from '../cloud.ts';
import type {CloudOptions} from '../cloud.ts';
export function createS3Provider(options:CloudOptions){
  const o=cloudOptions(options);
  const client=(publicURL=false,credentials?:Awaited<ReturnType<NonNullable<CloudOptions['credentials']>>>)=>new S3Client({region:o.region,endpoint:publicURL?(o.publicEndpoint||o.endpoint):o.endpoint,forcePathStyle:o.forcePathStyle||false,credentials:credentials||o.credentials,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  return signedProvider('s3',{
    async sign(method,key,input,publicURL){const credentials=o.credentials?await o.credentials():undefined,seconds=expiresIn(input.expiresIn,credentials),sdk=client(publicURL,credentials);try{const command=method==='PUT'?new PutObjectCommand({Bucket:o.bucket,Key:key,ContentType:input.contentType,ContentLength:input.size}):new GetObjectCommand({Bucket:o.bucket,Key:key,ResponseContentDisposition:'attachment'});const url=await getSignedUrl(sdk,command,{expiresIn:seconds,...(method==='PUT'?{signableHeaders:new Set(['content-type','content-length'])}:{})});return signed(method,url,method==='PUT'?{'content-type':input.contentType!}:{},seconds);}finally{sdk.destroy();}},
    async head(key,opts){const sdk=client();try{const r=await sdk.send(new HeadObjectCommand({Bucket:o.bucket,Key:key}),{abortSignal:opts?.signal});return {key,size:Number(r.ContentLength),contentType:r.ContentType||'application/octet-stream',etag:r.ETag,modifiedAt:r.LastModified?.toISOString()};}finally{sdk.destroy();}},
    async delete(key,opts){const sdk=client();try{await sdk.send(new DeleteObjectCommand({Bucket:o.bucket,Key:key}),{abortSignal:opts?.signal});}finally{sdk.destroy();}},
    async list(input={}){const sdk=client();try{const r=await sdk.send(new ListObjectsV2Command({Bucket:o.bucket,Prefix:input.prefix,ContinuationToken:input.cursor,MaxKeys:input.limit||50}),{abortSignal:input.signal});return {items:(r.Contents||[]).map(v=>({key:v.Key!,size:Number(v.Size),contentType:'application/octet-stream',etag:v.ETag,modifiedAt:v.LastModified?.toISOString()})),cursor:r.NextContinuationToken};}finally{sdk.destroy();}}
  });
}

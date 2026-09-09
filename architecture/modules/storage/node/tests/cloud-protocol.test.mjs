import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
for(const [name,factory] of [['s3','createS3Provider'],['aliyun-oss','createAliyunOSSProvider'],['tencent-cos','createTencentCOSProvider']]){
 test('native '+name+' SDK and streaming transport against an HTTP protocol fixture',async t=>{
  let module;try{module=await import('../dist/providers/'+name+'.js');}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'){t.skip('Provider not selected');return;}throw e;}
  const objects=new Map(),bucket='test-1250000000',xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const server=createServer(async(req,res)=>{
   const u=new URL(req.url,'http://localhost');let key=decodeURIComponent(u.pathname).replace(/^\//,'');if(key.startsWith(bucket+'/'))key=key.slice(bucket.length+1);if(key===bucket)key='';
   if(req.method==='GET'&&!key){const limit=Number(u.searchParams.get('max-keys')||50),cursor=u.searchParams.get('continuation-token')||u.searchParams.get('marker')||'',prefix=u.searchParams.get('prefix')||'';const all=[...objects].filter(([k])=>k>cursor&&k.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b)),items=all.slice(0,limit),last=items.at(-1)?.[0]||'';res.setHeader('content-type','application/xml');res.end('<ListBucketResult><Name>'+bucket+'</Name><MaxKeys>'+limit+'</MaxKeys><KeyCount>'+items.length+'</KeyCount><IsTruncated>'+(all.length>limit)+'</IsTruncated><NextMarker>'+xml(last)+'</NextMarker><NextContinuationToken>'+xml(last)+'</NextContinuationToken>'+items.map(([k,v])=>'<Contents><Key>'+xml(k)+'</Key><Size>'+v.body.length+'</Size><ETag>'+v.etag+'</ETag><LastModified>2026-09-09T00:00:00.000Z</LastModified><StorageClass>STANDARD</StorageClass></Contents>').join('')+'</ListBucketResult>');return;}
   if(req.method==='PUT'){const parts=[];for await(const chunk of req)parts.push(chunk);const body=Buffer.concat(parts),etag=createHash('sha256').update(body).digest('hex');objects.set(key,{body,type:req.headers['content-type'],etag});res.setHeader('etag',etag);res.end();return;}
   if(req.method==='DELETE'){objects.delete(key);res.writeHead(204);res.end();return;}
   const v=objects.get(key);if(!v){res.writeHead(404,{'content-type':'application/xml'});res.end('<Error><Code>NoSuchKey</Code><Message>Missing</Message><RequestId>fixture</RequestId></Error>');return;}
   res.setHeader('content-length',v.body.length);res.setHeader('content-type',v.type);res.setHeader('etag',v.etag);res.setHeader('last-modified',new Date('2026-09-09').toUTCString());res.end(req.method==='HEAD'?undefined:v.body);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const endpoint='http://127.0.0.1:'+server.address().port,p=module[factory]({bucket,region:name==='s3'?'us-east-1':name==='aliyun-oss'?'cn-hangzhou':'ap-guangzhou',endpoint,publicEndpoint:endpoint,allowHTTP:true,forcePathStyle:true,credentials:async()=>({accessKeyId:'fixture',secretAccessKey:'fixture'})});
  for(const [key,body]of [['a',Buffer.from([0,127,255])],['b',Buffer.alloc(0)]]){await p.put(key,{body,size:body.length,contentType:'application/octet-stream'});const h=await p.head(key);assert.equal(h.size,body.length);const d=await p.get(key),parts=[];for await(const b of d.body)parts.push(b);assert.deepEqual(Buffer.concat(parts),body);}
  const first=await p.list({limit:1});assert.equal(first.items.length,1);assert.ok(first.cursor);const second=await p.list({limit:1,cursor:first.cursor});assert.equal(second.items.length,1);
  await p.delete('a');await p.delete('a');await assert.rejects(p.get('missing'),e=>e.code==='NOT_FOUND');
  const link=await p.signDownload('b',{expiresIn:60});assert.match(decodeURIComponent(link.url),/response-content-disposition=attachment/);
 });
}

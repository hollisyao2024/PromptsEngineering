import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readCloudEnvironment} from '../dist/environment.js';
const provider=process.env.XIRANG_LIVE_STORAGE_PROVIDER;
test('TC-STORAGE-007 opt-in real cloud roundtrip',{skip:!provider?'Unverified: set XIRANG_LIVE_STORAGE_PROVIDER and LIVE_* for a disposable test bucket':false},async()=>{
 const factories={s3:'createS3Provider','aliyun-oss':'createAliyunOSSProvider','tencent-cos':'createTencentCOSProvider'};assert.ok(factories[provider],'Select an installed cloud provider');
 const module=await import('../dist/providers/'+provider+'.js'),p=module[factories[provider]](readCloudEnvironment('LIVE')),key='xirang-integration/'+randomUUID(),body=Buffer.from([0,1,127,255]);
 try{await p.put(key,{body,size:body.length,contentType:'application/octet-stream'});assert.equal((await p.head(key)).size,body.length);const download=await p.get(key),parts=[];for await(const part of download.body)parts.push(part);assert.deepEqual(Buffer.concat(parts),body);assert.ok((await p.list({prefix:key,limit:1})).items.some(v=>v.key===key));const signed=await p.signDownload(key,{expiresIn:60});assert.deepEqual(Buffer.from(await(await fetch(signed.url,{headers:signed.headers})).arrayBuffer()),body);}
 finally{await p.delete(key);}
});

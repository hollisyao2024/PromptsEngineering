import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const definitions=[['s3','createS3Provider','test-files','cn-hangzhou','X-Amz-Signature'],['aliyun-oss','createAliyunOSSProvider','test-files','cn-hangzhou','x-oss-signature'],['tencent-cos','createTencentCOSProvider','test-files-1250000000','ap-guangzhou','q-signature']];
for(const [provider,factory,bucket,region,signature] of definitions){
  test(provider+' native SDK signing and short-lived credential rotation',async t=>{
    const moduleURL=new URL('../dist/providers/'+provider+'.js',import.meta.url);if(!existsSync(moduleURL)){t.skip('Provider was not selected');return;}
    const create=(await import(moduleURL))[factory];let rotations=0;
    const p=create({bucket,region,credentials:async()=>{rotations++;return {accessKeyId:'example-access-key',secretAccessKey:'example-signing-secret',sessionToken:'example-session-token',expiration:new Date(Date.now()+120000)};}});
    const upload=await p.signUpload('uploads/test/object',{size:4,contentType:'text/plain',expiresIn:300});
    assert.equal(upload.method,'PUT');assert.equal(new URL(upload.url).protocol,'https:');assert.ok(new URL(upload.url).searchParams.has(signature),provider);assert.ok(Date.parse(upload.expiresAt)-Date.now()<120000);assert.equal(Object.values(upload.headers)[0],'text/plain');
    const signedHeaders=new URL(upload.url).searchParams.get(provider==='s3'?'X-Amz-SignedHeaders':provider==='aliyun-oss'?'x-oss-additional-headers':'q-header-list');
    assert.ok(signedHeaders?.split(';').includes('content-length'),'signature must bind declared bytes');
    assert.equal(Object.keys(upload.headers).some(k=>k.toLowerCase()==='content-length'),false,'browser controls Content-Length');
    const download=await p.signDownload('files/test/object',{expiresIn:60});assert.equal(download.method,'GET');assert.ok(rotations>=2);assert.equal(p.capabilities.resumable,false);
    await assert.rejects(()=>p.signUpload('../bad',{size:4,contentType:'text/plain',expiresIn:60}),e=>e.code==='INVALID_INPUT');
    const expired=create({bucket,region,credentials:async()=>({accessKeyId:'example',secretAccessKey:'example',expiration:new Date(0)})});await assert.rejects(()=>expired.signDownload('file',{expiresIn:30}),e=>e.code==='CONFIGURATION');
  });
}

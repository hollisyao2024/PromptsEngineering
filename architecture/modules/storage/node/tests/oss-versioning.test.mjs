import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
let create;try{({createAliyunOSSProvider:create}=await import('../dist/providers/aliyun-oss.js'));}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
async function fixture(t,mode=''){
 const requests=[];const state={mode,deny:false,stall:false};
 const server=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');requests.push({method:req.method,query:u.searchParams});
  if(u.searchParams.has('versioning')){res.setHeader('content-type','application/xml');if(state.deny){res.writeHead(403);res.end('<Error><Code>AccessDenied</Code></Error>');return;}res.end('<VersioningConfiguration>'+ (state.mode?'<Status>'+state.mode+'</Status>':'')+'</VersioningConfiguration>');return;}
  if(u.searchParams.has('versions')){res.setHeader('content-type','application/xml');const next=u.searchParams.has('key-marker');res.end('<ListVersionsResult><Name>fixture-bucket</Name><Prefix>files/</Prefix><IsTruncated>'+!next+'</IsTruncated>'+(next?'':'<NextKeyMarker>files/a</NextKeyMarker><NextVersionIdMarker>'+(state.stall?'':'v1')+'</NextVersionIdMarker>')+(next?'<DeleteMarker><Key>files/a</Key><VersionId>d1</VersionId><IsLatest>true</IsLatest><Owner><ID>fixture</ID><DisplayName>fixture</DisplayName></Owner></DeleteMarker>':'<Version><Key>files/a</Key><VersionId>v1</VersionId><Size>3</Size><IsLatest>false</IsLatest><Owner><ID>fixture</ID><DisplayName>fixture</DisplayName></Owner></Version>')+'</ListVersionsResult>');return;}
  if(u.searchParams.has('list-type')){res.setHeader('content-type','application/xml');const next=u.searchParams.has('continuation-token');res.end('<ListBucketResult><Name>fixture-bucket</Name><Prefix>files/</Prefix><IsTruncated>'+!next+'</IsTruncated>'+(next?'':'<NextContinuationToken>page2</NextContinuationToken>')+'<Contents><Key>files/'+(next?'b':'a')+'</Key><Size>3</Size></Contents></ListBucketResult>');return;}
  const version=u.searchParams.get('versionId');if(version==='missing'){res.writeHead(404);res.end('<Error><Code>NoSuchVersion</Code></Error>');return;}
  if(req.method==='DELETE'){res.writeHead(204);res.end();return;}
  if(req.method==='PUT'){for await(const _ of req){}res.end();return;}
  res.setHeader('content-length','3');res.setHeader('content-type','application/octet-stream');if(version&&version!=='null')res.setHeader('x-oss-version-id',version);res.end(req.method==='HEAD'?undefined:'old');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const endpoint='http://127.0.0.1:'+server.address().port;return {state,requests,p:create({bucket:'fixture-bucket',region:'cn-shanghai',endpoint,allowHTTP:true,credentials:async()=>({accessKeyId:'fixture',secretAccessKey:'fixture'})})};
}
test('OSS missing version header is explicit null; fixed reads never fall back',{skip:!create},async t=>{
 const {p,requests}=await fixture(t);assert.equal((await p.head('files/a')).versionId,'null');
 assert.equal((await p.put('files/new',{body:'new',size:3,contentType:'text/plain'})).versionId,'null');
 const d=await p.getVersion('files/a','null');let body='';for await(const b of d.body)body+=b;assert.equal(body,'old');assert.equal(d.info.versionId,'null');
 assert.equal((await p.headVersion('files/a','v1')).versionId,'v1');await p.deleteVersion('files/a','null');
 assert.ok(requests.some(r=>r.method==='DELETE'&&r.query.get('versionId')==='null'));
 const count=requests.length;await assert.rejects(p.getVersion('files/a','missing'),e=>e.code==='NOT_FOUND');assert.equal(requests.length,count+1);
 await assert.rejects(p.getVersion('files/a',''),e=>e.code==='INVALID_INPUT');
});
for(const mode of ['', 'Enabled','Suspended'])test('OSS complete pagination '+(mode||'never enabled'),{skip:!create},async t=>{
 const {p,requests}=await fixture(t,mode),first=await p.listVersions({prefix:'files/',limit:1});assert.equal(first.items[0].versionId,mode?'v1':'null');assert.ok(first.cursor);
 const second=await p.listVersions({prefix:'files/',limit:1,cursor:first.cursor});assert.equal(second.items[0].deleteMarker,!!mode);assert.equal(second.cursor,undefined);assert.equal(requests.filter(r=>r.query.has('versioning')).length,2);
});
test('OSS listing fails closed on permissions, changed mode and invalid cursors',{skip:!create},async t=>{
 const {p,state,requests}=await fixture(t);const first=await p.listVersions({prefix:'files/',limit:1});
 await assert.rejects(p.listVersions({prefix:'other/',cursor:first.cursor}),e=>e.code==='INVALID_INPUT');
 state.mode='Enabled';await assert.rejects(p.listVersions({prefix:'files/',cursor:first.cursor}),e=>e.code==='CONFLICT');
 state.deny=true;const count=requests.length;await assert.rejects(p.listVersions({prefix:'files/'}),e=>e.code==='FORBIDDEN');assert.equal(requests.length,count+1);
});
test('OSS unknown state and incomplete version cursor cannot report completion',{skip:!create},async t=>{
 const {p,state}=await fixture(t,'Enabled');state.stall=true;await assert.rejects(p.listVersions({prefix:'files/',limit:1}),e=>e.code==='UNAVAILABLE');state.mode='Unknown';await assert.rejects(p.listVersions({prefix:'files/'}),e=>e.code==='UNAVAILABLE');
});

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {validateConfig,createArchitecturePlan}=require('../scripts/project');
const {applyPlan}=require('../../tooling/xirang/engine');
const source=path.resolve(__dirname,'../..');
const selection=(provider='local',runtime='node')=>({schemaVersion:2,workspace:{packageManager:'pnpm@10.18.3'},applications:[{id:'api',path:'apps/api',stack:runtime==='go'?'go':'node-ts'}],fileStorage:{path:'packages/storage',runtime,consumers:['api'],defaultStore:'files',stores:[{id:'files',provider,envPrefix:'FILES'}]}});
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'xirang-files-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const target=path.join(root,'repo');fs.mkdirSync(target);return {source,target,runRoot:path.join(root,'runs'),includeRuntime:false};}
test('TC-STORAGE-001/008 optional storage selects only needed SDKs and converges',t=>{
  const expected={local:[],s3:['@aws-sdk/client-s3'], 'aliyun-oss':['ali-oss'],'tencent-cos':['cos-nodejs-sdk-v5']};
  for(const [provider,names] of Object.entries(expected)){
    const f=fixture(t),config=selection(provider),plan=createArchitecturePlan({...f,config});assert.deepEqual(plan.conflicts,[]);applyPlan(plan,{runRoot:f.runRoot});
    const pkg=JSON.parse(fs.readFileSync(path.join(f.target,'packages/storage/package.json')));const deps=Object.keys(pkg.dependencies||{});
    for(const name of Object.values(expected).flat())assert.equal(deps.includes(name),names.includes(name),name);
    assert.ok(pkg.exports['./client']);assert.match(fs.readFileSync(path.join(f.target,'pnpm-workspace.yaml'),'utf8'),/packages\/storage/);
    assert.equal(createArchitecturePlan({...f,config}).changes.length,0);
    fs.appendFileSync(path.join(f.target,'packages/storage/src/index.ts'),'\n// project extension\n');
    assert.equal(createArchitecturePlan({...f,config}).conflicts.length,0);
  }
});
test('TC-STORAGE-001 rejects secret config, browser consumer, duplicate store and unknown defaults',t=>{
  const f=fixture(t);for(const mutate of [c=>c.fileStorage.stores[0].accessKey='secret',c=>c.fileStorage.defaultStore='missing',c=>c.fileStorage.stores.push({...c.fileStorage.stores[0]}),c=>c.fileStorage.path='apps/api/storage',c=>c.fileStorage.consumers=['web']]){const c=selection();mutate(c);assert.throws(()=>validateConfig(c,f));}
  const c=selection();delete c.fileStorage;assert.equal(createArchitecturePlan({...f,config:c}).entries.some(e=>e.path.startsWith('packages/storage/')),false);
});
test('TC-STORAGE-001 Go storage uses native module and no Node dependencies',t=>{
  const f=fixture(t),config=selection('aliyun-oss','go');const p=createArchitecturePlan({...f,config});assert.deepEqual(p.conflicts,[]);applyPlan(p,{runRoot:f.runRoot});
  assert.match(fs.readFileSync(path.join(f.target,'packages/storage/go.mod'),'utf8'),/alibabacloud-oss-go-sdk-v2/);
  assert.equal(fs.existsSync(path.join(f.target,'packages/storage/package.json')),false);
  assert.match(fs.readFileSync(path.join(f.target,'apps/api/go.mod'),'utf8'),/replace xirang.local\/storage/);
  assert.equal(createArchitecturePlan({...f,config}).changes.length,0);
});
test('TC-STORAGE-001 rejects explicit malformed optional storage values',t=>{
  const f=fixture(t);
  for(const [key,values] of Object.entries({path:[null,false,''],runtime:[null,false,''],metadata:[null,false,[],{}],uploadApplications:[null,false,'']}))for(const value of values){
    const c=selection();c.fileStorage[key]=value;assert.throws(()=>validateConfig(c,f),key+': '+JSON.stringify(value));
  }
});
test('TC-STORAGE-008 template sync cannot silently adopt newly selected storage',t=>{
 const f=fixture(t),config=selection(),storage=config.fileStorage;delete config.fileStorage;applyPlan(createArchitecturePlan({...f,config}),{runRoot:f.runRoot});
 config.fileStorage=storage;fs.writeFileSync(path.join(f.target,'architecture.config.json'),JSON.stringify(config));
 assert.throws(()=>require('../../tooling/xirang/template').createTemplatePlan({source,target:f.target}),/New architecture choices/);
});

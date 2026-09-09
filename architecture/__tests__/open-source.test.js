const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {expandBlueprint,validateConfig,createArchitecturePlan}=require('../scripts/project');
const {applyPlan}=require('../../tooling/xirang/engine');
const source=path.resolve(__dirname,'../..');
const ids=['auth','auth-client','authorization','jobs','i18n','logging','telemetry','api-mocks'];
test('TC-OSSKIT-001 catalog covers selected capabilities with versions and honest alternative status',()=>{
 const catalog=require('../open-source-catalog.json');for(const id of ids)assert.ok(catalog.implemented.some(m=>m.selection.includes(id)),id);
 for(const item of catalog.implemented){assert.equal(item.status,'implemented');assert.ok(item.sources.every(s=>s.startsWith('https://')));for(const p of item.packages)assert.ok(typeof p.version==='string',p.name);}
 for(const item of catalog.alternatives)assert.notEqual(item.status,'implemented');
 assert.doesNotThrow(()=>validateConfig(JSON.parse(fs.readFileSync(path.join(source,'architecture/examples/open-source-monorepo.json'))),{source}));
});
function selection(){const c=expandBlueprint('admin-api',{source,database:'sqlite'});c.modules.push(...ids.map(id=>({id,path:'packages/'+id,...(['auth','authorization'].includes(id)?{options:{datastore:'main'}}:id==='jobs'?{options:{provider:'bullmq',backend:'redis'}}:{})})));c.applications.find(a=>a.id==='api').modules.push('auth','authorization','jobs','logging','telemetry');c.applications.find(a=>a.components).modules.push('auth-client','i18n','api-mocks');return c;}
test('TC-OSSKIT-001/002/003/008 all recommended server modules generate, preserve policy and converge',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'xirang-kit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const target=path.join(root,'repo');fs.mkdirSync(target);const f={source,target,config:selection(),includeRuntime:false},p=createArchitecturePlan(f);assert.deepEqual(p.conflicts,[]);applyPlan(p,{runRoot:path.join(root,'runs')});
 for(const id of ids){const pkg=JSON.parse(fs.readFileSync(path.join(target,'packages',id,'package.json')));assert.ok(pkg.exports['.']);assert.ok(fs.existsSync(path.join(target,'packages',id,'src/index.ts')));}
 const database=f.config.datastores[0].path;assert.ok(fs.existsSync(path.join(target,database,'prisma/auth.prisma')));assert.match(fs.readFileSync(path.join(target,database,'prisma.config.ts'),'utf8'),/schema:'prisma'/);
 assert.equal(createArchitecturePlan(f).changes.length,0);
 fs.appendFileSync(path.join(target,'packages/authorization/src/policy.ts'),'\n// custom policy\n');assert.equal(createArchitecturePlan(f).changes.length,0);
});
test('TC-OSSKIT-001/003 strict choices reject browser server imports and incompatible storage backend',()=>{
 const c=selection();c.applications.find(a=>a.components).modules.push('auth');assert.throws(()=>validateConfig(c,{source}),/server/i);
 const d=selection();d.modules.find(m=>m.id==='jobs').options={provider:'pg-boss',backend:'sqlite'};assert.throws(()=>validateConfig(d,{source}),/backend/i);
 const e=selection();e.modules.find(m=>m.id==='auth').options.secret='bad';assert.throws(()=>validateConfig(e,{source}),/options/i);
});
test('TC-OSSKIT-008 scoped adoption updates the consumer and Prisma schema closure',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'xirang-auth-scope-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const target=path.join(root,'repo');fs.mkdirSync(target);
 const config={schemaVersion:2,workspace:{packageManager:'pnpm@10.18.3'},applications:[{id:'api',path:'apps/api',stack:'node-ts'},{id:'other',path:'apps/other',stack:'node-ts'}],datastores:[{id:'main',path:'packages/database',engine:'sqlite',access:'prisma',consumers:['api']}],modules:[]};
 const f={source,target,config,includeRuntime:false},runRoot=path.join(root,'runs');applyPlan(createArchitecturePlan(f),{runRoot});
 config.modules.push({id:'auth',path:'packages/auth',options:{datastore:'main'}});config.applications[0].modules=['auth'];fs.writeFileSync(path.join(target,'architecture.config.json'),JSON.stringify(config));
 const p=createArchitecturePlan({...f,scope:'architecture:module:auth'});assert.deepEqual(p.conflicts,[]);assert.equal(p.entries.some(e=>e.path.startsWith('apps/other/')),false);applyPlan(p,{runRoot});
 assert.equal(JSON.parse(fs.readFileSync(path.join(target,'apps/api/package.json'))).dependencies['@project/auth'],'workspace:*');
 assert.match(fs.readFileSync(path.join(target,'packages/database/prisma.config.ts'),'utf8'),/schema:'prisma'/);
 assert.equal(createArchitecturePlan({...f,scope:'architecture:module:auth'}).changes.length,0);
});

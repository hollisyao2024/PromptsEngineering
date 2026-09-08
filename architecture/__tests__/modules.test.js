const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { hash, applyPlan } = require('../../tooling/xirang/engine');
const { createArchitecturePlan } = require('../scripts/project');
const source = path.resolve(__dirname,'../..');
function fixture(t) { const root=fs.mkdtempSync(path.join(os.tmpdir(),'xirang-modules-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root; }
const moduleImport = p => import(pathToFileURL(path.join(source,'architecture/modules',p)).href);
test('TC-ARCHPLAT-008 structured events redact nested secrets and identifiers before the sink', async () => {
  const {createLogger,redact}=await moduleImport('observability/index.mjs');const events=[];
  const logger=createLogger({sink:e=>events.push(e),context:{app:'test',token:'secret'},sampleRate:1});
  logger.emit('request.failed',{password:'secret',nested:{email:'user@example.org'},text:'Bearer abc user@example.org'},'error');
  const output=JSON.stringify(events);assert.ok(!output.includes('secret'));assert.ok(!output.includes('user@example.org'));assert.ok(!output.includes('Bearer abc'));assert.equal(events[0].context.app,'test');
  const cyclic={};cyclic.self=cyclic;assert.equal(redact(cyclic).self,'[CIRCULAR]');
  assert.throws(()=>createLogger({sampleRate:2}),/sampleRate/);
});
test('TC-ARCHPLAT-008 contract generator rejects unsupported schema and detects changed source', async t => {
  const {generate}=await moduleImport('contracts/generate.mjs');
  assert.throws(()=>generate({title:'X',type:'object',additionalProperties:false,properties:{x:{type:'string',pattern:'.*'}},required:[]}),/Unsupported/);
  const root=fixture(t);fs.cpSync(path.join(source,'architecture/modules/contracts'),root,{recursive:true});
  const invoke=()=>spawnSync(process.execPath,['generate.mjs','--check'],{cwd:root,encoding:'utf8'});
  assert.equal(invoke().status,0);fs.appendFileSync(path.join(root,'generated.ts'),'// edited\n');assert.equal(invoke().status,1);
});
test('TC-ARCHPLAT-008 assets enforce checksum, target and real paths', async t => {
  const {verifyAssets}=await moduleImport('runtime-assets/verify.mjs'),root=fixture(t);fs.writeFileSync(path.join(root,'asset.bin'),'verified');
  const entries=[{id:'engine',target:'mac-arm64',path:'asset.bin',sha256:hash('verified')}];assert.equal(verifyAssets(root,entries,'mac-arm64'),1);
  assert.throws(()=>verifyAssets(root,entries,'win-x64'),/No verified/);
  fs.writeFileSync(path.join(root,'asset.bin'),'changed');assert.throws(()=>verifyAssets(root,entries),/checksum/);
  entries[0].path='../escape';assert.throws(()=>verifyAssets(root,entries),/path/);
});
test('TC-ARCHPLAT-008 plugin permissions and signature claims fail closed', async t => {
  const {verifyPlugin}=await moduleImport('plugins/verify.mjs'),root=fixture(t);fs.writeFileSync(path.join(root,'plugin.mjs'),'export {};');
  const manifest={id:'plugin-test',version:'1.0.0',entry:'plugin.mjs',targets:['web'],permissions:[],signatureVerified:false};
  assert.equal(verifyPlugin(root,manifest).signatureVerified,false);
  assert.throws(()=>verifyPlugin(root,{...manifest,permissions:['filesystem']}),/permission/);
  assert.throws(()=>verifyPlugin(root,{...manifest,signatureVerified:true}),/signature/);
  assert.throws(()=>verifyPlugin(root,manifest,{target:'mac-arm64'}),/target/);
});
test('TC-ARCHPLAT-008 SQLite preflight is read-only, apply is idempotent and altered migrations fail', t => {
  const root=fixture(t),target=path.join(root,'repo');fs.mkdirSync(target);
  const config={schemaVersion:1,applications:[{id:'api',stack:'node',path:'apps/api'}],datastores:[{id:'local',engine:'sqlite',path:'db/local',consumers:['api']}],modules:[]};
  applyPlan(createArchitecturePlan({source,target,config,includeRuntime:false}),{runRoot:path.join(root,'runs')});
  const db=path.join(root,'data.sqlite'),cwd=path.join(target,'db/local');
  const run=args=>spawnSync(process.execPath,['migrate.mjs',...args],{cwd,encoding:'utf8',env:{...process.env,SQLITE_PATH:db}});
  assert.equal(run([]).status,0);assert.equal(fs.existsSync(db),false);
  assert.equal(run(['--apply']).status,0);assert.equal(run(['--apply']).status,0);
  const {DatabaseSync}=require('node:sqlite'),opened=new DatabaseSync(db);try{assert.throws(()=>opened.exec("INSERT INTO app_metadata(key,value) VALUES(NULL,'invalid')"),/NOT NULL/);}finally{opened.close();}
  fs.appendFileSync(path.join(cwd,'migrations/0001_initial.sql'),'SELECT 1;');
  const failed=run(['--apply']);assert.equal(failed.status,1);assert.match(failed.stderr,/checksum/);
});
test('TC-ARCHPLAT-008 SQLite transaction rolls back a failed migration batch', t => {
  const root=fixture(t),template=fs.readFileSync(path.join(source,'architecture/modules/migrations/migrate.mjs.tpl'),'utf8').replace('{{engine}}','sqlite');
  fs.mkdirSync(path.join(root,'migrations'));fs.writeFileSync(path.join(root,'migrate.mjs'),template);
  const sql='CREATE TABLE should_rollback (id INTEGER);\nINVALID SQL;';fs.writeFileSync(path.join(root,'migrations/0001_broken.sql'),sql);
  fs.writeFileSync(path.join(root,'migrations.json'),JSON.stringify([{id:'0001_broken',file:'0001_broken.sql',checksum:hash(sql),transactional:true}]));
  const db=path.join(root,'test.sqlite');const failed=spawnSync(process.execPath,['migrate.mjs','--apply'],{cwd:root,encoding:'utf8',env:{...process.env,SQLITE_PATH:db}});assert.equal(failed.status,1);
  const {DatabaseSync}=require('node:sqlite'),database=new DatabaseSync(db);try{assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name='should_rollback'").get(),undefined);}finally{database.close();}
});
test('TC-ARCHPLAT-008 private scans reject empty output, absent policy and forbidden domains', t => {
  const root=fixture(t),artifact=path.join(root,'dist');fs.mkdirSync(artifact);
  fs.copyFileSync(path.join(source,'architecture/profiles/private/scan.mjs'),path.join(root,'scan.mjs'));
  fs.writeFileSync(path.join(root,'profile.json'),JSON.stringify({denyPatterns:['forbidden.example']}));
  const run=()=>spawnSync(process.execPath,['scan.mjs',artifact],{cwd:root,encoding:'utf8'});
  assert.equal(run().status,1);fs.writeFileSync(path.join(artifact,'app.js'),'fetch("https://forbidden.example")');assert.equal(run().status,1);
  fs.writeFileSync(path.join(artifact,'app.js'),'safe');assert.equal(run().status,0);
  fs.writeFileSync(path.join(root,'profile.json'),JSON.stringify({denyPatterns:[]}));assert.equal(run().status,1);
});

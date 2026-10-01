const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const project=require('../scripts/project'),{applyPlan}=require('../../tooling/xirang/engine');
const source=path.resolve(__dirname,'../..');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'xirang-drizzle-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const target=path.join(root,'repo');fs.mkdirSync(target);return {target,runRoot:path.join(root,'runs')};}
const read=(f,p)=>fs.readFileSync(path.join(f.target,p),'utf8');
const plan=(f,config)=>project.createArchitecturePlan({source,target:f.target,config,includeRuntime:false});
test('TC-DRIZZLE-001 stable ORM/database combinations generate and converge',t=>{
 for(const access of ['prisma','drizzle'])for(const engine of ['postgres','mysql','mariadb','sqlite','sqlserver','cockroachdb']){
  const f=fixture(t);
  if(access==='drizzle'&&['sqlserver','cockroachdb'].includes(engine)){assert.throws(()=>project.expandBlueprint('admin-api',{source,database:engine,orm:access}),/pre-release|RC/);continue;}
  const config=project.expandBlueprint('admin-api',{source,database:engine,orm:access});assert.equal(config.datastores[0].access,access);
  config.applications=config.applications.filter(a=>a.stack==='node-ts').map(({modules,...a})=>a);config.modules=[];delete config.example;
  const p=plan(f,config);assert.deepEqual(p.conflicts,[]);applyPlan(p,{runRoot:f.runRoot});
  const pkg=JSON.parse(read(f,'packages/database/main/package.json'));assert.ok(pkg.dependencies[access==='prisma'?'@prisma/client':'drizzle-orm']);
  assert.equal(project.derivePaths(config).migrationsDir,'packages/database/main/'+(access==='prisma'?'prisma/migrations':'drizzle'));
  const again=plan(f,config);assert.equal(again.changes.length,0,JSON.stringify(again.changes.map(x=>x.path)));
 }
});
test('TC-DRIZZLE-004 Drizzle schema stays project-owned and engine/access changes are rejected',t=>{
 const f=fixture(t),c=project.expandBlueprint('admin-api',{source,database:'sqlite',orm:'drizzle'});applyPlan(plan(f,c),{runRoot:f.runRoot});
 const file=path.join(f.target,'packages/database/main/src/schema/tasks.ts');fs.appendFileSync(file,'\n// project extension\n');assert.equal(plan(f,c).changes.length,0);
 const changed=JSON.parse(read(f,'architecture.config.json'));changed.datastores[0].access='prisma';fs.writeFileSync(path.join(f.target,'architecture.config.json'),JSON.stringify(changed));assert.throws(()=>plan(f,changed),/explicit project migration/);
});
test('TC-DRIZZLE-003 optional modules select matching Drizzle adapters',t=>{
 const f=fixture(t),c=project.expandBlueprint('admin-api',{source,database:'sqlite',orm:'drizzle'});
 for(const id of ['auth','authorization'])c.modules.push({id,path:'packages/'+id,options:{datastore:'main'}});
 c.fileStorage={runtime:'node',path:'packages/storage',consumers:['api'],defaultStore:'local',stores:[{id:'local',provider:'local',envPrefix:'FILES'}],metadata:{datastore:'main'}};
 const p=plan(f,c);assert.deepEqual(p.conflicts,[]);applyPlan(p,{runRoot:f.runRoot});
 assert.match(read(f,'packages/auth/src/index.ts'),/drizzleAdapter/);assert.match(read(f,'packages/authorization/src/index.ts'),/drizzle/);
 assert.ok(fs.existsSync(path.join(f.target,'packages/database/main/src/schema/auth.ts')));
 assert.match(read(f,'apps/api/src/file-storage.ts'),/createDrizzleFileRepository/);
 assert.match(read(f,'apps/api/src/server.ts'),/type Database/);assert.doesNotMatch(read(f,'apps/api/src/server.ts'),/PrismaClient/);
});
test('TC-DRIZZLE-002 journal integrity and applied SQL hash/order checks fail closed',async t=>{
 const {pathToFileURL}=require('node:url');const {diskMigrations,verifyHistory}=await import(pathToFileURL(path.join(source,'architecture/stacks/data-access/drizzle/migration-history.mjs')));
 const f=fixture(t),root=path.join(f.target,'drizzle');fs.mkdirSync(path.join(root,'meta'),{recursive:true});
 fs.writeFileSync(path.join(root,'0000_init.sql'),'SELECT 1;');fs.writeFileSync(path.join(root,'meta/_journal.json'),JSON.stringify({version:'7',dialect:'sqlite',entries:[{idx:0,version:'6',when:1,tag:'0000_init',breakpoints:true}]}));
 fs.writeFileSync(path.join(root,'meta/0000_snapshot.json'),JSON.stringify({dialect:'sqlite',id:'fixture',prevId:'00000000-0000-0000-0000-000000000000'}));
 assert.throws(()=>diskMigrations(root,'mysql'),/dialect/);
 const d=diskMigrations(root);assert.deepEqual(verifyHistory(d,[{id:1,hash:d[0].checksum,created_at:1}]).pending,[]);
 assert.throws(()=>verifyHistory(d,[{id:1,hash:'changed',created_at:1}]),/checksum/);
 assert.throws(()=>verifyHistory(d,[{id:1,hash:d[0].checksum,created_at:2}]),/history|timestamp/);
 fs.writeFileSync(path.join(root,'meta/0000_snapshot.json'),JSON.stringify({dialect:'sqlite',id:'fixture',prevId:'broken'}));assert.throws(()=>diskMigrations(root),/snapshot/);
 fs.writeFileSync(path.join(root,'meta/0000_snapshot.json'),JSON.stringify({dialect:'sqlite',id:'fixture',prevId:'00000000-0000-0000-0000-000000000000'}));
 fs.writeFileSync(path.join(root,'meta/0001_snapshot.json'),'{}');assert.throws(()=>diskMigrations(root),/Unregistered migration snapshot/);fs.unlinkSync(path.join(root,'meta/0001_snapshot.json'));
 fs.writeFileSync(path.join(root,'0001_orphan.sql'),'SELECT 2;');assert.throws(()=>diskMigrations(root),/journal|unregistered/);
});

test('TC-DRIZZLE-001 explicit configurations reject unsupported combinations before writes',()=>{
 const config={schemaVersion:1,applications:[{id:'api',stack:'node',path:'apps/api'}],datastores:[{id:'main',engine:'mysql',path:'db/main',consumers:['api']}]};
 assert.throws(()=>project.validateConfig(config,{source}),/explicit ORM/);
 config.datastores[0].access='drizzle';assert.throws(()=>project.validateConfig(config,{source}),/unknown datastore field: access/);
});

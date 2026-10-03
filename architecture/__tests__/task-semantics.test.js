const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const project=require('../scripts/project'),{applyPlan}=require('../../tooling/xirang/engine');
const {parseMigrationSql,AUDIT_COLUMNS}=require('../../infra/scripts/tdd-tools/schema-governance');
const source=path.resolve(__dirname,'../..'),store='packages/database/main',init=store+'/prisma/migrations/20260909000000_init/migration.sql';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'xirang-task-semantics-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const target=path.join(root,'repo');fs.mkdirSync(target);return {target,runRoot:path.join(root,'runs')};}
const read=(f,p)=>fs.readFileSync(path.join(f.target,p),'utf8');
const put=(f,p,v)=>{fs.mkdirSync(path.dirname(path.join(f.target,p)),{recursive:true});fs.writeFileSync(path.join(f.target,p),v);};
const plan=(f,config)=>project.createArchitecturePlan({source,target:f.target,config,includeRuntime:false});
const blueprint=(engine,orm)=>project.expandBlueprint('admin-api',{source,database:engine,orm});
const legacy=engine=>fs.readFileSync(path.join(source,'architecture/stacks/data-access/task-model/legacy/'+(engine==='sqlite'?'sqlite':engine==='postgres'?'postgres':'mysql')+'.sql'),'utf8');

test('TC-DATA-004 fresh Prisma stores generate the semantic task model for every database',t=>{
 for(const engine of ['postgres','mysql','mariadb','sqlite']){
  const f=fixture(t),config=blueprint(engine,'prisma'),p=plan(f,config);assert.deepEqual(p.conflicts,[],engine);applyPlan(p,{runRoot:f.runRoot});
  const schema=read(f,store+'/prisma/schema.prisma');
  assert.match(schema,/@@map\("task"\)/);assert.match(schema,/deletedAt DateTime\? @map\("deleted_at"\)/);assert.doesNotMatch(schema,/\{\{/);
  const parsed=parseMigrationSql(read(f,init)),table=parsed.tables.find(x=>x.name==='task');assert.ok(table,engine);
  const columns=table.columns.map(c=>c.name);for(const audit of AUDIT_COLUMNS)assert.ok(columns.includes(audit),engine+':'+audit);
  assert.ok(columns.every(c=>/^[a-z][a-z0-9_]*$/.test(c)));
  assert.ok(table.checks.length||table.columns.find(c=>c.name==='status').hasCheck,engine+': status CHECK');
  if(engine!=='sqlite')for(const column of table.columns)assert.ok(column.comment||parsed.comments.columns.get('task.'+column.name),engine+': comment '+column.name);
  const service=read(f,'apps/api/src/tasks.ts');assert.match(service,/deletedAt:new Date\(\)/);assert.doesNotMatch(service,/deleteMany/);
  assert.equal(plan(f,config).changes.length,0,engine+' converges');
 }
});

test('TC-DATA-004 fresh Drizzle stores generate the semantic schema and soft-delete service',t=>{
 for(const engine of ['postgres','mysql','sqlite']){
  const f=fixture(t),config=blueprint(engine,'drizzle'),p=plan(f,config);assert.deepEqual(p.conflicts,[],engine);applyPlan(p,{runRoot:f.runRoot});
  const schema=read(f,store+'/src/schema/tasks.ts');
  assert.match(schema,/Table\('task',/);for(const audit of AUDIT_COLUMNS)assert.match(schema,new RegExp(`'${audit}'`));
  assert.match(schema,/check\('task_status_check'/);
  if(engine==='mysql')assert.doesNotMatch(schema,/isNull/);else assert.match(schema,/\.where\(isNull\(t\.deletedAt\)\)/);
  const service=read(f,'apps/api/src/tasks.ts');assert.match(service,/isNull\(tasks\.deletedAt\)/);assert.doesNotMatch(service,/tx\.delete\(/);
 }
});

test('TC-DATA-004 installed stores keep the original Task example bytes and do not conflict',t=>{
 for(const engine of ['postgres','mysql','sqlite']){
  const f=fixture(t),config=blueprint(engine,'prisma');
  put(f,init,legacy(engine));
  const p=plan(f,config);assert.deepEqual(p.conflicts,[],engine);applyPlan(p,{runRoot:f.runRoot});
  assert.equal(read(f,init),legacy(engine));
  assert.match(read(f,store+'/prisma/schema.prisma'),/model Task \{\n  id        String   @id/);assert.doesNotMatch(read(f,store+'/prisma/schema.prisma'),/@@map\("task"\)/);
  assert.match(read(f,'apps/api/src/tasks.ts'),/deleteMany/);
  assert.equal(plan(f,config).changes.length,0);
 }
 const f=fixture(t),config=blueprint('sqlite','drizzle');
 put(f,store+'/src/schema/tasks.ts',"export const tasks=sqliteTable('Task',{});\n");
 applyPlan(plan(f,config),{runRoot:f.runRoot});
 assert.match(read(f,'apps/api/src/tasks.ts'),/tx\.delete\(/);
});

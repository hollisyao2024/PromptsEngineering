const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const project=require('../scripts/project'),database=require('../scripts/database'),mm=require('../scripts/module-models'),{applyPlan}=require('../../tooling/xirang/engine');
const gate=require('../../infra/scripts/tdd-tools/schema-governance');
const source=path.resolve(__dirname,'../..');
const src=p=>fs.readFileSync(path.join(source,p),'utf8');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'xirang-semantics-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const target=path.join(root,'repo');fs.mkdirSync(target);return {root,target,runRoot:path.join(root,'runs')};}
const read=(f,p)=>fs.readFileSync(path.join(f.target,p),'utf8');
const write=(f,p,text)=>{fs.mkdirSync(path.dirname(path.join(f.target,p)),{recursive:true});fs.writeFileSync(path.join(f.target,p),text);};
const plan=(f,config)=>project.createArchitecturePlan({source,target:f.target,config,includeRuntime:false});
function selection(engine,orm){
 const c=project.expandBlueprint('admin-api',{source,database:engine,orm});
 c.applications=c.applications.filter(a=>a.stack==='node-ts').map(({modules,...a})=>a);c.modules=[{id:'auth',path:'packages/auth',options:{datastore:'main'}}];delete c.example;
 c.fileStorage={runtime:'node',path:'packages/storage',consumers:['api'],defaultStore:'local',stores:[{id:'local',provider:'local',envPrefix:'FILES'}],metadata:{datastore:'main'}};
 return c;
}
const dictionary=kinds=>kinds.flatMap(k=>mm.tables(k)).map(m=>`## \`${m.table}\`\n\n| 字段 | 类型 | 说明 |\n| --- | --- | --- |\n${m.fields.map(f=>`| ${f.column} | ${f.type} | ${f.comment} |`).join('\n')}${m.live?`\n| ${mm.snake(m.live+'Active')} | string | 未删除时的唯一值 |`:''}\n`).join('\n');
function evaluate(access,engine,sql,kinds,extra={}){
 const store={id:'main',path:'packages/database/main',access,engine};
 const migration=store.path+(access==='prisma'?'/prisma/migrations/1_init/migration.sql':'/drizzle/0000_init.sql'),schema=store.path+(access==='prisma'?'/prisma/schema.prisma':'/src/schema/auth.ts');
 const files={[migration]:sql,'docs/data/dictionary.md':dictionary(kinds),...extra};
 return gate.evaluateSchemaGate({stores:[store],gateConfig:gate.resolveGateConfig({tdd:{schemaGate:{semantic:'required'}}}),changes:[{status:'A',file:migration},{status:'M',file:schema}],readFile:f=>files[f]??null,fileDiff:()=>'+model Changed {}'});
}
const comments=()=>import(path.join(source,'architecture/stacks/data-access/drizzle/migration-comments.mjs'));

test('semantic Prisma module SQL passes the required gate on every engine',()=>{
 for(const engine of ['postgres','mysql','mariadb','sqlite'])for(const kind of ['auth','files'])for(const partial of [true,false]){
  const sql=mm.moduleSQL(kind,engine,{partial}),r=evaluate('prisma',engine,sql,[kind]);
  assert.deepEqual(r.errors,[],`${engine}/${kind}/${partial}`);assert.deepEqual(r.warnings,[]);
  for(const m of mm.tables(kind)){assert.match(m.table,/^[a-z][a-z0-9_]*$/);for(const field of ['created_at','updated_at','created_by','updated_by'])assert.ok(m.fields.some(f=>f.column===field),m.table+'.'+field);assert.equal(m.fields.some(f=>f.column==='deleted_at'),!!m.soft,m.table);}
 }
 assert.match(mm.moduleSQL('auth','postgres'),/CREATE UNIQUE INDEX "user_email_key" ON "user"\("email"\) WHERE \("deleted_at" IS NULL\);/);
 assert.doesNotMatch(mm.moduleSQL('auth','postgres',{partial:false}),/WHERE/);
 assert.match(mm.moduleSQL('auth','mysql'),/`email_active` VARCHAR\(191\) GENERATED ALWAYS AS \(IF\(`deleted_at` IS NULL, `email`, NULL\)\) STORED/);
 for(const table of ['session','account','verification','auth_audit_log'])assert.match(mm.moduleSQL('auth','sqlite'),new RegExp('-- xirang:hard-delete '+table+' '));
 assert.doesNotMatch(mm.moduleSQL('auth','sqlite'),/xirang:hard-delete (user|organization|member|invitation) /);
});

test('Drizzle migrations receive schema comments and hard-delete markers idempotently',async()=>{
 const {collectComments,annotateMigration}=await comments();
 const schema=mm.drizzleModuleSchema('auth','postgres');const tables=collectComments([schema]);
 assert.equal(tables.get('session').hardDelete.startsWith('会话到期'),true);assert.equal(tables.get('user').hardDelete,'');assert.equal(tables.get('user').columns.get('email'),'登录邮箱，未删除用户内唯一');
 const pg='CREATE TABLE "user" (\n\t"id" text PRIMARY KEY NOT NULL,\n\t"email" text NOT NULL\n);\n--> statement-breakpoint\nCREATE TABLE "session" (\n\t"id" text PRIMARY KEY NOT NULL\n);\n--> statement-breakpoint\nALTER TABLE "account" ADD COLUMN "scope" text;';
 const out=annotateMigration(pg,'postgresql',tables);
 assert.match(out,/^-- xirang:hard-delete session /);assert.doesNotMatch(out,/hard-delete user /);
 assert.match(out,/COMMENT ON TABLE "user" IS '用户：登录主体，删除为软删除';/);assert.match(out,/COMMENT ON COLUMN "user"."email" IS/);
 assert.doesNotMatch(out,/COMMENT ON COLUMN "user"."name"/,'only columns created in this migration');assert.match(out,/COMMENT ON COLUMN "account"."scope" IS '授权范围';/);
 assert.equal(annotateMigration(out,'postgresql',tables),out);
 const my='CREATE TABLE `user` (\n\t`id` varchar(191) NOT NULL,\n\t`email` varchar(191) NOT NULL,\n\tCONSTRAINT `user_id` PRIMARY KEY(`id`)\n);\n--> statement-breakpoint\nALTER TABLE `account` ADD `scope` longtext;';
 const mine=annotateMigration(my,'mysql',collectComments([mm.drizzleModuleSchema('auth','mysql')]));
 assert.match(mine,/`email` varchar\(191\) NOT NULL COMMENT '登录邮箱，未删除用户内唯一',/);assert.match(mine,/\n\) COMMENT='用户：登录主体，删除为软删除';/);assert.match(mine,/ADD `scope` longtext COMMENT '授权范围';/);
 assert.equal(annotateMigration(mine,'mysql',collectComments([mm.drizzleModuleSchema('auth','mysql')])),mine);
 const lite=annotateMigration('CREATE TABLE `verification` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n','sqlite',collectComments([mm.drizzleModuleSchema('auth','sqlite')]));
 assert.match(lite,/^-- xirang:hard-delete verification /);assert.doesNotMatch(lite,/COMMENT/);
 const generated=mm.drizzleModuleSchema('files','postgres');assert.match(generated,/export const fileObject=pgTable\('file_object'/);
});

test('generated Drizzle migrations satisfy the gate only after annotation',async()=>{
 const {collectComments,annotateMigration}=await comments();
 // Minimal drizzle-kit shaped SQL derived from the module tables; the real drizzle-kit 0.31 run is recorded as task evidence.
 for(const [engine,dialect] of [['postgres','postgresql'],['mysql','mysql'],['sqlite','sqlite']]){
  const q=engine==='mysql'?n=>'`'+n+'`':n=>(engine==='sqlite'?'`'+n+'`':'"'+n+'"');
  const sql=['auth','files'].flatMap(k=>mm.tables(k)).map(m=>`CREATE TABLE ${q(m.table)} (\n${[...m.fields.map(f=>'\t'+q(f.column)+' text'),...(m.live&&engine==='mysql'?['\t'+q(mm.snake(m.live+'Active'))+' varchar(191)']:[])].join(',\n')}\n);`).join('\n--> statement-breakpoint\n')+'\n';
  assert.ok(evaluate('drizzle',engine,sql,['auth','files']).errors.length>0,engine+' raw');
  const tables=collectComments(['auth','files'].map(k=>mm.drizzleModuleSchema(k,engine)));
  const r=evaluate('drizzle',engine,annotateMigration(sql,dialect,tables),['auth','files']);assert.deepEqual(r.errors,[],engine);
 }
});

test('fresh installs choose semantic modules and respect Prisma partial-index support',t=>{
 assert.deepEqual(database.moduleGeneration(null,{path:'x',access:'prisma'},'auth'),{generation:'semantic',partial:true});
 const f=fixture(t),store={path:'packages/database/main',access:'prisma'};
 assert.deepEqual(database.moduleGeneration(f.target,store,'auth'),{generation:'semantic',partial:true});
 write(f,store.path+'/prisma/schema.prisma','generator client {\n  provider = "prisma-client"\n}\n');
 assert.deepEqual(database.moduleGeneration(f.target,store,'files'),{generation:'semantic',partial:false});
 write(f,store.path+'/prisma/auth.prisma',mm.prismaSchema('auth','postgres',{partial:false}));assert.deepEqual(database.moduleGeneration(f.target,store,'auth'),{generation:'semantic',partial:false});
 write(f,store.path+'/prisma/auth.prisma',src('architecture/modules/open-source/auth-schema/auth.prisma'));assert.deepEqual(database.moduleGeneration(f.target,store,'auth'),{generation:'legacy'});
 assert.match(src('architecture/stacks/data-access/prisma/prisma/schema.prisma.tpl'),/previewFeatures = \["partialIndexes"\]/);
 for(const access of ['prisma','drizzle']){
  const g=fixture(t),config=selection('postgres',access),p=plan(g,config);assert.deepEqual(p.conflicts,[]);applyPlan(p,{runRoot:g.runRoot});
  const index=read(g,'packages/auth/src/index.ts');assert.match(index,/softDeleteAdapter\((prisma|drizzle)Adapter/);assert.match(index,/organization\(\),bearer\(\),xirangAudit\(\)/);
  assert.ok(fs.existsSync(path.join(g.target,'packages/auth/src/audit.ts')));
  assert.match(read(g,'packages/storage/src/'+access+'-repository.ts'),/deletedAt/);
  if(access==='prisma'){assert.match(read(g,'packages/database/main/prisma/auth.prisma'),/@@map\("auth_audit_log"\)/);assert.match(read(g,'packages/database/main/prisma/migrations/20260909020000_auth/migration.sql'),/WHERE \("deleted_at" IS NULL\)/);}
  else{assert.match(read(g,'packages/database/main/src/schema/auth.ts'),/@hard-delete/);assert.ok(fs.existsSync(path.join(g.target,'packages/database/main/migration-comments.mjs')));}
  assert.equal(plan(g,config).changes.length,0);
 }
});

test('installed legacy modules keep original bytes, stay exempt and converge',t=>{
 for(const access of ['prisma','drizzle']){
  const f=fixture(t),config=selection('postgres',access),db='packages/database/main';
  if(access==='prisma'){
   write(f,db+'/prisma/migrations/20260909020000_auth/migration.sql',database.prismaModuleSQL('postgres','auth',src));
   write(f,db+'/prisma/migrations/20260909010000_file_storage/migration.sql',database.prismaModuleSQL('postgres','files',src));
  }else{
   write(f,db+'/src/schema/auth.ts',database.drizzleSchema('postgres','auth'));write(f,db+'/src/schema/file-storage.ts',database.drizzleSchema('postgres','files'));
  }
  const p=plan(f,config);assert.deepEqual(p.conflicts,[]);applyPlan(p,{runRoot:f.runRoot});
  const index=read(f,'packages/auth/src/index.ts');assert.doesNotMatch(index,/softDeleteAdapter|xirangAudit/);assert.equal(fs.existsSync(path.join(f.target,'packages/auth/src/audit.ts')),false);
  assert.equal(read(f,'packages/storage/src/'+access+'-repository.ts'),src('architecture/modules/storage/node/legacy/'+access+'-repository.ts').replaceAll('{{datastore}}','main'));
  if(access==='prisma'){
   assert.equal(index,src('architecture/modules/open-source/auth-legacy/prisma.ts').replaceAll('{{datastore}}','main').replaceAll('{{provider}}','postgresql'));
   assert.equal(read(f,db+'/prisma/auth.prisma'),src('architecture/modules/open-source/auth-schema/auth.prisma'));
   assert.equal(read(f,db+'/prisma/file-storage.prisma'),src('architecture/modules/storage/prisma/file-storage.prisma'));
  }
  const store={id:'main',path:db,access,engine:'postgres'};
  assert.ok(gate.legacyModuleTables(store,p=>{try{return read(f,p);}catch{return null;}}).includes('user'));
  assert.equal(plan(f,config).changes.length,0);
 }
});

test('audit adapter soft-deletes identities, hard-deletes credentials with secret-free audit rows',async t=>{
 const f=fixture(t),dir=path.join(f.root,'audit');fs.mkdirSync(path.join(dir,'node_modules/@better-auth/core'),{recursive:true});
 fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}\n');
 fs.writeFileSync(path.join(dir,'node_modules/@better-auth/core/package.json'),JSON.stringify({name:'@better-auth/core',type:'module',exports:{'./context':'./context.js'}}));
 fs.writeFileSync(path.join(dir,'node_modules/@better-auth/core/context.js'),'export async function tryGetCurrentAuthEndpointContext(){return globalThis.__ctx;}\n');
 fs.copyFileSync(path.join(source,'architecture/modules/open-source/auth/src/audit.ts'),path.join(dir,'audit.ts'));
 const {softDeleteAdapter,xirangAudit}=await import(path.join(dir,'audit.ts'));
 const rows={user:[{id:'u1',email:'a@x'}],session:[{id:'s1',userId:'u1',token:'secret-token'}],authAuditLog:[]},calls=[];
 const match=(row,where=[])=>where.every(w=>(row[w.field]??null)===w.value);
 const base={
  create:async({model,data})=>{(rows[model]||=[]).push(data);return data;},
  findOne:async({model,where})=>rows[model].find(r=>match(r,where))||null,
  findMany:async({model,where})=>rows[model].filter(r=>match(r,where)),
  count:async({model,where})=>rows[model].filter(r=>match(r,where)).length,
  update:async({model,where,update})=>{const r=rows[model].find(x=>match(x,where));if(r)Object.assign(r,update);return r||null;},
  updateMany:async({model,where,update})=>{const hit=rows[model].filter(x=>match(x,where));hit.forEach(r=>Object.assign(r,update));return hit.length;},
  delete:async({model,where})=>{calls.push(['delete',model]);rows[model]=rows[model].filter(r=>!match(r,where));},
  deleteMany:async({model,where})=>{const before=rows[model].length;rows[model]=rows[model].filter(r=>!match(r,where));return before-rows[model].length;},
  transaction:async cb=>cb(base)};
 const adapter=softDeleteAdapter(()=>base)({});
 globalThis.__ctx={context:{session:{user:{id:'admin'}}}};t.after(()=>{delete globalThis.__ctx;});
 const created=await adapter.create({model:'organization',data:{id:'o1',slug:'s',createdBy:'forged'}});assert.equal(created.createdBy,'admin');
 await adapter.delete({model:'user',where:[{field:'id',value:'u1'}]});
 assert.equal(rows.user.length,1);assert.equal(rows.user[0].deletedBy,'admin');assert.ok(rows.user[0].deletedAt instanceof Date);
 assert.equal(await adapter.findOne({model:'user',where:[{field:'id',value:'u1'}]}),null);assert.equal(await adapter.count({model:'user',where:[]}),0);
 delete globalThis.__ctx;
 await adapter.deleteMany({model:'session',where:[{field:'userId',value:'u1'}]});
 assert.equal(rows.session.length,0);assert.equal(rows.authAuditLog.length,1);
 assert.deepEqual(rows.authAuditLog[0],{action:'delete',targetModel:'session',targetId:'s1',userId:'u1',actor:'system',createdBy:'system',updatedBy:'system'});
 assert.doesNotMatch(JSON.stringify(rows.authAuditLog),/secret-token/);
 await adapter.transaction(async trx=>trx.delete({model:'organization',where:[{field:'id',value:'o1'}]}));assert.ok(rows.organization[0].deletedAt);
 const plugin=xirangAudit();assert.equal(plugin.id,'xirang-audit');assert.ok(plugin.schema.authAuditLog.fields.actor.required);assert.equal(plugin.schema.session.fields.deletedAt,undefined);assert.ok(plugin.schema.member.fields.updatedAt.onUpdate);
});

test('data dictionary documents every semantic module column',()=>{
 const index=gate.parseDictionary(src('docs/data/dictionary.md'));
 for(const m of ['auth','files'].flatMap(k=>mm.tables(k))){
  const documented=index.get(m.table);assert.ok(documented,m.table);
  for(const f of m.fields)assert.ok(documented.get(f.column),m.table+'.'+f.column);
 }
 assert.doesNotMatch(src('docs/data/dictionary.md'),/来源 `architecture\/modules\/open-source\/auth-schema\/auth\.prisma`/);
});

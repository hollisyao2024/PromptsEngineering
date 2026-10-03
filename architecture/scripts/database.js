const fs=require('node:fs'),path=require('node:path');
const {json}=require('../../tooling/xirang/engine');
const specs={postgres:{provider:'postgresql',dialect:'postgresql',adapter:'pg'},mysql:{provider:'mysql',dialect:'mysql',adapter:'mariadb'},mariadb:{provider:'mysql',dialect:'mysql',adapter:'mariadb'},sqlite:{provider:'sqlite',dialect:'sqlite',adapter:'better-sqlite3'}};
function databaseChoice(store,cat){
 const spec=specs[store.engine];if(!spec)throw Error('Unsupported database: '+store.engine);
 if(!store.access){if(!['postgres','sqlite'].includes(store.engine))throw Error('Database requires an explicit ORM access: '+store.engine);return spec;}
 if(!cat.dataAccess[store.access])throw Error('Unsupported datastore access: '+store.access);
 if(!cat.dataAccess[store.access].engines.includes(store.engine))throw Error(cat.dataAccess[store.access].blocked?.[store.engine]||'Unsupported ORM/database combination');
 return spec;
}
const authModels={
 user:{id:'id',name:'string',email:'unique',emailVerified:'boolean',image:'optional',createdAt:'date',updatedAt:'date'},
 session:{id:'id',expiresAt:'date',token:'unique',createdAt:'date',updatedAt:'date',ipAddress:'optional',userAgent:'optional',userId:'user',activeOrganizationId:'optional'},
 account:{id:'id',accountId:'string',providerId:'string',userId:'user',accessToken:'optionalLong',refreshToken:'optionalLong',idToken:'optionalLong',accessTokenExpiresAt:'optionalDate',refreshTokenExpiresAt:'optionalDate',scope:'optionalLong',password:'optionalLong',createdAt:'date',updatedAt:'date'},
 verification:{id:'id',identifier:'string',value:'long',expiresAt:'date',createdAt:'date',updatedAt:'date'},
 organization:{id:'id',name:'string',slug:'unique',logo:'optional',createdAt:'date',metadata:'optionalLong'},
 member:{id:'id',organizationId:'organization',userId:'user',role:'string',createdAt:'date'},
 invitation:{id:'id',organizationId:'organization',email:'string',role:'optional',status:'string',expiresAt:'date',createdAt:'date',inviterId:'user'}
};
function drizzleSchema(engine,kind,generation='legacy'){
 if(generation==='semantic'&&['auth','files'].includes(kind))return require('./module-models').drizzleModuleSchema(kind,engine);
 const dialect=specs[engine].dialect,isPg=dialect==='postgresql',isMy=dialect==='mysql';
 const core=isPg?'pg':isMy?'mysql':'sqlite',table=isPg?'pgTable':isMy?'mysqlTable':'sqliteTable';
 const models=kind==='auth'?authModels:kind==='files'?{fileObject:{id:'id',ownerId:'string',storeId:'string',objectKey:'key',state:'string',version:'int',record:'long',createdAt:'date',updatedAt:'date'}}:null;
 if(!models)return drizzleTaskSchema(engine);
 const imports=isPg?'pgTable,text,integer,boolean,timestamp,index,uniqueIndex':isMy?'mysqlTable,varchar,longtext,int,boolean,datetime,index,uniqueIndex':'sqliteTable,text,integer,index,uniqueIndex';
 let source=`import {${imports}} from 'drizzle-orm/${core}-core';\nimport {randomUUID} from 'node:crypto';\n// Project-owned schema. Generate and review an append-only migration after changes.\n`;
 for(const [name,fields] of Object.entries(models)){
  const columns=Object.entries(fields).map(([field,type])=>{
   let value;
   if(type==='date'||type==='optionalDate')value=isPg?`timestamp('${field}',{withTimezone:true,mode:'date'})`:isMy?`datetime('${field}',{mode:'date',fsp:3})`:`integer('${field}',{mode:'timestamp_ms'})`;
   else if(type==='int'||type==='version')value=`${isMy?'int':'integer'}('${field}')`;
   else if(type==='boolean')value=isPg||isMy?`boolean('${field}')`:`integer('${field}',{mode:'boolean'})`;
   else value=isMy?(type.includes('Long')||type==='long'?`longtext('${field}')`:`varchar('${field}',{length:${type==='key'?512:255}})`):`text('${field}')`;
   if(['id','uuid'].includes(type))value+='.primaryKey()';
   if(!type.startsWith('optional'))value+='.notNull()';
   if(type==='uuid')value+='.$defaultFn(()=>randomUUID())';if(type==='unique')value+='.unique()';if(type==='boolean')value+='.default(false)';if(type==='version')value+='.default(1)';if(type==='status')value+=".default('todo')";
   if(type==='date'&&field==='createdAt')value+='.$defaultFn(()=>new Date())';if(type==='date'&&field==='updatedAt')value+='.$defaultFn(()=>new Date()).$onUpdate(()=>new Date())';
   if(['user','organization'].includes(type))value+=`.references(()=>${type}.id,{onDelete:'cascade'})`;
   return `  ${field}:${value}`;
  });
  const extras=name==='fileObject'?"t=>[uniqueIndex('FileObject_store_key').on(t.storeId,t.objectKey),index('FileObject_owner_id').on(t.ownerId,t.id),index('FileObject_state_updated').on(t.state,t.updatedAt)]":null;
  source+=`export const ${name}=${table}('${name==='fileObject'?'FileObject':name}',{\n${columns.join(',\n')}\n}${extras?','+extras:''});\n`;
 }
 return source;
}
// Fresh stores get the semantic task example (ADR-034): snake_case columns behind camelCase keys, audit fields and soft delete.
function drizzleTaskSchema(engine){
 const dialect=specs[engine].dialect,isPg=dialect==='postgresql',isMy=dialect==='mysql';
 const core=isPg?'pg':isMy?'mysql':'sqlite',table=isPg?'pgTable':isMy?'mysqlTable':'sqliteTable';
 const imports=isPg?'pgTable,text,integer,timestamp,index,check':isMy?'mysqlTable,varchar,int,datetime,index,check':'sqliteTable,text,integer,index,check';
 const text=(column,length=191)=>isMy?`varchar('${column}',{length:${length}})`:`text('${column}')`;
 const date=column=>isPg?`timestamp('${column}',{withTimezone:true,mode:'date'})`:isMy?`datetime('${column}',{mode:'date',fsp:3})`:`integer('${column}',{mode:'timestamp_ms'})`;
 const live=isMy?'':'.where(isNull(t.deletedAt))';
 return `import {${imports}} from 'drizzle-orm/${core}-core';
import {${isMy?'sql':'sql,isNull'}} from 'drizzle-orm';
import {randomUUID} from 'node:crypto';
// Project-owned schema. Generate and review an append-only migration after changes.
// 数据语义约定：表/列 snake_case，六个审计字段，软删除；生成迁移后为表和列补注释（docs/data/dictionary.md 同步）。
/** 任务：示例业务表，删除为软删除 */
export const tasks=${table}('task',{
  /** 任务 ID（UUID） */
  id:${text('id')}.primaryKey().notNull().$defaultFn(()=>randomUUID()),
  /** 任务标题 */
  title:${text('title',255)}.notNull(),
  /** 任务状态：todo=待处理 doing=进行中 done=已完成 */
  status:${text('status')}.notNull().default('todo'),
  /** 乐观锁版本号，每次更新加 1 */
  version:${isMy?'int':'integer'}('version').notNull().default(1),
  /** 创建时间 */
  createdAt:${date('created_at')}.notNull().$defaultFn(()=>new Date()),
  /** 最后修改时间 */
  updatedAt:${date('updated_at')}.notNull().$defaultFn(()=>new Date()).$onUpdate(()=>new Date()),
  /** 创建人标识，无登录主体时为 system */
  createdBy:${text('created_by')}.notNull().default('system'),
  /** 最后修改人标识，无登录主体时为 system */
  updatedBy:${text('updated_by')}.notNull().default('system'),
  /** 软删除时间，为空表示未删除 */
  deletedAt:${date('deleted_at')},
  /** 软删除操作人标识 */
  deletedBy:${text('deleted_by')}
},t=>[index('task_created_at_id_idx').on(t.createdAt,t.id)${live},index('task_status_updated_at_idx').on(t.status,t.updatedAt)${live},check('task_status_check',sql\`\${t.status} in ('todo','doing','done')\`)]);
`;
}
const PRISMA_INIT='prisma/migrations/20260909000000_init/migration.sql';
// Installed stores keep the original Task example bytes, so append-only migrations never conflict; fresh stores get the semantic model.
function taskModelGeneration(target,store){
 if(!target)return 'semantic';
 const read=rel=>{try{return fs.readFileSync(path.join(target,store.path,rel),'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}};
 if(store.access==='drizzle'){const schema=read('src/schema/tasks.ts');return schema!==null&&!/Table\('task'/.test(schema)?'legacy':'semantic';}
 const init=read(PRISMA_INIT);if(init!==null)return /CREATE TABLE ["`]task["`]/.test(init)?'semantic':'legacy';
 const schema=read('prisma/schema.prisma');return schema!==null&&!/@@map\("task"\)/.test(schema)?'legacy':'semantic';
}
function buildDrizzleStore({store,owner,add,copy,deps,config,readSource}){
 const spec=specs[store.engine],storeEnv='DATABASE_'+store.id.replaceAll('-','_').toUpperCase()+'_URL';
 const driver=store.engine==='sqlite'?'@libsql/client':spec.dialect==='mysql'?'mysql2':'pg';
 copy('architecture/stacks/data-access/drizzle',store.path,owner,{engine:store.engine,dialect:spec.dialect,storeEnv},()=> 'update');
 // Environment preparation shares the isolation protocol, with database-specific URLs.
 for(const file of ['environment.mjs','.env.example'])add(store.path+'/'+file,readSource('architecture/stacks/data-access/prisma/'+file).replaceAll('{{engine}}',store.engine).replaceAll('{{storeEnv}}',storeEnv).replaceAll('{{access}}','drizzle'),file==='.env.example'?'init-if-missing':'update',owner);
 add(store.path+'/src/schema/tasks.ts',drizzleSchema(store.engine,'tasks'),'init-if-missing',owner);
 const optional=[...(config.modules.some(m=>m.id==='auth'&&m.options?.datastore===store.id)?['auth']:[]),...(config.fileStorage?.metadata?.datastore===store.id?['file-storage']:[])];
 add(store.path+'/src/schema/index.ts',"export * from './tasks.ts';\n"+optional.map(x=>`export * from './${x}.ts';\n`).join(''),'update',owner);
 const sqlite=store.engine==='sqlite',mysql=spec.dialect==='mysql';
 const imports=sqlite?"import {createClient} from '@libsql/client';\nimport {drizzle} from 'drizzle-orm/libsql';":mysql?"import {createPool} from 'mysql2/promise';\nimport {drizzle} from 'drizzle-orm/mysql2';":"import {Pool} from 'pg';\nimport {drizzle} from 'drizzle-orm/node-postgres';";
 const connection=sqlite?"const client=createClient({url:sqliteUrl(url)});return drizzle(client,{schema});":mysql?"const client=createPool(url);return drizzle(client,{schema,mode:'default'});":"const client=new Pool({...postgresConfiguration(url),max:10,connectionTimeoutMillis:5000});return drizzle(client,{schema});";
 add(store.path+'/src/client.ts',imports+"\nimport * as schema from './schema/index.ts';\nimport {databaseUrl,sqliteUrl,postgresConfiguration} from './connection.mjs';\nexport function createDatabase(url?:string){url=databaseUrl(url);"+connection+"}\nexport type Database=ReturnType<typeof createDatabase>;\nexport type Transaction=Parameters<Parameters<Database['transaction']>[0]>[0];\nlet instance:Database|undefined;\nexport const getDatabase=()=>instance ||=createDatabase();\nexport async function disconnectDatabase(){if(instance){"+(sqlite?"instance.$client.close();":"await instance.$client.end();")+"instance=undefined;}}\nexport function affectedRows(result:unknown):number{const row=(Array.isArray(result)?result[0]:result) as {rowCount?:number;rowsAffected?:number;affectedRows?:number};return row.rowCount??row.rowsAffected??row.affectedRows??0;}\n",'update',owner);
 const pkg={name:'@project/database-'+store.id,private:true,type:'module',engines:deps.engines,exports:{'.':{types:'./dist/index.d.ts',default:'./dist/index.js'}},scripts:{generate:'tsc --noEmit',build:'tsc','type-check':'tsc --noEmit','db:generate':'node generate-migration.mjs','db:status':'node migrate.mjs status','db:deploy':'node migrate.mjs deploy','db:pull':'drizzle-kit pull','db:prepare':'node environment.mjs'},dependencies:{'drizzle-orm':deps.drizzle['drizzle-orm'],[driver]:deps.drizzle[driver]||deps.prisma[driver]},devDependencies:{'drizzle-kit':deps.drizzle['drizzle-kit'],typescript:deps.frontendDev.typescript,'@types/node':deps.frontendDev['@types/node'],...(!sqlite&&!mysql?{'@types/pg':'8.20.0'}:{})}};
 add(store.path+'/package.json',json(pkg),'merge-json',owner);
 add(store.path+'/tsconfig.json',json({...require('./monorepo').tsconfig(),compilerOptions:{...require('./monorepo').tsconfig().compilerOptions,allowJs:true},include:['src']}),'merge-json',owner);
 add(store.path+'/.gitignore','node_modules/\ndist/\n.env\n.env.local\n*.sqlite\n*.sqlite-*\n.migration-running.json\n','append-lines',owner);
}
module.exports={moduleGeneration,taskModelGeneration,drizzleTaskSchema,prismaModuleSchema,buildPrismaStore,prismaModuleSQL,specs,databaseChoice,drizzleSchema,buildDrizzleStore};

// Module tables (ADR-035): installed legacy auth/file stores keep their original bytes; fresh stores get the semantic tables.
const MODULE_FILES={auth:{migration:'prisma/migrations/20260909020000_auth/migration.sql',legacySql:/"emailVerified"|`emailVerified`/,schema:'prisma/auth.prisma',map:'@@map("auth_audit_log")',drizzle:'src/schema/auth.ts',legacyDrizzle:/'emailVerified'/},
 files:{migration:'prisma/migrations/20260909010000_file_storage/migration.sql',legacySql:/CREATE TABLE ["`]FileObject["`]/,schema:'prisma/file-storage.prisma',map:'@@map("file_object")',drizzle:'src/schema/file-storage.ts',legacyDrizzle:/'FileObject'/}};
function moduleGeneration(target,store,kind){
 if(!target)return {generation:'semantic',partial:true};
 const f=MODULE_FILES[kind],read=rel=>{try{return fs.readFileSync(path.join(target,store.path,rel),'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}};
 if(store.access==='drizzle'){const schema=read(f.drizzle);return {generation:schema!==null&&f.legacyDrizzle.test(schema)?'legacy':'semantic',partial:true};}
 const migration=read(f.migration);
 if(migration!==null)return f.legacySql.test(migration)?{generation:'legacy'}:{generation:'semantic',partial:/WHERE \("deleted_at" IS NULL\)/.test(migration)};
 const schema=read(f.schema);
 if(schema!==null)return schema.includes(f.map)?{generation:'semantic',partial:/where: \{ deletedAt: null \}/.test(schema)}:{generation:'legacy'};
 const main=read('prisma/schema.prisma');
 return {generation:'semantic',partial:main===null||/partialIndexes/.test(main)};
}

function prismaModuleSQL(engine,kind,readSource,generation={generation:'legacy'}){
 if(generation.generation==='semantic')return require('./module-models').moduleSQL(kind,engine,{partial:generation.partial});
 if(['postgres','sqlite'].includes(engine))return readSource('architecture/modules/'+(kind==='auth'?'open-source/auth-schema':'storage/prisma')+'/'+engine+'.sql');
 const text=readSource('architecture/modules/'+(kind==='auth'?'open-source/auth-schema':'storage/prisma')+'/postgres.sql');
 return text.replace(/CREATE SCHEMA IF NOT EXISTS "public";/g,'').replaceAll('"','`').replaceAll('TIMESTAMP(3)','DATETIME(3)').replaceAll('TEXT','VARCHAR(191)').replace(/`record` VARCHAR\(191\)/g,'`record` LONGTEXT').replace(/`(?:accessToken|refreshToken|idToken|password|scope|image|logo|metadata|value)` VARCHAR\(191\)/g,m=>m.replace('VARCHAR(191)','LONGTEXT'));
}
function prismaModuleSchema(engine,kind,readSource,generation={generation:'legacy'}){
 if(generation.generation==='semantic')return require('./module-models').prismaSchema(kind,engine,{partial:generation.partial});
 const file=kind==='auth'?'open-source/auth-schema/auth.prisma':'storage/prisma/file-storage.prisma';
 const source=readSource('architecture/modules/'+file);
 if(!['mysql','mariadb'].includes(engine))return source;
 const longFields=new Set(['record','accessToken','refreshToken','idToken','password','scope','image','logo','metadata','value']);
 return source.replace(/^(\s*)(\w+)(\s+)String(\??)(.*)$/gm,(line,indent,field,gap,optional,rest)=>longFields.has(field)?indent+field+gap+'String'+optional+rest+' @db.LongText':line);
}
function buildPrismaStore({store,owner,add,copy,deps,readSource,target}){
 const d=deps.prisma,spec=specs[store.engine],storeEnv='DATABASE_'+store.id.replaceAll('-','_').toUpperCase()+'_URL';
 const generation=taskModelGeneration(target,store),dialectSql=spec.provider==='mysql'?'mysql':store.engine;
 const taskModel=readSource('architecture/stacks/data-access/task-model/'+generation+'/model.prisma').replaceAll('{{titleNative}}',spec.provider==='mysql'?' @db.VarChar(255)':'');
 copy('architecture/stacks/data-access/prisma',store.path,owner,{provider:spec.provider,engine:store.engine,storeId:store.id,storeEnv,adapter:spec.adapter,access:'prisma',taskModel},p=>p==='prisma/schema.prisma'||p==='.env.example'?'init-if-missing':p.startsWith('prisma/migrations/')?'append':'update');
 if(['postgres','sqlite'].includes(store.engine))copy('architecture/stacks/data-access/prisma-'+store.engine,store.path,owner,{storeEnv},p=>p.startsWith('prisma/migrations/')?'append':'update');
 else{
  const {clientSource}=prismaAdditional(store,spec,storeEnv,readSource);
  add(store.path+'/src/client.ts',clientSource,'update',owner);
  add(store.path+'/prisma/migrations/migration_lock.toml','provider = "'+spec.provider+'"\n','append',owner);
 }
 add(store.path+'/'+PRISMA_INIT,readSource('architecture/stacks/data-access/task-model/'+generation+'/'+dialectSql+'.sql'),'append',owner);
 const driver=spec.adapter==='mariadb'?'mysql2':spec.adapter==='pg'?'pg':'better-sqlite3';
 add(store.path+'/package.json',json({name:'@project/database-'+store.id,private:true,type:'module',engines:deps.engines,exports:{'.':{types:'./dist/index.d.ts',default:'./dist/index.js'}},scripts:{generate:'prisma generate','type-check':'tsc --noEmit',build:'tsc','db:status':'node migrate.mjs status','db:deploy':'node migrate.mjs deploy','db:dev':'node migrate.mjs dev','db:pull':'prisma db pull','db:prepare':'node environment.mjs'},dependencies:{'@prisma/client':d.prisma,['@prisma/adapter-'+spec.adapter]:d.prisma,[driver]:d[driver]},devDependencies:{prisma:d.prisma,typescript:deps.frontendDev.typescript,'@types/node':deps.frontendDev['@types/node']}}),'merge-json',owner);
 add(store.path+'/tsconfig.json',json(require('./monorepo').tsconfig()),'merge-json',owner);
}
function prismaAdditional(store,spec,storeEnv){
 const clientSource=`import {PrismaClient} from './generated/client.ts';\nimport {PrismaMariaDb} from '@prisma/adapter-mariadb';\nimport {existsSync,readFileSync} from 'node:fs';\nimport {parseEnv} from 'node:util';\nexport function createDatabase(url?:string){const file=new URL('../.env',import.meta.url),env=existsSync(file)?parseEnv(readFileSync(file,'utf8')):{};url ||=process.env['${storeEnv}']||process.env.DATABASE_URL||env['${storeEnv}']||env.DATABASE_URL;if(!url)throw Error('Explicit database URL required');const u=new URL(url);if(u.protocol!=='mysql:')throw Error('MySQL URL required');if(u.search)throw Error('MySQL URL query options require explicit project adapter integration');return new PrismaClient({adapter:new PrismaMariaDb({host:u.hostname,port:Number(u.port)||3306,user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:decodeURIComponent(u.pathname.slice(1)),connectionLimit:10})});}\nlet instance:PrismaClient|undefined;export const getDatabase=()=>instance ||=createDatabase();export async function disconnectDatabase(){if(instance)await instance.$disconnect();instance=undefined;}\n`;
 return {clientSource};
}

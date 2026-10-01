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
function drizzleSchema(engine,kind){
 const dialect=specs[engine].dialect,isPg=dialect==='postgresql',isMy=dialect==='mysql';
 const core=isPg?'pg':isMy?'mysql':'sqlite',table=isPg?'pgTable':isMy?'mysqlTable':'sqliteTable';
 const models=kind==='auth'?authModels:kind==='files'?{fileObject:{id:'id',ownerId:'string',storeId:'string',objectKey:'key',state:'string',version:'int',record:'long',createdAt:'date',updatedAt:'date'}}:{tasks:{id:'uuid',title:'string',status:'status',version:'version',createdAt:'date',updatedAt:'date'}};
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
  const extras=name==='tasks'?"t=>[index('Task_createdAt_id_idx').on(t.createdAt,t.id),index('Task_status_idx').on(t.status)]":name==='fileObject'?"t=>[uniqueIndex('FileObject_store_key').on(t.storeId,t.objectKey),index('FileObject_owner_id').on(t.ownerId,t.id),index('FileObject_state_updated').on(t.state,t.updatedAt)]":null;
  source+=`export const ${name}=${table}('${name==='tasks'?'Task':name==='fileObject'?'FileObject':name}',{\n${columns.join(',\n')}\n}${extras?','+extras:''});\n`;
 }
 return source;
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
module.exports={prismaModuleSchema,buildPrismaStore,prismaModuleSQL,specs,databaseChoice,drizzleSchema,buildDrizzleStore};

function prismaModuleSQL(engine,kind,readSource){
 if(['postgres','sqlite'].includes(engine))return readSource('architecture/modules/'+(kind==='auth'?'open-source/auth-schema':'storage/prisma')+'/'+engine+'.sql');
 const text=readSource('architecture/modules/'+(kind==='auth'?'open-source/auth-schema':'storage/prisma')+'/postgres.sql');
 return text.replace(/CREATE SCHEMA IF NOT EXISTS "public";/g,'').replaceAll('"','`').replaceAll('TIMESTAMP(3)','DATETIME(3)').replaceAll('TEXT','VARCHAR(191)').replace(/`record` VARCHAR\(191\)/g,'`record` LONGTEXT').replace(/`(?:accessToken|refreshToken|idToken|password|scope|image|logo|metadata|value)` VARCHAR\(191\)/g,m=>m.replace('VARCHAR(191)','LONGTEXT'));
}
function prismaModuleSchema(engine,kind,readSource){
 const file=kind==='auth'?'open-source/auth-schema/auth.prisma':'storage/prisma/file-storage.prisma';
 const source=readSource('architecture/modules/'+file);
 if(!['mysql','mariadb'].includes(engine))return source;
 const longFields=new Set(['record','accessToken','refreshToken','idToken','password','scope','image','logo','metadata','value']);
 return source.replace(/^(\s*)(\w+)(\s+)String(\??)(.*)$/gm,(line,indent,field,gap,optional,rest)=>longFields.has(field)?indent+field+gap+'String'+optional+rest+' @db.LongText':line);
}
function buildPrismaStore({store,owner,add,copy,deps,readSource}){
 const d=deps.prisma,spec=specs[store.engine],storeEnv='DATABASE_'+store.id.replaceAll('-','_').toUpperCase()+'_URL';
 copy('architecture/stacks/data-access/prisma',store.path,owner,{provider:spec.provider,engine:store.engine,storeId:store.id,storeEnv,adapter:spec.adapter,access:'prisma',titleNative:spec.provider==='mysql'?' @db.VarChar(255)':''},p=>p==='prisma/schema.prisma'||p==='.env.example'?'init-if-missing':p.startsWith('prisma/migrations/')?'append':'update');
 if(['postgres','sqlite'].includes(store.engine))copy('architecture/stacks/data-access/prisma-'+store.engine,store.path,owner,{storeEnv},p=>p.startsWith('prisma/migrations/')?'append':'update');
 else{
  const {clientSource,sql}=prismaAdditional(store,spec,storeEnv,readSource);
  add(store.path+'/src/client.ts',clientSource,'update',owner);
  add(store.path+'/prisma/migrations/migration_lock.toml','provider = "'+spec.provider+'"\n','append',owner);
  add(store.path+'/prisma/migrations/20260909000000_init/migration.sql',sql,'append',owner);
 }
 const driver=spec.adapter==='mariadb'?'mysql2':spec.adapter==='pg'?'pg':'better-sqlite3';
 add(store.path+'/package.json',json({name:'@project/database-'+store.id,private:true,type:'module',engines:deps.engines,exports:{'.':{types:'./dist/index.d.ts',default:'./dist/index.js'}},scripts:{generate:'prisma generate','type-check':'tsc --noEmit',build:'tsc','db:status':'node migrate.mjs status','db:deploy':'node migrate.mjs deploy','db:dev':'node migrate.mjs dev','db:pull':'prisma db pull','db:prepare':'node environment.mjs'},dependencies:{'@prisma/client':d.prisma,['@prisma/adapter-'+spec.adapter]:d.prisma,[driver]:d[driver]},devDependencies:{prisma:d.prisma,typescript:deps.frontendDev.typescript,'@types/node':deps.frontendDev['@types/node']}}),'merge-json',owner);
 add(store.path+'/tsconfig.json',json(require('./monorepo').tsconfig()),'merge-json',owner);
}
function prismaAdditional(store,spec,storeEnv){
 const sql="CREATE TABLE `Task` (`id` VARCHAR(191) NOT NULL PRIMARY KEY,`title` VARCHAR(255) NOT NULL,`status` VARCHAR(191) NOT NULL DEFAULT 'todo',`version` INTEGER NOT NULL DEFAULT 1,`createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),`updatedAt` DATETIME(3) NOT NULL);\nCREATE INDEX `Task_createdAt_id_idx` ON `Task`(`createdAt`,`id`);\nCREATE INDEX `Task_status_idx` ON `Task`(`status`);\n";
 const clientSource=`import {PrismaClient} from './generated/client.ts';\nimport {PrismaMariaDb} from '@prisma/adapter-mariadb';\nimport {existsSync,readFileSync} from 'node:fs';\nimport {parseEnv} from 'node:util';\nexport function createDatabase(url?:string){const file=new URL('../.env',import.meta.url),env=existsSync(file)?parseEnv(readFileSync(file,'utf8')):{};url ||=process.env['${storeEnv}']||process.env.DATABASE_URL||env['${storeEnv}']||env.DATABASE_URL;if(!url)throw Error('Explicit database URL required');const u=new URL(url);if(u.protocol!=='mysql:')throw Error('MySQL URL required');if(u.search)throw Error('MySQL URL query options require explicit project adapter integration');return new PrismaClient({adapter:new PrismaMariaDb({host:u.hostname,port:Number(u.port)||3306,user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:decodeURIComponent(u.pathname.slice(1)),connectionLimit:10})});}\nlet instance:PrismaClient|undefined;export const getDatabase=()=>instance ||=createDatabase();export async function disconnectDatabase(){if(instance)await instance.$disconnect();instance=undefined;}\n`;
 return {sql,clientSource};
}

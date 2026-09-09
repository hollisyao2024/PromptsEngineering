const {json,readLock}=require('../../tooling/xirang/engine');
const moduleIds=['auth','auth-client','authorization','jobs','i18n','logging','telemetry','api-mocks'];
const browserIds=['auth-client','i18n','api-mocks'];
function validateModules(config){
 for(const m of config.modules){
  if(!moduleIds.includes(m.id)){if(m.options!==undefined)throw new Error('Module does not accept options: '+m.id);continue;}
  if(config.schemaVersion!==2)throw new Error('Open-source modules require a v2 workspace');
  const allowed=['auth','authorization'].includes(m.id)?['datastore']:m.id==='jobs'?['provider','backend']:[];
  if(m.options!==undefined&&(!m.options||Array.isArray(m.options)||typeof m.options!=='object'||Object.keys(m.options).some(k=>!allowed.includes(k))))throw new Error('Invalid module options: '+m.id);
  if(['auth','authorization'].includes(m.id)){
   const db=config.datastores.find(d=>d.id===m.options?.datastore&&d.access==='prisma');
   if(!db)throw new Error(m.id+' requires a Prisma datastore');
   if(config.applications.some(a=>a.modules?.includes(m.id)&&!db.consumers.includes(a.id)))throw new Error(m.id+' server must consume the selected datastore');
  }
  if(m.id==='jobs'&&!((m.options?.provider==='pg-boss'&&m.options.backend==='postgres')||(m.options?.provider==='bullmq'&&['redis','postgres'].includes(m.options.backend))))throw new Error('Unsupported jobs provider/backend');
  if(!browserIds.includes(m.id)&&config.applications.some(a=>a.modules?.includes(m.id)&&a.stack!=='node-ts'))throw new Error(m.id+' requires a Node TypeScript server consumer');
  if(m.id==='auth-client'&&!config.modules.some(x=>x.id==='auth'))throw new Error('auth-client requires the auth module');
 }
}
function buildModules({config,source,target,add,copy,owned,readSource,deps,selected,registration}){
 const change=(p,fn)=>{const item=owned.get(p);if(item)item.content=fn(item.content);};
 for(const m of config.modules.filter(m=>moduleIds.includes(m.id))){
  const owner='architecture:module:'+m.id;if(!selected(owner))continue;
  const old=readLock(target).packages?.[owner]?.selection;
  if(old&&!require('node:util').isDeepStrictEqual(old.options||{},m.options||{}))throw new Error('Module option change requires explicit project migration/adoption: '+m.id);
  registration(owner,m);
  const db=config.datastores.find(d=>d.id===m.options?.datastore);
  const values={datastore:db?.id||'',provider:db?.engine==='postgres'?'postgresql':'sqlite',backend:m.options?.backend||''};
  copy('architecture/modules/open-source/'+m.id,m.path,owner,values,p=>['src/policy.ts','src/resources.ts','src/handlers.ts'].includes(p)?'init-if-missing':'update');
  if(m.id==='jobs')copy('architecture/modules/open-source/jobs-'+m.options.provider,m.path,owner,values);
  if(m.id==='jobs'&&m.options.provider==='bullmq')add(m.path+'/src/migration-connection.ts',m.options.backend==='postgres'?"import {Pool} from 'pg';\nexport function poolForMigration(connectionString:string){return new Pool({connectionString});}\n":"export function poolForMigration(_connectionString:string):never{throw new Error('Redis has no SQL migration');}\n",'update',owner);
  if(m.id==='jobs'&&m.options.provider==='bullmq'&&m.options.backend==='redis')change(m.path+'/src/index.ts',text=>text.replace("import {poolForMigration} from './migration-connection.ts';\n",'').replace(/export async function prepareJobs\([\s\S]*?\n}/,"export async function prepareJobs(_connectionString:string,_schema?:string){throw new Error('Redis has no SQL migrations');}"));
  const runtime={...deps.modules[m.id]};
  if(db)runtime['@project/database-'+db.id]='workspace:*';
  if(m.id==='auth-client')Object.assign(runtime,{react:deps.frontend.react});
  if(m.id==='jobs'){runtime[m.options.provider]=deps.jobs[m.options.provider];if(m.options.backend==='redis')runtime.ioredis=deps.jobs.ioredis;else runtime.pg=deps.prisma.pg;}
  const browser=browserIds.includes(m.id),exports={'.':{types:browser?'./src/index.ts':'./dist/index.d.ts',default:browser?'./src/index.ts':'./dist/index.js'}};
  if(m.id==='api-mocks'){exports['./node']={types:'./src/node.ts',default:'./src/node.ts'};exports['./browser']={types:'./src/browser.ts',default:'./src/browser.ts'};}
  const compiler={...require('./monorepo').tsconfig(browser),...(browser?{include:['src']}:{})};if(m.id==='auth')compiler.compilerOptions.lib=['ES2022','DOM'];
  const scripts={'type-check':'tsc --noEmit',...(!browser?{build:'tsc'}:{})};
  if(m.id==='api-mocks')scripts['worker:init']='msw init';
  if(m.id==='jobs')scripts['db:prepare']='node dist/prepare.js';
  add(m.path+'/package.json',json({name:'@project/'+m.id,private:true,type:'module',engines:deps.engines,exports,scripts,dependencies:runtime,devDependencies:{typescript:deps.frontendDev.typescript,'@types/node':deps.frontendDev['@types/node'],...(browser?{'@types/react':deps.frontendDev['@types/react']}:{}) ,...(m.id==='jobs'&&m.options.backend==='postgres'?{'@types/pg':'8.20.0'}:{})}}),'merge-json',owner);
  add(m.path+'/tsconfig.json',json(compiler),'merge-json',owner);
  add(m.path+'/.gitignore','node_modules/\ndist/\n.env\n.env.local\n','append-lines',owner);
  if(m.id==='auth'){
   add(db.path+'/prisma/auth.prisma',readSource('architecture/modules/open-source/auth-schema/auth.prisma'),'init-if-missing',owner);
   add(db.path+'/prisma/migrations/20260909020000_auth/migration.sql',readSource('architecture/modules/open-source/auth-schema/'+db.engine+'.sql'),'append',owner);
   change(db.path+'/prisma.config.ts',text=>text.replace("schema:'prisma/schema.prisma'","schema:'prisma'"));
  }
 }
}
module.exports={moduleIds,browserIds,validateModules,buildModules};

const path = require('node:path');
const {json,parseJson,read,readLock}=require('../../tooling/xirang/engine');
const workspaceModules=['domain','contracts','api-client','query','platform','config','observability',...require('./open-source').moduleIds];
const dependencies={contracts:['domain'],'api-client':['contracts'],query:['api-client']};
const packageRoot=p=>p.split('/').slice(0,2).join('/');
function validateWorkspaceConfig(config,cat) {
  if(config.schemaVersion!==2) {
    if(config.modules.some(m=>cat.modules[m.id].requiresWorkspace))throw new Error('Module requires schemaVersion 2 workspace');
    return;
  }
  if(!config.workspace || Object.keys(config.workspace).some(k=>k!=='packageManager') || !/^pnpm@10\.\d+\.\d+$/.test(config.workspace.packageManager))throw new Error('v2 workspace requires pinned pnpm@10.x.y');
  if(config.blueprint && (Object.keys(config.blueprint).some(k=>!['id','version'].includes(k)) || !cat.blueprints[config.blueprint.id] || typeof config.blueprint.version!=='string'))throw new Error('Invalid blueprint metadata');
  const names=new Set();
  for(const item of [...config.applications.filter(a=>a.stack!=='go'),...config.modules.filter(m=>workspaceModules.includes(m.id)),...config.datastores.map(d=>({id:d.access==='prisma'?'database-'+d.id:'db-'+d.id}))]) {
    if(names.has(item.id)||item.id==='ui'||(config.fileStorage?.runtime==='node'&&item.id==='storage'))throw new Error('Duplicate/reserved workspace package name: '+item.id);names.add(item.id);
  }
  const uis=config.applications.filter(a=>cat.stacks[a.stack].ui);
  const roots=new Set(uis.flatMap(a=>Object.values(a.components).map(packageRoot)));
  if(roots.size>1 || [...roots].some(p=>!p.startsWith('packages/')))throw new Error('v2 UI components require one shared package root');
  for(const m of config.modules)for(const dep of dependencies[m.id]||[])if(!config.modules.some(x=>x.id===dep))throw new Error(m.id+' requires workspace module '+dep);
  for(const store of config.datastores) {
    if(store.access!==undefined && store.access!=='prisma')throw new Error('Unsupported datastore access');
    if(store.access==='prisma' && store.consumers.some(id=>config.applications.find(a=>a.id===id).stack!=='node-ts'))throw new Error('Prisma requires a Node TypeScript server consumer; native/browser use an API or host port');
  }
  if(config.example) {
    const e=config.example;
    if(Object.keys(e).some(k=>!['kind','api','datastore'].includes(k)) || e.kind!=='tasks' || !config.applications.some(a=>a.id===e.api&&a.stack==='node-ts') || !config.datastores.some(d=>d.id===e.datastore&&d.access==='prisma'&&d.consumers.includes(e.api)))throw new Error('Invalid tasks example API/datastore');
    for(const m of workspaceModules.filter(id=>!require('./open-source').moduleIds.includes(id)))if(!config.modules.some(x=>x.id===m))throw new Error('Tasks example requires '+m);
    if(uis.some(a=>!['data-table','forms'].every(s=>a.componentSets.includes(s))))throw new Error('Tasks example requires DataTable and forms');
  }
}
function tsconfig(browser=false) {
  return {compilerOptions:{target:'ES2022',module:browser?'ESNext':'NodeNext',moduleResolution:browser?'Bundler':'NodeNext',lib:browser?['ES2022','DOM','DOM.Iterable']:['ES2022'],jsx:'react-jsx',strict:true,skipLibCheck:true,esModuleInterop:true,resolveJsonModule:true,declaration:true,outDir:'dist',rootDir:'src',types:browser?[]:['node'],rewriteRelativeImportExtensions:true,...(browser?{noEmit:true,declaration:false,rootDir:'.'}: {})},include:['src']};
}
function buildPrismaStore({store,owner,add,copy,deps}) {
  const d=deps.prisma,storeEnv='DATABASE_'+store.id.replaceAll('-','_').toUpperCase()+'_URL';
  copy('architecture/stacks/data-access/prisma',store.path,owner,{provider:store.engine==='postgres'?'postgresql':'sqlite',engine:store.engine,storeId:store.id,storeEnv,adapter:store.engine==='postgres'?'pg':'better-sqlite3'},p=>p==='prisma/schema.prisma'||p==='.env.example'?'init-if-missing':p.startsWith('prisma/migrations/')?'append':'update');
  copy('architecture/stacks/data-access/prisma-'+store.engine,store.path,owner,{storeEnv},p=>p.startsWith('prisma/migrations/')?'append':'update');
  add(store.path+'/package.json',json({name:'@project/database-'+store.id,private:true,type:'module',engines:deps.engines,exports:{'.':{types:'./dist/index.d.ts',default:'./dist/index.js'}},scripts:{generate:'prisma generate','type-check':'tsc --noEmit',build:'tsc','db:status':'node migrate.mjs status','db:deploy':'node migrate.mjs deploy','db:dev':'node migrate.mjs dev','db:pull':'prisma db pull','db:prepare':'node environment.mjs'},dependencies:{'@prisma/client':d.prisma,['@prisma/adapter-'+(store.engine==='postgres'?'pg':'better-sqlite3')]:d.prisma,[store.engine==='postgres'?'pg':'better-sqlite3']:d[store.engine==='postgres'?'pg':'better-sqlite3']},devDependencies:{prisma:d.prisma,typescript:deps.frontendDev.typescript,'@types/node':deps.frontendDev['@types/node']}}),'merge-json',owner);
  add(store.path+'/tsconfig.json',json(tsconfig()),'merge-json',owner);
}
function buildWorkspace({config,cat,assets,owned,add,copy,readSource,deps,registration,selected,target}) {
  const change=(p,fn)=>{const item=owned.get(p);if(item)item.content=fn(item.content);};
  const pkg=(p,fn)=>change(p,c=>json(fn(parseJson(c,p))));
  const uiApps=config.applications.filter(a=>cat.stacks[a.stack].ui);
  const uiRoot=uiApps.length?packageRoot(uiApps[0].components.ui):null;
  const ui=uiApps[0]?.components;
  const imports=text=>text.replaceAll('@/components/','@project/ui/').replaceAll('@/lib/utils','@project/ui/lib/utils');
  if(uiRoot) {
    for(const item of assets)if(item.path.startsWith(uiRoot+'/')&&/\.[jt]sx?$/.test(item.path))item.content=imports(item.content);
    pkg(uiRoot+'/package.json',p=>({...p,name:'@project/ui',exports:{...Object.fromEntries(Object.entries(ui).map(([group,dir])=>['./'+(group==='dataTable'?'data-table':group)+'/*','./'+path.posix.relative(uiRoot,dir)+'/*.tsx'])),'./selectors/date-value':'./'+path.posix.relative(uiRoot,ui.selectors)+'/date-value.ts','./feedback/use-async-action':'./'+path.posix.relative(uiRoot,ui.feedback)+'/use-async-action.ts','./lib/*':'./lib/*.ts','./app-shell':'./src/app-shell.tsx'},dependencies:{...p.dependencies,'next-themes':deps.components['next-themes']},devDependencies:{...p.devDependencies,typescript:deps.frontendDev.typescript},scripts:{'type-check':'tsc --noEmit'}}));
    const owner='architecture:component-package:'+uiRoot;
    if(owned.has(uiRoot+'/package.json')) {
      add(uiRoot+'/tsconfig.json',json({...tsconfig(true),include:['src','lib']}),'merge-json',owner);
      add(uiRoot+'/src/app-shell.tsx',readSource('architecture/modules/app-shell/app-shell.tsx'),'update',owner);
    }
  }
  for(const app of config.applications) {
    const owner='architecture:app:'+app.id;
    const map=Object.fromEntries((app.modules||[]).filter(m=>workspaceModules.includes(m)).map(m=>['@project/'+m,'workspace:*']));
    if(config.example && (cat.stacks[app.stack].ui||config.example.api===app.id))for(const id of cat.stacks[app.stack].ui?['api-client','query','platform']:['contracts','config','observability'])map['@project/'+id]='workspace:*';
    for(const store of config.datastores.filter(d=>d.access==='prisma'&&d.consumers.includes(app.id)))map['@project/database-'+store.id]='workspace:*';
    pkg(app.path+'/package.json',p=>({...p,dependencies:{...p.dependencies,...map,...(cat.stacks[app.stack].ui?{'@project/ui':'workspace:*'}:{})},...(app.stack==='node-ts'?{devDependencies:{...p.devDependencies,typescript:deps.frontendDev.typescript,'@types/node':deps.frontendDev['@types/node'],tsx:deps.prisma.tsx},engines:deps.engines}:{})}));
    if(cat.stacks[app.stack].ui) {
      change(app.path+'/'+app.sourceDir+'/styles.css',text=>text+'@source '+JSON.stringify(path.posix.relative(app.path+'/'+app.sourceDir,uiRoot+'/src'))+';\n');
      for(const item of assets)if(item.path.startsWith(app.path+'/')&&/\.[jt]sx?$/.test(item.path))item.content=imports(item.content);
      // Consumers still retain their v1-compatible aliases; package sources use package exports.
      if(config.example&&selected(owner)) {
        change(app.path+'/'+app.sourceDir+'/app.tsx',()=>{const text=readSource('architecture/examples/tasks/app.tsx');return app.stack==='react-next'?text.replaceAll('import.meta.env.VITE_API_URL','process.env.NEXT_PUBLIC_API_URL'):text;});
        add(app.path+'/.env.example',(app.stack==='react-next'?'NEXT_PUBLIC_API_URL':'VITE_API_URL')+'=http://127.0.0.1:3000\n# Keep credentials out of VITE_*; the sample UI accepts a token in memory.\n','init-if-missing',owner);
      }
    }
    if(app.stack==='tauri' && selected(owner) && config.modules.some(m=>m.id==='platform')) {
      const root=app.path+'/src-tauri';
      change(root+'/Cargo.toml',text=>text+'\n'+readSource('architecture/modules/tauri-platform/dependencies.toml'));
      owned.get(root+'/Cargo.toml').strategy='update';
      change(root+'/src/main.rs',text=>text.replace('fn main()', 'mod xirang_platform;\nfn main()').replace('tauri::Builder::default().run','xirang_platform::configure(tauri::Builder::default()).run'));
      add(root+'/src/xirang_platform.rs',readSource('architecture/modules/tauri-platform/xirang_platform.rs'),'update',owner);
      change(root+'/capabilities/default.json',text=>{const permissions=JSON.parse(text);permissions.permissions.push(...JSON.parse(readSource('architecture/modules/tauri-platform/permissions.json')));return json(permissions);});
      owned.get(root+'/capabilities/default.json').strategy='merge-json';
      change(root+'/tauri.conf.json',text=>{const c=JSON.parse(text);c.app.security.csp="default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:3000 http://localhost:3000";return json(c);});
    }
    if(app.stack==='node-ts' && selected(owner)) {
      change(app.path+'/tsconfig.json',()=>json({...tsconfig(),include:[app.sourceDir],compilerOptions:{...tsconfig().compilerOptions,rootDir:app.sourceDir}}));
      if(config.example?.api===app.id) {
        const store=config.example.datastore;
        change(app.path+'/'+app.sourceDir+'/server.ts',()=>readSource('architecture/examples/tasks/server.ts').replaceAll('@project/database-main','@project/database-'+store));
        add(app.path+'/'+app.sourceDir+'/tasks.ts',readSource('architecture/examples/tasks/tasks.ts').replaceAll('@project/database-main','@project/database-'+store),'init-if-missing',owner);
        add(app.path+'/.env.example','PORT=3000\nHOST=127.0.0.1\n# Required to allow writes; use a random local secret, never commit it.\nAPI_WRITE_TOKEN=\nCORS_ORIGINS=http://127.0.0.1:5173,http://localhost:1420,tauri://localhost\n# DATABASE_URL is loaded in the database package or supplied by the environment.\n','init-if-missing',owner);
      }
    }
  }
  for(const module of config.modules.filter(m=>workspaceModules.includes(m.id))) {
    const owner='architecture:module:'+module.id;if(!selected(owner)||require('./open-source').moduleIds.includes(module.id))continue;
    const browser=['query','platform'].includes(module.id);
    copy('architecture/'+(cat.modules[module.id].workspaceTemplate||cat.modules[module.id].template),module.path,owner,{},p=>p==='openapi.json'||(module.id==='domain'&&p.startsWith('src/'))?'init-if-missing':'update');
    const depsMap=Object.fromEntries((dependencies[module.id]||[]).map(m=>['@project/'+m,'workspace:*']));
    if(module.id==='contracts')Object.assign(depsMap,{ajv:deps.contracts.ajv,'ajv-formats':deps.contracts['ajv-formats']});
    if(module.id==='api-client')depsMap['openapi-fetch']=deps.contracts['openapi-fetch'];
    if(module.id==='query')Object.assign(depsMap,{'@tanstack/react-query':deps.query['@tanstack/react-query'],react:deps.frontend.react});
    if(module.id==='platform') {
      if(config.applications.some(a=>a.stack==='tauri'))Object.assign(depsMap,{'@tauri-apps/api':deps.frameworks['@tauri-apps/api']},deps.platform);
      else change(module.path+'/src/index.ts',text=>text.slice(0,text.indexOf('export async function createTauriPlatform'))+'export async function createPlatform():Promise<Platform>{return createBrowserPlatform();}\n');
    }
    const scripts={'type-check':'tsc --noEmit',...(!browser?{build:'tsc'}:{})};
    if(module.id==='contracts'){scripts.generate='node generate.mjs';scripts['check:generated']='node generate.mjs --check';}
    add(module.path+'/package.json',json({name:'@project/'+module.id,private:true,type:'module',exports:{'.':{types:browser?'./src/index.ts':'./dist/index.d.ts',default:browser?'./src/index.ts':'./dist/index.js'},...(module.id==='contracts'?{'./openapi.json':'./openapi.json','./types':{types:'./dist/generated.d.ts',default:'./dist/generated.js'}}:{})},scripts,dependencies:depsMap,devDependencies:{typescript:deps.frontendDev.typescript,'@types/node':deps.frontendDev['@types/node'],...(module.id==='query'?{'@types/react':deps.frontendDev['@types/react']}:{}) ,...(module.id==='contracts'?{'openapi-typescript':deps.contracts['openapi-typescript'],typescript:deps.contracts.typescript}:{})}}),'merge-json',owner);
    add(module.path+'/tsconfig.json',json(tsconfig(browser)),'merge-json',owner);
    add(module.path+'/.gitignore','node_modules/\ndist/\n*.tsbuildinfo\n'+(module.id==='contracts'?'src/generated.ts\nsrc/schemas.ts\n':''),'init-if-missing',owner);
  }
  const owner='architecture:workspace';
  const packagePaths=[...config.applications.filter(a=>a.stack!=='go').map(a=>a.path),...config.datastores.map(d=>d.path),...config.modules.filter(m=>workspaceModules.includes(m.id)).map(m=>m.path),...(uiRoot?[uiRoot]:[]),...(config.fileStorage?.runtime==='node'?[config.fileStorage.path]:[])].sort();
  registration(owner,{workspace:config.workspace,packages:packagePaths});
  const previous=readLock(target);
  for(const store of config.datastores) {
    const old=previous.packages?.['architecture:store:'+store.id]?.selection;
    if(old && (old.engine!==store.engine || old.access!==store.access))throw new Error('Datastore engine/access change requires explicit project migration: '+store.id);
  }
  const rootPackage=read(target,'package.json');
  if(rootPackage) {
    const current=parseJson(rootPackage,'package.json').packageManager;
    if(current && !current.startsWith('pnpm@'))throw new Error('Existing packageManager conflicts with pnpm workspace');
  }
  const overrides=Object.fromEntries(Object.entries(deps.securityOverrides).filter(([key])=>key.startsWith('@redocly/')?config.modules.some(m=>m.id==='contracts'):config.datastores.some(d=>d.access==='prisma')));
  add('package.json',json({private:true,packageManager:config.workspace.packageManager,engines:deps.engines,scripts:{generate:'node tooling/workspace/run.mjs generate',build:'node tooling/workspace/run.mjs build','type-check':'node tooling/workspace/run.mjs type-check','test:workspace':'node tooling/workspace/run.mjs test'},devDependencies:{typescript:deps.frontendDev.typescript},...(Object.keys(overrides).length?{pnpm:{overrides}}:{})}),'merge-json',owner);
  const buildDependencies=[...(config.datastores.some(d=>d.access==='prisma')?['@prisma/engines','prisma']:[]),...(config.datastores.some(d=>d.access==='prisma'&&d.engine==='sqlite')?['better-sqlite3']:[]),...(config.applications.some(a=>a.stack==='node-ts'||cat.stacks[a.stack].ui)?['esbuild']:[])];
  const yamlList=(key,values)=>key+':'+(values.length?'\n'+values.map(p=>'  - '+JSON.stringify(p)).join('\n'):' []')+'\n';
  add('pnpm-workspace.yaml',yamlList('packages',packagePaths)+yamlList('onlyBuiltDependencies',buildDependencies),'merge-yaml',owner);
  add('.gitignore','node_modules/\ndist/\n.env\n.env.local\n.env.*.local\n*.sqlite\n*.sqlite-*\n','append-lines',owner);
  copy('architecture/modules/workspace','tooling/workspace',owner);
  for(const file of ['package.json','.gitignore']){const item=owned.get(file);if(item)Object.assign(item,require('../../tooling/xirang/root-contributions').preserveRootContribution(item,target));}
}
module.exports={workspaceModules,validateWorkspaceConfig,buildPrismaStore,buildWorkspace,tsconfig};

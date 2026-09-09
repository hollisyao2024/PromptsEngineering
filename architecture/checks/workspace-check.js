const fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const {parseDocument}=require('../../tooling/xirang/yaml');
const {read,parseJson,hash,readLock,safePath}=require('../../tooling/xirang/engine');
function checkWorkspace(target,config,{syntax=true}={}) {
  const failures=[],checks=[],fail=(name,reason)=>failures.push({name,reason});
  const uiApps=config.applications.filter(a=>a.components);
  const uiRoots=[...new Set(uiApps.map(a=>a.components.ui.split('/').slice(0,2).join('/')))];
  const owners=[...config.applications,...config.modules,...config.datastores,...(config.fileStorage?.runtime==='node'?[{id:'storage',path:config.fileStorage.path}]:[]),...uiRoots.map(p=>({id:'ui',path:p}))];
  const packages=new Map();
  for(const owner of owners) {
    const text=read(target,owner.path+'/package.json');if(!text)continue;
    const pkg=parseJson(text,owner.path+'/package.json');
    if(packages.has(pkg.name))fail(owner.path,'Duplicate workspace package name');
    packages.set(pkg.name,{...owner,pkg});
    if(read(target,owner.path+'/pnpm-lock.yaml')!==null)fail(owner.path,'Workspace uses a single root lockfile; migrate the nested lock explicitly');
  }
  try {
    const doc=parseDocument(read(target,'pnpm-workspace.yaml')).value;
    if(!Array.isArray(doc.packages))throw new Error('Workspace package membership missing');
    for(const item of packages.values()) {
      const match=pattern=>typeof pattern==='string'&&path.posix.matchesGlob(item.path,pattern);
      if(!doc.packages.filter(p=>!p.startsWith('!')).some(match)||doc.packages.filter(p=>p.startsWith('!')).some(p=>match(p.slice(1))))fail(item.path,'Package is excluded from pnpm workspace');
    }
    if(parseJson(read(target,'package.json')||'{}').packageManager!==config.workspace.packageManager)fail('package.json','Package manager differs from architecture choice');
    checks.push('workspace:membership');
  } catch(e){fail('pnpm-workspace.yaml',e.message);}
  for(const app of uiApps) {
    const pkg=packages.get('@project/'+app.id)?.pkg;
    if(pkg?.dependencies?.['@project/ui']!=='workspace:*')fail(app.path,'UI consumer must use workspace:*');
  }
  for(const store of config.datastores.filter(d=>d.access==='prisma')) {
    const provider=store.engine==='postgres'?'postgresql':'sqlite';
    const schema=read(target,store.path+'/prisma/schema.prisma');
    if(!schema||!new RegExp('datasource\\s+\\w+\\s*\\{[^}]*provider\\s*=\\s*"'+provider+'"').test(schema))fail(store.path,'Prisma datasource provider conflicts with architecture choice');
    for(const id of store.consumers)if(packages.get('@project/'+id)?.pkg.dependencies?.['@project/database-'+store.id]!=='workspace:*')fail(id,'Datastore consumer must use workspace:*');
    const directory=safePath(target,store.path+'/prisma/migrations');
    if(!fs.existsSync(directory))fail(store.path,'Prisma migrations missing');
    else for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      if(entry.isSymbolicLink())fail(store.path,'Migration symlink');
      if(entry.isDirectory()&&(!/^\d{14}_[a-zA-Z0-9_-]+$/.test(entry.name)||read(target,store.path+'/prisma/migrations/'+entry.name+'/migration.sql')===null))fail(entry.name,'Invalid Prisma migration');
    }
    checks.push('datastore:'+store.id);
  }
  const lock=readLock(target);
  for(const [file,record] of Object.entries(lock.files))if(config.datastores.some(d=>d.access==='prisma'&&file.startsWith(d.path+'/prisma/migrations/'))&&hash(read(target,file))!==record.base)fail(file,'Published migration changed or removed');
  if(!syntax)return {checks,failures};
  let ts;
  try{ts=createRequire(path.join(target,'package.json'))('typescript');}catch{fail('workspace','TypeScript dependency missing');return {checks,failures};}
  const {walk}=require('../scripts/project');
  const publicModules=new Set(['domain','contracts','api-client','query','platform','auth-client','i18n','api-mocks']);
  const roots=[...config.applications.map(a=>({root:a.path+'/'+a.sourceDir,app:a,browser:!!a.components})),...config.modules.map(m=>({root:m.path+'/src',browser:publicModules.has(m.id)})),...uiRoots.map(p=>({root:p+'/src',browser:true}))];
  const privateRoots=[...(config.fileStorage?[{path:config.fileStorage.path}]:[]),...config.datastores,...config.modules.filter(m=>['config','observability','auth','authorization','jobs','logging','telemetry'].includes(m.id))].map(m=>path.resolve(target,m.path)+path.sep);
  const visited=new Set(),options=new Map(),native=new Set(['button','input','select','option','textarea','dialog','details','summary','table']);
  function visitFile(file,context) {
    const key=(context.app?.id||'shared')+':'+context.browser+':'+file;if(visited.has(key))return;visited.add(key);
    if(!fs.existsSync(file)||!/\.[cm]?[jt]sx?$/.test(file))return;
    const relative=path.relative(target,file).replaceAll('\\','/');
    const primitive=uiApps.some(a=>relative.startsWith(a.components.ui+'/'));
    const table=uiApps.some(a=>relative.startsWith(a.components.dataTable+'/'));
    const cfg=ts.findConfigFile(path.dirname(file),ts.sys.fileExists);
    if(cfg&&!options.has(cfg)){const parsed=ts.readConfigFile(cfg,ts.sys.readFile);options.set(cfg,ts.parseJsonConfigFileContent(parsed.config,ts.sys,path.dirname(cfg)).options);}
    const text=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    function inspect(node) {
      if(context.browser&&!primitive&&(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&native.has(node.tagName.getText(tree)))fail(relative,'Business controls must use shadcn/common DataTable');
      const spec=(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))?node.moduleSpecifier:ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(tree)==='require')?node.arguments[0]:undefined;
      if(spec&&ts.isStringLiteral(spec)) {
        const name=spec.text;
        if(context.browser&&(/^(?:better-auth\/(?:node|plugins)|@project\/(?:auth$|authorization(?:\/|$)|jobs(?:\/|$)|logging(?:\/|$)|telemetry(?:\/|$)|storage(?!\/client$)|api-mocks\/node)|@aws-sdk\/|ali-oss$|cos-nodejs-sdk-v5$|pg-boss$|bullmq$|pino$|msw\/node$)/.test(name)))fail(relative,'Server SDK/module is forbidden in browser code: '+name);
        if(context.browser&&/^(?:@prisma\/|@project\/(?:database-|db-|config$|observability$)|node:|fs$|child_process$)/.test(name))fail(relative,'Server/database dependency is forbidden in browser/shared code: '+name);
        if(context.browser&&!primitive&&!table&&/(?:^|\/)ui\/table$/.test(name))fail(relative,'Business tables must use the common DataTable');
        const resolved=ts.resolveModuleName(name,file,options.get(cfg)||{moduleResolution:ts.ModuleResolutionKind.Bundler},ts.sys).resolvedModule?.resolvedFileName;
        if(resolved) {
          const absolute=path.resolve(resolved);
          if(config.applications.some(a=>a.id!==context.app?.id&&absolute.startsWith(path.resolve(target,a.path)+path.sep)))fail(relative,'Cross-application source import: '+name);
          if(context.browser&&name!=='@project/storage/client'&&privateRoots.some(p=>absolute.startsWith(p)))fail(relative,'Server-only package imported by browser/shared code');
          if(absolute.startsWith(path.resolve(target)+path.sep)&&!absolute.split(path.sep).includes('node_modules'))visitFile(absolute,context);
        }
      }
      ts.forEachChild(node,inspect);
    }
    inspect(tree);
  }
  for(const context of roots)for(const file of walk(safePath(target,context.root)))visitFile(path.join(target,context.root,file),context.root===config.modules.find(m=>m.id==='api-mocks')?.path+'/src'&&file==='node.ts'?{...context,browser:false}:context);
  checks.push('workspace:source-boundaries');
  return {checks,failures};
}
module.exports={checkWorkspace};

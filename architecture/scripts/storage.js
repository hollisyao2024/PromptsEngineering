const path=require('node:path');
const fs=require('node:fs');
const {safePath,json,readLock}=require('../../tooling/xirang/engine');
const providers=['local','s3','aliyun-oss','tencent-cos'];
const names={local:'createLocalProvider',s3:'createS3Provider','aliyun-oss':'createAliyunOSSProvider','tencent-cos':'createTencentCOSProvider'};
function validateStorage(config,target){
  const s=config.fileStorage;if(s===undefined)return;
  if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['path','runtime','consumers','defaultStore','stores','metadata','uploadApplications'].includes(k)))throw new Error('Invalid fileStorage configuration');
  if(s.path===undefined)s.path='packages/storage';if(s.runtime===undefined)s.runtime='node';safePath(target,s.path);
  if(!s.path.startsWith('packages/')||!['node','go'].includes(s.runtime))throw new Error('Storage requires a packages path and node/go runtime');
  const overlaps=p=>p.toLowerCase()===s.path.toLowerCase()||p.toLowerCase().startsWith(s.path.toLowerCase()+'/')||s.path.toLowerCase().startsWith(p.toLowerCase()+'/');
  for(const item of [...config.applications,...config.datastores,...config.modules,...config.profiles])if(overlaps(item.path))throw new Error('Storage path overlaps architecture owner');
  for(const a of config.applications)for(const p of Object.values(a.components||{}))if(overlaps(p))throw new Error('Storage path overlaps UI');
  if(!Array.isArray(s.consumers)||!s.consumers.length||new Set(s.consumers).size!==s.consumers.length||s.consumers.some(id=>!config.applications.some(a=>a.id===id&&(s.runtime==='go'?a.stack==='go':['node','node-ts'].includes(a.stack)))))throw new Error('Storage consumers must use its server runtime');
  if(!Array.isArray(s.stores)||!s.stores.length||s.stores.length>32)throw new Error('Storage requires 1..32 profiles');
  const ids=new Set(),envs=new Set();
  for(const store of s.stores){
    if(!store||Object.keys(store).some(k=>!['id','provider','envPrefix'].includes(k))||!/^[-a-z0-9]{1,64}$/.test(store.id)||!providers.includes(store.provider)||!/^[_A-Z][A-Z0-9_]{1,63}$/.test(store.envPrefix)||ids.has(store.id)||envs.has(store.envPrefix))throw new Error('Invalid or duplicate storage profile; credentials belong in environment');
    ids.add(store.id);envs.add(store.envPrefix);
  }
  if(!ids.has(s.defaultStore))throw new Error('Unknown default storage profile');
  if(s.metadata!==undefined){
    if(!s.metadata||typeof s.metadata!=='object'||Array.isArray(s.metadata)||Object.keys(s.metadata).some(k=>k!=='datastore')||s.runtime!=='node'||config.schemaVersion!==2)throw new Error('Prisma storage metadata requires Node workspace');
    const db=config.datastores.find(d=>d.id===s.metadata.datastore&&d.access==='prisma');
    if(!db||s.consumers.some(id=>!db.consumers.includes(id)))throw new Error('Metadata datastore must be a Prisma datastore consumed by every storage app');
  }
  if(s.uploadApplications===undefined)s.uploadApplications=[];
  if(!Array.isArray(s.uploadApplications)||new Set(s.uploadApplications).size!==s.uploadApplications.length||s.uploadApplications.some(id=>!config.applications.some(a=>a.id===id&&a.components&&['uploads','data-table'].every(set=>a.componentSets.includes(set)))))throw new Error('Upload applications must select shadcn UI');
}
function buildStorage({config,source,target,add,owned,copy,readSource,deps,registration,selected}){
  const s=config.fileStorage;if(!s)return;
  const owner='architecture:file-storage';
  const old=readLock(target).packages?.[owner]?.selection;
  if(old&&(old.path!==s.path||old.runtime!==s.runtime||s.stores.some(x=>old.stores.some(y=>y.id===x.id&&y.provider!==x.provider))))throw new Error('Storage path/runtime/provider change requires an explicit project migration');
  const selectedProviders=[...new Set([...s.stores,...(old?.stores||[])].map(p=>p.provider))];
  const active=selected(owner)||[...s.consumers,...s.uploadApplications].some(id=>selected('architecture:app:'+id));
  const change=(p,fn)=>{const asset=owned.get(p);if(asset)asset.content=fn(asset.content);};
  if(!active)return;
  registration(owner,s);
  if(s.runtime==='node'){
    const {walk}=require('./project');
    for(const rel of walk(path.join(source,'architecture/modules/storage/node/src'))){
      const provider=rel.startsWith('providers/')?rel.slice(10,-3):null;
      if(provider&&provider!=='local'&&!selectedProviders.includes(provider))continue;
      add(s.path+'/src/'+rel,readSource('architecture/modules/storage/node/src/'+rel),'update',owner);
    }
    const runtimeDeps={};
    for(const p of selectedProviders)Object.assign(runtimeDeps,deps.storage.node[p]);
    const exports={'.':{types:'./dist/index.d.ts',default:'./dist/index.js'},'./client':{types:'./dist/client.d.ts',default:'./dist/client.js'},'./configured':{types:'./dist/configured.d.ts',default:'./dist/configured.js'}};
    for(const p of selectedProviders)exports['./providers/'+p]={types:'./dist/providers/'+p+'.d.ts',default:'./dist/providers/'+p+'.js'};
    add(s.path+'/package.json',json({name:'@project/storage',private:true,type:'module',engines:deps.engines,exports,scripts:{build:'tsc','type-check':'tsc --noEmit',test:'node --test tests/*.test.mjs'},dependencies:runtimeDeps,devDependencies:{typescript:deps.frontendDev.typescript,'@types/node':deps.frontendDev['@types/node'],...(selectedProviders.includes('aliyun-oss')?{'@types/ali-oss':deps.storage.types.oss}:{})}}),'merge-json',owner);
    add(s.path+'/tsconfig.json',json({compilerOptions:{...require('./monorepo').tsconfig().compilerOptions,lib:['ES2022','DOM','DOM.Iterable']},include:['src']}),'merge-json',owner);
    const imports=selectedProviders.map(p=>'import {'+names[p]+'} from "./providers/'+p+'.ts";').join('\n');
    const setup=s.stores.map(store=>store.provider==='local'?'stores['+JSON.stringify(store.id)+']=await createLocalProvider({directory:env['+JSON.stringify(store.envPrefix+'_DIRECTORY')+']||fileURLToPath(new URL("../.data/'+store.id+'",import.meta.url))});':'stores['+JSON.stringify(store.id)+']='+names[store.provider]+'(readCloudEnvironment('+JSON.stringify(store.envPrefix)+',env));').join('\n');
    add(s.path+'/src/configured.ts',imports+'\nimport {fileURLToPath} from "node:url";\nimport {StorageRouter} from "./router.ts";\nimport type {StorageProvider} from "./contracts.ts";\nimport {readCloudEnvironment} from "./environment.ts";\nexport async function createConfiguredStorage(env:NodeJS.ProcessEnv=process.env){const stores:Record<string,StorageProvider>={};\n'+setup+'\nreturn new StorageRouter(stores,'+JSON.stringify(s.defaultStore)+');}\n','update',owner);
    add(s.path+'/.gitignore','node_modules/\ndist/\n.data/\n.env\n.env.local\n','append-lines',owner);
    add(s.path+'/.env.example',s.stores.map(store=>store.provider==='local'?store.envPrefix+'_DIRECTORY=\n':[store.envPrefix+'_BUCKET=',store.envPrefix+'_REGION=',store.envPrefix+'_ENDPOINT=',store.envPrefix+'_PUBLIC_ENDPOINT=',store.envPrefix+'_ACCESS_KEY_ID=',store.envPrefix+'_SECRET_ACCESS_KEY=',store.envPrefix+'_SESSION_TOKEN='].join('\n')+'\n').join('\n'),'init-if-missing',owner);
    copy('architecture/modules/storage/node/tests',s.path+'/tests',owner);
    for(const app of config.applications.filter(a=>s.consumers.includes(a.id)))change(app.path+'/package.json',text=>{const p=JSON.parse(text);p.dependencies={...p.dependencies,'@project/storage':config.schemaVersion===2?'workspace:*':'link:'+path.posix.relative(app.path,s.path)};return json(p);});
  }else{
    require('./storage-go').buildGoStorage({config,s,owner,selectedProviders,add,copy,readSource,deps,owned});
  }
  for(const app of config.applications.filter(a=>s.consumers.includes(a.id))){
    if(s.runtime==='node')add(app.path+'/'+app.sourceDir+'/file-storage.ts',readSource('architecture/modules/storage/node/'+(s.metadata?'example-prisma.ts':'example.ts')).replaceAll('{{datastore}}',s.metadata?.datastore||''),'init-if-missing','architecture:app:'+app.id);
    const ignore=owned.get(app.path+'/.gitignore');if(ignore){ignore.content+='\n.data/\n';ignore.strategy='append-lines';}
  }
  for(const app of config.applications.filter(a=>s.uploadApplications.includes(a.id))){
    add(app.path+'/'+app.sourceDir+'/lib/file-client.ts',readSource('architecture/modules/storage/node/src/client.ts'),'update',owner);
    add(app.path+'/'+app.sourceDir+'/examples/file-upload.tsx',readSource('architecture/modules/storage/upload-example.tsx'),'init-if-missing','architecture:app:'+app.id);
  }
  if(s.metadata){
    const db=config.datastores.find(d=>d.id===s.metadata.datastore);
    add(db.path+'/prisma/file-storage.prisma',readSource('architecture/modules/storage/prisma/file-storage.prisma'),'init-if-missing',owner);
    add(db.path+'/prisma/migrations/20260909010000_file_storage/migration.sql',readSource('architecture/modules/storage/prisma/'+db.engine+'.sql'),'append',owner);
    change(db.path+'/prisma.config.ts',text=>text.replace("schema:'prisma/schema.prisma'","schema:'prisma'"));
  }
}
module.exports={validateStorage,buildStorage,providers};

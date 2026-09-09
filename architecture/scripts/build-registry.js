#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const {read,safePath,json,atomicWrite}=require('../../tooling/xirang/engine');
function buildRegistry(source=path.resolve(__dirname,'../..')) {
  const root=path.join(source,'architecture/components/shadcn'),registry=JSON.parse(read(root,'registry.json'));
  const versions=JSON.parse(read(source,'architecture/dependencies.json')).frontend;
  const index=new Map(registry.items.map(item=>[item.name,item]));
  const build=item=>{
    const visited=new Set(),files=new Map(),dependencies=new Set(['cn','clsx','tailwind-merge','class-variance-authority','react','react-dom','lucide-react','radix-ui'].map(name=>`${name}@${versions[name]}`));
    function include(name){if(visited.has(name))return;visited.add(name);const current=index.get(name);if(!current)throw new Error(`Registry dependency missing: ${name}`);
      for(const dep of current.registryDependencies||[])include(dep);
      for(const dep of current.dependencies||[]) {
        const name=dep.slice(0,dep.lastIndexOf('@'));
        if(!versions[name])throw new Error(`Registry dependency is not pinned in architecture/dependencies.json: ${dep}`);
        dependencies.add(`${name}@${versions[name]}`);
      }
      for(const file of current.files) {
        const content=read(root,file.path);
        if(content===null)throw new Error(`Registry source missing: ${file.path}`);
        for(const match of content.matchAll(/@\/components\/ui\/([a-z-]+)/g))include(match[1]);
        files.set(file.path,{...file,content});
      }
    }
    include(item.name);
    files.set('utils.ts',{path:'utils.ts',type:'registry:lib',target:'@lib/utils.ts',content:'export { cn } from "cn";\n'});
    files.set('SHADCN-LICENSE',{path:'SHADCN-LICENSE',type:'registry:file',target:'~/SHADCN-LICENSE',content:read(root,'LICENSE')});
    return {$schema:'https://ui.shadcn.com/schema/registry-item.json',name:item.name,type:item.type,title:item.title,dependencies:[...dependencies].sort(),files:[...files.values()]};
  };
  return registry.items.map(build);
}
if(require.main===module)try{
  if(!process.argv[2])throw new Error('Explicit output directory required (use container tmp/artifacts)');
  const out=path.resolve(process.argv[2]),items=buildRegistry();for(const item of items)atomicWrite(safePath(out,`${item.name}.json`),json(item));
  console.log(`STATUS=OK\nREGISTRY_ITEMS=${items.length}`);
}catch(error){console.error(`STATUS=BLOCKED\nREASON=${error.message}`);process.exitCode=1;}
module.exports={buildRegistry};

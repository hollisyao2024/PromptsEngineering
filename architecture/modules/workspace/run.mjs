import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const action=process.argv[2];
if(!['generate','build','type-check','test'].includes(action))throw new Error('Unknown workspace action');
const pnpm=process.env.npm_execpath;
function run(args) {
  const r=spawnSync(pnpm?process.execPath:'pnpm',[...(pnpm?[pnpm]:[]),...args],{stdio:'inherit',shell:false});
  if(r.error||r.status!==0)process.exit(r.status||1);
}
run(['-r','--workspace-concurrency=1','--if-present','run','generate']);
if(['type-check','test'].includes(action)) {
  const config=JSON.parse(readFileSync('architecture.config.json','utf8'));
  const paths=[...config.datastores.map(d=>d.path),...config.modules.map(m=>m.path)];
  const filters=paths.flatMap(p=>{try{const pkg=JSON.parse(readFileSync(p+'/package.json','utf8'));return pkg.scripts?.build?['--filter',pkg.name]:[];}catch{return [];}});
  if(filters.length)run(['-r','--workspace-concurrency=1',...filters,'--if-present','run','build']);
}
if(action!=='generate')run(['-r','--workspace-concurrency=1','--if-present','run',action==='test'?'test':action]);

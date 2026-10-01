const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {syncSourceVersions}=require('../source-version-sync');
const cfg=require('../../shared/config');
const tmp=cfg.resolveContainerPath(cfg.loadConfig({repoRoot:process.cwd()}),cfg.getMainRepoRoot(process.cwd()),'tmp');
const config={template:{role:'source'},baseBranch:'main'};
function fixture(t){
 const dir=fs.mkdtempSync(path.join(tmp,'source-version-test-')),main=path.join(dir,'repo'),work=path.join(dir,'work');fs.mkdirSync(main);
 const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const write=(cwd,p,j)=>{fs.mkdirSync(path.dirname(path.join(cwd,p)),{recursive:true});fs.writeFileSync(path.join(cwd,p),JSON.stringify(j,null,2)+'\n');};
 git(main,'init','--initial-branch=main');git(main,'config','user.name','Fixture');git(main,'config','user.email','fixture@example.invalid');
 for(const [p,j] of [['package.json',{version:'3.6.2'}],['agent/manifest.json',{version:'3.6.2'}],['infra/templates/agent/template.manifest.json',{templateVersion:'3.6.2'}],['architecture/manifest.json',{version:'3.4.3'}]])write(main,p,j);
 git(main,'add','.');git(main,'commit','-m','base');git(main,'remote','add','origin','https://github.com/hollisyao2024/PromptsEngineering.git');const base=git(main,'rev-parse','HEAD');git(main,'update-ref','refs/remotes/origin/main',base);git(main,'worktree','add','-b','feature/test',work);
 t.after(()=>{git(main,'worktree','remove','--force',work);fs.rmSync(dir,{recursive:true,force:true});});
 const version=(p,field='version')=>JSON.parse(fs.readFileSync(path.join(work,p),'utf8'))[field];
 let fetches=0;const fetchBase=()=>{fetches++;git(main,'update-ref','refs/remotes/origin/main',base);};
 return {main,work,git,write,version,fetchBase,fetches:()=>fetches};
}
test('TC-DRIZZLE-006 source changes increment once and synchronize release manifests',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.work,'README.md'),'changed');
 const result=syncSourceVersions({repoRoot:f.work,config,fetchBase:f.fetchBase});assert.equal(result.version,'3.6.3');assert.equal(f.version('agent/manifest.json'),'3.6.3');assert.equal(f.version('infra/templates/agent/template.manifest.json','templateVersion'),'3.6.3');assert.equal(f.version('architecture/manifest.json'),'3.4.3');
 syncSourceVersions({repoRoot:f.work,config,fetchBase:f.fetchBase});assert.equal(f.version('package.json'),'3.6.3');assert.equal(f.fetches(),2);
});
test('TC-DRIZZLE-006 architecture increments independently and explicit higher releases are retained',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.work,'architecture/new.txt'),'changed');syncSourceVersions({repoRoot:f.work,config,fetchBase:f.fetchBase});assert.equal(f.version('architecture/manifest.json'),'3.4.4');
 f.write(f.work,'package.json',{version:'3.7.0'});f.write(f.work,'architecture/manifest.json',{version:'3.5.0'});syncSourceVersions({repoRoot:f.work,config,fetchBase:f.fetchBase});assert.equal(f.version('package.json'),'3.7.0');assert.equal(f.version('agent/manifest.json'),'3.7.0');assert.equal(f.version('architecture/manifest.json'),'3.5.0');
});
test('TC-DRIZZLE-006 projects and unchanged sources do not publish; primary source rejects edits',t=>{
 const f=fixture(t);assert.equal(syncSourceVersions({repoRoot:f.work,config:{}}).status,'SKIPPED');assert.equal(syncSourceVersions({repoRoot:f.work,config,fetchBase:f.fetchBase}).status,'UNCHANGED');fs.writeFileSync(path.join(f.main,'README.md'),'changed');assert.throws(()=>syncSourceVersions({repoRoot:f.main,config,fetchBase:f.fetchBase}),/linked worktree/);assert.equal(f.version('package.json'),'3.6.2');
});
test('TC-DRIZZLE-006 fetch failure and invalid/regressed versions prevent all version writes',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.work,'architecture/new.txt'),'changed');assert.throws(()=>syncSourceVersions({repoRoot:f.work,config,fetchBase:()=>{throw Error('required fetch failed')}}),/required fetch/);assert.equal(f.version('package.json'),'3.6.2');
 f.write(f.work,'architecture/manifest.json',{version:'3.4.2'});assert.throws(()=>syncSourceVersions({repoRoot:f.work,config,fetchBase:f.fetchBase}),/regression/);assert.equal(f.version('package.json'),'3.6.2');
 f.write(f.work,'architecture/manifest.json',{version:'invalid'});assert.throws(()=>syncSourceVersions({repoRoot:f.work,config,fetchBase:f.fetchBase}),/version/);assert.equal(f.version('agent/manifest.json'),'3.6.2');
});

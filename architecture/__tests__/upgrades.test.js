const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTemplatePlan } = require('../../tooling/xirang/template');
const { applyPlan } = require('../../tooling/xirang/engine');
const { createArchitecturePlan } = require('../scripts/project');
const source=path.resolve(__dirname,'../..');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'xirang-upgrade-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const target=path.join(root,'repo');fs.mkdirSync(target);return{root,target,runRoot:path.join(root,'runs')};}
test('TC-ARCHPLAT-001 agent-only install does not generate architecture or application files',t=>{
 const f=fixture(t);const p=createTemplatePlan({source,target:f.target,scope:'agent'});applyPlan(p,{runRoot:f.runRoot});
 assert.ok(fs.existsSync(path.join(f.target,'AGENTS.md')));assert.ok(!fs.existsSync(path.join(f.target,'apps')));assert.ok(!fs.existsSync(path.join(f.target,'architecture')));
 assert.equal(createTemplatePlan({source,target:f.target,scope:'agent'}).changes.length,0);
});
test('TC-ARCHPLAT-009 explicit architecture kit install stays inert and can be upgraded without project config',t=>{
 const f=fixture(t);applyPlan(createTemplatePlan({source,target:f.target,include:['architecture']}),{runRoot:f.runRoot});
 assert.ok(fs.existsSync(path.join(f.target,'architecture/manifest.json')));assert.ok(!fs.existsSync(path.join(f.target,'apps')));
 assert.equal(createTemplatePlan({source,target:f.target}).changes.length,0);
});
test('TC-ARCHPLAT-009 integrated template upgrade preserves custom components and protects unselected choices',t=>{
 const f=fixture(t);applyPlan(createTemplatePlan({source,target:f.target}),{runRoot:f.runRoot});
 const config={schemaVersion:1,applications:[{id:'api',stack:'node',path:'apps/server'}],datastores:[],modules:[{id:'observability',path:'packages/logging'}]};
 applyPlan(createArchitecturePlan({source,target:f.target,config}),{runRoot:f.runRoot});
 const file=path.join(f.target,'packages/logging/index.mjs');fs.appendFileSync(file,'\n// project customization\n');
 const p=createTemplatePlan({source,target:f.target});assert.equal(p.conflicts.length,0);applyPlan(p,{runRoot:f.runRoot});assert.match(fs.readFileSync(file,'utf8'),/project customization/);
 const current=JSON.parse(fs.readFileSync(path.join(f.target,'architecture.config.json'),'utf8'));current.applications.push({id:'worker',stack:'node',path:'apps/worker'});fs.writeFileSync(path.join(f.target,'architecture.config.json'),JSON.stringify(current));
 assert.throws(()=>createTemplatePlan({source,target:f.target}),/New architecture choices/);
});
test('TC-ARCHPLAT-009 standalone architecture can later adopt agent workflows without changing engine ownership',t=>{
 const f=fixture(t);applyPlan(createArchitecturePlan({source,target:f.target,config:{schemaVersion:1,applications:[]}}),{runRoot:f.runRoot});
 const p=createTemplatePlan({source,target:f.target});assert.equal(p.conflicts.length,0);applyPlan(p,{runRoot:f.runRoot});
 assert.equal(createTemplatePlan({source,target:f.target}).changes.length,0);
});
test('TC-OSSKIT-008 agent and workspace share root contributions in either adoption order and scoped updates',t=>{
 for(const first of ['agent','architecture']){
  const f=fixture(t),config={schemaVersion:2,workspace:{packageManager:'pnpm@10.18.3'},applications:[{id:'api',stack:'node-ts',path:'apps/api'}]};
  if(first==='agent')applyPlan(createTemplatePlan({source,target:f.target,scope:'agent'}),{runRoot:f.runRoot});
  applyPlan(createArchitecturePlan({source,target:f.target,config}),{runRoot:f.runRoot});
  const all=createTemplatePlan({source,target:f.target});assert.deepEqual(all.conflicts,[]);applyPlan(all,{runRoot:f.runRoot});
  const p=path.join(f.target,'package.json'),pkg=JSON.parse(fs.readFileSync(p));pkg.scripts.project='echo custom';fs.writeFileSync(p,JSON.stringify(pkg));fs.appendFileSync(path.join(f.target,'.gitignore'),'project-artifacts/\n');
  for(const scope of ['agent','architecture','all']){const plan=createTemplatePlan({source,target:f.target,scope});assert.deepEqual(plan.conflicts,[],scope);applyPlan(plan,{runRoot:f.runRoot});}
  const final=JSON.parse(fs.readFileSync(p));assert.ok(final.scripts.agent);assert.ok(final.scripts.build);assert.equal(final.scripts.project,'echo custom');assert.match(fs.readFileSync(path.join(f.target,'.gitignore'),'utf8'),/project-artifacts/);assert.equal(createTemplatePlan({source,target:f.target}).changes.length,0);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),source=path.resolve(import.meta.dirname,'../..');
const legacy=process.env.XIRANG_LEGACY_SOURCE;
if(!legacy||JSON.parse(fs.readFileSync(path.join(legacy,'package.json'))).version!=='3.1.0')throw new Error('XIRANG_LEGACY_SOURCE must point to an extracted v3.1.0 source snapshot');
const current=require('../scripts/project.js'),old=require(path.join(legacy,'architecture/scripts/project.js'));
const {createTemplatePlan}=require('../../tooling/xirang/template.js'),{applyPlan}=require('../../tooling/xirang/engine.js');
test('TC-MONOPLAT-009 real v3.1.0 consumer retains SQL history, UI and project-owned customization',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xirang-legacy-upgrade-')),target=path.join(root,'repo'),runRoot=path.join(root,'runs');
  fs.mkdirSync(target);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const config={schemaVersion:1,applications:[{id:'web',stack:'react-vite',path:'apps/web'},{id:'api',stack:'node',path:'apps/server'}],datastores:[{id:'main',engine:'postgres',path:'packages/database',consumers:['api']}],modules:[{id:'observability',path:'packages/logging'}]};
  const oldPlan=old.createArchitecturePlan({source:legacy,target,config});assert.deepEqual(oldPlan.conflicts,[]);applyPlan(oldPlan,{runRoot});
  const sentinels={};
  for(const file of ['apps/web/src/components/ui/button.tsx','packages/logging/index.mjs','apps/server/src/server.mjs']) {
    const abs=path.join(target,file);fs.appendFileSync(abs,'\n// Keep this project customization\n');sentinels[file]=fs.readFileSync(abs,'utf8');
  }
  for(const file of ['RULES.md','packages/database/prisma/schema.prisma','packages/database/migrations/9999_project.sql']){
    const abs=path.join(target,file);fs.mkdirSync(path.dirname(abs),{recursive:true});fs.writeFileSync(abs,'project owned sentinel\n');sentinels[file]=fs.readFileSync(abs,'utf8');
  }
  const packageFile=path.join(target,'apps/web/package.json'),pkg=JSON.parse(fs.readFileSync(packageFile));pkg.scripts.custom='echo project-owned';fs.writeFileSync(packageFile,JSON.stringify(pkg));
  const initialMigration=fs.readFileSync(path.join(target,'packages/database/migrations/0001_initial.sql'),'utf8');
  const plan=createTemplatePlan({source,target});assert.deepEqual(plan.conflicts,[]);applyPlan(plan,{runRoot});
  for(const [file,content]of Object.entries(sentinels))assert.equal(fs.readFileSync(path.join(target,file),'utf8'),content,file);
  assert.equal(JSON.parse(fs.readFileSync(packageFile)).scripts.custom,'echo project-owned');
  assert.equal(fs.readFileSync(path.join(target,'packages/database/migrations/0001_initial.sql'),'utf8'),initialMigration);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target,'architecture.config.json'))).schemaVersion,1);
  assert.equal(fs.existsSync(path.join(target,'pnpm-workspace.yaml')),false);
  assert.equal(createTemplatePlan({source,target}).changes.length,0);
  assert.equal(require(path.join(target,'tooling/xirang/vendor/yaml/lib/index.js')).parse('retained: true').retained,true);
  assert.equal(current.createArchitecturePlan({source,target,config:JSON.parse(fs.readFileSync(path.join(target,'architecture.config.json')))}).changes.length,0);
});

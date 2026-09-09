import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),source=path.resolve(import.meta.dirname,'../..'),legacy=process.env.XIRANG_LEGACY_SOURCE;
if(!legacy||JSON.parse(fs.readFileSync(path.join(legacy,'package.json'))).version!=='3.2.0')throw Error('Extracted v3.2.0 source required');
const old=require(path.join(legacy,'architecture/scripts/project.js')),current=require('../scripts/project.js');
const {createTemplatePlan}=require('../../tooling/xirang/template.js'),{applyPlan}=require('../../tooling/xirang/engine.js');
test('TC-OSSKIT-008 real v3.2 upgrade preserves custom schema, SQL, UI and accepts explicit capability adoption',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'xirang-33-')),target=path.join(root,'repo'),runRoot=path.join(root,'runs');fs.mkdirSync(target);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const config=old.expandBlueprint('admin-api',{source:legacy,database:'sqlite'});applyPlan(old.createArchitecturePlan({source:legacy,target,config}),{runRoot});
 const before=new Map();for(const file of ['packages/database/main/prisma/schema.prisma','packages/ui/src/ui/button.tsx','apps/api/src/server.ts']){const p=path.join(target,file);fs.appendFileSync(p,'\n// Preserve project customization\n');before.set(file,fs.readFileSync(p,'utf8'));}
 const schemaFile=[...before.keys()][0],sql=path.join(target,'packages/database/main/prisma/migrations/20260909000000_init/migration.sql'),sqlBefore=fs.readFileSync(sql,'utf8');
 const update=createTemplatePlan({source,target});assert.deepEqual(update.conflicts,[]);applyPlan(update,{runRoot});for(const [file,text]of before)assert.equal(fs.readFileSync(path.join(target,file),'utf8'),text);assert.equal(fs.readFileSync(sql,'utf8'),sqlBefore);assert.equal(createTemplatePlan({source,target}).changes.length,0);assert.equal(fs.existsSync(path.join(target,'packages/auth')),false);
 const adopted=JSON.parse(fs.readFileSync(path.join(target,'architecture.config.json')));adopted.modules.push({id:'auth',path:'packages/auth',options:{datastore:'main'}});adopted.applications.find(a=>a.id==='api').modules.push('auth');fs.writeFileSync(path.join(target,'architecture.config.json'),JSON.stringify(adopted));
 const p=current.createArchitecturePlan({source,target,config:adopted,scope:'architecture:module:auth'});assert.deepEqual(p.conflicts,[]);applyPlan(p,{runRoot});assert.equal(fs.readFileSync(path.join(target,schemaFile),'utf8'),before.get(schemaFile));assert.equal(fs.readFileSync(sql,'utf8'),sqlBefore);assert.ok(fs.existsSync(path.join(target,'packages/database/main/prisma/auth.prisma')));assert.match(fs.readFileSync(path.join(target,'packages/database/main/prisma.config.ts'),'utf8'),/schema:'prisma'/);assert.equal(current.createArchitecturePlan({source,target,config:adopted}).changes.length,0);
});

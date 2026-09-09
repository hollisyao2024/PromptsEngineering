const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const project = require('../scripts/project');
const { applyPlan } = require('../../tooling/xirang/engine');
const source = path.resolve(__dirname, '../..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-monorepo-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'repo'); fs.mkdirSync(target);
  return {target, runRoot: path.join(root, 'runs')};
}
const read = (f,p) => fs.readFileSync(path.join(f.target,p),'utf8');
const put = (f,p,v) => {fs.mkdirSync(path.dirname(path.join(f.target,p)),{recursive:true});fs.writeFileSync(path.join(f.target,p),v);};
function plan(f,config) {return project.createArchitecturePlan({source,target:f.target,config,includeRuntime:false});}
test('TC-MONOPLAT-001/008 four blueprints generate shared workspace once and converge', t => {
  for (const id of ['admin-api','fullstack','web-desktop','local-private']) {
    const f=fixture(t), config=project.expandBlueprint(id,{source,database:'sqlite'});
    const p=plan(f,config); assert.deepEqual(p.conflicts,[]); applyPlan(p,{runRoot:f.runRoot});
    const pkg=JSON.parse(read(f,'package.json'));
    assert.equal(pkg.packageManager,'pnpm@10.18.3');
    assert.match(pkg.scripts.build,/workspace/);
    assert.equal(pkg.pnpm.overrides['@prisma/config>deepmerge-ts'],'8.0.2');
    assert.equal(pkg.pnpm.overrides['@redocly/openapi-core>js-yaml'],'4.3.2');
    assert.match(read(f,'pnpm-workspace.yaml'),/packages\/database\/main/);
    for (const module of ['domain','contracts','api-client','query','platform','config','observability']) assert.ok(JSON.parse(read(f,`packages/${module}/package.json`)).exports,module);
    assert.ok(JSON.parse(read(f,'packages/ui/package.json')).exports['./ui/*']);
    assert.equal(JSON.parse(read(f,'apps/api/package.json')).dependencies['@project/database-main'],'workspace:*');
    for(const app of config.applications.filter(a=>a.stack!=='node-ts'))assert.match(read(f,app.path+'/src/styles.css'),/@source "\.\.\/\.\.\/\.\.\/packages\/ui\/src";/);
    assert.match(read(f,'packages/database/main/prisma/schema.prisma'),/provider = "sqlite"/);
    assert.ok(p.entries.filter(e=>e.path==='packages/ui/src/ui/button.tsx').length===1);
    assert.equal(plan(f,config).changes.length,0);
  }
});
test('TC-MONOPLAT-009 workspace merge retains project YAML and schema customizations', t=>{
  const f=fixture(t),config=project.expandBlueprint('admin-api',{source});
  put(f,'pnpm-workspace.yaml','# Project catalog\npackages:\n  - custom/*\ncatalog:\n  lodash: 4.17.21\n');
  put(f,'package.json',JSON.stringify({private:true,scripts:{custom:'echo custom'}}));
  let p=plan(f,config); assert.deepEqual(p.conflicts,[]);applyPlan(p,{runRoot:f.runRoot});
  assert.match(read(f,'pnpm-workspace.yaml'),/# Project catalog/);
  assert.match(read(f,'pnpm-workspace.yaml'),/custom\/\*/);
  assert.match(read(f,'pnpm-workspace.yaml'),/lodash/);
  const schema='// project-owned\n'+read(f,'packages/database/main/prisma/schema.prisma');
  put(f,'packages/database/main/prisma/schema.prisma',schema);
  p=plan(f,config);assert.deepEqual(p.conflicts,[]);assert.equal(p.changes.length,0);
  assert.equal(read(f,'packages/database/main/prisma/schema.prisma'),schema);
  assert.equal(JSON.parse(read(f,'package.json')).scripts.custom,'echo custom');
});
test('TC-MONOPLAT-002 v2 rejects Prisma browser/native consumers and incompatible stacks',t=>{
  const f=fixture(t);
  for(const consumer of ['admin','desktop']) {
    const config=project.expandBlueprint(consumer==='desktop'?'web-desktop':'admin-api',{source});
    config.datastores[0].consumers=[consumer];
    assert.throws(()=>project.validateConfig(config,{source,target:f.target}),/Prisma|browser/);
  }
  const config=project.expandBlueprint('admin-api',{source});
  config.workspace.packageManager='npm@11.0.0';
  assert.throws(()=>project.validateConfig(config,{source,target:f.target}),/pnpm/);
});
test('TC-MONOPLAT-008 unknown blueprint and unsupported database fail before mutation',()=>{
  assert.throws(()=>project.expandBlueprint('unknown',{source}),/blueprint/);
  assert.throws(()=>project.expandBlueprint('admin-api',{source,database:'mysql'}),/database/);
});
test('TC-MONOPLAT-001 minimal workspace and provider-specific install scripts remain valid',t=>{
  const f=fixture(t),config={schemaVersion:2,workspace:{packageManager:'pnpm@10.18.3'},applications:[],datastores:[],modules:[]};
  const p=plan(f,config);assert.deepEqual(p.conflicts,[]);applyPlan(p,{runRoot:f.runRoot});
  const yaml=require('../../tooling/xirang/vendor/yaml/lib');
  assert.deepEqual(yaml.parse(read(f,'pnpm-workspace.yaml')),{packages:[],onlyBuiltDependencies:[]});
  const pg=plan(fixture(t),project.expandBlueprint('admin-api',{source,database:'postgres'}));
  const workspace=pg.entries.find(e=>e.path==='pnpm-workspace.yaml');
  assert.ok(!workspace.after?.includes('better-sqlite3'));
});

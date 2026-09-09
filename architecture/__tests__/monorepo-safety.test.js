const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {planUpdate,applyPlan,mergeJsonValue}=require('../../tooling/xirang/engine');
const {mergeYaml,parseDocument}=require('../../tooling/xirang/yaml');
test('TC-MONOPLAT-009 YAML merge preserves unknown keys, comments and detects conflicting edits',()=>{
  const base='packages:\n  - apps/web\ncatalog:\n  react: 19.0.0\n';
  const local='# owned by project\n'+base+'custom: true\n';
  const upstream='packages:\n  - apps/web\n  - packages/db/main\ncatalog:\n  react: 19.2.8\n';
  const result=mergeYaml(base,local,upstream,mergeJsonValue);
  assert.equal(parseDocument(result).value.catalog.react,'19.2.8');assert.match(result,/# owned by project/);assert.match(result,/custom: true/);
  assert.equal(mergeYaml(upstream,result,upstream,mergeJsonValue),result);
  assert.throws(()=>mergeYaml(base,local.replace('19.0.0','19.1.0'),upstream,mergeJsonValue),/conflict/);
  for(const text of ['packages: []\npackages: []\n','__proto__: {}\n','a: !unknown value\n','- not-a-map\n'])assert.throws(()=>parseDocument(text));
  assert.throws(()=>mergeYaml(base,'packages: []\n',upstream,mergeJsonValue),/removed locally/);
});
test('TC-MONOPLAT-009 frozen YAML plan detects target drift before writes',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xirang-yaml-'));t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
  const target=path.join(root,'repo');fs.mkdirSync(target);fs.writeFileSync(path.join(target,'pnpm-workspace.yaml'),'packages: []\n');
  const p=planUpdate({target,assets:[{path:'pnpm-workspace.yaml',content:'packages:\n  - apps/web\n',strategy:'merge-yaml',owner:'test'}],packages:{}});
  fs.writeFileSync(path.join(target,'pnpm-workspace.yaml'),'packages: []\nchanged: true\n');
  assert.throws(()=>applyPlan(p,{runRoot:path.join(root,'runs')}),/changed|drift|stale/i);
  assert.equal(fs.existsSync(path.join(target,'xirang.lock.json')),false);
});
test('TC-MONOPLAT-003 Prisma migration history blocks missing, modified, duplicate and failed records',async()=>{
  const {verifyHistory}=await import(pathToFileURL(path.resolve(__dirname,'../stacks/data-access/prisma/migration-history.mjs')));
  const disk=[{name:'20260909000000_init',checksum:'a'},{name:'20260910000000_next',checksum:'b'}];
  const row={migration_name:disk[0].name,checksum:'a',finished_at:'2026-09-09',rolled_back_at:null};
  assert.deepEqual(verifyHistory(disk,[row]),{applied:[disk[0].name],pending:[disk[1].name]});
  assert.throws(()=>verifyHistory(disk.slice(1),[row]),/missing/);
  assert.throws(()=>verifyHistory(disk,[{...row,checksum:'wrong'}]),/checksum/);
  assert.throws(()=>verifyHistory(disk,[{...row,finished_at:null}]),/Failed/);
  assert.throws(()=>verifyHistory(disk,[row,row]),/Duplicate/);
  assert.equal(verifyHistory(disk,[{...row,finished_at:null,rolled_back_at:'2026-09-09'}]).pending.length,2);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createArchitecturePlan } = require('../scripts/project');
const { applyPlan } = require('../../tooling/xirang/engine');
const { validateUpstreamModuleAlignment } = require('../../infra/scripts/qa-tools/generate-qa');
const source = path.resolve(__dirname, '../..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-governance-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const target = path.join(root, 'repo'); fs.mkdirSync(target);
  return {target, runRoot:path.join(root, 'runs')};
}
const config = {schemaVersion:1, applications:[{id:'worker',stack:'node-ts',path:'apps/worker'}],datastores:[],modules:[]};
test('architecture init documents selection without inventing a functional governance module', t => {
  const f = fixture(t);
  applyPlan(createArchitecturePlan({source,target:f.target,config,includeRuntime:false}), {runRoot:f.runRoot});
  const summary = fs.readFileSync(path.join(f.target,'docs/architecture-selection.md'),'utf8');
  assert.match(summary,/worker.*node-ts/);
  assert.equal(fs.existsSync(path.join(f.target,'docs/arch-modules/application/ARCH.md')),false);
  assert.match(fs.readFileSync(path.join(f.target,'docs/ARCH.md'),'utf8'),/architecture-selection\.md/);
  assert.doesNotMatch(fs.readFileSync(path.join(f.target,'docs/arch-modules/module-list.md'),'utf8'),/application\/ARCH\.md/);
  assert.equal(createArchitecturePlan({source,target:f.target,config,includeRuntime:false}).changes.length,0);
});
test('architecture init preserves business governance and keeps QA upstream module alignment', t => {
  const f = fixture(t);const originals = new Map();
  for (const domain of ['prd','arch','task']) {
    const filename = `docs/${domain}-modules/foundation/${domain.toUpperCase()}.md`;
    fs.mkdirSync(path.dirname(path.join(f.target,filename)),{recursive:true});
    originals.set(filename,`# foundation ${domain}\n`);
    const index = `docs/${domain}-modules/module-list.md`;
    originals.set(index,`# ${domain} modules\n\n| foundation |\n`);
  }
  originals.set('docs/ARCH.md','# Existing architecture\n');
  for (const [filename,content] of originals) fs.writeFileSync(path.join(f.target,filename),content);
  applyPlan(createArchitecturePlan({source,target:f.target,config,includeRuntime:false}),{runRoot:f.runRoot});
  for (const [filename,content] of originals) assert.equal(fs.readFileSync(path.join(f.target,filename),'utf8'),content);
  const dirs = domain => fs.readdirSync(path.join(f.target,`docs/${domain}-modules`),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name);
  assert.deepEqual(validateUpstreamModuleAlignment(dirs('prd').map(moduleDir=>({moduleDir})),dirs('arch'),dirs('task')), {missingArch:[],extraArch:[],missingTask:[],extraTask:[]});
});

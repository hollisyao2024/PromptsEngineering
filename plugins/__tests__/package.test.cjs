'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {collectFiles,packagePlugin} = require('../pack.cjs');
const source=path.resolve(__dirname,'../xirang');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'xirang-package-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const plugin=path.join(root,'plugin');fs.cpSync(source,plugin,{recursive:true});
  return {root,plugin,output:path.join(root,'plugin.zip')};
}
test('both marketplaces resolve the same plugin and preserve manual installation',()=>{
  const root=path.resolve(__dirname,'../..');
  const claude=JSON.parse(fs.readFileSync(path.join(root,'.claude-plugin/marketplace.json')));
  const openai=JSON.parse(fs.readFileSync(path.join(root,'.agents/plugins/marketplace.json')));
  assert.equal(claude.plugins.length,1);assert.equal(openai.plugins.length,1);
  assert.equal(claude.plugins[0].name,'xirang');assert.equal(openai.plugins[0].name,'xirang');
  assert.equal(path.resolve(root,claude.plugins[0].source),source);
  assert.equal(path.resolve(root,openai.plugins[0].source.path),source);
  assert.equal(openai.plugins[0].policy.installation,'AVAILABLE');
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'plugin.json')));
  assert.equal(manifest.extensions['com.openai'].requires_local_executor,true);
  assert.equal(manifest.extensions['com.openai'].onboardingSkill,'./skills/xirang-setup/SKILL.md');
});
test('ZIP is self-contained and executable after unpacking without its source repository',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.plugin,'.env.local'),'PRIVATE_TEST_SENTINEL=secret');
  fs.mkdirSync(path.join(f.plugin,'node_modules'));fs.writeFileSync(path.join(f.plugin,'node_modules/leak'),'secret');
  const report=packagePlugin({source:f.plugin,output:f.output});
  assert.ok(report.files.includes('plugin.json'));
  assert.ok(!report.files.some(p=>/\.env|node_modules/u.test(p)));
  const unpacked=path.join(f.root,'unpacked');fs.mkdirSync(unpacked);
  const unzip=spawnSync('unzip',['-q',f.output,'-d',unpacked],{encoding:'utf8'});assert.equal(unzip.status,0,unzip.stderr);
  assert.deepEqual(collectFiles(unpacked),report.files);
  const target=path.join(f.root,'target');fs.mkdirSync(target);
  const run=spawnSync(process.execPath,[path.join(unpacked,'scripts/inspect-project.cjs'),'--project',target],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).status,'UNMANAGED');
  assert.deepEqual(fs.readdirSync(target),[]);
  for(const skill of ['xirang-setup','xirang-task','xirang-resume','xirang-deliver']) {
    const entry=path.join(unpacked,'skills',skill,'SKILL.md');
    const text=fs.readFileSync(entry,'utf8');
    for(const [,relative] of text.matchAll(/\]\(([^)]+)\)/gu)) {
      assert.ok(fs.existsSync(path.resolve(path.dirname(entry),relative)),skill+': '+relative);
    }
  }
});
test('existing archive and invalid output paths are never overwritten',t=>{
  const f=fixture(t);fs.writeFileSync(f.output,'sentinel');
  assert.throws(()=>packagePlugin({source:f.plugin,output:f.output}),/exists/u);
  assert.equal(fs.readFileSync(f.output,'utf8'),'sentinel');
  assert.throws(()=>packagePlugin({source:f.plugin,output:path.join(f.plugin,'inside.zip')}),/outside/u);
  assert.throws(()=>packagePlugin({source:f.plugin,output:path.join(f.root,'not-zip.txt')}),/\.zip/u);
});
test('symlinked payload is rejected before any output is created',t=>{
  const f=fixture(t);const icon=path.join(f.plugin,'assets/icon.svg');fs.unlinkSync(icon);
  fs.symlinkSync(path.join(f.plugin,'plugin.json'),icon);
  assert.throws(()=>packagePlugin({source:f.plugin,output:f.output}),/symbolic/u);
  assert.ok(!fs.existsSync(f.output));
});
test('missing payload and mismatched manifests fail before creating an archive',t=>{
  const f=fixture(t);const manifest=path.join(f.plugin,'.claude-plugin/plugin.json');
  const changed=JSON.parse(fs.readFileSync(manifest));changed.version='99.0.0';fs.writeFileSync(manifest,JSON.stringify(changed));
  assert.throws(()=>packagePlugin({source:f.plugin,output:f.output}),/identity/u);
  fs.unlinkSync(path.join(f.plugin,'references/workflow.md'));
  assert.throws(()=>collectFiles(f.plugin),/missing/u);
  assert.ok(!fs.existsSync(f.output));
});
test('manifest resources cannot escape the fixed package payload',t=>{
  const f=fixture(t),file=path.join(f.plugin,'plugin.json');
  const manifest=JSON.parse(fs.readFileSync(file));
  manifest.extensions['com.openai'].interface.logo='../outside.svg';fs.writeFileSync(file,JSON.stringify(manifest));
  assert.throws(()=>packagePlugin({source:f.plugin,output:f.output}),/resource/u);
  assert.ok(!fs.existsSync(f.output));
});
test('a skills-only package cannot silently acquire executable hook or MCP components',t=>{
  const f=fixture(t),file=path.join(f.plugin,'.claude-plugin/plugin.json');
  const manifest=JSON.parse(fs.readFileSync(file));manifest.hooks='./hooks/hooks.json';fs.writeFileSync(file,JSON.stringify(manifest));
  assert.throws(()=>packagePlugin({source:f.plugin,output:f.output}),/unsupported component/u);
  assert.ok(!fs.existsSync(f.output));
});
test('archive tool failure keeps the output absent and removes its own temporary directory',t=>{
  const f=fixture(t);
  assert.throws(()=>packagePlugin({source:f.plugin,output:f.output,zipCommand:path.join(f.root,'missing-zip')}),/zip/u);
  assert.ok(!fs.existsSync(f.output));
  assert.deepEqual(fs.readdirSync(f.root),['plugin']);
});

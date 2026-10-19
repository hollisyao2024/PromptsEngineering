'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {inspectProject} = require('../xirang/scripts/inspect-project.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-inspect-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  return root;
}
function write(root, file, value) {
  fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});
  fs.writeFileSync(path.join(root,file),value);
}
function adopted(root) {
  for (const file of ['AGENTS.md','docs/CONVENTIONS.md','RULES.md']) write(root,file,'project rules\n');
  write(root,'agent.config.json','{}\n');
  write(root,'xirang.lock.json','{}\n');
  write(root,'infra/scripts/agent-runner/agent-cli.js','throw new Error("must never execute project code");\n');
  write(root,'package.json',JSON.stringify({scripts:{agent:'node infra/scripts/agent-runner/agent-cli.js'}}));
  fs.mkdirSync(path.join(root,'.xirang/baselines'),{recursive:true});
  write(root,'.xirang/baselines/fixture.json','{}\n');
}
function git(root,...args) {
  const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  return result.stdout.trim();
}

test('empty directory is unmanaged and inspection creates no files',t=>{
  const root=fixture(t);
  assert.equal(inspectProject(root).status,'UNMANAGED');
  assert.deepEqual(fs.readdirSync(root),[]);
});
test('an adopted directory without Git needs initialization, not a mutation attempt',t=>{
  const root=fixture(t); adopted(root);
  assert.equal(inspectProject(root).status,'NEEDS_GIT');
});
test('ready project is read without executing its CLI or exposing environment contents',t=>{
  const root=fixture(t); adopted(root); git(root,'init','--quiet');
  write(root,'.env.local','PRIVATE_TEST_SENTINEL=do-not-return\n');
  const report=inspectProject(root);
  assert.equal(report.status,'READY');
  assert.equal(report.worktreeKind,'main');
  assert.ok(!JSON.stringify(report).includes('do-not-return'));
  assert.equal(fs.readFileSync(path.join(root,'.env.local'),'utf8'),'PRIVATE_TEST_SENTINEL=do-not-return\n');
});
test('missing and empty project rules block rather than guessing defaults',t=>{
  const root=fixture(t); adopted(root); git(root,'init','--quiet');
  fs.unlinkSync(path.join(root,'RULES.md'));
  assert.equal(inspectProject(root).status,'INCOMPLETE');
  write(root,'RULES.md',' \n');
  assert.ok(inspectProject(root).problems.some(p=>p.includes('RULES.md')));
});
test('invalid config and substituted package command are reported without execution',t=>{
  const root=fixture(t); adopted(root); git(root,'init','--quiet');
  write(root,'agent.config.json','{');
  assert.equal(inspectProject(root).status,'INCOMPLETE');
  write(root,'agent.config.json','{}');
  write(root,'package.json',JSON.stringify({scripts:{agent:'touch unexpected-file'}}));
  assert.equal(inspectProject(root).status,'INCOMPLETE');
  assert.ok(!fs.existsSync(path.join(root,'unexpected-file')));
  write(root,'package.json',JSON.stringify({scripts:{agent:42}}));
  assert.equal(inspectProject(root).status,'INCOMPLETE');
  write(root,'package.json',JSON.stringify({scripts:{agent:'node infra/scripts/agent-runner/agent-cli.js'}}));
  fs.unlinkSync(path.join(root,'infra/scripts/agent-runner/agent-cli.js'));
  fs.mkdirSync(path.join(root,'infra/scripts/agent-runner/agent-cli.js'));
  assert.equal(inspectProject(root).status,'INCOMPLETE');
});
test('official source may omit RULES but an unrelated source-role repository may not',t=>{
  const root=fixture(t); adopted(root); git(root,'init','--quiet');
  write(root,'agent.config.json',JSON.stringify({template:{role:'source'}}));
  assert.equal(inspectProject(root).status,'INCOMPLETE');
  fs.unlinkSync(path.join(root,'RULES.md'));
  assert.equal(inspectProject(root).status,'INCOMPLETE');
  git(root,'remote','add','origin','https://github.com/hollisyao2024/PromptsEngineering.git');
  assert.equal(inspectProject(root).status,'SOURCE');
});
test('linked worktree is identified and a nested cwd resolves to its actual root',t=>{
  const root=fixture(t); const main=path.join(root,'repo'); fs.mkdirSync(main);
  adopted(main); git(main,'init','--quiet'); git(main,'add','.');
  git(main,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgSign=false','commit','--quiet','-m','fixture');
  const linked=path.join(root,'linked'); git(main,'worktree','add','--quiet','-b','fixture-task',linked);
  const report=inspectProject(path.join(linked,'docs'));
  assert.equal(report.projectRoot,fs.realpathSync(linked));
  assert.equal(report.worktreeKind,'linked');
  assert.equal(report.status,'READY');
});
test('missing paths and unavailable Git have explicit diagnostic outcomes',t=>{
  const root=fixture(t);
  assert.throws(()=>inspectProject(path.join(root,'missing')),/directory/u);
  adopted(root);
  const report=inspectProject(root,{gitCommand:path.join(root,'missing-git')});
  assert.equal(report.status,'NEEDS_GIT');
  assert.equal(report.gitAvailable,false);
});

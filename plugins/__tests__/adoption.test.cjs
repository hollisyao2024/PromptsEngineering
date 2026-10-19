'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {inspectProject} = require('../xirang/scripts/inspect-project.cjs');
const source = path.resolve(__dirname,'../..');

test('real updater adoption and local-remote task commands isolate two worktrees', {timeout:180000}, t => {
  const fixture=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'xirang-adoption-')));
  t.after(()=>fs.rmSync(fixture,{recursive:true,force:true}));
  const project=path.join(fixture,'repo');fs.mkdirSync(project);
  fs.writeFileSync(path.join(project,'README.md'),'project-owned sentinel\n');
  function run(cwd,command,args) {
    const result=spawnSync(command,args,{cwd,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
    assert.equal(result.status,0,`${command} ${args.join(' ')}\n${result.error?.message||''}\n${result.stdout.slice(-5000)}\n${result.stderr}`);
    return result.stdout;
  }
  const update=run(source,process.execPath,['infra/scripts/setup/update-template.js',project,'--scope','agent']);
  assert.match(update,/CONVERGENCE_STATUS=OK/u);
  assert.equal(fs.readFileSync(path.join(project,'README.md'),'utf8'),'project-owned sentinel\n');
  assert.ok(!fs.existsSync(path.join(project,'plugins')),'source plugin must not leak into adopted projects');
  assert.ok(!fs.existsSync(path.join(project,'.claude-plugin')));
  assert.ok(!fs.existsSync(path.join(project,'.agents/plugins/marketplace.json')));
  // The fixture has its own identity and a local bare remote; no user credentials or external service.
  run(project,'git',['init','--quiet','-b','main']);
  run(project,'git',['add','.']);
  run(project,'git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgSign=false','commit','--quiet','-m','adopt fixture']);
  const remote=path.join(fixture,'remote.git');run(fixture,'git',['init','--quiet','--bare',remote]);
  run(project,'git',['remote','add','origin',remote]);
  const auth=path.join(project,'infra/scripts/shared/github-auth-run.js');
  run(project,process.execPath,[auth,'--','git','push','-u','origin','main']);
  function agent(cwd,...args) {return run(cwd,process.execPath,[path.join(cwd,'infra/scripts/agent-runner/agent-cli.js'),...args]);}
  const worktrees=[];
  for (const id of ['demo-a','demo-b']) {
    agent(project,'task','start','--task',id,'--phase','tdd','--type','mutation','--desc','isolated fixture','--acceptance','one task owns one file','--verify-step','create worktree','--verify-step','write own file');
    agent(project,'task','checkpoint','--task',id,'--step','S1','--status','running','--evidence','fixture setup');
    const created=agent(project,'worktree','new','--phase=tdd','--task',id);
    assert.match(created,/BASE_FRESHNESS=VERIFIED/u);
    const cwd=created.match(/^NEXT_CWD=(.+)$/mu)?.[1];assert.ok(cwd);
    assert.equal(inspectProject(cwd).status,'READY');
    agent(cwd,'task','checkpoint','--task',id,'--step','S1','--status','done','--evidence','worktree created');
    agent(cwd,'task','checkpoint','--task',id,'--step','S2','--status','running','--evidence','writing one fixture file');
    fs.writeFileSync(path.join(cwd,'docs',id+'.md'),'# '+id+'\n');
    worktrees.push(cwd);
  }
  assert.notEqual(worktrees[0],worktrees[1]);
  assert.ok(!fs.existsSync(path.join(project,'docs/demo-a.md')));
  assert.ok(!fs.existsSync(path.join(worktrees[0],'docs/demo-b.md')));
  assert.ok(!fs.existsSync(path.join(worktrees[1],'docs/demo-a.md')));
  assert.match(run(worktrees[0],'git',['status','--porcelain']),/docs\/demo-a.md/u);
  assert.doesNotMatch(run(worktrees[0],'git',['status','--porcelain']),/demo-b/u);
  // Unknown mutation results become verification work; resuming must not duplicate the write.
  const resumed=agent(worktrees[0],'task','resume','--task','demo-a');
  assert.match(resumed,/AUTO_CONTINUE=false/u);
  assert.match(resumed,/CONTINUATION_ACTION=RESOLVE_BLOCKER/u);
  const stateFile=resumed.match(/^STATE_PATH=(.+)$/mu)?.[1];assert.ok(stateFile);
  const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  assert.equal(state.steps.find(step=>step.id==='S2').status,'verify_required');
  assert.equal(fs.readFileSync(path.join(worktrees[0],'docs/demo-a.md'),'utf8'),'# demo-a\n');
});

#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { catalog, validateConfig, detectProject, createArchitecturePlan, CONFIG, walk, expandBlueprint } = require('./project');
const { checkProject } = require('../checks/project-check');
const { applyPlan, resumePlan, json, read, parseJson, atomicWrite, safePath } = require('../../tooling/xirang/engine');
function args(argv) {
  const result={action:argv[0]||'help'}; const values=new Set(['target','source','config','out','plan','scope','run-root','blueprint','database']);
  for(let i=1;i<argv.length;i++) {
    const [key,...rest]=argv[i].replace(/^--/,'').split('=');
    if(values.has(key)) { const value=rest.length?rest.join('='):argv[++i];if(!value||value.startsWith('--'))throw new Error(`--${key} requires a value`);result[key]=value; }
    else if(['dry-run','no-install','write'].includes(key)) {if(rest.length)throw new Error(`--${key} does not take a value`);result[key]=true;}
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return result;
}
function runtimeRoot(target) {
  // Reuse the workflow path resolver when installed; standalone architecture uses sibling tmp.
  const helper=path.resolve(__dirname,'../../infra/scripts/shared/config.js');
  if(fs.existsSync(helper)) { const {loadConfig,getMainRepoRoot,resolveContainerPath}=require(helper); return path.join(resolveContainerPath(loadConfig({repoRoot:target}),getMainRepoRoot(target),'tmp'),'xirang-runs'); }
  return path.resolve(target,'../tmp/xirang-runs');
}
const { assertMutationTarget } = require('../../tooling/xirang/target');
function installDependencies(target, config) {
  if(config.schemaVersion===2) {
    const script=process.env.npm_execpath;
    if(process.platform==='win32'&&!script)throw new Error('Invoke through pnpm agent on Windows');
    for(const args of [['install'],['run','generate']]) {
      const r=spawnSync(script?process.execPath:'pnpm',[...(script?[script]:[]),...args],{cwd:target,stdio:'inherit',shell:false});
      if(r.error||r.status!==0)throw new Error('Workspace dependency install/generation failed');
    }
    return {status:'OK',directories:['.'],lockfile:'pnpm-lock.yaml'};
  }
  const directories=new Set([...config.applications.map(a=>a.path),...config.datastores.map(d=>d.path), ...config.applications.flatMap(a=>Object.values(a.components||{}).filter(p=>p.startsWith('packages/')).map(p=>p.split('/').slice(0,2).join('/')))].filter(p=>read(target,`${p}/package.json`)!==null));
  for(const directory of directories) {
    const root=safePath(target,directory);
    const pnpmScript=process.env.npm_execpath;
    if(process.platform==='win32'&&!pnpmScript)throw new Error('On Windows invoke via pnpm agent, or pnpm exec node architecture/scripts/cli.js');
    const result=spawnSync(pnpmScript?process.execPath:'pnpm',[...(pnpmScript?[pnpmScript]:[]),'install','--ignore-workspace','--ignore-scripts'],{cwd:root,stdio:'inherit',shell:false});
    if(result.error||result.status!==0)throw new Error(`Dependency install failed for ${directory}`);
  }
  return {status:'OK',directories:[...directories]};
}
function printPlan(plan) {
  console.log(`STATUS=${plan.conflicts.length?'BLOCKED':'PLANNED'}\nPLAN_ID=${plan.id}\nCHANGED_FILES=${plan.changes.length}`);
  for(const entry of plan.entries) if(entry.reason||entry.before!==entry.afterHash) console.log(`${entry.reason?'conflict':entry.before===null?'create':entry.strategy}\t${entry.path}${entry.reason?`\t${entry.reason}`:''}`);
  console.log(`NEXT_ACTION=${plan.conflicts.length?'Resolve conflicts or review explicit adoption':'Apply this plan, install dependencies and run architecture check'}`);
}
function main(argv=process.argv.slice(2)) {
  const cli=args(argv),target=path.resolve(cli.target||process.cwd()),source=path.resolve(cli.source||path.join(__dirname,'../..'));
  if(cli.action==='help') {console.log('Usage: pnpm agent -- architecture <catalog|detect|validate|plan|init|update|adopt|apply|resume|check|install-deps> [--target path] [--config file] [--scope owner] [--out file] [--plan file] [--dry-run] [--no-install] [--blueprint id --database postgres|sqlite]\nStandalone: node architecture/scripts/cli.js <action>');return;}
  if(cli.action==='catalog'){console.log(json(catalog(source)));return;}
  if(cli.action==='detect'){console.log(json(detectProject(target)));return;}
  if(!fs.existsSync(target))throw new Error('Target directory must exist');
  const runRoot=cli['run-root']?path.resolve(cli['run-root']):runtimeRoot(target);
  if(cli.action==='resume'){assertMutationTarget(target);console.log(json(resumePlan(target,{runRoot})));return;}
  if(cli.action==='apply') {
    if(!cli.plan)throw new Error('--plan required');assertMutationTarget(target);
    const plan=parseJson(fs.readFileSync(cli.plan,'utf8'),'plan');if(path.resolve(plan.target)!==target)throw new Error('Plan target mismatch');
    console.log(json(applyPlan(plan,{runRoot})));console.log('DEPENDENCIES=NOT_RUN\nNEXT_ACTION=architecture install-deps followed by architecture check');return;
  }
  const configFile=cli.config?path.resolve(cli.config):path.join(target,CONFIG);
  if(cli.database&&!cli.blueprint)throw new Error('--database requires --blueprint');
  if(cli.blueprint&&(cli.config||read(target,CONFIG)!==null||!['init','plan'].includes(cli.action)))throw new Error('Blueprint expansion is only allowed for new init/plan choices');
  const config=validateConfig(cli.blueprint?expandBlueprint(cli.blueprint,{source,database:cli.database}):parseJson(fs.readFileSync(configFile,'utf8'),CONFIG),{target,source});
  if(cli.action==='validate'){console.log('STATUS=OK');return;}
  if(cli.action==='check'){const result=checkProject(target,config,{source});console.log(json(result));if(result.status!=='OK')process.exitCode=1;return;}
  if(cli.action==='install-deps'){assertMutationTarget(target);console.log(json(installDependencies(target,config)));return;}
  if(!['plan','init','update','adopt'].includes(cli.action))throw new Error(`Unknown architecture action: ${cli.action}`);
  const plan=createArchitecturePlan({source,target,config,scope:cli.scope,adopt:cli.action==='adopt'});printPlan(plan);
  if(cli.out) {
    const out=path.resolve(cli.out);if(out===target||out.startsWith(target+path.sep))throw new Error('Save frozen plans outside the project (container tmp)');
    atomicWrite(out,json(plan),0o600);console.log(`PLAN_PATH=${out}`);
  }
  if(plan.conflicts.length){process.exitCode=1;return;}
  if(cli.action==='plan'||cli['dry-run']||(cli.action==='adopt'&&!cli.write))return;
  assertMutationTarget(target);console.log(json(applyPlan(plan,{runRoot})));
  const convergence=createArchitecturePlan({source,target,config,scope:cli.scope});
  if(convergence.conflicts.length||convergence.changes.length)throw new Error('Architecture convergence failed');
  console.log('CONVERGENCE_STATUS=OK');
  if(!cli['no-install']) {
    installDependencies(target,config);
    const check=checkProject(target,config,{source});console.log(json(check));if(check.status!=='OK')throw new Error('Architecture checks failed');console.log('DEPENDENCIES=INSTALLED');
  } else console.log('DEPENDENCIES=PENDING\nNEXT_ACTION=architecture install-deps followed by architecture check');
}
if(require.main===module)try{main();}catch(error){console.error(`STATUS=BLOCKED\nREASON=${error.message}\nNEXT_ACTION=Resolve the reported condition; preserve any active journal and resume after verification`);process.exitCode=1;}
module.exports={main,args,runtimeRoot,installDependencies,assertMutationTarget};

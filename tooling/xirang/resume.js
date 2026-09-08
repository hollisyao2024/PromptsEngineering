#!/usr/bin/env node
const path=require('node:path');
const {resumePlan,json}=require('./engine');
const {assertMutationTarget}=require('./target');
const {loadConfig,getMainRepoRoot,resolveContainerPath}=require('../../infra/scripts/shared/config');
try {
 const target=process.cwd(),config=loadConfig({repoRoot:target});
 assertMutationTarget(target);
 const runRoot=path.join(resolveContainerPath(config,getMainRepoRoot(target),'tmp'),'xirang-runs');
 console.log(json(resumePlan(target,{runRoot})));
 console.log('NEXT_ACTION=Rerun template dry-run, project checks and delivery gates');
}catch(error){console.error(`STATUS=BLOCKED\nREASON=${error.message}`);process.exitCode=1;}

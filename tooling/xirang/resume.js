#!/usr/bin/env node
const path=require('node:path');
const {resumePlan,json}=require('./engine');
const {assertMutationTarget}=require('./target');
const {containerPath}=require('./source-cache');
try {
 const target=process.cwd();
 assertMutationTarget(target);
 const runRoot=path.join(containerPath(target,'tmp'),'xirang-runs');
 console.log(json(resumePlan(target,{runRoot})));
 console.log('NEXT_ACTION=Rerun template dry-run, project checks and delivery gates');
}catch(error){console.error(`STATUS=BLOCKED\nREASON=${error.message}`);process.exitCode=1;}

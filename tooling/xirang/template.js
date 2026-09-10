const fs = require('node:fs');
const path = require('node:path');
const { planUpdate, readLock, safePath, read, parseJson, hash, json, applyPlan, atomicWrite } = require('./engine');

function walk(root, relative = '') {
  const result=[];
  for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    if(['.git','node_modules','.DS_Store'].includes(entry.name))continue;
    const p=relative?`${relative}/${entry.name}`:entry.name;
    if(entry.isSymbolicLink())throw new Error(`source symlink: ${p}`);
    if(entry.isDirectory())result.push(...walk(root,p));else if(entry.isFile())result.push(p);
  }
  return result;
}
function buildAgentAssets(source,target,manifestPath='infra/templates/agent/template.manifest.json') {
  const assets=[],inputs=[];
  const readSource=p=>{const file=safePath(source,p),text=fs.readFileSync(file,'utf8');inputs.push({path:file,hash:hash(text)});return text;};
  const manifest=parseJson(readSource(manifestPath),'agent manifest');
  const rules=manifest.rules||[];
  const effective=p=>rules.filter(rule=>p===rule.path||p.startsWith(rule.path+'/')).sort((a,b)=>b.path.length-a.path.length)[0];
  for(const rule of rules) {
    if(['project-owned','generated','exclude','opt-in'].includes(rule.strategy))continue;
    if(rule.strategy==='remove') {assets.push({path:rule.path,content:null,strategy:'remove',owner:'agent',version:manifest.templateVersion});continue;}
    const from=rule.source||rule.path, sourcePath=safePath(source,from);
    if(!fs.existsSync(sourcePath))throw new Error(`source missing: ${from}`);
    const directory=fs.statSync(sourcePath).isDirectory();
    for(const relative of directory?walk(sourcePath):['']) {
      const p=relative?`${rule.path}/${relative}`:rule.path;
      if(effective(p)!==rule)continue;
      let content=readSource(relative?`${from}/${relative}`:from),strategy=rule.strategy;
      if(strategy==='merge-package-scripts'){content=json({scripts:parseJson(content,from).scripts||{}});strategy='merge-json';}
      if(strategy==='append-block')strategy='managed-block';
      // Existing JSONC comments are preserved as text and participate in diff3 updates.
      if(strategy==='merge-jsonc')strategy='update';
      assets.push({path:p,content,strategy,owner:'agent',version:manifest.templateVersion,marker:rule.marker,mode:fs.statSync(safePath(source,relative?`${from}/${relative}`:from)).mode&0o777});
    }
  }
  return {assets:assets.map(asset=>require('./root-contributions').preserveRootContribution(asset,target)),inputs,version:manifest.templateVersion};
}
function createTemplatePlan({source,target,scope='all',adopt=false,manifestPath,include=[]}) {
  if(path.resolve(source)===path.resolve(target))throw new Error('Template source cannot apply onto itself');
  const installed=readLock(target),assets=[],inputs=[],packages={};
  if(!['all','agent','architecture'].includes(scope)&&!scope.startsWith('architecture:'))throw new Error('scope must be all, agent, architecture or an installed architecture owner');
  if(scope==='all'||scope==='agent') {
    const agent=buildAgentAssets(source,target,manifestPath);assets.push(...agent.assets);inputs.push(...agent.inputs);
    packages.agent={version:agent.version};
  }
  const hasArchitecture=!!installed.packages['architecture:standards'];
  if(scope==='agent' && include.length) throw new Error('agent scope cannot include architecture');
  const includeKit=scope!=='agent'&&(include.includes('architecture')||include.includes('all')||installed.packages['architecture:runtime']||hasArchitecture);
  if(scope!=='agent'&&(hasArchitecture||scope!=='all')) {
    const configText=read(target,'architecture.config.json');
    if(!configText)throw new Error('Architecture update requires an adopted architecture.config.json');
    const {buildArchitectureAssets,validateConfig}=require('../../architecture/scripts/project');
    const config=parseJson(configText,'architecture.config.json');
    // Ordinary template upgrades may only update installed selections. Added/changed choices require architecture init/update.
    const selectionKeys=[...(config.applications||[]).map(a=>`architecture:app:${a.id}`),...(config.datastores||[]).map(d=>`architecture:store:${d.id}`),...(config.modules||[]).map(m=>`architecture:module:${m.id}`),...(config.profiles||[]).map(p=>`architecture:profile:${p.id}`)];
    if(config.fileStorage)selectionKeys.push('architecture:file-storage');
    if(selectionKeys.some(key=>!installed.packages[key]))throw new Error('New architecture choices need architecture init/update before template sync');
    const built=buildArchitectureAssets({source,target,config,includeRuntime:false,scope:scope==='all'?'architecture':scope});
    for (const [owner, value] of Object.entries(built.packages)) {
      const previous = installed.packages[owner];
      if (!previous?.parametersHash || previous.parametersHash === value.parametersHash || owner === 'architecture:standards') continue;
      // Additive schema defaults do not change a consumer's chosen architecture.
      if (owner.startsWith('architecture:app:') && previous.selection) {
        const legacy = { ...config, applications: config.applications.map(app => app.id === previous.selection.id ? previous.selection : app) };
        const normalized = validateConfig(legacy, { source, target }).applications.find(app => app.id === previous.selection.id);
        if (JSON.stringify(normalized) === JSON.stringify(value.selection)) continue;
      }
      throw new Error(`Architecture selection changed: ${owner}; use architecture update`);
    }
    assets.push(...built.assets);inputs.push(...built.inputs);Object.assign(packages,built.packages);
  }
  if(includeKit) {
    const kit=require('./architecture-kit').buildRuntimeAssets({source,target});
    assets.push(...kit.assets);inputs.push(...kit.inputs);Object.assign(packages,kit.packages);
  }
  // The runtime engine is shared; one owner consistently manages it regardless of entry point.
  for(const asset of assets)if(asset.path.startsWith('tooling/xirang/'))asset.owner='xirang:engine';
  const unique=new Map();
  for(const asset of assets){if(unique.has(asset.path)){const old=unique.get(asset.path),combined=require('./root-contributions').mergeRootContributions(old,asset,target);if(combined)unique.set(asset.path,combined);else if(old.content!==asset.content||old.strategy!==asset.strategy||old.owner!==asset.owner)throw new Error(`duplicate template owner: ${asset.path}`);}else unique.set(asset.path,asset);}
  const {spawnSync}=require('node:child_process');const commit=spawnSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8',shell:false});
  const identity={id:'xirang',commit:commit.status===0?commit.stdout.trim():null};
  if(packages.agent)packages.agent.source=identity;
  if(packages['architecture:runtime'])packages['architecture:runtime'].source=identity;
  return planUpdate({target,source:identity,assets:[...unique.values()],inputs,packages,adopt});
}
function print(plan,write) {
  const counts={};
  console.log(`STATUS=${plan.conflicts.length?'BLOCKED':write?'UPDATED':'DRY_RUN'}\nPLAN_ID=${plan.id}`);
  const details=plan.entries.map(entry=>{
    const status=entry.reason?'blocked':entry.before===entry.afterHash?'unchanged':entry.before===null?'created':entry.after===null?'removed':'updated';counts[status]=(counts[status]||0)+1;
    return `${status}\t${entry.strategy}\t${entry.path}${entry.reason?`\tconflicts=${entry.reason}`:''}`;
  });
  for(const p of plan.metadataChanges||[]){counts.updated=(counts.updated||0)+1;details.push(`updated\tmetadata\t${p}`);}
  console.log(`COUNTS=${JSON.stringify(counts)}\nDETAILS_START\n${details.join('\n')}\nDETAILS_END`);
  console.log('NEXT_ACTION=Review conflicts and plan; explicit adopt is required for existing files without baseline');
}
function runTemplate(args,source,target) {
  const plan=args.plan?parseJson(fs.readFileSync(args.plan,'utf8'),'plan'):createTemplatePlan({source,target,scope:args.scope||'all',adopt:!!args.adopt,manifestPath:args.manifest,include:args.include||[]});
  if(path.resolve(plan.target)!==path.resolve(target))throw new Error('plan target mismatch');
  if(args['plan-out'])atomicWrite(path.resolve(args['plan-out']),json(plan),0o600);
  if(args.write) {
    const runRoot=path.join(require('./source-cache').containerPath(target,'tmp'),'xirang-runs');
    if(plan.conflicts.length)throw new Error('Resolve template conflicts before applying');
    require('./source-cache').preparePlanSource(plan,source);
    applyPlan(plan,{runRoot});
  }
  print(plan,!!args.write);
  if(plan.conflicts.length)process.exitCode=1;
}
module.exports={buildAgentAssets,createTemplatePlan,runTemplate};

const fs = require('node:fs');
const path = require('node:path');
function runArchitectureCheck(repoRoot) {
  const configFile=path.join(repoRoot,'architecture.config.json');
  if(!fs.existsSync(configFile))return {status:'SKIPPED',reason:'project has not selected architecture'};
  const checker=path.join(repoRoot,'architecture/checks/project-check.js');
  if(!fs.existsSync(checker))throw new Error('architecture.config.json exists but architecture package is missing; install it explicitly');
  const result=require(checker).checkProject(repoRoot,JSON.parse(fs.readFileSync(configFile,'utf8')),{source:repoRoot});
  if(result.status!=='OK')throw new Error(`Architecture check failed: ${result.failures.map(f=>`${f.name}: ${f.reason}`).join('; ')}`);
  return result;
}
module.exports={runArchitectureCheck};

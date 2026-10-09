const fs = require('node:fs');
const path = require('node:path');
function runArchitectureCheck(repoRoot, { warn = line => process.stderr.write(`${line}\n`) } = {}) {
  if (!fs.existsSync(path.join(repoRoot, 'architecture.config.json'))) return {status:'SKIPPED',reason:'project has not selected architecture'};
  const { read, readLock, parseJson, safePath } = require('../../../tooling/xirang/engine');
  const { POINTER } = require('../../../tooling/xirang/source-cache');
  const { resolveRuntimeSource } = require('../../../tooling/xirang/architecture-runtime');
  const content = read(repoRoot, 'architecture.config.json');
  const config = parseJson(content, 'architecture.config.json'), lock = readLock(repoRoot);
  const onDemand = read(repoRoot, POINTER) !== null || lock.files[POINTER]
    || lock.packages['architecture:runtime']?.selection?.mode === 'on-demand';
  // A missing/corrupt on-demand pointer must not fall back to leftover legacy code.
  const source = onDemand ? resolveRuntimeSource(repoRoot).sourceRoot : repoRoot;
  const checker=safePath(source,'architecture/checks/project-check.js');
  if(!fs.existsSync(checker))throw new Error('architecture.config.json exists but architecture package is missing; install it explicitly');
  const result=require(checker).checkProject(repoRoot,config,{source});
  // Advisory warnings (ADR-040) are surfaced before any failure and never change the gate result.
  // Older pinned checkers return no warnings field.
  for(const w of result.warnings||[])warn(`ARCHITECTURE_WARNING=${w.name}|${w.code}|${String(w.reason).replace(/\r?\n/g,' ')}`);
  if(result.status!=='OK')throw new Error(`Architecture check failed: ${result.failures.map(f=>`${f.name}: ${f.reason}`).join('; ')}`);
  return result;
}
module.exports={runArchitectureCheck};

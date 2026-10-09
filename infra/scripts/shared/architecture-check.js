const fs = require('node:fs');
const path = require('node:path');

const ARCHITECTURE_CHECK_NEXT_ACTION = {
  ARCHITECTURE_PACKAGE_MISSING: 'pnpm agent -- template sync --include architecture',
  ARCHITECTURE_CHECK_FAILED: 'run `pnpm agent -- architecture check`, fix the listed failures, then rerun the gate',
};

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.nextAction = ARCHITECTURE_CHECK_NEXT_ACTION[code];
  return error;
}

function runArchitectureCheck(repoRoot, { warn = line => process.stderr.write(`${line}\n`) } = {}) {
  if (!fs.existsSync(path.join(repoRoot, 'architecture.config.json'))) return {status:'SKIPPED',reason:'project has not selected architecture'};
  const { read, readLock, parseJson, safePath } = require('../../../tooling/xirang/engine');
  const { POINTER } = require('../../../tooling/xirang/source-cache');
  const { resolveRuntimeSource } = require('../../../tooling/xirang/architecture-runtime');
  const content = read(repoRoot, 'architecture.config.json');
  const config = parseJson(content, 'architecture.config.json'), lock = readLock(repoRoot);
  const onDemand = read(repoRoot, POINTER) !== null || lock.files[POINTER]
    || lock.packages['architecture:runtime']?.selection?.mode === 'on-demand';
  const source = onDemand ? resolveRuntimeSource(repoRoot).sourceRoot : repoRoot;
  const checker=safePath(source,'architecture/checks/project-check.js');
  if(!fs.existsSync(checker))throw codedError('ARCHITECTURE_PACKAGE_MISSING','architecture.config.json exists but architecture package is missing; install it explicitly');
  const result=require(checker).checkProject(repoRoot,config,{source});
  for(const w of result.warnings||[])warn(`ARCHITECTURE_WARNING=${w.name}|${w.code}|${String(w.reason).replace(/\r?\n/g,' ')}`);
  if(result.status!=='OK')throw codedError('ARCHITECTURE_CHECK_FAILED',`Architecture check failed: ${result.failures.map(f=>`${f.name}: ${f.reason}`).join('; ')}`);
  return result;
}
module.exports={ARCHITECTURE_CHECK_NEXT_ACTION,runArchitectureCheck};

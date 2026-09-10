const fs = require('node:fs');
const path = require('node:path');
const { read, readLock, parseJson, hash, safePath, json, resumePlan } = require('./engine');
const { POINTER, validateDescriptor, resolveSource, containerPath } = require('./source-cache');

function parseArgs(argv) {
  const result = { action: argv[0] || 'help' };
  const values = new Set(['target', 'source', 'config', 'out', 'plan', 'scope', 'run-root', 'blueprint', 'database']);
  for (let i = 1; i < argv.length; i++) {
    const [key, ...rest] = argv[i].replace(/^--/, '').split('=');
    if (values.has(key)) {
      const value = rest.length ? rest.join('=') : argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
      result[key] = value;
    } else if (['dry-run', 'no-install', 'write'].includes(key)) {
      if (rest.length) throw new Error(`--${key} does not take a value`);
      result[key] = true;
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return result;
}

function readRuntimeDescriptor(runtimeRoot) {
  const content = read(runtimeRoot, POINTER), record = readLock(runtimeRoot).files[POINTER];
  if (!content || !record || record.owner !== 'architecture:runtime' || record.base !== hash(content)) throw new Error('Missing or modified architecture runtime pointer; run template sync --include architecture');
  return validateDescriptor(parseJson(content, POINTER));
}

function resolveRuntimeSource(runtimeRoot, { target = runtimeRoot, source } = {}) {
  return resolveSource({ target, source, descriptor: readRuntimeDescriptor(runtimeRoot) });
}

function main(argv = process.argv.slice(2), { runtimeRoot = path.resolve(__dirname, '../..') } = {}) {
  const args = parseArgs(argv), target = path.resolve(args.target || process.cwd());
  const actions = ['catalog', 'detect', 'validate', 'plan', 'init', 'update', 'adopt', 'apply', 'resume', 'check', 'install-deps'];
  if (args.action === 'help') {
    console.log('Usage: pnpm agent -- architecture <' + actions.join('|') + '> [--config file] [--blueprint id --database postgres|sqlite] [--dry-run] [--no-install]');
    return;
  }
  if (!actions.includes(args.action)) throw new Error('Unknown architecture action: ' + args.action);
  if (!fs.existsSync(target)) throw new Error('Target directory must exist');
  // An interrupted write can leave the new pointer with the old lock. Frozen recovery
  // needs only the installed engine and journal, never a source fetch or a new plan.
  if (args.action === 'resume') {
    require('./target').assertMutationTarget(target);
    const runRoot = args['run-root'] ? path.resolve(args['run-root']) : path.join(containerPath(target, 'tmp'), 'xirang-runs');
    console.log(json(resumePlan(target, { runRoot })));
    console.log('NEXT_ACTION=architecture install-deps, architecture check and convergence plan');
    return;
  }
  if (args.action === 'catalog') {
    const descriptor = readRuntimeDescriptor(runtimeRoot);
    const catalog = parseJson(read(runtimeRoot, 'architecture/manifest.json'), 'architecture catalog');
    if (catalog.id !== 'architecture' || catalog.version !== descriptor.version) throw new Error('Architecture catalog version mismatch');
    console.log(json(catalog)); return;
  }
  const resolved = resolveRuntimeSource(runtimeRoot, { target, source: args.source && path.resolve(args.source) });
  const { descriptor } = resolved;
  console.error(`ARCHITECTURE_VERSION=${descriptor.version}\nARCHITECTURE_COMMIT=${descriptor.commit || 'LOCAL_PREVIEW'}\nARCHITECTURE_CACHE=${resolved.cacheStatus}\nARCHITECTURE_SOURCE_ROOT=${resolved.sourceRoot}`);
  // The source stays fixed while all application writes and commands target the requested project.
  require(safePath(resolved.sourceRoot, 'architecture/scripts/cli.js')).main([
    ...argv, '--source', resolved.sourceRoot, '--target', target,
  ]);
}

module.exports = { main, parseArgs, resolveRuntimeSource };

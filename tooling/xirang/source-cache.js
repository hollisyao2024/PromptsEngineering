const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { hash, json, parseJson, safePath, read, atomicWrite, withMutex, validatePlan } = require('./engine');
const { buildAnonymousGitEnvironment } = require('./anonymous-git');
const { canonicalPath } = require('./target');

const REPOSITORY = 'https://github.com/hollisyao2024/PromptsEngineering.git';
const POINTER = 'architecture/runtime.json';
const MARKER = '.xirang-source.json';
// Cache the architecture runtime, excluding Git metadata and installed dependencies.
const SOURCE_ROOTS = ['architecture', 'tooling/xirang', 'infra/scripts/shared/config.js',
  'infra/templates/agent/config.example.json', 'infra/templates/agent/template.manifest.json', 'package.json'];

function listSourceFiles(source) {
  const files = [];
  function visit(relative) {
    const absolute = safePath(source, relative), stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) {
        if (['.git', 'node_modules', '.DS_Store'].includes(name)) continue;
        visit(`${relative}/${name}`);
      }
    } else if (stat.isFile()) files.push({ path: relative, hash: hash(fs.readFileSync(absolute)), mode: stat.mode & 0o777 });
    else throw new Error(`Unsupported source entry: ${relative}`);
  }
  for (const root of SOURCE_ROOTS) visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function validateDescriptor(value) {
  if (!value || value.schemaVersion !== 1 || value.mode !== 'on-demand' || value.id !== 'xirang'
    || value.repository !== REPOSITORY || !/^\d+\.\d+\.\d+$/.test(value.version || '')
    || !(value.commit === null || /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.commit || ''))
    || !/^[a-f0-9]{64}$/.test(value.integrity || '')) throw new Error('Invalid architecture runtime source descriptor');
  return value;
}

function sourceIdentity(source) {
  const marker = read(source, MARKER);
  if (marker !== null) return { id: 'xirang', commit: validateDescriptor(parseJson(marker, MARKER)).commit };
  const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: source, encoding: 'utf8', shell: false });
  if (root.status !== 0 || fs.realpathSync(root.stdout.trim()) !== fs.realpathSync(source)) return { id: 'xirang', commit: null };
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8', shell: false });
  return { id: 'xirang', commit: result.status === 0 ? result.stdout.trim() : null };
}

function describeSource(source) {
  const manifest = parseJson(read(source, 'architecture/manifest.json'), 'architecture manifest');
  const identity = parseJson(read(source, 'infra/templates/agent/template.manifest.json'), 'template manifest').template;
  if (manifest.id !== 'architecture' || identity?.id !== 'xirang' || identity.repository !== REPOSITORY) throw new Error('Architecture source identity mismatch');
  const files = listSourceFiles(source);
  const descriptor = validateDescriptor({ schemaVersion: 1, mode: 'on-demand', id: 'xirang',
    repository: REPOSITORY, commit: sourceIdentity(source).commit, version: manifest.version,
    integrity: hash(json(files.map(({ path, hash }) => ({ path, hash })))) });
  return { descriptor, files, inputs: files.map(file => ({ path: safePath(source, file.path), hash: file.hash })) };
}

function assertMatchingSource(source, descriptor) {
  const actual = describeSource(source);
  if (json(actual.descriptor) !== json(descriptor)) throw new Error('Architecture source version/content mismatch; restore the pinned source or run template sync');
  return actual;
}

function containerPath(target, key) {
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: target, encoding: 'utf8', shell: false });
  const helper = path.resolve(__dirname, '../../infra/scripts/shared/config.js');
  if (fs.existsSync(helper)) {
    const c = require(helper);
    const main = result.status === 0 ? c.getMainRepoRoot(target) : path.resolve(target);
    return c.resolveContainerPath(c.loadConfig({ repoRoot: target }), main, key);
  }
  // Standalone architecture installations have no workflow package. Resolve the main worktree first.
  const main = result.status === 0 ? path.dirname(result.stdout.trim()) : path.resolve(target);
  const config = parseJson(read(target, 'agent.config.json') || '{}', 'agent config');
  const selected = process.env[`AGENT_${key.toUpperCase()}_DIR`] || config.containerDirs?.[key];
  return path.resolve(main, selected || path.join('..', key));
}

function cacheLocation(target, descriptor, cacheRoot) {
  const root = path.resolve(cacheRoot || path.join(containerPath(target, 'cache'), 'xirang/sources'));
  const directory = safePath(root, `${descriptor.commit || 'local'}-${descriptor.integrity}`);
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: target, encoding: 'utf8', shell: false });
  const boundaries = [target, ...(common.status === 0 ? [path.dirname(common.stdout.trim())] : [])];
  for (const boundary of boundaries) {
    const relative = path.relative(canonicalPath(boundary), canonicalPath(root));
    if (!relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) throw new Error('Architecture cache must be outside the project');
  }
  return { root, directory };
}

function inspectCache(directory, descriptor) {
  const marker = read(directory, MARKER);
  if (marker === null || json(parseJson(marker, MARKER)) !== json(descriptor)) throw new Error('Architecture cache marker mismatch');
  assertMatchingSource(directory, descriptor);
}

function fetchPinnedSnapshot({ directory, descriptor, run = spawnSync }) {
  validateDescriptor(descriptor);
  if (!descriptor.commit) throw new Error('Local preview has no published commit; provide the matching --source to rebuild its cache');
  const env = buildAnonymousGitEnvironment();
  for (const args of [
    ['init', '--quiet', directory],
    ['-C', directory, 'fetch', '--quiet', '--no-tags', '--depth=1', REPOSITORY, descriptor.commit],
    ['-C', directory, 'checkout', '--quiet', '--detach', descriptor.commit],
  ]) {
    const result = run('git', args, { cwd: path.dirname(directory), env, encoding: 'utf8', shell: false, timeout: 60000 });
    if (result.error || result.status !== 0) throw new Error('Pinned architecture source fetch failed; no fallback version was used');
  }
  const head = run('git', ['-C', directory, 'rev-parse', 'HEAD'], { env, encoding: 'utf8', shell: false, timeout: 10000 });
  if (head.status !== 0 || head.stdout.trim() !== descriptor.commit) throw new Error('Fetched architecture commit mismatch');
  return directory;
}

function resolveSource({ target, descriptor, source, cacheRoot, fetchSnapshot = fetchPinnedSnapshot }) {
  validateDescriptor(descriptor);
  let described = source ? assertMatchingSource(source, descriptor) : null;
  const { root, directory } = cacheLocation(target, descriptor, cacheRoot);
  if (fs.existsSync(directory)) {
    inspectCache(directory, descriptor);
    return { sourceRoot: directory, cacheStatus: 'HIT', descriptor };
  }
  fs.mkdirSync(root, { recursive: true });
  const mutex = safePath(root, `locks/${descriptor.integrity}`); fs.mkdirSync(mutex, { recursive: true });
  return withMutex(mutex, () => {
    if (fs.existsSync(directory)) { inspectCache(directory, descriptor); return { sourceRoot: directory, cacheStatus: 'HIT', descriptor }; }
    const stage = fs.mkdtempSync(path.join(root, '.prepare-'));
    try {
      if (!source) {
        source = fetchSnapshot({ directory: path.join(stage, 'fetched'), descriptor });
        described = assertMatchingSource(source, descriptor);
      }
      const snapshot = path.join(stage, 'snapshot'); fs.mkdirSync(snapshot);
      for (const file of described.files) {
        const content = fs.readFileSync(safePath(source, file.path));
        if (hash(content) !== file.hash) throw new Error('Architecture source changed during cache preparation');
        atomicWrite(safePath(snapshot, file.path), content, file.mode);
      }
      atomicWrite(safePath(snapshot, MARKER), json(descriptor));
      inspectCache(snapshot, descriptor);
      fs.renameSync(snapshot, directory);
      return { sourceRoot: directory, cacheStatus: 'PREPARED', descriptor };
    } finally { fs.rmSync(stage, { recursive: true, force: true }); }
  });
}

function preparePlanSource(plan, source) {
  validatePlan(plan);
  const entry = plan.entries.find(e => e.path === POINTER && e.after !== null);
  if (!entry) return null;
  if (plan.conflicts.length) throw new Error('Resolve architecture plan conflicts before preparing its source');
  return resolveSource({ target: plan.target, source, descriptor: parseJson(entry.after, POINTER) });
}

module.exports = { REPOSITORY, POINTER, SOURCE_ROOTS, describeSource, sourceIdentity, validateDescriptor,
  assertMatchingSource, containerPath, cacheLocation, resolveSource, fetchPinnedSnapshot, preparePlanSource };

/* Shared by the agent package installer and architecture generators. No application dependencies. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const LOCK = 'xirang.lock.json';
const STRATEGIES = new Set(['overwrite', 'update', 'merge-json', 'merge-yaml', 'append', 'append-json', 'append-lines', 'managed-block', 'init-if-missing', 'project-owned', 'remove']);
const hash = value => value === null || value === undefined ? null : crypto.createHash('sha256').update(value).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
const json = value => `${JSON.stringify(canonical(value), null, 2)}\n`;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function safePath(root, relative, internal = false) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative)
    || relative.split('/').some(p => !p || p === '.' || p === '..') || /^[A-Za-z]:/.test(relative)) throw new Error(`invalid path: ${relative}`);
  if (relative.split('/').some(p => p === '.git' || p === 'node_modules') || (!internal && (relative === LOCK || relative.startsWith('.xirang/') || relative === '.xirang'))) throw new Error(`reserved path: ${relative}`);
  const base = path.resolve(root);
  // Check ancestors too: a real leaf beneath a linked parent is not a safe target.
  for (let current = base; ; current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      const systemAlias = process.platform === 'darwin' && ['/var', '/tmp', '/etc'].includes(current) && fs.realpathSync(current) === `/private${current}`;
      if (!systemAlias) throw new Error(`symlink in root path: ${current}`);
    }
    if (path.dirname(current) === current) break;
  }
  let current = base;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (stat?.isSymbolicLink()) throw new Error(`symlink in target path: ${relative}`);
    if (stat && current !== path.join(base, relative) && !stat.isDirectory()) throw new Error(`path parent is not a directory: ${relative}`);
  }
  return current;
}
function read(root, relative, internal = false) {
  const file = safePath(root, relative, internal);
  try {
    if (!fs.statSync(file).isFile()) throw new Error(`path is not a regular file: ${relative}`);
    return fs.readFileSync(file, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function parseJson(content, label) {
  return JSON.parse(content, (key, value) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`unsafe JSON key in ${label}: ${key}`);
    return value;
  });
}
function readLock(target) {
  const content = read(target, LOCK, true);
  if (content === null) return { schemaVersion: 1, files: {}, packages: {} };
  const lock = parseJson(content, LOCK);
  if (lock.schemaVersion !== 1 || !isObject(lock.files) || !isObject(lock.packages)) throw new Error('invalid xirang lock schema');
  for (const [name, record] of Object.entries(lock.files)) {
    safePath(target, name);
    if (!record || !STRATEGIES.has(record.strategy) || typeof record.owner !== 'string' || !/^[a-f0-9]{64}$/.test(record.base)) throw new Error(`invalid lock record: ${name}`);
  }
  return lock;
}
function baseline(target, record) {
  if (!record) return undefined;
  const text = read(target, `.xirang/baselines/${record.base}`, true);
  if (text === null || hash(text) !== record.base) throw new Error(`missing or corrupt baseline: ${record.base}`);
  return text;
}
function mergeText(base, local, upstream) {
  if (local === upstream || base === upstream) return local;
  if (local === base) return upstream;
  if ([base, local, upstream].some(v => typeof v !== 'string' || v.includes('\0'))) throw new Error('text conflict (binary or deleted content)');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-merge-'));
  try {
    for (const [name, text] of Object.entries({ base, local, upstream })) fs.writeFileSync(path.join(temp, name), text);
    const result = spawnSync('git', ['merge-file', '-p', '--diff3', 'local', 'base', 'upstream'], { cwd: temp, encoding: 'utf8', shell: false, maxBuffer: 16 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('overlapping text conflict; reconcile local/base/upstream');
    return result.stdout;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
function mergeJsonValue(base, local, upstream, name = '$') {
  if (equal(local, upstream) || equal(base, upstream)) return local;
  if (equal(local, base)) return upstream;
  if ((base === undefined || isObject(base)) && isObject(local) && isObject(upstream)) {
    const output = {};
    for (const key of new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(upstream)])) {
      const value = mergeJsonValue(base?.[key], local[key], upstream[key], `${name}.${key}`);
      if (value !== undefined) output[key] = value;
    }
    return output;
  }
  throw new Error(`JSON field conflict: ${name}`);
}
function adoptJson(local, upstream) {
  if (local === undefined) return upstream;
  if (isObject(local) && isObject(upstream)) {
    const result = { ...local };
    for (const [key,value] of Object.entries(upstream)) result[key] = adoptJson(local[key],value);
    return result;
  }
  return local;
}
function appendJson(local, upstream, key = 'id') {
  if (!Array.isArray(local) || !Array.isArray(upstream)) throw new Error('append-json requires arrays');
  const map = new Map();
  for (const entry of [...local, ...upstream]) {
    const id = entry?.[key];
    if (typeof id !== 'string' || !id) throw new Error(`append-json requires stable ${key}`);
    if (map.has(id) && !equal(map.get(id), entry)) throw new Error(`append conflict: ${id}`);
    map.set(id, entry);
  }
  return [...map.values()];
}
function managedBlock(content, marker) {
  if (!/^[a-zA-Z0-9._:-]+$/.test(marker || '')) throw new Error('invalid managed block marker');
  const start = `# >>> ${marker}`, end = `# <<< ${marker}`;
  const starts = content.split(start).length - 1, ends = content.split(end).length - 1;
  if (starts !== ends || starts > 1) throw new Error(`malformed managed block: ${marker}`);
  if (!starts) return { prefix: content, body: undefined, suffix: '' };
  const a = content.indexOf(start), b = content.indexOf(end);
  if (b < a) throw new Error(`malformed managed block: ${marker}`);
  return { prefix: content.slice(0, a), body: content.slice(a + start.length, b).replace(/^\r?\n/, '').trimEnd() + '\n', suffix: content.slice(b + end.length).replace(/^\r?\n/, '') };
}
function decide(asset, local, base, record, adopt) {
  const upstream = asset.content;
  if (asset.strategy === 'project-owned' || (asset.strategy === 'init-if-missing' && local !== null)) return local;
  if (asset.strategy === 'remove') {
    if (local === null) return null;
    if (base === undefined || local !== base) throw new Error('removal conflict: reliable unmodified baseline required');
    return null;
  }
  if (asset.strategy === 'managed-block') {
    const parts = managedBlock(local || '', asset.marker);
    const normalized = upstream.trimEnd() + '\n';
    let body;
    if (parts.body === undefined) body = normalized;
    else if (base === undefined && parts.body !== normalized) {
      if (!adopt) throw new Error('adoption required for existing managed block');
      body = parts.body;
    } else body = mergeText(base === undefined ? normalized : base.trimEnd() + '\n', parts.body, normalized);
    return `${parts.prefix}${parts.prefix && !parts.prefix.endsWith('\n') ? '\n' : ''}# >>> ${asset.marker}\n${body}# <<< ${asset.marker}\n${parts.suffix}`;
  }
  if (asset.strategy === 'append-json') return json(appendJson(local === null ? [] : parseJson(local, asset.path), parseJson(upstream, asset.path), asset.idKey));
  if (asset.strategy === 'append-lines') return [...new Set([...(local || '').split('\n'), ...upstream.split('\n')].filter(Boolean))].join('\n') + '\n';
  if (asset.strategy === 'append') {
    if (local !== null && local !== upstream) throw new Error('append conflict: existing file is immutable');
    return upstream;
  }
  if (asset.strategy === 'merge-yaml') return require('./yaml').mergeYaml(base, local, upstream, mergeJsonValue);
  if (asset.strategy === 'merge-json') {
    if (adopt && base === undefined) return json(adoptJson(local === null ? undefined : parseJson(local, asset.path), parseJson(upstream, asset.path)));
    return json(mergeJsonValue(base === undefined ? undefined : parseJson(base, asset.path), local === null ? undefined : parseJson(local, asset.path), parseJson(upstream, asset.path)));
  }
  if (local === upstream) return local;
  if (base === undefined) {
    if (local === null) return upstream;
    if (adopt) return local;
    throw new Error('adoption required: existing file has no trusted baseline');
  }
  if (asset.strategy === 'overwrite') {
    if (local === base) return upstream;
    if (upstream === base && record?.adoptedLocal === hash(local)) return local;
    throw new Error('overwrite conflict: local content changed');
  }
  return mergeText(base, local, upstream);
}
function planUpdate({ target, assets, inputs = [], packages = {}, source = {}, adopt = false }) {
  target = path.resolve(target);
  const lockBefore = read(target, LOCK, true), previous = readLock(target);
  // A corrupt retained baseline must not be silently carried into the next lock.
  for (const record of Object.values(previous.files)) baseline(target, record);
  const nextLock = structuredClone(previous);
  nextLock.packages = { ...nextLock.packages, ...packages };
  const entries = [], conflicts = [], seen = new Set();
  for (const asset of assets) {
    safePath(target, asset.path);
    if (seen.has(asset.path.toLowerCase())) throw new Error(`duplicate target ownership: ${asset.path}`);
    seen.add(asset.path.toLowerCase());
    if (!STRATEGIES.has(asset.strategy)) throw new Error(`unknown strategy: ${asset.strategy}`);
    if (asset.strategy !== 'remove' && typeof asset.content !== 'string') throw new Error(`asset content must be text: ${asset.path}`);
    if (!asset.owner) throw new Error(`asset owner required: ${asset.path}`);
    const local = read(target, asset.path), record = previous.files[asset.path], base = baseline(target, record);
    let after = local, reason = '';
    try {
      if (record && record.owner !== asset.owner) throw new Error(`owner conflict: ${record.owner} -> ${asset.owner}`);
      after = decide(asset, local, base, record, adopt);
    } catch (error) { reason = error.message; conflicts.push({ path: asset.path, reason }); }
    const entry = { path: asset.path, strategy: asset.strategy, owner: asset.owner, before: hash(local), after, afterHash: hash(after), upstream: asset.content, mode: asset.mode || (local !== null ? fs.statSync(safePath(target, asset.path)).mode & 0o777 : 0o644), reason };
    entries.push(entry);
    if (reason || asset.strategy === 'project-owned') continue;
    if (asset.strategy === 'remove') { delete nextLock.files[asset.path]; continue; }
    nextLock.files[asset.path] = { owner: asset.owner, version: asset.version || '1', strategy: asset.strategy, base: hash(asset.content) };
    if (asset.strategy === 'overwrite' && ((adopt && base === undefined && local !== null && local !== asset.content) || record?.adoptedLocal)) nextLock.files[asset.path].adoptedLocal = hash(local);
  }
  const lockAfter = json(nextLock);
  const metadataChanges = [];
  const retainedBases = new Set(Object.values(nextLock.files).map(record => record.base));
  const baselineRemovals = [...new Set(Object.values(previous.files).map(record => record.base))]
    .filter(digest => !retainedBases.has(digest)).sort();
  if (lockBefore !== lockAfter) metadataChanges.push(LOCK);
  for (const entry of entries) {
    if (entry.strategy === 'project-owned' || entry.strategy === 'remove' || entry.reason) continue;
    const p = `.xirang/baselines/${hash(entry.upstream)}`;
    if (read(target, p, true) === null && !metadataChanges.includes(p)) metadataChanges.push(p);
  }
  const plan = { schemaVersion: 1, target, source, inputs, lockBefore: hash(lockBefore), lockAfter, entries, conflicts, metadataChanges, baselineRemovals, changes: [...entries.filter(e => e.before !== e.afterHash).map(e => e.path), ...metadataChanges, ...baselineRemovals.map(digest => `.xirang/baselines/${digest}`)] };
  plan.id = hash(json(plan));
  return plan;
}
function validatePlan(plan) {
  const { id, ...body } = plan;
  if (plan.schemaVersion !== 1 || hash(json(body)) !== id) throw new Error('plan digest mismatch');
  for (const entry of plan.entries) {
    safePath(plan.target, entry.path);
    if (hash(entry.after) !== entry.afterHash) throw new Error(`plan content hash mismatch: ${entry.path}`);
    if (!STRATEGIES.has(entry.strategy)) throw new Error('invalid plan strategy');
  }
  if (plan.conflicts.length) throw new Error(`plan has ${plan.conflicts.length} conflict(s)`);
  const retained = new Set(Object.values(parseJson(plan.lockAfter, 'next lock').files).map(record => record.base));
  for (const digest of plan.baselineRemovals || []) if (!/^[a-f0-9]{64}$/.test(digest) || retained.has(digest)) throw new Error('unsafe baseline removal');
}
function atomicWrite(file, text, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.xirang-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  let fd;
  try { fd = fs.openSync(tmp, 'wx', mode); fs.writeFileSync(fd, text); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(tmp, file); }
  finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function removeEmptyParents(target, file) {
  for (let directory = path.dirname(file); directory !== path.resolve(target); directory = path.dirname(directory)) {
    const relative = path.relative(target, directory).split(path.sep).join('/');
    safePath(target, relative);
    try { fs.rmdirSync(directory); }
    catch (error) { if (['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) return; throw error; }
  }
}
function runDirectory(target, runRoot) {
  if (!runRoot) throw new Error('runRoot must be an explicit external runtime directory');
  if (path.resolve(runRoot) === path.resolve(target) || path.resolve(runRoot).startsWith(path.resolve(target) + path.sep)) throw new Error('runRoot must be outside target');
  const canonicalTarget = fs.realpathSync(target);
  const aliases = new Set([canonicalTarget, path.resolve(target)]);
  // Older plans may have used a macOS system alias before cwd resolved it.
  if (process.platform === 'darwin') for (const prefix of ['/var', '/tmp', '/etc']) {
    if (canonicalTarget.startsWith('/private' + prefix + path.sep)) aliases.add(canonicalTarget.slice('/private'.length));
  }
  const candidates = [...aliases].map(value => safePath(path.resolve(runRoot), hash(value).slice(0, 24)));
  const existing = candidates.filter(value => fs.existsSync(value));
  if (existing.length > 1) throw new Error('ambiguous update journals for project path aliases; inspect before recovery');
  const dir = existing[0] || candidates[0];
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function withMutex(dir, fn) {
  const file = safePath(dir, 'writer.lock');
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Serialize stale-lock recovery so two recoverers cannot unlink each other's new lock.
    const recovery = safePath(dir, 'writer-recovery.lock');
    let recoveryFd;
    try {
      recoveryFd = fs.openSync(recovery, 'wx', 0o600);
      const owner = parseJson(fs.readFileSync(file, 'utf8'), 'writer lock');
      if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error('invalid writer lock');
      try { process.kill(owner.pid, 0); throw new Error('another xirang writer is running'); }
      catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
      fs.unlinkSync(file);
      fd = fs.openSync(file, 'wx', 0o600);
    } finally {
      if (recoveryFd !== undefined) { fs.closeSync(recoveryFd); fs.unlinkSync(recovery); }
    }
  }
  try { fs.writeFileSync(fd, json({ pid: process.pid })); fs.fsyncSync(fd); return fn(); }
  finally { fs.closeSync(fd); fs.unlinkSync(file); }
}
function execute(plan, options, recovering) {
  validatePlan(plan);
  const dir = runDirectory(plan.target, options.runRoot);
  return withMutex(dir, () => {
    const journalFile = safePath(dir, 'active.json');
    let journal = fs.existsSync(journalFile) ? parseJson(fs.readFileSync(journalFile, 'utf8'), 'journal') : null;
    if (journal && journal.status !== 'complete' && (!recovering || journal.plan.id !== plan.id)) throw new Error('unfinished update exists; resume its frozen plan');
    if (recovering && !journal) throw new Error('no interrupted plan to resume');
    if (!recovering) {
      for (const input of plan.inputs) {
        const actual = read(path.dirname(input.path), path.basename(input.path), true);
        if (hash(actual) !== input.hash) throw new Error(`source drift: ${input.path}`);
      }
    }
    const currentLock = read(plan.target, LOCK, true);
    if (hash(currentLock) !== plan.lockBefore && !(recovering && currentLock === plan.lockAfter)) throw new Error('lock drift; replan required');
    for (const entry of plan.entries) {
      const actual = hash(read(plan.target, entry.path));
      if (actual !== entry.before && !(recovering && actual === entry.afterHash)) throw new Error(`target drift: ${entry.path}`);
    }
    // Recheck baseline integrity at execution, not only when planning.
    for (const record of Object.values(readLock(plan.target).files)) baseline(plan.target, record);
    if (!recovering) {
      const previousBases = new Set(Object.values(readLock(plan.target).files).map(record => record.base));
      for (const digest of plan.baselineRemovals || []) if (!previousBases.has(digest)) throw new Error('baseline removal lacks previous ownership');
    }
    journal = { schemaVersion: 1, status: 'running', plan, completed: journal?.plan?.id === plan.id ? journal.completed : [] };
    atomicWrite(journalFile, json(journal), 0o600);
    for (const entry of plan.entries) {
      const current = hash(read(plan.target, entry.path));
      if (current === entry.afterHash) { if (entry.after === null) removeEmptyParents(plan.target, safePath(plan.target, entry.path)); continue; }
      if (current !== entry.before) throw new Error(`target drift before write: ${entry.path}`);
      const file = safePath(plan.target, entry.path);
      if (entry.after === null) { fs.unlinkSync(file); removeEmptyParents(plan.target, file); }
      else atomicWrite(file, entry.after, entry.mode);
      if (hash(read(plan.target, entry.path)) !== entry.afterHash) throw new Error(`post-write verification failed: ${entry.path}`);
      journal.completed.push(entry.path); atomicWrite(journalFile, json(journal), 0o600);
      options.afterWrite?.(entry);
    }
    for (const entry of plan.entries) {
      if (entry.strategy === 'project-owned' || entry.strategy === 'remove') continue;
      const digest = hash(entry.upstream), file = safePath(plan.target, `.xirang/baselines/${digest}`, true);
      const existing = read(plan.target, `.xirang/baselines/${digest}`, true);
      if (existing !== null && hash(existing) !== digest) throw new Error('baseline collision or corruption');
      if (existing === null) atomicWrite(file, entry.upstream);
    }
    // Verify the whole result again before committing the version lock.
    for (const entry of plan.entries) if (hash(read(plan.target, entry.path)) !== entry.afterHash) throw new Error(`final target drift: ${entry.path}`);
    if (read(plan.target, LOCK, true) !== currentLock) throw new Error('lock drift during apply; preserve journal and inspect concurrent changes');
    if (read(plan.target, LOCK, true) !== plan.lockAfter) atomicWrite(safePath(plan.target, LOCK, true), plan.lockAfter);
    options.afterLockWrite?.();
    // The new lock is durable before retiring baselines; recovery no longer needs their contents.
    for (const digest of plan.baselineRemovals || []) {
      const relative = `.xirang/baselines/${digest}`, existing = read(plan.target, relative, true);
      if (existing === null) continue;
      if (hash(existing) !== digest) throw new Error('retired baseline changed; preserve journal and inspect');
      fs.unlinkSync(safePath(plan.target, relative, true));
    }
    journal.status = 'complete'; atomicWrite(journalFile, json(journal), 0o600);
    return { status: 'OK', planId: plan.id, changes: plan.changes, journal: journalFile };
  });
}
function applyPlan(plan, options = {}) { return execute(plan, options, false); }
function resumePlan(target, options = {}) {
  const dir = runDirectory(target, options.runRoot), journal = parseJson(fs.readFileSync(safePath(dir, 'active.json'), 'utf8'), 'journal');
  if (fs.realpathSync(journal.plan.target) !== fs.realpathSync(target)) throw new Error('journal target mismatch');
  return execute(journal.plan, options, true);
}
module.exports = { planUpdate, applyPlan, resumePlan, readLock, hash, json, safePath, read, parseJson, mergeText, mergeJsonValue, managedBlock, atomicWrite, withMutex, validatePlan };

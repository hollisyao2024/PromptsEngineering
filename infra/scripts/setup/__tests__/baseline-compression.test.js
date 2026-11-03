const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { planUpdate, applyPlan, resumePlan, readBaselineStore, hash, json } = require('../../../../tooling/xirang/engine');
const PACK = '.xirang/baselines.json';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-compression-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'repo'); fs.mkdirSync(target);
  return { target, runRoot: path.join(root, 'runs'), put(file, text) { fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true }); fs.writeFileSync(path.join(target, file), text); }, get(file) { return fs.readFileSync(path.join(target, file), 'utf8'); } };
}
const asset = (file, content, owner = 'agent') => ({ path: file, content, owner, version: '1', strategy: 'update' });
const install = (f, assets, options = {}) => applyPlan(planUpdate({ target: f.target, assets }), { ...f, ...options });
const packed = blobs => { const raw = Buffer.from(JSON.stringify(blobs)); return { schemaVersion: 2, encoding: 'br-base64', size: raw.length, data: zlib.brotliCompressSync(raw).toString('base64') }; };
test('RUL-BASE-006 compressed JSON preserves exact Unicode, binary-text and CRLF originals and reuses unchanged bytes', t => {
  const f = fixture(t), contents = ['中文\n'.repeat(2000), 'line\r\n\0binary\r\n'];
  const assets = contents.map((s, i) => asset(`a${i}`, s)); install(f, assets);
  const raw = f.get(PACK), store = JSON.parse(raw);
  assert.equal(store.schemaVersion, 2); assert.equal(store.encoding, 'br-base64');
  assert.ok(Buffer.byteLength(raw) < Buffer.byteLength(json({ schemaVersion: 1, blobs: Object.fromEntries(contents.map(s => [hash(s), s])) })) / 2);
  assert.deepEqual(readBaselineStore(f.target).blobs, Object.fromEntries(contents.map(s => [hash(s), s])));
  const before = fs.statSync(path.join(f.target, PACK)).mtimeMs;
  assert.deepEqual(planUpdate({ target: f.target, assets }).changes, []); install(f, assets);
  assert.equal(f.get(PACK), raw); assert.equal(fs.statSync(path.join(f.target, PACK)).mtimeMs, before);
});
for (const hook of ['afterBaselineWrite', 'afterLockWrite', 'afterBaselineFinalize']) test(`RUL-BASE-007 v1 JSON migration preserves all scopes and resumes at ${hook}`, t => {
  const f = fixture(t), first = asset('a', 'one\ntwo\nthree\n'), other = asset('b', 'other\n', 'architecture:ui');
  install(f, [first, other]); const blobs = readBaselineStore(f.target).blobs;
  f.put(PACK, json({ schemaVersion: 1, blobs })); f.put('a', 'local\ntwo\nthree\n');
  const next = [asset('a', 'one\ntwo\nupstream\n')], p = planUpdate({ target: f.target, assets: next });
  assert.equal(JSON.parse(f.get(PACK)).schemaVersion, 1, 'planning never migrates');
  assert.throws(() => applyPlan(p, { ...f, [hook]() { throw Error('power loss'); } }), /power loss/);
  resumePlan(f.target, f);
  assert.equal(JSON.parse(f.get(PACK)).schemaVersion, 2);
  assert.equal(f.get('a'), 'local\ntwo\nupstream\n'); assert.equal(f.get('b'), other.content);
  assert.equal(readBaselineStore(f.target).blobs[hash(other.content)], other.content);
  assert.deepEqual(planUpdate({ target: f.target, assets: next }).changes, []);
});
test('RUL-BASE-007 frozen uncompressed v2 plans still finish and can then migrate', t => {
  const f = fixture(t), assets = [asset('a', 'old')];
  const p = planUpdate({ target: f.target, assets });
  delete p.id;
  p.baselineStore.staged = p.baselineStore.after = json({ schemaVersion: 1, blobs: { [hash('old')]: 'old' } });
  p.id = hash(json(p));
  assert.throws(() => applyPlan(p, { ...f, afterLockWrite() { throw Error('stop'); } }), /stop/);
  resumePlan(f.target, f); assert.equal(JSON.parse(f.get(PACK)).schemaVersion, 1);
  install(f, assets); assert.equal(JSON.parse(f.get(PACK)).schemaVersion, 2);
  assert.equal(readBaselineStore(f.target).blobs[hash('old')], 'old');
});
test('RUL-BASE-008 invalid compressed envelopes fail before project writes without legacy fallback', t => {
  const valid = packed({ [hash('base')]: 'base' });
  const corruptions = [{ ...valid, encoding: 'unknown' }, { ...valid, schemaVersion: 3 }, { ...valid, extra: true }, { ...valid, data: valid.data + '!' }, { ...valid, data: Buffer.concat([Buffer.from(valid.data, 'base64'), Buffer.from('garbage')]).toString('base64') }, { ...valid, data: 'AAAA' }, { ...valid, size: 1 }, { ...valid, size: valid.size + 1 }, { ...valid, size: -1 }, { ...valid, size: 1.5 }, { ...valid, size: '1' }, packed([]), packed({ invalid: 'base' }), packed({ [hash('base')]: 'wrong' })];
  for (const value of corruptions) {
    const f = fixture(t); install(f, [asset('a', 'base')]);
    f.put(PACK, json(value)); f.put(`.xirang/baselines/${hash('base')}`, 'base');
    assert.throws(() => planUpdate({ target: f.target, assets: [asset('a', 'next')] }), /baseline/i);
    assert.equal(f.get('a'), 'base'); assert.equal(f.get(PACK), json(value));
  }
});
test('RUL-BASE-009 packed stores without a legacy directory avoid probing each legacy blob', t => {
  const f = fixture(t), assets = Array.from({ length: 30 }, (_, i) => asset(`a${i}`, `content ${i}`));
  install(f, assets);
  let probes = 0;
  const original = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', function (file, ...args) {
    if (/[\\/]\.xirang[\\/]baselines[\\/][a-f0-9]{64}$/.test(String(file))) probes += 1;
    return original.call(this, file, ...args);
  });
  assert.deepEqual(planUpdate({ target: f.target, assets }).changes, []);
  assert.equal(probes, 0, 'an absent legacy directory needs no per-blob filesystem probes');
});

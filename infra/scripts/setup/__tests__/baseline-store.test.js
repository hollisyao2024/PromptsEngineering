const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planUpdate, applyPlan, resumePlan, hash, json, readLock } = require('../../../../tooling/xirang/engine');
const PACK = '.xirang/baselines.json';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'repo'), runRoot = path.join(root, 'runs'); fs.mkdirSync(target);
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true }); fs.writeFileSync(path.join(target, file), text); };
  return { target, runRoot, put, get: file => fs.readFileSync(path.join(target, file), 'utf8') };
}
const asset = (file, content, owner = 'agent') => ({ path: file, content, owner, version: '1', strategy: 'update' });
const apply = (f, assets, options = {}) => applyPlan(planUpdate({ target: f.target, assets }), { ...f, ...options });
function legacy(f, assets) {
  const files = {};
  for (const a of assets) {
    f.put(a.path, a.content); f.put(`.xirang/baselines/${hash(a.content)}`, a.content);
    files[a.path] = { owner: a.owner, version: '1', strategy: a.strategy, base: hash(a.content) };
  }
  f.put('xirang.lock.json', json({ schemaVersion: 1, files, packages: {} }));
}
test('RUL-BASE-001 fresh install uses one deterministic deduplicated baseline file and converges', t => {
  const f = fixture(t), assets = [asset('a', 'same\n'), asset('b', 'same\n')]; apply(f, assets);
  assert.deepEqual(fs.readdirSync(path.join(f.target, '.xirang')), ['baselines.json']);
  assert.deepEqual(JSON.parse(f.get(PACK)), { schemaVersion: 1, blobs: { [hash('same\n')]: 'same\n' } });
  assert.deepEqual(planUpdate({ target: f.target, assets }).changes, []);
});
test('RUL-BASE-002 legacy migration is read-only in plan and retains other scopes and unregistered files', t => {
  const f = fixture(t), assets = [asset('a', 'one\ntwo\nthree\n'), asset('b', 'other\n', 'architecture:ui')];
  legacy(f, assets); f.put('a', 'local\ntwo\nthree\n'); f.put('.xirang/baselines/unregistered', 'keep');
  const next = [asset('a', 'one\ntwo\nupstream\n')], p = planUpdate({ target: f.target, assets: next });
  assert.ok(p.changes.includes(PACK)); assert.equal(fs.existsSync(path.join(f.target, PACK)), false);
  applyPlan(p, f);
  assert.equal(f.get('a'), 'local\ntwo\nupstream\n'); assert.equal(f.get('b'), 'other\n');
  assert.deepEqual(fs.readdirSync(path.join(f.target, '.xirang/baselines')), ['unregistered']);
  assert.deepEqual(JSON.parse(f.get(PACK)).blobs, { [hash(next[0].content)]: next[0].content, [hash('other\n')]: 'other\n' });
  assert.deepEqual(planUpdate({ target: f.target, assets: next }).changes, []);
});
test('RUL-BASE-003 malformed or incomplete packed baselines cannot fall back to a legacy file', t => {
  for (const packed of ['bad json', json({ schemaVersion: 2, blobs: {} }), json({ schemaVersion: 1, blobs: {} }), json({ schemaVersion: 1, blobs: { [hash('base')]: 'corrupt' } }), json({ schemaVersion: 1, blobs: { '../escape': 'base' } })]) {
    const f = fixture(t); legacy(f, [asset('a', 'base')]); f.put(PACK, packed);
    assert.throws(() => planUpdate({ target: f.target, assets: [asset('a', 'next')] }), /baseline/i);
    assert.equal(f.get('a'), 'base');
  }
});
test('RUL-BASE-003 package drift after planning blocks before any target write', t => {
  const f = fixture(t); apply(f, [asset('a', 'base')]);
  const p = planUpdate({ target: f.target, assets: [asset('a', 'next')] });
  f.put(PACK, json({ schemaVersion: 1, blobs: { [hash('base')]: 'base', [hash('external')]: 'external' } }));
  assert.throws(() => applyPlan(p, f), /baseline.*drift/i); assert.equal(f.get('a'), 'base');
});
for (const hook of ['afterBaselineWrite', 'afterLockWrite', 'afterBaselineFinalize', 'afterLegacyBaselineRemove']) {
  test(`RUL-BASE-004 interrupted migration resumes safely at ${hook}`, t => {
    const f = fixture(t); legacy(f, [asset('a', 'base'), asset('b', 'other', 'architecture:ui')]);
    const assets = [asset('a', 'next')], p = planUpdate({ target: f.target, assets });
    assert.throws(() => applyPlan(p, { ...f, [hook]() { throw new Error('power loss'); } }), /power loss/);
    resumePlan(f.target, f);
    assert.equal(f.get('a'), 'next'); assert.equal(f.get('b'), 'other');
    assert.equal(fs.existsSync(path.join(f.target, '.xirang/baselines')), false);
    assert.deepEqual(Object.keys(JSON.parse(f.get(PACK)).blobs).sort(), [hash('next'), hash('other')].sort());
    assert.deepEqual(planUpdate({ target: f.target, assets }).changes, []);
  });
}
test('RUL-BASE-004 resume refuses external package edits and preserves legacy contents', t => {
  const f = fixture(t); legacy(f, [asset('a', 'base')]); const p = planUpdate({ target: f.target, assets: [asset('a', 'next')] });
  assert.throws(() => applyPlan(p, { ...f, afterBaselineWrite() { throw new Error('stop'); } }), /stop/);
  f.put(PACK, json({ schemaVersion: 1, blobs: { [hash('external')]: 'external' } }));
  assert.throws(() => resumePlan(f.target, f), /baseline.*drift/i);
  assert.equal(f.get(`.xirang/baselines/${hash('base')}`), 'base');
});
test('RUL-BASE-004 a published package reverted to the valid old snapshot still blocks lock publication', t => {
  const f = fixture(t); apply(f, [asset('a', 'base')]);
  const before = f.get(PACK), lock = f.get('xirang.lock.json');
  assert.throws(() => apply(f, [asset('a', 'next')], { afterBaselineWrite() { f.put(PACK, before); } }), /baseline.*drift/i);
  assert.equal(f.get('xirang.lock.json'), lock);
  assert.equal(f.get(PACK), before);
});
test('RUL-BASE-005 JSON package survives CRLF checkout and retired blobs lose only their last reference', t => {
  const f = fixture(t); apply(f, [asset('a', 'base\n'), asset('b', 'base\n', 'architecture:ui')]);
  f.put(PACK, f.get(PACK).replace(/\n/g, '\r\n'));
  apply(f, [asset('a', 'next\n')]);
  assert.equal(JSON.parse(f.get(PACK)).blobs[hash('base\n')], 'base\n');
  apply(f, [{ ...asset('b', undefined, 'architecture:ui'), strategy: 'remove' }]);
  assert.equal(JSON.parse(f.get(PACK)).blobs[hash('base\n')], undefined);
  assert.equal(readLock(f.target).files.a.base, hash('next\n'));
});
test('RUL-BASE-003 legacy corruption, symlinks and post-plan edits block without deleting contents', t => {
  for (const corruption of ['missing', 'content', 'symlink', 'drift']) {
    const f = fixture(t), a = asset('a', 'base'); legacy(f, [a]);
    const file = path.join(f.target, `.xirang/baselines/${hash('base')}`);
    if (corruption === 'drift') {
      const p = planUpdate({ target: f.target, assets: [asset('a', 'next')] });
      fs.writeFileSync(file, 'external');
      assert.throws(() => applyPlan(p, f), /baseline/i);
    } else {
      fs.unlinkSync(file);
      if (corruption === 'content') fs.writeFileSync(file, 'corrupt');
      if (corruption === 'symlink') {
        const external = path.join(f.runRoot, 'external'); fs.mkdirSync(f.runRoot); fs.writeFileSync(external, 'base');
        fs.symlinkSync(external, file);
      }
      assert.throws(() => planUpdate({ target: f.target, assets: [asset('a', 'next')] }), /baseline|symlink/i);
    }
    assert.equal(f.get('a'), 'base'); assert.equal(fs.existsSync(path.join(f.target, PACK)), false);
  }
});
test('RUL-BASE-004 old v1 frozen journals finish in legacy format before a later migration', t => {
  const f = fixture(t), assets = [asset('a', 'base')];
  const p = planUpdate({ target: f.target, assets });
  // Model an on-disk v1 journal created before the storage upgrade; its digest covers the original fields only.
  delete p.id; delete p.baselineStore; p.schemaVersion = 1;
  p.metadataChanges = ['xirang.lock.json', `.xirang/baselines/${hash('base')}`];
  p.changes = ['a', ...p.metadataChanges]; p.id = hash(json(p));
  assert.throws(() => applyPlan(p, { ...f, afterWrite() { throw new Error('stop'); } }), /stop/);
  resumePlan(f.target, f);
  assert.equal(f.get(`.xirang/baselines/${hash('base')}`), 'base');
  apply(f, assets);
  assert.equal(JSON.parse(f.get(PACK)).blobs[hash('base')], 'base');
  assert.equal(fs.existsSync(path.join(f.target, '.xirang/baselines')), false);
});
test('RUL-BASE-001 RUL-BASE-002 real agent template migrates all legacy contents to one file and converges', t => {
  const f = fixture(t), source = path.resolve(__dirname, '../../../..');
  const { createTemplatePlan } = require('../../../../tooling/xirang/template');
  applyPlan(createTemplatePlan({ source, target: f.target, scope: 'agent' }), f);
  const store = JSON.parse(f.get(PACK));
  assert.ok(Object.keys(store.blobs).length > 100, 'exercise the complete agent package');
  for (const [digest, content] of Object.entries(store.blobs)) f.put(`.xirang/baselines/${digest}`, content);
  fs.unlinkSync(path.join(f.target, PACK));
  const p = createTemplatePlan({ source, target: f.target, scope: 'agent' });
  assert.deepEqual(p.conflicts, []); applyPlan(p, f);
  assert.deepEqual(JSON.parse(f.get(PACK)), store);
  assert.deepEqual(fs.readdirSync(path.join(f.target, '.xirang')), ['baselines.json']);
  assert.deepEqual(createTemplatePlan({ source, target: f.target, scope: 'agent' }).changes, []);
  console.log(`BASELINE_MIGRATION=${Object.keys(store.blobs).length}->1; BYTES=${Buffer.byteLength(f.get(PACK))}`);
});

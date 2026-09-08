const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planUpdate, applyPlan, resumePlan, readLock, hash } = require('../../../../tooling/xirang/engine');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-engine-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'project'), runRoot = path.join(root, 'runs');
  fs.mkdirSync(target);
  return { target, runRoot, put(p, s) { fs.mkdirSync(path.dirname(path.join(target, p)), { recursive: true }); fs.writeFileSync(path.join(target, p), s); }, get(p) { return fs.readFileSync(path.join(target, p), 'utf8'); } };
}
const asset = (content, strategy = 'update', file = 'apps/web/component.ts') => ({ path: file, content, strategy, owner: 'architecture:ui', version: '1.0.0' });
function install(f, assets, options = {}) { const p = planUpdate({ target: f.target, assets, ...options }); applyPlan(p, { runRoot: f.runRoot }); return p; }

test('TC-ARCHPLAT-006 three-way update preserves local and upstream disjoint edits; repeat converges', t => {
  const f = fixture(t), base = 'first\nunchanged\nlast\n';
  install(f, [asset(base)]);
  f.put('apps/web/component.ts', 'local\nunchanged\nlast\n');
  const p = install(f, [asset('first\nunchanged\nupstream\n')]);
  assert.equal(p.conflicts.length, 0);
  assert.equal(f.get('apps/web/component.ts'), 'local\nunchanged\nupstream\n');
  assert.equal(planUpdate({ target: f.target, assets: [asset('first\nunchanged\nupstream\n')] }).changes.length, 0);
});
test('TC-ARCHPLAT-006 overwrite drift and overlapping update block entire batch before writes', t => {
  const f = fixture(t); install(f, [asset('base\n', 'overwrite')]); f.put('apps/web/component.ts', 'local\n');
  for (const strategy of ['overwrite', 'update']) {
    const p = planUpdate({ target: f.target, assets: [asset('new\n', strategy), asset('new file', 'update', 'new.txt')] });
    assert.ok(p.conflicts.length); assert.throws(() => applyPlan(p, { runRoot: f.runRoot }), /conflict/i);
    assert.equal(fs.existsSync(path.join(f.target, 'new.txt')), false);
  }
  assert.equal(f.get('apps/web/component.ts'), 'local\n');
});
test('TC-ARCHPLAT-006 JSON fields merge while preserving project keys; stable append rejects rewritten IDs', t => {
  const f = fixture(t); const a = s => asset(JSON.stringify(s), 'merge-json', 'package.json');
  install(f, [a({ scripts: { build: 'old' }, dependencies: { a: '1' } })]);
  f.put('package.json', JSON.stringify({ name: 'my-app', scripts: { build: 'old', local: 'mine' }, dependencies: { a: '1', b: '2' } }));
  install(f, [a({ scripts: { build: 'new' }, dependencies: { a: '2' } })]);
  assert.deepEqual(JSON.parse(f.get('package.json')), { name: 'my-app', scripts: { build: 'new', local: 'mine' }, dependencies: { a: '2', b: '2' } });
  const b = rows => asset(JSON.stringify(rows), 'append-json', 'entries.json');
  install(f, [b([{ id: 'a', value: 1 }])]); install(f, [b([{ id: 'a', value: 1 }, { id: 'b', value: 2 }])]);
  assert.equal(JSON.parse(f.get('entries.json')).length, 2);
  assert.ok(planUpdate({ target: f.target, assets: [b([{ id: 'a', value: 9 }])] }).conflicts.length);
});
test('TC-ARCHPLAT-006 append files immutable; init and project-owned preserve local content', t => {
  const f = fixture(t); install(f, [asset('sql', 'append', 'migrations/001.sql')]);
  assert.ok(planUpdate({ target: f.target, assets: [asset('changed', 'append', 'migrations/001.sql')] }).conflicts.length);
  f.put('config.json', 'mine'); f.put('RULES.md', 'mine');
  install(f, [asset('upstream', 'init-if-missing', 'config.json'), asset('no', 'project-owned', 'RULES.md')]);
  assert.equal(f.get('config.json'), 'mine'); assert.equal(f.get('RULES.md'), 'mine');
});
test('TC-ARCHPLAT-004 unknown baseline requires explicit adoption and preserves files', t => {
  const f = fixture(t); f.put('apps/web/component.ts', 'custom');
  assert.match(planUpdate({ target: f.target, assets: [asset('template')] }).conflicts[0].reason, /adopt/i);
  install(f, [asset('template')], { adopt: true }); assert.equal(f.get('apps/web/component.ts'), 'custom');
  assert.equal(planUpdate({ target: f.target, assets: [asset('template')] }).changes.length, 0);
});
test('TC-ARCHPLAT-007 frozen target/source/lock and content hashes are verified', t => {
  const f = fixture(t); const p = planUpdate({ target: f.target, assets: [asset('new')] });
  f.put('apps/web/component.ts', 'appeared'); assert.throws(() => applyPlan(p, { runRoot: f.runRoot }), /drift/i);
  const p2 = planUpdate({ target: f.target, assets: [asset('appeared')] }); p2.entries[0].after = 'tampered';
  assert.throws(() => applyPlan(p2, { runRoot: f.runRoot }), /digest|hash/i);
  const src = path.join(path.dirname(f.target), 'source.txt'); fs.writeFileSync(src, 'before');
  const p3 = planUpdate({ target: f.target, assets: [], inputs: [{ path: src, hash: hash('before') }] });
  fs.writeFileSync(src, 'after'); assert.throws(() => applyPlan(p3, { runRoot: f.runRoot }), /source.*drift/i);
});
test('TC-ARCHPLAT-007 corrupted or missing baseline fails closed', t => {
  const f = fixture(t); install(f, [asset('base')]);
  const lock = readLock(f.target); const digest = lock.files['apps/web/component.ts'].base;
  f.put(`.xirang/baselines/${digest}`, 'corrupt');
  assert.throws(() => planUpdate({ target: f.target, assets: [asset('new')] }), /baseline/i);
});
test('TC-ARCHPLAT-007 path escape, symlink and duplicate ownership rejected without writes', t => {
  const f = fixture(t);
  for (const name of ['../escape', '/tmp/escape', '.git/config', '.xirang/escape', 'xirang.lock.json', 'a/../b', 'a\\b']) {
    assert.throws(() => planUpdate({ target: f.target, assets: [asset('x', 'update', name)] }), /path|reserved/i);
  }
  fs.symlinkSync(os.tmpdir(), path.join(f.target, 'link'));
  assert.throws(() => planUpdate({ target: f.target, assets: [asset('x', 'update', 'link/x')] }), /symlink/i);
  assert.throws(() => planUpdate({ target: f.target, assets: [asset('a'), asset('b')] }), /duplicate/i);
});
test('TC-ARCHPLAT-007 interrupted writes resume by before/after hashes and never reapply changed files', t => {
  const f = fixture(t), assets = [asset('A', 'update', 'a.txt'), asset('B', 'update', 'b.txt')];
  const p = planUpdate({ target: f.target, assets });
  assert.throws(() => applyPlan(p, { runRoot: f.runRoot, afterWrite() { throw new Error('power loss'); } }), /power loss/);
  assert.equal(fs.existsSync(path.join(f.target, 'xirang.lock.json')), false);
  resumePlan(f.target, { runRoot: f.runRoot });
  assert.equal(f.get('a.txt'), 'A'); assert.equal(f.get('b.txt'), 'B');
  assert.equal(planUpdate({ target: f.target, assets }).changes.length, 0);
});
test('TC-ARCHPLAT-007 resume rejects user edits after interruption', t => {
  const f = fixture(t); const p = planUpdate({ target: f.target, assets: [asset('A', 'update', 'a.txt')] });
  assert.throws(() => applyPlan(p, { runRoot: f.runRoot, afterWrite() { throw new Error('stop'); } }), /stop/);
  f.put('a.txt', 'user edit'); assert.throws(() => resumePlan(f.target, { runRoot: f.runRoot }), /drift/i);
  assert.equal(f.get('a.txt'), 'user edit');
});

test('TC-ARCHPLAT-006 managed blocks preserve surrounding project text and reject overlapping edits', t => {
  const f = fixture(t), a = body => ({ ...asset(body, 'managed-block', '.gitignore'), marker: 'xirang' });
  f.put('.gitignore', '# project\nlocal/\n');
  install(f, [a('node_modules/\n')]);
  f.put('.gitignore', f.get('.gitignore') + '# project footer\n');
  install(f, [a('node_modules/\ndist/\n')]);
  assert.match(f.get('.gitignore'), /^# project\nlocal\//);
  assert.match(f.get('.gitignore'), /# project footer\n$/);
  f.put('.gitignore', f.get('.gitignore').replace('dist/', 'custom/'));
  const p = planUpdate({ target: f.target, assets: [a('node_modules/\nbuild/\n')] });
  assert.ok(p.conflicts.length);
  assert.throws(() => applyPlan(p, { runRoot: f.runRoot }), /conflict/);
});
test('TC-ARCHPLAT-007 lock drift during a batch must not be overwritten at commit', t => {
  const f = fixture(t);
  const p = planUpdate({ target: f.target, assets: [asset('A', 'update', 'a.txt')] });
  const concurrent = JSON.stringify({ schemaVersion: 1, files: {}, packages: { concurrent: { version: '1' } } });
  assert.throws(() => applyPlan(p, { runRoot: f.runRoot, afterWrite() { f.put('xirang.lock.json', concurrent); } }), /lock drift/);
  assert.equal(f.get('xirang.lock.json'), concurrent);
});

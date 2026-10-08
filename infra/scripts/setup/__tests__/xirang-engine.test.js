const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planUpdate, applyPlan, resumePlan, readLock, hash } = require('../../../../tooling/xirang/engine');
const { createTemplatePlan } = require('../../../../tooling/xirang/template');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-engine-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'project'), runRoot = path.join(root, 'runs');
  fs.mkdirSync(target);
  return { target, runRoot, put(p, s) { fs.mkdirSync(path.dirname(path.join(target, p)), { recursive: true }); fs.writeFileSync(path.join(target, p), s); }, get(p) { return fs.readFileSync(path.join(target, p), 'utf8'); } };
}
const asset = (content, strategy = 'update', file = 'apps/web/component.ts') => ({ path: file, content, strategy, owner: 'architecture:ui', version: '1.0.0' });
function install(f, assets, options = {}) { const p = planUpdate({ target: f.target, assets, ...options }); applyPlan(p, { runRoot: f.runRoot }); return p; }

test('three-way update preserves local and upstream disjoint edits; repeat converges', t => {
  const f = fixture(t), base = 'first\nunchanged\nlast\n';
  install(f, [asset(base)]);
  f.put('apps/web/component.ts', 'local\nunchanged\nlast\n');
  const p = install(f, [asset('first\nunchanged\nupstream\n')]);
  assert.equal(p.conflicts.length, 0);
  assert.equal(f.get('apps/web/component.ts'), 'local\nunchanged\nupstream\n');
  assert.equal(planUpdate({ target: f.target, assets: [asset('first\nunchanged\nupstream\n')] }).changes.length, 0);
});
test('Gemini workspace compression preference survives a repeated template sync', t => {
  const f = fixture(t);
  const file = '.gemini/settings.json';
  const base = '{\n  // project settings\n  "model": { "compressionThreshold": 0.18 },\n  "context": { "fileName": ["AGENTS.md"] }\n}\n';
  const local = base.replace('0.18', '0.42');
  install(f, [asset(base, 'update', file)]);
  f.put(file, local);
  install(f, [asset(base, 'update', file)]);
  assert.match(f.get(file), /"compressionThreshold": 0\.42/u);
  assert.equal(planUpdate({ target: f.target, assets: [asset(base, 'update', file)] }).changes.length, 0);
});
test('overwrite drift and overlapping update block entire batch before writes', t => {
  const f = fixture(t); install(f, [asset('base\n', 'overwrite')]); f.put('apps/web/component.ts', 'local\n');
  for (const strategy of ['overwrite', 'update']) {
    const p = planUpdate({ target: f.target, assets: [asset('new\n', strategy), asset('new file', 'update', 'new.txt')] });
    assert.ok(p.conflicts.length); assert.throws(() => applyPlan(p, { runRoot: f.runRoot }), /conflict/i);
    assert.equal(fs.existsSync(path.join(f.target, 'new.txt')), false);
  }
  assert.equal(f.get('apps/web/component.ts'), 'local\n');
});
test('adopted overwrite baseline converges after an upstream upgrade', t => {
  const f = fixture(t), file = 'apps/web/component.ts';
  install(f, [asset('old\n', 'overwrite')]);
  const lock = readLock(f.target);
  lock.files[file].adoptedLocal = hash('old\n');
  f.put('xirang.lock.json', `${JSON.stringify(lock, null, 2)}\n`);

  install(f, [asset('new\n', 'overwrite')]);
  assert.equal(f.get(file), 'new\n');
  assert.equal(readLock(f.target).files[file].adoptedLocal, undefined);
  assert.equal(planUpdate({ target: f.target, assets: [asset('new\n', 'overwrite')] }).changes.length, 0);
});
test('adopted local overwrite stays protected while upstream is unchanged', t => {
  const f = fixture(t), file = 'apps/web/component.ts';
  f.put(file, 'custom\n');
  install(f, [asset('upstream\n', 'overwrite')], { adopt: true });
  assert.equal(f.get(file), 'custom\n');
  assert.equal(planUpdate({ target: f.target, assets: [asset('upstream\n', 'overwrite')] }).changes.length, 0);
  assert.ok(planUpdate({ target: f.target, assets: [asset('next\n', 'overwrite')] }).conflicts.length);
});
test('JSON fields merge while preserving project keys; stable append rejects rewritten IDs', t => {
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
// Merged JSON must read like the project's own file: existing keys keep their order, new keys are appended sorted.
const pretty = value => `${JSON.stringify(value, null, 2)}\n`;
const keysOf = value => Object.keys(value);
test('merge-json keeps the project key order and appends new keys sorted; repeat converges', t => {
  const f = fixture(t), a = s => asset(JSON.stringify(s), 'merge-json', 'package.json');
  install(f, [a({ scripts: { build: 'old' }, dependencies: { a: '1' } })]);
  f.put('package.json', pretty({ name: 'my-app', scripts: { start: 's', build: 'old', 'init:platform': 'p', 'init:dev': 'd' }, dependencies: { b: '2', a: '1' } }));
  const next = a({ scripts: { build: 'new', zeta: 'z', agent: 'a' }, dependencies: { a: '2', c: '3' }, engines: { node: '>=22' } });
  install(f, [next]);
  const merged = JSON.parse(f.get('package.json'));
  assert.deepEqual(merged, { name: 'my-app', scripts: { start: 's', build: 'new', 'init:platform': 'p', 'init:dev': 'd', agent: 'a', zeta: 'z' }, dependencies: { b: '2', a: '2', c: '3' }, engines: { node: '>=22' } });
  assert.deepEqual(keysOf(merged), ['name', 'scripts', 'dependencies', 'engines']);
  assert.deepEqual(keysOf(merged.scripts), ['start', 'build', 'init:platform', 'init:dev', 'agent', 'zeta']);
  assert.deepEqual(keysOf(merged.dependencies), ['b', 'a', 'c']);
  assert.equal(planUpdate({ target: f.target, assets: [next] }).changes.length, 0);
});
test('merge-json keeps an already sorted object sorted when new keys arrive', t => {
  const f = fixture(t), a = s => asset(JSON.stringify(s), 'merge-json', 'package.json');
  install(f, [a({ devDependencies: { a: '1' }, scripts: { build: 'b' } })]);
  f.put('package.json', pretty({ devDependencies: { a: '1', c: '3' }, scripts: { build: 'b', test: 't' } }));
  install(f, [a({ devDependencies: { a: '1', b: '2' }, scripts: { build: 'b', lint: 'l' } })]);
  const merged = JSON.parse(f.get('package.json'));
  assert.deepEqual(keysOf(merged), ['devDependencies', 'scripts']);
  assert.deepEqual(keysOf(merged.devDependencies), ['a', 'b', 'c']);
  assert.deepEqual(keysOf(merged.scripts), ['build', 'lint', 'test']);
});
test('merge-json adoption keeps the local key order and converges', t => {
  const f = fixture(t), a = s => asset(JSON.stringify(s), 'merge-json', 'package.json');
  f.put('package.json', pretty({ scripts: { zz: 'mine', aa: 'mine' }, name: 'my-app' }));
  const next = a({ scripts: { aa: 'upstream', bb: 'new' }, version: '1.0.0' });
  install(f, [next], { adopt: true });
  const adopted = JSON.parse(f.get('package.json'));
  assert.deepEqual(adopted, { scripts: { zz: 'mine', aa: 'mine', bb: 'new' }, name: 'my-app', version: '1.0.0' });
  assert.deepEqual(keysOf(adopted), ['scripts', 'name', 'version']);
  assert.deepEqual(keysOf(adopted.scripts), ['zz', 'aa', 'bb']);
  assert.equal(planUpdate({ target: f.target, assets: [next] }).changes.length, 0);
});
test('merge-json creates a missing file with sorted keys', t => {
  const f = fixture(t);
  install(f, [asset(JSON.stringify({ b: 1, a: { d: 1, c: 2 } }), 'merge-json', 'package.json')]);
  assert.equal(f.get('package.json'), '{\n  "a": {\n    "c": 2,\n    "d": 1\n  },\n  "b": 1\n}\n');
});
test('merge-json never reorders order-significant keys inside project values', t => {
  const f = fixture(t), a = s => asset(JSON.stringify(s), 'merge-json', 'package.json');
  install(f, [a({ marker: 1 })]);
  const exportsMap = { '.': { types: './index.d.ts', import: './index.mjs', default: './index.js' } };
  f.put('package.json', pretty({ marker: 1, exports: exportsMap, hooks: [{ type: 'command', command: 'x' }] }));
  install(f, [a({ marker: 2 })]);
  const merged = JSON.parse(f.get('package.json'));
  assert.equal(merged.marker, 2);
  assert.deepEqual(keysOf(merged.exports['.']), ['types', 'import', 'default']);
  assert.deepEqual(keysOf(merged.hooks[0]), ['type', 'command']);
});
test('template sync of package.json scripts keeps the project script order and converges', t => {
  const f = fixture(t), source = path.join(path.dirname(f.target), 'source');
  const put = (file, text) => { fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true }); fs.writeFileSync(path.join(source, file), text); };
  put('infra/templates/agent/template.manifest.json', pretty({ template: { id: 'xirang' }, templateVersion: '1', rules: [{ path: 'package.json', strategy: 'merge-package-scripts' }] }));
  const release = scripts => put('package.json', pretty({ name: 'xirang', scripts }));
  const sync = () => { const plan = createTemplatePlan({ source, target: f.target }); applyPlan(plan, { runRoot: f.runRoot }); return plan; };
  release({ build: 'old', agent: 'a' });
  sync();
  f.put('package.json', pretty({ name: 'my-app', scripts: { start: 's', build: 'old', agent: 'a', 'init:platform': 'p', 'init:dev': 'd' } }));
  release({ build: 'new', agent: 'a', lint: 'l' });
  assert.deepEqual(sync().conflicts, []);
  const merged = JSON.parse(f.get('package.json'));
  assert.deepEqual(keysOf(merged), ['name', 'scripts']);
  assert.deepEqual(Object.entries(merged.scripts), [['start', 's'], ['build', 'new'], ['agent', 'a'], ['init:platform', 'p'], ['init:dev', 'd'], ['lint', 'l']]);
  assert.equal(createTemplatePlan({ source, target: f.target }).changes.length, 0);
});
test('append files immutable; init and project-owned preserve local content', t => {
  const f = fixture(t); install(f, [asset('sql', 'append', 'migrations/001.sql')]);
  assert.ok(planUpdate({ target: f.target, assets: [asset('changed', 'append', 'migrations/001.sql')] }).conflicts.length);
  f.put('config.json', 'mine'); f.put('RULES.md', 'mine');
  install(f, [asset('upstream', 'init-if-missing', 'config.json'), asset('no', 'project-owned', 'RULES.md')]);
  assert.equal(f.get('config.json'), 'mine'); assert.equal(f.get('RULES.md'), 'mine');
});
test('unknown baseline requires explicit adoption and preserves files', t => {
  const f = fixture(t); f.put('apps/web/component.ts', 'custom');
  assert.match(planUpdate({ target: f.target, assets: [asset('template')] }).conflicts[0].reason, /adopt/i);
  install(f, [asset('template')], { adopt: true }); assert.equal(f.get('apps/web/component.ts'), 'custom');
  assert.equal(planUpdate({ target: f.target, assets: [asset('template')] }).changes.length, 0);
});
test('frozen target/source/lock and content hashes are verified', t => {
  const f = fixture(t); const p = planUpdate({ target: f.target, assets: [asset('new')] });
  f.put('apps/web/component.ts', 'appeared'); assert.throws(() => applyPlan(p, { runRoot: f.runRoot }), /drift/i);
  const p2 = planUpdate({ target: f.target, assets: [asset('appeared')] }); p2.entries[0].after = 'tampered';
  assert.throws(() => applyPlan(p2, { runRoot: f.runRoot }), /digest|hash/i);
  const src = path.join(path.dirname(f.target), 'source.txt'); fs.writeFileSync(src, 'before');
  const p3 = planUpdate({ target: f.target, assets: [], inputs: [{ path: src, hash: hash('before') }] });
  fs.writeFileSync(src, 'after'); assert.throws(() => applyPlan(p3, { runRoot: f.runRoot }), /source.*drift/i);
});
test('corrupted or missing baseline fails closed', t => {
  const f = fixture(t); install(f, [asset('base')]);
  const lock = readLock(f.target); const digest = lock.files['apps/web/component.ts'].base;
  f.put(`.xirang/baselines/${digest}`, 'corrupt');
  assert.throws(() => planUpdate({ target: f.target, assets: [asset('new')] }), /baseline/i);
});
test('path escape, symlink and duplicate ownership rejected without writes', t => {
  const f = fixture(t);
  for (const name of ['../escape', '/tmp/escape', '.git/config', '.xirang/escape', 'xirang.lock.json', 'a/../b', 'a\\b']) {
    assert.throws(() => planUpdate({ target: f.target, assets: [asset('x', 'update', name)] }), /path|reserved/i);
  }
  fs.symlinkSync(os.tmpdir(), path.join(f.target, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => planUpdate({ target: f.target, assets: [asset('x', 'update', 'link/x')] }), /symlink/i);
  assert.throws(() => planUpdate({ target: f.target, assets: [asset('a'), asset('b')] }), /duplicate/i);
});
test('interrupted writes resume by before/after hashes and never reapply changed files', t => {
  const f = fixture(t), assets = [asset('A', 'update', 'a.txt'), asset('B', 'update', 'b.txt')];
  const p = planUpdate({ target: f.target, assets });
  assert.throws(() => applyPlan(p, { runRoot: f.runRoot, afterWrite() { throw new Error('power loss'); } }), /power loss/);
  assert.equal(fs.existsSync(path.join(f.target, 'xirang.lock.json')), false);
  resumePlan(f.target, { runRoot: f.runRoot });
  assert.equal(f.get('a.txt'), 'A'); assert.equal(f.get('b.txt'), 'B');
  assert.equal(planUpdate({ target: f.target, assets }).changes.length, 0);
});
test('resume rejects user edits after interruption', t => {
  const f = fixture(t); const p = planUpdate({ target: f.target, assets: [asset('A', 'update', 'a.txt')] });
  assert.throws(() => applyPlan(p, { runRoot: f.runRoot, afterWrite() { throw new Error('stop'); } }), /stop/);
  f.put('a.txt', 'user edit'); assert.throws(() => resumePlan(f.target, { runRoot: f.runRoot }), /drift/i);
  assert.equal(f.get('a.txt'), 'user edit');
});

test('managed blocks preserve surrounding project text and reject overlapping edits', t => {
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
test('lock drift during a batch must not be overwritten at commit', t => {
  const f = fixture(t);
  const p = planUpdate({ target: f.target, assets: [asset('A', 'update', 'a.txt')] });
  const concurrent = JSON.stringify({ schemaVersion: 1, files: {}, packages: { concurrent: { version: '1' } } });
  assert.throws(() => applyPlan(p, { runRoot: f.runRoot, afterWrite() { f.put('xirang.lock.json', concurrent); } }), /lock drift/);
  assert.equal(f.get('xirang.lock.json'), concurrent);
});

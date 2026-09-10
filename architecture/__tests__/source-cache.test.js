const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { describeSource, resolveSource, fetchPinnedSnapshot, validateDescriptor, REPOSITORY, containerPath, cacheLocation } = require('../../tooling/xirang/source-cache');
const { json, withMutex } = require('../../tooling/xirang/engine');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), target = path.join(root, 'project'), cacheRoot = path.join(root, 'cache');
  fs.mkdirSync(source); fs.mkdirSync(target);
  const files = {
    'architecture/manifest.json': json({ id: 'architecture', version: '3.4.0' }),
    'architecture/scripts/cli.js': 'module.exports = { main() {} };\n',
    'tooling/xirang/example.js': 'module.exports = 1;\n',
    'infra/scripts/shared/config.js': '// cache test fixture\n',
    'infra/templates/agent/config.example.json': '{}\n',
    'infra/templates/agent/template.manifest.json': json({ template: { id: 'xirang', repository: REPOSITORY } }),
    'package.json': json({ name: 'xirang', version: '3.4.0' }),
  };
  for (const [file, content] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true }); fs.writeFileSync(path.join(source, file), content); }
  return { root, source, target, cacheRoot };
}

test('TC-LAZYARCH-004 source is content pinned, cache hits are offline, missing cache can be reconstructed', t => {
  const f = fixture(t), descriptor = describeSource(f.source).descriptor;
  const first = resolveSource({ ...f, descriptor }); assert.equal(first.cacheStatus, 'PREPARED');
  assert.ok(!fs.existsSync(path.join(f.target, 'architecture')));
  const hit = resolveSource({ ...f, source: undefined, descriptor, fetchSnapshot() { throw new Error('network must not run'); } });
  assert.equal(hit.cacheStatus, 'HIT'); assert.equal(hit.sourceRoot, first.sourceRoot);
  fs.rmSync(first.sourceRoot, { recursive: true });
  let fetched = 0;
  const rebuilt = resolveSource({ ...f, source: undefined, descriptor, fetchSnapshot() { fetched++; return f.source; } });
  assert.equal(fetched, 1); assert.equal(rebuilt.cacheStatus, 'PREPARED');
  assert.deepEqual(describeSource(rebuilt.sourceRoot).descriptor, descriptor);
});

test('TC-LAZYARCH-004 corrupt cache and mismatched source block without fallback or project writes', t => {
  const f = fixture(t), descriptor = describeSource(f.source).descriptor, cached = resolveSource({ ...f, descriptor });
  fs.appendFileSync(path.join(cached.sourceRoot, 'tooling/xirang/example.js'), '// corrupt\n');
  assert.throws(() => resolveSource({ ...f, source: undefined, descriptor, fetchSnapshot() { assert.fail('must not hide corruption'); } }), /mismatch/);
  fs.appendFileSync(path.join(f.source, 'architecture/scripts/cli.js'), '// changed\n');
  assert.throws(() => resolveSource({ ...f, descriptor }), /mismatch/);
  assert.deepEqual(fs.readdirSync(f.target), []);
});

test('TC-LAZYARCH-004 source and cache symlinks and project-local cache are rejected', t => {
  const f = fixture(t), descriptor = describeSource(f.source).descriptor;
  assert.throws(() => resolveSource({ ...f, descriptor, cacheRoot: path.join(f.target, '.cache') }), /outside/);
  fs.symlinkSync(f.target, f.cacheRoot);
  assert.throws(() => resolveSource({ ...f, descriptor }), /symlink/);
  fs.symlinkSync(path.join(f.source, 'package.json'), path.join(f.source, 'architecture/bad.json'));
  assert.throws(() => describeSource(f.source), /symlink/);
  assert.deepEqual(fs.readdirSync(f.target), []);
});

test('TC-LAZYARCH-004 anonymous transport fetches only pinned official SHA without inherited credentials', t => {
  const f = fixture(t), descriptor = { ...describeSource(f.source).descriptor, commit: 'a'.repeat(40) }, calls = [];
  fetchPinnedSnapshot({ directory: path.join(f.root, 'download'), descriptor, run(command, args, options) {
    calls.push(args); assert.equal(command, 'git'); assert.equal(options.shell, false);
    assert.equal(options.env.GH_TOKEN, undefined); assert.equal(options.env.GITHUB_TOKEN, undefined);
    assert.equal(options.env.GIT_CONFIG_GLOBAL, os.devNull); assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
    return { status: 0, stdout: args.includes('rev-parse') ? descriptor.commit + '\n' : '' };
  } });
  const fetch = calls.find(args => args.includes('fetch'));
  assert.ok(fetch.includes(REPOSITORY)); assert.equal(fetch.at(-1), descriptor.commit); assert.ok(!fetch.includes('main'));
  for (const patch of [{ repository: 'https://example.invalid/repo' }, { commit: 'main' }, { integrity: 'bad' }]) assert.throws(() => validateDescriptor({ ...descriptor, ...patch }));
  assert.throws(() => fetchPinnedSnapshot({ directory: path.join(f.root, 'broken'), descriptor, run: () => ({ status: 1 }) }), /no fallback/);
});

test('TC-LAZYARCH-004 active cache writer blocks a second fill and interrupted preparation is retryable', t => {
  const f = fixture(t), descriptor = describeSource(f.source).descriptor;
  const lockDir = path.join(f.cacheRoot, 'locks', descriptor.integrity); fs.mkdirSync(lockDir, { recursive: true });
  withMutex(lockDir, () => assert.throws(() => resolveSource({ ...f, descriptor }), /another xirang writer/));
  assert.throws(() => resolveSource({ ...f, source: undefined, descriptor, fetchSnapshot() { throw new Error('transport interrupted'); } }), /interrupted/);
  assert.deepEqual(fs.readdirSync(f.cacheRoot).filter(p => p.startsWith('.prepare-')), []);
  assert.equal(resolveSource({ ...f, descriptor }).cacheStatus, 'PREPARED');
});

test('TC-LAZYARCH-004 a linked worktree resolves the shared container cache from the main repository', t => {
  const f = fixture(t), main = path.join(f.root, 'repo'), linked = path.join(f.root, 'worktrees/task'); fs.mkdirSync(main);
  function git(args) { const r = spawnSync('git', args, { cwd: main, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); }
  git(['init', '--quiet']); git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '--quiet', '-m', 'fixture']);
  git(['worktree', 'add', '--quiet', '-b', 'test', linked]);
  assert.equal(path.dirname(containerPath(linked, 'cache')), fs.realpathSync(f.root));
  assert.throws(() => resolveSource({ ...f, target: linked, descriptor: describeSource(f.source).descriptor, cacheRoot: path.join(main, '.cache') }), /outside/);
});

test('TC-LAZYARCH-004 a non-Git target never resolves cache relative to the source tool checkout', t => {
  const f = fixture(t);
  assert.equal(containerPath(f.target, 'cache'), path.join(f.root, 'cache'));
  assert.equal(cacheLocation(f.target, describeSource(f.source).descriptor, f.root).root, f.root);
});

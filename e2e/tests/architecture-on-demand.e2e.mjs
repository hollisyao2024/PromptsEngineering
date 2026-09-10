import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const source = fileURLToPath(new URL('../../', import.meta.url));
const { buildRuntimeAssets } = require('../../tooling/xirang/architecture-kit');
const { planUpdate, applyPlan, json, hash, read } = require('../../tooling/xirang/engine');
const { preparePlanSource, cacheLocation } = require('../../tooling/xirang/source-cache');
const c = require('../../infra/scripts/shared/config');
const tmp = c.resolveContainerPath(c.loadConfig({ repoRoot: source }), c.getMainRepoRoot(source), 'tmp');

function fingerprint(root) {
  const files = [];
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name;
      assert.ok(!entry.isSymbolicLink(), 'consumer fixture must contain regular files');
      if (entry.isDirectory()) walk(path.join(directory, entry.name), relative + '/');
      else files.push([relative, hash(fs.readFileSync(path.join(directory, entry.name)))]);
    }
  }
  walk(root); return hash(json(files));
}

test('TC-LAZYARCH-002/003/004 published CLI survives cold cache, corruption and recovery', () => {
  assert.match(process.env.XIRANG_RELEASE_COMMIT || '', /^[a-f0-9]{40}$/, 'set XIRANG_RELEASE_COMMIT to a published source commit');
  const parent = path.join(tmp, 'architecture-on-demand');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'qa-consumer-'));
  const target = path.join(root, 'project'); fs.mkdirSync(target);
  const kit = buildRuntimeAssets({ source, target });
  assert.equal(kit.descriptor.commit, process.env.XIRANG_RELEASE_COMMIT);
  const plan = planUpdate({ target, ...kit });
  preparePlanSource(plan, source); applyPlan(plan, { runRoot: path.join(root, 'tmp/xirang-runs') });
  fs.writeFileSync(path.join(target, 'RULES.md'), 'project-owned sentinel\n');
  const cached = cacheLocation(target, kit.descriptor).directory;
  function discardFixtureCache() {
    assert.ok(path.relative(root, cached).startsWith('cache' + path.sep));
    assert.deepEqual(JSON.parse(read(cached, '.xirang-source.json')), kit.descriptor);
    fs.rmSync(cached, { recursive: true });
  }
  function cli(args, succeeds = true) {
    const result = spawnSync(process.execPath, ['architecture/scripts/cli.js', ...args], { cwd: target, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    if (succeeds) assert.equal(result.status, 0, result.stdout + result.stderr);
    else assert.notEqual(result.status, 0);
    return result;
  }
  try {
    // A real GitHub fetch must rebuild this exact published version without --source.
    discardFixtureCache();
    const beforeCold = fingerprint(target), started = performance.now();
    const cold = cli(['detect']);
    const coldFetchMs = Math.round(performance.now() - started);
    assert.match(cold.stderr, /ARCHITECTURE_CACHE=PREPARED/);
    assert.match(cold.stderr, new RegExp('ARCHITECTURE_COMMIT=' + kit.descriptor.commit));
    assert.equal(fingerprint(target), beforeCold, 'cold source preparation cannot change the project');
    const catalog = cli(['catalog']); assert.equal(JSON.parse(catalog.stdout).version, '3.4.0');
    assert.equal(kit.assets.filter(asset => asset.path.startsWith('architecture/')).length, 7);
    assert.ok(!fs.existsSync(path.join(target, 'apps')), 'kit acquisition is not application adoption');
    const configFile = path.join(root, 'choice.json');
    fs.writeFileSync(configFile, json({ schemaVersion: 1, applications: [{ id: 'api', stack: 'node', path: 'apps/api' }] }));
    cli(['init', '--config', configFile, '--no-install']); cli(['check']);
    const api = spawnSync(process.execPath, ['--test'], { cwd: path.join(target, 'apps/api'), encoding: 'utf8', timeout: 15000 });
    assert.equal(api.status, 0, api.stdout + api.stderr);
    assert.ok(!fs.existsSync(path.join(target, 'packages')));
    assert.ok(!fs.existsSync(path.join(target, 'architecture/stacks')));
    assert.match(cli(['plan']).stdout, /CHANGED_FILES=0/);
    // A corrupt cache must report failure without silently changing version or project files.
    const beforeFailure = fingerprint(target);
    fs.appendFileSync(path.join(cached, 'architecture/scripts/cli.js'), '\n// simulated cache corruption\n');
    assert.match(cli(['plan'], false).stderr, /mismatch/);
    assert.equal(fingerprint(target), beforeFailure);
    discardFixtureCache();
    assert.match(cli(['detect', '--source', source]).stderr, /ARCHITECTURE_CACHE=PREPARED/);
    assert.match(cli(['plan']).stdout, /CHANGED_FILES=0/);
    assert.equal(read(target, 'RULES.md'), 'project-owned sentinel\n');
    const report = { status: 'PASS', commit: kit.descriptor.commit, integrity: kit.descriptor.integrity,
      runtimeFiles: 7, coldFetchMs, journeys: ['cold-cache-and-selected-api', 'corruption-without-project-writes', 'matching-source-recovery-and-convergence'] };
    const output = path.join(tmp, 'test-results/architecture-on-demand');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'result.json'), json(report));
    console.log(json(report));
    fs.rmSync(root, { recursive: true });
  } catch (error) {
    console.error('Preserved failed consumer fixture: ' + root);
    throw error;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url), source = path.resolve(import.meta.dirname, '../..');
const legacy = process.env.XIRANG_LEGACY_SOURCE;
if (!legacy || JSON.parse(fs.readFileSync(path.join(legacy, 'package.json'))).version !== '3.3.0') throw new Error('Original 3.3.0 source snapshot required');
const oldTemplate = require(path.join(legacy, 'tooling/xirang/template.js'));
const oldProject = require(path.join(legacy, 'architecture/scripts/project.js'));
const oldEngine = require(path.join(legacy, 'tooling/xirang/engine.js'));
const { createTemplatePlan } = require('../../tooling/xirang/template.js');
const { preparePlanSource } = require('../../tooling/xirang/source-cache.js');
const { applyPlan, readLock } = require('../../tooling/xirang/engine.js');
function files(root) { return fs.readdirSync(root, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(root, e.name)).map(p => `${e.name}/${p}`) : [e.name]); }
function size(root) { return files(root).reduce((sum, p) => sum + fs.statSync(path.join(root, p)).size, 0); }

for (const adopted of [false, true]) test(`TC-LAZYARCH-005/006 original 3.3 ${adopted ? 'adopted workspace' : 'inert full kit'} shrinks without losing customizations`, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-34-upgrade-')), target = path.join(root, 'repo'), runRoot = path.join(root, 'runs'); fs.mkdirSync(target);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  oldEngine.applyPlan(oldTemplate.createTemplatePlan({ source: legacy, target, include: ['architecture'] }), { runRoot });
  if (adopted) oldEngine.applyPlan(oldProject.createArchitecturePlan({ source: legacy, target, config: oldProject.expandBlueprint('admin-api', { source: legacy, database: 'sqlite' }) }), { runRoot });
  const before = { files: files(path.join(target, 'architecture')).length, bytes: size(path.join(target, 'architecture')), baselineBytes: size(path.join(target, '.xirang/baselines')) };
  const custom = new Map([['RULES.md', '# Project-owned rules\n'], ['architecture/project-notes.md', '# Keep project note\n']]);
  for (const [p, text] of custom) fs.writeFileSync(path.join(target, p), text);
  if (adopted) for (const p of ['apps/api/src/server.ts', 'packages/ui/src/ui/button.tsx', 'packages/database/main/prisma/schema.prisma']) {
    fs.appendFileSync(path.join(target, p), '\n// project customization\n'); custom.set(p, fs.readFileSync(path.join(target, p), 'utf8'));
  }
  const configBefore = adopted && fs.readFileSync(path.join(target, 'architecture.config.json'), 'utf8');
  const sql = adopted && fs.readFileSync(path.join(target, 'packages/database/main/prisma/migrations/20260909000000_init/migration.sql'), 'utf8');
  const fullBefore = fs.readFileSync(path.join(target, 'architecture/modules/storage/node/src/service.ts'), 'utf8');
  fs.appendFileSync(path.join(target, 'architecture/modules/storage/node/src/service.ts'), '\n// changed template\n');
  assert.ok(createTemplatePlan({ source, target }).conflicts.some(c => c.path.endsWith('storage/node/src/service.ts')));
  fs.writeFileSync(path.join(target, 'architecture/modules/storage/node/src/service.ts'), fullBefore);
  const agentOnly = createTemplatePlan({ source, target, scope: 'agent' });
  assert.ok(!agentOnly.entries.some(e => e.path.startsWith('architecture/'))); applyPlan(agentOnly, { runRoot });
  assert.ok(fs.existsSync(path.join(target, 'architecture/modules/storage')));
  const plan = createTemplatePlan({ source, target }); assert.deepEqual(plan.conflicts, []);
  preparePlanSource(plan, source); applyPlan(plan, { runRoot });
  for (const [p, text] of custom) assert.equal(fs.readFileSync(path.join(target, p), 'utf8'), text, p);
  if (adopted) {
    assert.equal(fs.readFileSync(path.join(target, 'architecture.config.json'), 'utf8'), configBefore);
    assert.equal(fs.readFileSync(path.join(target, 'packages/database/main/prisma/migrations/20260909000000_init/migration.sql'), 'utf8'), sql);
    assert.ok(!fs.existsSync(path.join(target, 'packages/auth'))); assert.ok(!fs.existsSync(path.join(target, 'packages/storage')));
  }
  const after = { files: files(path.join(target, 'architecture')).length, bytes: size(path.join(target, 'architecture')), baselineBytes: size(path.join(target, '.xirang/baselines')) };
  assert.ok(after.files <= 8, JSON.stringify(after)); assert.ok(after.bytes < before.bytes / 4); assert.ok(after.baselineBytes < before.baselineBytes);
  assert.ok(!fs.existsSync(path.join(target, 'architecture/modules'))); assert.ok(!fs.existsSync(path.join(target, 'architecture/stacks')));
  assert.equal(readLock(target).packages['architecture:runtime'].selection.mode, 'on-demand');
  assert.equal(createTemplatePlan({ source, target }).changes.length, 0);
  for (const action of adopted ? ['catalog', 'validate', 'plan'] : ['catalog', 'detect']) {
    const result = spawnSync(process.execPath, ['architecture/scripts/cli.js', action], { cwd: target, encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    if (action === 'plan') assert.match(result.stdout, /CHANGED_FILES=0/);
  }
  console.log(JSON.stringify({ adopted, before, after }));
});

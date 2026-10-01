'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildAgentAssets } = require('../../../../tooling/xirang/template');
const { planUpdate, applyPlan } = require('../../../../tooling/xirang/engine');
const ROOT = path.resolve(__dirname, '../../../..');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-initialization-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'project');
  fs.mkdirSync(target);
  const assets = buildAgentAssets(ROOT, target).assets.filter(a => a.path === 'RULES.md');
  assert.equal(assets.length, 1, 'RULES must be part of the application plan');
  return { target, assets, runRoot: path.join(root, 'runs') };
}

test('TC-CMDSURF-038 initial template application creates missing rules and dry-run preserves the target', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-wrapper-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'project');
  fs.mkdirSync(target);
  const run = args => spawnSync(process.execPath,
    [path.join(ROOT, 'infra/scripts/setup/update-template.js'), target, '--scope', 'agent', ...args],
    { cwd: ROOT, encoding: 'utf8' });
  const dry = run(['--dry-run']);
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  const file = path.join(target, 'RULES.md');
  assert.equal(fs.existsSync(file), false);
  const apply = run([]);
  assert.equal(apply.status, 0, apply.stdout + apply.stderr);
  assert.ok(fs.readFileSync(file, 'utf8').trim());
  assert.match(apply.stdout, /CONVERGENCE_STATUS=OK/);
});

for (const content of ['', '# 项目定制\r\n规则不变。\r\n']) {
  test(`TC-CMDSURF-039 existing ${content ? 'custom' : 'empty'} rules survive initial apply and updates`, t => {
    const f = fixture(t), file = path.join(f.target, 'RULES.md');
    const bytes = Buffer.from(content);
    fs.writeFileSync(file, bytes);
    for (const assets of [f.assets, f.assets.map(a => ({ ...a, content: '# 上游新骨架\n', version: '99.0.0' }))]) {
      const plan = planUpdate({ target: f.target, assets });
      assert.equal(plan.conflicts.length, 0);
      applyPlan(plan, { runRoot: f.runRoot });
      assert.deepEqual(fs.readFileSync(file), bytes);
      assert.equal(planUpdate({ target: f.target, assets }).changes.length, 0);
    }
  });
}

test('TC-CMDSURF-040 update restores missing rules after an earlier install and preserves later project edits', t => {
  const f = fixture(t), file = path.join(f.target, 'RULES.md');
  applyPlan(planUpdate({ target: f.target, assets: f.assets }), { runRoot: f.runRoot });
  fs.unlinkSync(file);
  const plan = planUpdate({ target: f.target, assets: f.assets });
  assert.equal(plan.conflicts.length, 0);
  assert.equal(fs.existsSync(file), false);
  applyPlan(plan, { runRoot: f.runRoot });
  assert.ok(fs.readFileSync(file, 'utf8').trim());
  fs.writeFileSync(file, '# 自定义项目规则\n');
  const updated = f.assets.map(a => ({ ...a, content: '# 新模板规则\n' }));
  applyPlan(planUpdate({ target: f.target, assets: updated }), { runRoot: f.runRoot });
  assert.equal(fs.readFileSync(file, 'utf8'), '# 自定义项目规则\n');
  assert.equal(planUpdate({ target: f.target, assets: updated }).changes.length, 0);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { applyRule } = require('../template-apply-engine');

test('AC1 installed ignore excludes dependency artifacts, retains locks and custom lines, and converges', t => {
  const source = path.resolve(__dirname, '../../../..');
  const target = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'xirang-dependency-ignore-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  fs.writeFileSync(path.join(target, '.gitignore'), 'project-custom-output/\n');
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'infra/templates/agent/template.manifest.json'), 'utf8'));
  const rule = manifest.rules.find(item => item.path === '.gitignore');
  applyRule(source, target, rule, true, new Set());
  const installed = fs.readFileSync(path.join(target, '.gitignore'), 'utf8');
  assert.ok(installed.startsWith('project-custom-output/\n'));
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: target }).status, 0);
  for (const file of ['node_modules/.pnpm-workspace-state-v1.json', 'apps/web/node_modules/pkg/index.js', 'project-custom-output/result']) {
    assert.equal(spawnSync('git', ['check-ignore', '--quiet', file], { cwd: target }).status, 0, `${file} must be ignored`);
  }
  for (const file of ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'apps/web/pnpm-lock.yaml']) {
    assert.equal(spawnSync('git', ['check-ignore', '--quiet', file], { cwd: target }).status, 1, `${file} policy belongs to the project`);
  }
  applyRule(source, target, rule, true, new Set());
  assert.equal(fs.readFileSync(path.join(target, '.gitignore'), 'utf8'), installed);
});

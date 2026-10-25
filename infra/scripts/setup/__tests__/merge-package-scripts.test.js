'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.resolve(__dirname, '..', 'merge-package-scripts.js');
const legacyShip = 'node infra/scripts/devops-tools/devops-run.js --action=ship --env=dev';
const renamedShip = 'node infra/scripts/ops-tools/ops-run.js --action=ship --env=dev';

function fixture(t, scripts) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'merge-package-scripts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packagePath = path.join(root, 'package.json');
  const manifestPath = path.join(root, 'package-scripts.json');
  fs.writeFileSync(packagePath, `${JSON.stringify({ name: 'consumer', private: true, scripts }, null, 2)}\n`);
  fs.writeFileSync(manifestPath, `${JSON.stringify({ scripts: {} }, null, 2)}\n`);
  return { packagePath, manifestPath };
}

function run(files, extra = []) {
  return spawnSync(process.execPath, [script, '--package', files.packagePath, '--manifest', files.manifestPath, ...extra], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

test('dry-run reports renamed template script paths without touching package.json', (t) => {
  const files = fixture(t, { 'ship:dev': legacyShip, lint: 'eslint .' });
  const before = fs.readFileSync(files.packagePath, 'utf8');

  const result = run(files);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^STATUS=DRY_RUN$/mu);
  assert.match(result.stdout, /^RENAMED_SCRIPT_PATHS=1$/mu);
  assert.match(result.stdout, /^RENAMED_SCRIPTS=ship:dev$/mu);
  assert.equal(fs.readFileSync(files.packagePath, 'utf8'), before);
});

test('write rewrites only the exact renamed template path and keeps every other value', (t) => {
  const files = fixture(t, {
    'ship:dev': legacyShip,
    'ship:staging': 'AGENT_ENV=staging node ./infra/scripts/devops-tools/devops-run.js --action=ship --env=staging',
    lint: 'eslint .',
    archive: 'cp vendor/infra/scripts/devops-tools/devops-run.js.bak /tmp',
  });

  const result = run(files, ['--write']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^STATUS=UPDATED$/mu);
  assert.match(result.stdout, /^RENAMED_SCRIPT_PATHS=2$/mu);
  const pkg = JSON.parse(fs.readFileSync(files.packagePath, 'utf8'));
  assert.deepEqual(pkg.scripts, {
    'ship:dev': renamedShip,
    'ship:staging': 'AGENT_ENV=staging node ./infra/scripts/ops-tools/ops-run.js --action=ship --env=staging',
    lint: 'eslint .',
    archive: 'cp vendor/infra/scripts/devops-tools/devops-run.js.bak /tmp',
  });
  assert.equal(pkg.name, 'consumer');
});

test('packages without renamed template paths report zero rewrites', (t) => {
  const files = fixture(t, { 'ship:dev': renamedShip });

  const result = run(files, ['--write']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^RENAMED_SCRIPT_PATHS=0$/mu);
  assert.match(result.stdout, /^RENAMED_SCRIPTS=none$/mu);
});

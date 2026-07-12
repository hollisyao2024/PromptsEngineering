'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { inspectModuleLayout } = require('../check-completeness');

test('PRD completeness requires module-list and at least one module directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-modular-layout-'));
  const modulesDir = path.join(root, 'docs/prd-modules');
  const moduleList = path.join(modulesDir, 'module-list.md');

  assert.equal(inspectModuleLayout(modulesDir, moduleList).valid, false);
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(moduleList, '# Modules\n');
  assert.equal(inspectModuleLayout(modulesDir, moduleList).valid, false);
  fs.mkdirSync(path.join(modulesDir, 'auth'));
  assert.deepEqual(inspectModuleLayout(modulesDir, moduleList), {
    valid: true,
    reason: '',
    moduleDirs: ['auth'],
  });
});

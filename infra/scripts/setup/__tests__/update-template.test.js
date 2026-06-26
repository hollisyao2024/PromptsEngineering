'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  GH_TOKEN_ENV_BLOCK,
  ensureGhTokenEnvLocal,
} = require('../update-template');

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `update-template-${prefix}-`));
}

test('ensureGhTokenEnvLocal reports create in dry-run without writing', () => {
  const targetRoot = mkTmpDir('dry-create');
  const result = ensureGhTokenEnvLocal(targetRoot, false);
  assert.equal(result.status, 'created');
  assert.equal(fs.existsSync(path.join(targetRoot, '.env.local')), false);
});

test('ensureGhTokenEnvLocal creates .env.local with GH_TOKEN block', () => {
  const targetRoot = mkTmpDir('create');
  const result = ensureGhTokenEnvLocal(targetRoot, true);
  assert.equal(result.status, 'created');
  assert.equal(fs.readFileSync(path.join(targetRoot, '.env.local'), 'utf8'), GH_TOKEN_ENV_BLOCK);
});

test('ensureGhTokenEnvLocal appends GH_TOKEN block to existing env file', () => {
  const targetRoot = mkTmpDir('append');
  fs.writeFileSync(path.join(targetRoot, '.env.local'), 'OTHER=value');
  const result = ensureGhTokenEnvLocal(targetRoot, true);
  assert.equal(result.status, 'updated');
  const content = fs.readFileSync(path.join(targetRoot, '.env.local'), 'utf8');
  assert.equal(content, `OTHER=value\n\n${GH_TOKEN_ENV_BLOCK}`);
});

test('ensureGhTokenEnvLocal does not duplicate existing GH_TOKEN values', () => {
  const targetRoot = mkTmpDir('existing');
  fs.writeFileSync(path.join(targetRoot, '.env.local'), 'GH_TOKEN=already-set\n');
  const result = ensureGhTokenEnvLocal(targetRoot, true);
  assert.equal(result.status, 'unchanged');
  assert.equal(fs.readFileSync(path.join(targetRoot, '.env.local'), 'utf8'), 'GH_TOKEN=already-set\n');
});

test('ensureGhTokenEnvLocal treats export GH_TOKEN as existing', () => {
  const targetRoot = mkTmpDir('existing-export');
  fs.writeFileSync(path.join(targetRoot, '.env.local'), 'export GH_TOKEN=already-set\n');
  const result = ensureGhTokenEnvLocal(targetRoot, true);
  assert.equal(result.status, 'unchanged');
  assert.equal(fs.readFileSync(path.join(targetRoot, '.env.local'), 'utf8'), 'export GH_TOKEN=already-set\n');
});

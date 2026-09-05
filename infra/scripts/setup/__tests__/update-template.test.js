'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { applyRule } = require('../template-apply-engine');

const {
  createBackfillBaseline,
  ENVIRONMENT_FILE_PAIRS,
  initializeEnvironmentFiles,
} = require('../update-template');

const TEMPLATE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const TEMPLATE_PACKAGE_NAME = 'prompts-engineering-agents-router';

function isTemplateSourceRoot() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(TEMPLATE_ROOT, 'package.json'), 'utf8'));
  return packageJson.name === TEMPLATE_PACKAGE_NAME;
}

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `update-template-${prefix}-`));
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

test('createBackfillBaseline snapshots template updates without changing the caller index', () => {
  const targetRoot = mkTmpDir('baseline');
  git(targetRoot, ['init']);
  git(targetRoot, ['config', 'user.name', 'Template Test']);
  git(targetRoot, ['config', 'user.email', 'template-test@example.invalid']);
  fs.writeFileSync(path.join(targetRoot, 'AGENTS.md'), 'before\n');
  git(targetRoot, ['add', 'AGENTS.md']);
  git(targetRoot, ['commit', '-m', 'initial']);

  fs.writeFileSync(path.join(targetRoot, 'AGENTS.md'), 'after\n');
  const result = createBackfillBaseline(targetRoot);

  assert.equal(result.status, 'created');
  assert.equal(git(targetRoot, ['show', 'refs/agent/backfill-baseline:AGENTS.md']), 'after');
  assert.equal(git(targetRoot, ['diff', '--cached', '--name-only']), '');
  assert.equal(git(targetRoot, ['diff', '--name-only']), 'AGENTS.md');
});

function writeEnvironmentExamples(targetRoot) {
  const contents = new Map([
    ['.env.example', 'GH_TOKEN=\nLOCAL_ONLY=\n'],
    ['.env.staging.example', 'APP_ENV=staging\nSTAGING_SECRET=\n'],
    ['.env.production.example', 'APP_ENV=production\nPRODUCTION_SECRET=\n'],
  ]);
  for (const [file, content] of contents) {
    fs.writeFileSync(path.join(targetRoot, file), content);
  }
  return contents;
}

test('initializeEnvironmentFiles dry-run reports all missing runtime files without writing', () => {
  const targetRoot = mkTmpDir('env-dry-run');
  writeEnvironmentExamples(targetRoot);

  const results = initializeEnvironmentFiles(targetRoot, false);

  assert.deepEqual(results, ENVIRONMENT_FILE_PAIRS.map(({ runtime }) => ({
    status: 'created',
    path: runtime,
    reason: 'initialized from corresponding example',
  })));
  for (const { runtime } of ENVIRONMENT_FILE_PAIRS) {
    assert.equal(fs.existsSync(path.join(targetRoot, runtime)), false);
  }
});

test('initializeEnvironmentFiles creates each runtime file from its target example', () => {
  const targetRoot = mkTmpDir('env-create');
  const contents = writeEnvironmentExamples(targetRoot);

  const results = initializeEnvironmentFiles(targetRoot, true);

  assert.deepEqual(results.map(({ status, path: file }) => ({ status, path: file })), [
    { status: 'created', path: '.env.local' },
    { status: 'created', path: '.env.staging' },
    { status: 'created', path: '.env.production' },
  ]);
  for (const { example, runtime } of ENVIRONMENT_FILE_PAIRS) {
    assert.equal(fs.readFileSync(path.join(targetRoot, runtime), 'utf8'), contents.get(example));
  }
});

test('initializeEnvironmentFiles never modifies existing runtime files', () => {
  const targetRoot = mkTmpDir('env-existing');
  writeEnvironmentExamples(targetRoot);
  const sentinels = new Map(ENVIRONMENT_FILE_PAIRS.map(({ runtime }, index) => [
    runtime,
    `SENTINEL_${index}=preserve-exactly`,
  ]));
  for (const [file, content] of sentinels) {
    fs.writeFileSync(path.join(targetRoot, file), content);
  }

  const results = initializeEnvironmentFiles(targetRoot, true);

  assert.deepEqual(results.map(({ status }) => status), ['unchanged', 'unchanged', 'unchanged']);
  for (const [file, content] of sentinels) {
    assert.equal(fs.readFileSync(path.join(targetRoot, file), 'utf8'), content);
  }
});

test('initializeEnvironmentFiles fails closed when a required example is missing', () => {
  const targetRoot = mkTmpDir('env-missing-example');
  fs.writeFileSync(path.join(targetRoot, '.env.example'), 'GH_TOKEN=\n');

  assert.throws(
    () => initializeEnvironmentFiles(targetRoot, true),
    /environment example missing: \.env\.staging\.example/u,
  );
  assert.equal(fs.existsSync(path.join(targetRoot, '.env.local')), false);
  assert.equal(fs.existsSync(path.join(targetRoot, '.env.staging')), false);
  assert.equal(fs.existsSync(path.join(targetRoot, '.env.production')), false);
});

test('the template source keeps its GitHub token example empty', {
  skip: !isTemplateSourceRoot(),
}, () => {
  const example = fs.readFileSync(path.join(TEMPLATE_ROOT, '.env.example'), 'utf8');
  assert.match(example, /^GH_TOKEN=\r?$/mu);
  assert.doesNotMatch(example, /^GH_TOKEN=ghp_xxx\r?$/mu);
});

test('environment initialization creates six files with the expected Git ownership and then converges', () => {
  const targetRoot = mkTmpDir('env-integration');
  const manifest = JSON.parse(fs.readFileSync(
    path.join(TEMPLATE_ROOT, 'infra/templates/agent/template.manifest.json'),
    'utf8',
  ));
  const exampleRules = ENVIRONMENT_FILE_PAIRS.map(({ example }) => (
    manifest.rules.find((rule) => rule.path === example)
  ));
  const gitignoreRule = manifest.rules.find((rule) => rule.path === '.gitignore');

  for (const rule of [...exampleRules, gitignoreRule]) {
    const result = applyRule(TEMPLATE_ROOT, targetRoot, rule, true, new Set());
    assert.notEqual(result[0].status, 'blocked');
  }
  initializeEnvironmentFiles(targetRoot, true);

  for (const { example, runtime } of ENVIRONMENT_FILE_PAIRS) {
    assert.equal(fs.existsSync(path.join(targetRoot, example)), true);
    assert.equal(fs.existsSync(path.join(targetRoot, runtime)), true);
  }

  git(targetRoot, ['init']);
  for (const { example, runtime } of ENVIRONMENT_FILE_PAIRS) {
    const ignoredRuntime = spawnSync('git', ['check-ignore', '--quiet', runtime], { cwd: targetRoot });
    const ignoredExample = spawnSync('git', ['check-ignore', '--quiet', example], { cwd: targetRoot });
    assert.equal(ignoredRuntime.status, 0, `${runtime} must be ignored`);
    assert.notEqual(ignoredExample.status, 0, `${example} must remain trackable`);
  }

  const sentinels = new Map();
  for (const { example, runtime } of ENVIRONMENT_FILE_PAIRS) {
    sentinels.set(example, `${example}=project-owned`);
    sentinels.set(runtime, `${runtime}=project-owned`);
  }
  for (const [file, content] of sentinels) fs.writeFileSync(path.join(targetRoot, file), content);

  for (const rule of exampleRules) applyRule(TEMPLATE_ROOT, targetRoot, rule, true, new Set());
  initializeEnvironmentFiles(targetRoot, true);
  for (const [file, content] of sentinels) {
    assert.equal(fs.readFileSync(path.join(targetRoot, file), 'utf8'), content);
  }
});

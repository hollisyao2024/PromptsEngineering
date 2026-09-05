'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

test('GitHub workflows remain project-owned and local gates never trigger workflows', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'infra', 'templates', 'agent', 'template.manifest.json'),
    'utf8',
  ));
  const workflowRule = manifest.rules.find((rule) => rule.path === '.github/workflows');
  assert.deepEqual(workflowRule, { path: '.github/workflows', strategy: 'project-owned' });

  const localGateSources = [
    'infra/scripts/tdd-tools/tdd-push.js',
    'infra/scripts/qa-tools/qa-verify.js',
    'infra/scripts/qa-tools/qa-merge.js',
  ].map((relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')).join('\n');
  assert.doesNotMatch(localGateSources, /gh['"]?\s*,?\s*['"]workflow['"]|workflow\/run/u);

  const policyDocs = [
    'AGENTS.md',
    'docs/CONVENTIONS.md',
    'infra/scripts/qa-tools/README.md',
  ].map((relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')).join('\n');
  assert.match(policyDocs, /不创建、修改、触发或依赖 GitHub CI/u);
  assert.doesNotMatch(
    fs.readFileSync(path.join(repoRoot, 'infra', 'scripts', 'qa-tools', 'README.md'), 'utf8'),
    /\.github\/workflows\/qa-|GitHub Actions/u,
  );
});

test('multi-host lifecycle has no machine-role or QA-account authorization gate', () => {
  const sources = [
    'agent.config.json',
    'infra/templates/agent/agent.config.template.json',
    'infra/scripts/worktree-tools/worktree-core.js',
    'infra/scripts/qa-tools/qa-verify.js',
    'infra/scripts/qa-tools/qa-merge.js',
  ].filter((relativePath) => fs.existsSync(path.join(repoRoot, relativePath)))
    .map((relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
    .join('\n');

  assert.doesNotMatch(sources, /machineRole|qaMachine|qaAccount|allowedMachine/iu);
});

test('qa merge has no hard-coded main push and no force push to the base branch', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'infra', 'scripts', 'qa-tools', 'qa-merge.js'), 'utf8');
  assert.doesNotMatch(source, /\['push',\s*'origin',\s*'main'\]/u);
  assert.doesNotMatch(source, /push[^\n]*(?:--force|--force-with-lease)[^\n]*(?:main|baseBranch)/iu);
});

test('qa merge does not mutate the feature branch after QA verification', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'infra', 'scripts', 'qa-tools', 'qa-merge.js'), 'utf8');
  const mainBody = source.slice(source.indexOf('async function main()'));
  assert.doesNotMatch(mainBody, /autoRebaseOnMain\(/u);
  assert.doesNotMatch(mainBody, /push --force-with-lease/u);
});

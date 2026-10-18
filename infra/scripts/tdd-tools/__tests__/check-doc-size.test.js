'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  DEFAULTS,
  checkChanges,
  collectChanges,
  parseAddedLines,
  resolveDocSizeConfig,
} = require('../check-doc-size');

const enabled = (overrides = {}) => resolveDocSizeConfig({ tdd: { docSize: { enabled: true, ...overrides } } });

test('doc size gate is disabled by default and in the shipped config', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const defaults = JSON.parse(fs.readFileSync(path.join(repoRoot, 'infra/templates/agent/config.example.json'), 'utf8'));
  assert.equal(defaults.tdd.docSize.enabled, false);
  assert.equal(resolveDocSizeConfig(defaults), null);
  assert.equal(resolveDocSizeConfig({}), null);
  const { enabled: _enabled, ...limits } = defaults.tdd.docSize;
  assert.deepEqual(limits, DEFAULTS);
});

test('doc size config rejects invalid limits and unsafe paths', () => {
  assert.throws(() => enabled({ changelogMaxLineChars: 0 }), /tdd\.docSize\.changelogMaxLineChars/);
  assert.throws(() => enabled({ recordMaxLines: '60' }), /tdd\.docSize\.recordMaxLines/);
  assert.throws(() => enabled({ changelogFiles: ['../CHANGELOG.md'] }), /tdd\.docSize\.changelogFiles/);
  assert.throws(() => enabled({ deploymentsDir: '/abs/deployments' }), /tdd\.docSize\.deploymentsDir/);
  assert.equal(enabled({ deploymentsDir: 'ops/deploys/' }).deploymentsDir, 'ops/deploys');
});

test('changelog and ledger added lines are limited by character count', () => {
  const docSize = enabled();
  const violations = checkChanges([
    { path: 'CHANGELOG.md', isNew: false, addedLines: ['- 短条目', `- ${'变'.repeat(119)}`], content: '' },
    { path: 'docs/data/deployments/LOG-2026-10.md', isNew: false, addedLines: ['x'.repeat(241)], content: '' },
    { path: 'docs/data/deployments/LOG-2026-10.md', isNew: false, addedLines: ['x'.repeat(240)], content: '' },
  ], docSize);
  assert.equal(violations.length, 2);
  assert.match(violations[0], /^CHANGELOG\.md\|line-chars\|121>120\|/);
  assert.match(violations[1], /LOG-2026-10\.md\|line-chars\|241>240/);
});

test('deployment README size and new standalone records are limited; old records are not retroactive', () => {
  const docSize = enabled();
  const longRecord = `${'line\n'.repeat(61)}`;
  const violations = checkChanges([
    { path: 'docs/data/deployments/README.md', isNew: false, addedLines: [], content: 'x'.repeat(8193) },
    { path: 'docs/data/deployments/DEPLOY-20261018-001-rollback.md', isNew: true, addedLines: [], content: longRecord },
    { path: 'docs/data/deployments/DEPLOY-20250101-001-old.md', isNew: false, addedLines: [], content: longRecord },
    { path: 'docs/data/deployments/DEPLOY-20261018-002-ok.md', isNew: true, addedLines: [], content: 'line\n'.repeat(60) },
    { path: 'docs/other.md', isNew: true, addedLines: ['x'.repeat(500)], content: 'x'.repeat(10000) },
  ], docSize);
  assert.deepEqual(violations, [
    'docs/data/deployments/README.md|bytes|8193>8192',
    'docs/data/deployments/DEPLOY-20261018-001-rollback.md|lines|61>60',
  ]);
});

test('parseAddedLines ignores diff headers', () => {
  assert.deepEqual(parseAddedLines('+++ b/CHANGELOG.md\n@@ -1 +1,2 @@\n+新行\n-旧行\n context'), ['新行']);
});

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('collectChanges only reports changes relative to the base branch, including untracked files', (t) => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'xirang-doc-size-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'test');
  fs.mkdirSync(path.join(root, 'docs/data/deployments'), { recursive: true });
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `# Changelog\n\n- ${'旧'.repeat(200)}\n`);
  fs.writeFileSync(path.join(root, 'docs/data/deployments/DEPLOY-20250101-001-old.md'), 'line\n'.repeat(100));
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'base');
  git(root, 'checkout', '-q', '-b', 'feature');
  fs.appendFileSync(path.join(root, 'CHANGELOG.md'), `- ${'新'.repeat(130)}\n`);
  fs.appendFileSync(path.join(root, 'docs/data/deployments/DEPLOY-20250101-001-old.md'), 'more\n');
  fs.writeFileSync(path.join(root, 'docs/data/deployments/LOG-2026-10.md'), '| 2026-10-18 | staging | abc1234 | OK |\n');

  const docSize = enabled();
  const changes = collectChanges({ cwd: root, baseBranch: 'main', docSize });
  const byPath = Object.fromEntries(changes.map((change) => [change.path, change]));
  assert.deepEqual(Object.keys(byPath).sort(), [
    'CHANGELOG.md',
    'docs/data/deployments/DEPLOY-20250101-001-old.md',
    'docs/data/deployments/LOG-2026-10.md',
  ]);
  assert.deepEqual(byPath['CHANGELOG.md'].addedLines, [`- ${'新'.repeat(130)}`]);
  assert.equal(byPath['docs/data/deployments/LOG-2026-10.md'].isNew, true);
  assert.deepEqual(checkChanges(changes, docSize), [
    `CHANGELOG.md|line-chars|132>120|- ${'新'.repeat(38)}`,
  ]);
});

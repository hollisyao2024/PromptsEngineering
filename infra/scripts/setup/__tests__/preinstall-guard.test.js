'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  findProdInstallReason,
  isSourceCheckoutRoot,
  shouldBlockInstall,
} = require('../preinstall-guard');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agent-template-${prefix}-`));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeSourceCheckoutMarkers(root) {
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  writeJson(path.join(root, 'package.json'), { name: 'example-project' });
  fs.mkdirSync(path.join(root, 'infra', 'scripts', 'setup'), { recursive: true });
  fs.writeFileSync(path.join(root, 'infra', 'scripts', 'setup', 'preinstall-guard.js'), '');
}

test('detects production-only pnpm install flags that would prune dev dependencies', () => {
  assert.equal(findProdInstallReason({ npm_config_production: 'true' }), 'npm_config_production=true');
  assert.equal(findProdInstallReason({ npm_config_dev: 'false' }), 'npm_config_dev=false');
  assert.equal(findProdInstallReason({ npm_config_omit: 'optional,dev' }), 'npm_config_omit includes dev');
  assert.equal(findProdInstallReason({ npm_config_only: 'production' }), 'npm_config_only=production');
  assert.equal(findProdInstallReason({ NODE_ENV: 'production' }), 'NODE_ENV=production');
  assert.equal(findProdInstallReason({ NODE_ENV: 'development' }), '');
});

test('blocks production-only install in source checkout but allows release directories', () => {
  const sourceRoot = makeTempDir('source-checkout-');
  const releaseRoot = makeTempDir('release-root-');

  try {
    writeSourceCheckoutMarkers(sourceRoot);
    writeJson(path.join(releaseRoot, 'package.json'), { name: 'xiaolan-private-server-runtime' });

    assert.equal(isSourceCheckoutRoot(sourceRoot), true);
    assert.equal(isSourceCheckoutRoot(releaseRoot), false);
    assert.deepEqual(shouldBlockInstall({ cwd: sourceRoot, env: { npm_config_production: 'true' } }), {
      blocked: true,
      reason: 'npm_config_production=true',
    });
    assert.deepEqual(shouldBlockInstall({ cwd: releaseRoot, env: { npm_config_production: 'true' } }), {
      blocked: false,
      reason: '',
    });
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
    fs.rmSync(releaseRoot, { recursive: true, force: true });
  }
});

test('allows explicit emergency override for source checkout production installs', () => {
  const sourceRoot = makeTempDir('source-override-');

  try {
    writeSourceCheckoutMarkers(sourceRoot);

    assert.deepEqual(shouldBlockInstall({
      cwd: sourceRoot,
      env: {
        NODE_ENV: 'production',
        AGENT_ALLOW_PROD_INSTALL_IN_SOURCE_REPO: '1',
      },
    }), {
      blocked: false,
      reason: '',
    });
  } finally {
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});

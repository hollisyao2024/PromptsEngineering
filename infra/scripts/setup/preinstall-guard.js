#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ALLOW_PROD_INSTALL_ENV = 'AGENT_ALLOW_PROD_INSTALL_IN_SOURCE_REPO';

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalize(value));
}

function isSourceCheckoutRoot(root) {
  return (
    fs.existsSync(path.join(root, 'AGENTS.md')) &&
    fs.existsSync(path.join(root, 'pnpm-workspace.yaml')) &&
    fs.existsSync(path.join(root, 'package.json')) &&
    fs.existsSync(path.join(root, 'infra', 'scripts', 'setup', 'preinstall-guard.js'))
  );
}

function commaListIncludes(value, needle) {
  return String(value || '')
    .split(',')
    .map((item) => normalize(item))
    .includes(needle);
}

function findProdInstallReason(env = process.env) {
  if (isTruthy(env.npm_config_production) || isTruthy(env.npm_config_prod)) {
    return 'npm_config_production=true';
  }
  if (normalize(env.npm_config_dev) === 'false') {
    return 'npm_config_dev=false';
  }
  if (commaListIncludes(env.npm_config_omit, 'dev')) {
    return 'npm_config_omit includes dev';
  }
  if (['prod', 'production'].includes(normalize(env.npm_config_only))) {
    return `npm_config_only=${normalize(env.npm_config_only)}`;
  }
  if (normalize(env.NODE_ENV) === 'production') {
    return 'NODE_ENV=production';
  }
  return '';
}

function shouldBlockInstall({ cwd = process.cwd(), env = process.env } = {}) {
  if (!isSourceCheckoutRoot(cwd)) return { blocked: false, reason: '' };
  if (isTruthy(env[ALLOW_PROD_INSTALL_ENV])) return { blocked: false, reason: '' };

  const reason = findProdInstallReason(env);
  return {
    blocked: Boolean(reason),
    reason,
  };
}

function main() {
  const result = shouldBlockInstall();
  if (!result.blocked) return;

  console.error(
    [
      `[preinstall-guard] Refusing production-only install in source checkout: ${result.reason}.`,
      '',
      'This source checkout may need devDependencies for local dev servers and template tooling.',
      'Run development installs in the source checkout:',
      '  pnpm install --frozen-lockfile',
      '',
      'Run production-only installs only in generated release/artifacts directories.',
      `Emergency override: ${ALLOW_PROD_INSTALL_ENV}=1 pnpm install --prod`,
      '',
    ].join('\n')
  );
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  ALLOW_PROD_INSTALL_ENV,
  findProdInstallReason,
  isSourceCheckoutRoot,
  shouldBlockInstall,
};

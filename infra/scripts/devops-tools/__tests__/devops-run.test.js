'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  collectPositionals,
  commandForAction,
  normalizeDevTarget,
  resolveRuntimeCommand,
} = require('../devops-run');

test('normalizes common dev service targets', () => {
  assert.equal(normalizeDevTarget('private'), 'private');
  assert.equal(normalizeDevTarget('priv'), 'private');
  assert.equal(normalizeDevTarget('enterprise'), 'private');
  assert.equal(normalizeDevTarget('saas'), 'default');
  assert.equal(normalizeDevTarget('local'), 'default');
});

test('collects positional target after valued flags', () => {
  assert.deepEqual(collectPositionals(['--action=dev-restart', 'private']), ['private']);
  assert.deepEqual(collectPositionals(['--action', 'dev-restart', 'private']), ['private']);
  assert.deepEqual(collectPositionals(['--action=env-check', '--env', 'dev']), []);
  assert.deepEqual(collectPositionals(['--action=dev-restart', '--', '--dry-run']), ['--dry-run']);
});

test('selects dev server command by target', () => {
  const config = {
    devServer: {
      commands: {
        restart: {
          default: 'node scripts/dev-server.js restart',
          private: 'node scripts/private-server.js restart',
        },
      },
    },
  };

  assert.equal(
    commandForAction(config, {}, 'dev-restart', '', 'private'),
    'node scripts/private-server.js restart'
  );
  assert.equal(
    commandForAction(config, {}, 'dev-restart', '', ''),
    'node scripts/dev-server.js restart'
  );
});

test('materializes node-prefixed configured commands with the current runtime', () => {
  assert.equal(
    resolveRuntimeCommand('node scripts/server.js restart', 'C:\\Program Files\\nodejs\\node.exe'),
    '"C:\\Program Files\\nodejs\\node.exe" scripts/server.js restart'
  );
  assert.equal(
    resolveRuntimeCommand('pnpm dev:restart', 'C:\\Program Files\\nodejs\\node.exe'),
    'pnpm dev:restart'
  );
});

test('keeps ship target semantics on env actions', () => {
  const config = {
    devops: {
      commands: {
        ship: {
          production: 'deploy production',
        },
      },
    },
  };

  assert.equal(commandForAction(config, {}, 'ship', 'production', 'private'), 'deploy production');
});

test('rejects positional dev targets so /restart private cannot be routed implicitly', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const script = path.join(repoRoot, 'infra/scripts/devops-tools/devops-run.js');
  const result = spawnSync(
    process.execPath,
    [script, '--action=dev-restart', 'private', '--dry-run'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /dev action positional targets are not supported/);
  assert.match(result.stderr, /--target=private/);
});

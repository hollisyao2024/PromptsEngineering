'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  collectPositionals,
  commandForAction,
  normalizeDevTarget,
  resolveBashCommand,
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

test('does not fall back to the default service command for an explicit private target', () => {
  const config = {
    devServer: {
      commands: {
        restart: 'node scripts/dev-server.js restart',
      },
    },
  };

  assert.equal(commandForAction(config, {}, 'dev-restart', '', 'private'), '');
});

test('selects app dev and build commands by platform and target without cross-profile fallback', () => {
  const config = {
    app: {
      commands: {
        dev: {
          mac: {
            default: 'pnpm dev:app:mac',
            private: 'pnpm private:dev:app:mac',
          },
        },
        build: {
          win: 'pnpm build:app:win',
        },
      },
    },
  };

  assert.equal(commandForAction(config, {}, 'app-dev', '', 'private', 'mac'), 'pnpm private:dev:app:mac');
  assert.equal(commandForAction(config, {}, 'app-dev', '', '', 'mac'), 'pnpm dev:app:mac');
  assert.equal(commandForAction(config, {}, 'app-build', '', '', 'win'), 'pnpm build:app:win');
  assert.equal(commandForAction(config, {}, 'app-build', '', 'private', 'win'), '');
});

test('selects server build and ship commands by environment and target', () => {
  const config = {
    devops: {
      commands: {
        build: {
          production: 'pnpm build:prod',
          private: {
            production: 'pnpm private:build:prod',
          },
        },
        ship: {
          production: 'pnpm ship:prod',
          private: {
            production: 'pnpm private:ship:prod',
          },
        },
      },
    },
  };

  assert.equal(commandForAction(config, {}, 'build', 'production', '', ''), 'pnpm build:prod');
  assert.equal(commandForAction(config, {}, 'build', 'production', 'private', ''), 'pnpm private:build:prod');
  assert.equal(commandForAction(config, {}, 'ship', 'production', 'private', ''), 'pnpm private:ship:prod');
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

test('uses Git Bash for bash-prefixed commands on Windows', () => {
  assert.equal(
    resolveBashCommand('bash infra/scripts/server/deploy-api.sh production', {
      platform: 'win32',
      exists: (candidate) => candidate === 'C:\\Program Files\\Git\\bin\\bash.exe',
    }),
    '"C:\\Program Files\\Git\\bin\\bash.exe" infra/scripts/server/deploy-api.sh production'
  );
});

test('keeps bash-prefixed commands unchanged on macOS', () => {
  assert.equal(
    resolveBashCommand('bash infra/scripts/server/deploy-api.sh production', { platform: 'darwin' }),
    'bash infra/scripts/server/deploy-api.sh production'
  );
});

test('reports no Windows Bash command when no compatible runtime is installed', () => {
  assert.equal(
    resolveBashCommand('bash infra/scripts/server/deploy-api.sh production', {
      platform: 'win32',
      exists: () => false,
    }),
    ''
  );
});

test('does not fall back to the default ship command for an explicit private target', () => {
  const config = {
    devops: {
      commands: {
        ship: {
          production: 'deploy production',
        },
      },
    },
  };

  assert.equal(commandForAction(config, {}, 'ship', 'production', 'private'), '');
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
  assert.match(result.stderr, /\/private restart/);
});

test('requires an explicit platform for app commands', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const script = path.join(repoRoot, 'infra/scripts/devops-tools/devops-run.js');
  const result = spawnSync(process.execPath, [script, '--action=app-dev', '--dry-run'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing --platform/);
});

test('documents /private restart as the user shortcut instead of /restart --target', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const expert = fs.readFileSync(path.join(repoRoot, 'AgentRoles/DEVOPS-ENGINEERING-EXPERT.md'), 'utf8');
  assert.match(expert, /`\/private restart`/u);
  assert.doesNotMatch(expert, /`\/restart --target <profile>`/u);
});

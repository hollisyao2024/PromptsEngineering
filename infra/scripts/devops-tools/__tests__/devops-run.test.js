'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig } = require('../../shared/config');

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

test('an updated sparse project inherits all 32 registered default commands and can override one leaf', (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-command-matrix-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  fs.writeFileSync(path.join(fixture, 'agent.config.json'), `${JSON.stringify({
    projectName: 'fixture',
    app: {
      commands: {
        dev: {
          mac: { default: 'pnpm custom:dev:mac' },
        },
      },
    },
  }, null, 2)}\n`);

  const config = loadConfig({ repoRoot: fixture, env: {}, argv: [] });
  const resolved = [];
  for (const platform of ['mac', 'win', 'ios', 'android']) {
    const defaultDev = platform === 'mac' ? 'pnpm custom:dev:mac' : `pnpm dev:app:${platform}`;
    resolved.push(commandForAction(config, {}, 'app-dev', '', '', platform));
    assert.equal(resolved.at(-1), defaultDev);
    resolved.push(commandForAction(config, {}, 'app-dev', '', 'private', platform));
    assert.equal(resolved.at(-1), `pnpm private:dev:app:${platform}`);
    resolved.push(commandForAction(config, {}, 'app-build', '', '', platform));
    assert.equal(resolved.at(-1), `pnpm build:app:${platform}`);
    resolved.push(commandForAction(config, {}, 'app-build', '', 'private', platform));
    assert.equal(resolved.at(-1), `pnpm private:build:app:${platform}`);
  }

  for (const action of ['start', 'restart', 'stop', 'status', 'logs']) {
    resolved.push(commandForAction(config, {}, `dev-${action}`, '', ''));
    assert.equal(resolved.at(-1), `pnpm dev:${action}`);
    resolved.push(commandForAction(config, {}, `dev-${action}`, '', 'private'));
    assert.equal(resolved.at(-1), `pnpm private:${action}`);
  }

  for (const env of ['dev', 'staging', 'production']) {
    const suffix = env === 'production' ? 'prod' : env;
    resolved.push(commandForAction(config, {}, 'build', env));
    assert.equal(resolved.at(-1), `pnpm build:${suffix}`);
    resolved.push(commandForAction(config, {}, 'build', env, 'private'));
    assert.equal(resolved.at(-1), `pnpm private:build:${suffix}`);
  }

  assert.equal(resolved.length, 32);
  assert.equal(commandForAction(config, {}, 'ship', 'production'), '');
  assert.equal(commandForAction(config, {}, 'ship', 'production', 'private'), '');
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

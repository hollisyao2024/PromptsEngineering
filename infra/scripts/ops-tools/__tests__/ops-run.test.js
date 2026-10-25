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
  detectRecursiveCall,
  normalizeDevTarget,
  opsCallKey,
  resolveBashCommand,
  resolveRuntimeCommand,
  resolveSourceArgs,
  templateCommand,
} = require('../ops-run');

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
    ops: {
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
    ops: {
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
  const script = path.join(repoRoot, 'infra/scripts/ops-tools/ops-run.js');
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
  const script = path.join(repoRoot, 'infra/scripts/ops-tools/ops-run.js');
  const result = spawnSync(process.execPath, [script, '--action=app-dev', '--dry-run'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing --platform/);
});

test('creates missing tmp, cache, and artifacts directories before a project command dry-run', (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-container-dirs-'));
  t.after(() => fs.rmSync(container, { recursive: true, force: true }));
  const repoRoot = path.resolve(__dirname, '../../../..');
  const script = path.join(repoRoot, 'infra/scripts/ops-tools/ops-run.js');
  const tmpDir = path.join(container, 'tmp');
  const cacheDir = path.join(container, 'cache');
  const artifactsDir = path.join(container, 'artifacts');

  const result = spawnSync(
    process.execPath,
    [script, '--action=app-build', '--platform=win', '--dry-run'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENT_TMP_DIR: tmpDir,
        AGENT_CACHE_DIR: cacheDir,
        AGENT_ARTIFACTS_DIR: artifactsDir,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /STATUS=DRY_RUN/);
  for (const directoryPath of [tmpDir, cacheDir, artifactsDir]) {
    assert.equal(fs.lstatSync(directoryPath).isDirectory(), true, directoryPath);
  }
});

test('blocks before later command side effects when a container path is not a directory', (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-container-file-'));
  t.after(() => fs.rmSync(container, { recursive: true, force: true }));
  const repoRoot = path.resolve(__dirname, '../../../..');
  const script = path.join(repoRoot, 'infra/scripts/ops-tools/ops-run.js');
  const cachePath = path.join(container, 'cache');
  const artifactsDir = path.join(container, 'artifacts');
  fs.writeFileSync(cachePath, 'occupied\n');

  const result = spawnSync(
    process.execPath,
    [script, '--action=app-build', '--platform=win', '--dry-run'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENT_TMP_DIR: path.join(container, 'tmp'),
        AGENT_CACHE_DIR: cachePath,
        AGENT_ARTIFACTS_DIR: artifactsDir,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /container directory cache must be a real directory/iu);
  assert.equal(fs.existsSync(artifactsDir), false);
});

test('documents /private restart as the user shortcut instead of /restart --target', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const expert = fs.readFileSync(path.join(repoRoot, 'AgentRoles/OPS-ENGINEERING-EXPERT.md'), 'utf8');
  assert.match(expert, /`\/private restart`/u);
  assert.doesNotMatch(expert, /`\/restart --target <profile>`/u);
});

const SHIP_SHA = 'ddc9528d6d35fc9884bc9b1b87aa8d0222e63d05';
const SHIP_TEMPLATE = 'node scripts/ship.js production {source_args} {dry_run_arg}';

test('expands --sha into a ship command that declares {source_args}', () => {
  assert.deepEqual(resolveSourceArgs({ sha: SHIP_SHA }, 'ship', SHIP_TEMPLATE), { value: `--sha=${SHIP_SHA}` });
  assert.deepEqual(resolveSourceArgs({ source: 'origin/release-1.2' }, 'cd', SHIP_TEMPLATE), {
    value: '--source=origin/release-1.2',
  });
  assert.match(
    templateCommand(SHIP_TEMPLATE, { source_args: `--sha=${SHIP_SHA}`, dry_run_arg: '--dry-run' }),
    new RegExp(`ship\\.js production --sha=${SHIP_SHA} --dry-run$`)
  );
});

test('keeps the command unchanged when no source is requested', () => {
  assert.deepEqual(resolveSourceArgs({}, 'ship', SHIP_TEMPLATE), { value: '' });
  assert.deepEqual(resolveSourceArgs({}, 'ship', 'node scripts/ship.js production'), { value: '' });
  assert.deepEqual(resolveSourceArgs({}, 'build', 'pnpm build'), { value: '' });
});

test('rejects malformed or shell-unsafe source selections', () => {
  for (const sha of [
    true,
    '',
    SHIP_SHA.slice(0, 12),
    SHIP_SHA.toUpperCase(),
    `${SHIP_SHA};rm -rf /`,
    `${SHIP_SHA} --force`,
    `$(id)${SHIP_SHA.slice(5)}`,
  ]) {
    assert.ok(resolveSourceArgs({ sha }, 'ship', SHIP_TEMPLATE).error, `sha accepted: ${sha}`);
  }
  for (const source of [true, '', '-main', 'a..b', 'main;id', 'main id', '$(id)', 'main`id`', 'refs/heads/x.lock', 'x/']) {
    assert.ok(resolveSourceArgs({ source }, 'ship', SHIP_TEMPLATE).error, `source accepted: ${source}`);
  }
  assert.match(resolveSourceArgs({ sha: SHIP_SHA, source: 'main' }, 'ship', SHIP_TEMPLATE).error, /either/);
});

test('fails closed when the configured command cannot receive the source selection', () => {
  assert.match(
    resolveSourceArgs({ sha: SHIP_SHA }, 'ship', 'node scripts/ship.js production').error,
    /\{source_args\}/
  );
  assert.match(resolveSourceArgs({ sha: SHIP_SHA }, 'build', 'pnpm build {source_args}').error, /ship and cd/);
});

const SHIP_FIXTURE_OPS = {
  commands: {
    ship: { production: 'node -e "" -- {source_args} {dry_run_arg}' },
    cd: { production: 'node -e ""' },
  },
};

// Runs ops-run.js in a throwaway git fixture; `config` replaces the fixture's
// agent.config.json body and `env` overrides the child environment.
function runOpsCli(t, args, { config, env = {} } = {}) {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-ship-sha-'));
  t.after(() => fs.rmSync(container, { recursive: true, force: true }));
  const fixture = path.join(container, 'repo');
  fs.mkdirSync(fixture);
  spawnSync('git', ['init', '-q'], { cwd: fixture });
  fs.writeFileSync(path.join(fixture, 'agent.config.json'), `${JSON.stringify(
    config || { projectName: 'fixture', ops: SHIP_FIXTURE_OPS },
    null,
    2,
  )}\n`);
  const repoRoot = path.resolve(__dirname, '../../../..');
  return spawnSync(process.execPath, [path.join(repoRoot, 'infra/scripts/ops-tools/ops-run.js'), ...args], {
    cwd: fixture,
    env: {
      ...process.env,
      AGENT_TMP_DIR: path.join(container, 'tmp'),
      AGENT_CACHE_DIR: path.join(container, 'cache'),
      AGENT_ARTIFACTS_DIR: path.join(container, 'artifacts'),
      AGENT_OPS_DEPLOY_ENABLED: 'true',
      // A test runner launched from an ops shortcut must not leak its call chain into the fixture.
      AGENT_OPS_CALL_STACK: '',
      ...env,
    },
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 60000,
  });
}

// Writes a node script that re-invokes ops-run.js with `args`, like a package.json
// alias pointing back at the dispatcher. It stops by itself at `depthLimit` so a
// missing guard fails the assertion instead of recursing forever.
function writeReentrantHelper(t, args, { depthLimit = 3 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-reentrant-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const opsRun = path.resolve(__dirname, '../ops-run.js');
  const helper = path.join(dir, 'reenter.js');
  fs.writeFileSync(helper, [
    "const { spawnSync } = require('node:child_process');",
    "const depth = Number(process.env.FIXTURE_REENTRY_DEPTH || 0);",
    `if (depth >= ${depthLimit}) { console.log('REENTRY_DEPTH_LIMIT'); process.exit(0); }`,
    `const run = spawnSync(process.execPath, [${JSON.stringify(opsRun)}, ...${JSON.stringify(args)}], {`,
    "  stdio: 'inherit',",
    "  env: { ...process.env, FIXTURE_REENTRY_DEPTH: String(depth + 1) },",
    "});",
    "process.exit(typeof run.status === 'number' ? run.status : 1);",
    '',
  ].join('\n'));
  return `node "${helper}"`;
}

test('blocks an invalid --sha before printing or running any command', (t) => {
  const result = runOpsCli(t, ['--action=ship', '--env=production', '--sha=abc;id', '--dry-run']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /STATUS=BLOCKED/);
  assert.match(result.stderr, /REASON=--sha must be a full 40-character lowercase commit SHA/);
  assert.doesNotMatch(result.stdout, /COMMAND=/);
});

test('blocks --sha for a configured command that does not declare {source_args}', (t) => {
  // The fixture's cd command has no {source_args}; it must not silently drop the SHA.
  const result = runOpsCli(t, ['--action=cd', '--env=production', `--sha=${SHIP_SHA}`, '--dry-run']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /STATUS=BLOCKED/);
  assert.doesNotMatch(result.stdout, /COMMAND=/);
});

test('passes a validated --sha and delegated --dry-run to a command that declares them', (t) => {
  const result = runOpsCli(t, ['--action=ship', '--env=production', `--sha=${SHIP_SHA}`, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`SOURCE_ARGS=--sha=${SHIP_SHA}`));
  assert.match(result.stdout, /DRY_RUN_MODE=DELEGATED/);
  assert.match(result.stdout, new RegExp(`COMMAND=.*--sha=${SHIP_SHA} --dry-run$`, 'm'));
});

test('blocks a project config that still declares the renamed devops section', (t) => {
  const result = runOpsCli(t, ['--action=ci-status', '--dry-run'], {
    config: { projectName: 'fixture', devops: { commands: { ciStatus: 'node -e ""' } } },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /STATUS=BLOCKED/);
  assert.match(result.stderr, /devops 节已更名为 ops/u);
  assert.doesNotMatch(result.stdout, /COMMAND=/);
});

test('blocks the renamed AGENT_DEVOPS_DEPLOY_ENABLED environment variable', (t) => {
  const result = runOpsCli(t, ['--action=ship', '--env=production', '--dry-run'], {
    env: { AGENT_DEVOPS_DEPLOY_ENABLED: 'true' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /STATUS=BLOCKED/);
  assert.match(result.stderr, /AGENT_OPS_DEPLOY_ENABLED/);
  assert.doesNotMatch(result.stdout, /COMMAND=/);
});

test('writes runs under ops-runs and exposes AGENT_OPS_ACTION to the configured command', (t) => {
  const result = runOpsCli(t, ['--action=ci-status'], {
    config: {
      projectName: 'fixture',
      ops: {
        commands: {
          ciStatus: 'node -e "console.log(\'ACTION_SEEN=\' + process.env.AGENT_OPS_ACTION + \'|\' + (process.env.AGENT_DEVOPS_ACTION || \'\'))"',
        },
      },
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^RUN_DIR=.*[\\/]ops-runs[\\/]/m);
  assert.match(result.stdout, /^ACTION_SEEN=ci-status\|$/m);
});

test('builds a positional call key and detects re-entry of the same shortcut', () => {
  assert.equal(opsCallKey('dev-status'), 'dev-status');
  assert.equal(opsCallKey('dev-status', '', 'private'), 'dev-status::private');
  assert.equal(opsCallKey('build', 'staging', 'private'), 'build::private:staging');
  assert.equal(opsCallKey('app-dev', '', '', 'mac'), 'app-dev:mac');
  // Fixed positions keep env and profile apart even when their values match.
  assert.notEqual(opsCallKey('build', 'staging'), opsCallKey('build', '', 'staging'));

  assert.deepEqual(detectRecursiveCall('', 'dev-status'), { recursive: false, stack: ['dev-status'] });
  assert.deepEqual(detectRecursiveCall('dev-restart', 'dev-status'), {
    recursive: false,
    stack: ['dev-restart', 'dev-status'],
  });
  assert.deepEqual(detectRecursiveCall('dev-restart,dev-status', 'dev-status'), {
    recursive: true,
    stack: ['dev-restart', 'dev-status', 'dev-status'],
  });
  assert.equal(detectRecursiveCall('ship:::staging', 'ship:::production').recursive, false);
  assert.equal(detectRecursiveCall(undefined, 'dev-status').recursive, false);
});

test('blocks a configured command that calls back into the same shortcut instead of recursing', (t) => {
  const reenter = writeReentrantHelper(t, ['--action=dev-status']);
  const result = runOpsCli(t, ['--action=dev-status'], {
    config: { projectName: 'fixture', devServer: { commands: { status: reenter } } },
  });
  assert.equal(result.status, 1, result.stdout);
  assert.doesNotMatch(result.stdout, /REENTRY_DEPTH_LIMIT/);
  assert.match(result.stderr, /REASON=recursive ops shortcut: dev-status -> dev-status/);
  assert.match(result.stderr, /^CALL_STACK=dev-status -> dev-status$/m);
  // Only the outer run reaches the configured command; the re-entry stops before printing one.
  assert.equal(result.stdout.match(/^COMMAND=/gm).length, 1);
});

test('lets a shortcut run a different nested shortcut and passes the call chain down', (t) => {
  const reenter = writeReentrantHelper(t, ['--action=dev-status']);
  const result = runOpsCli(t, ['--action=dev-restart'], {
    config: {
      projectName: 'fixture',
      devServer: {
        commands: {
          restart: reenter,
          status: 'node -e "console.log(\'STACK_SEEN=\' + process.env.AGENT_OPS_CALL_STACK)"',
        },
      },
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^STACK_SEEN=dev-restart,dev-status$/m);
});

// The template default devServer.commands calls the project's own pnpm dev:<action>
// scripts; downstream projects inherit these defaults unchanged.
test('keeps the template default dev service commands pointing at project pnpm scripts', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const defaults = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'infra/templates/agent/config.example.json'), 'utf8')
  );
  for (const action of ['start', 'restart', 'stop', 'status', 'logs']) {
    assert.deepEqual(defaults.devServer.commands[action], {
      default: `pnpm dev:${action}`,
      private: `pnpm private:${action}`,
    });
  }
});

// Only the Xirang source has no local dev service; installed projects keep their own scripts and config.
function isTemplateSourceRepo(repoRoot) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'agent.config.json'), 'utf8'));
    return Boolean(config.template && config.template.role === 'source');
  } catch {
    return false;
  }
}
const SOURCE_REPO_ROOT = path.resolve(__dirname, '../../../..');
const TEMPLATE_SOURCE_ONLY = isTemplateSourceRepo(SOURCE_REPO_ROOT)
  ? false
  : 'only the Xirang template source ships without a local dev service';

test('template source package.json keeps no dev:* alias that calls back into ops-run', { skip: TEMPLATE_SOURCE_ONLY }, () => {
  const { scripts = {} } = JSON.parse(fs.readFileSync(path.join(SOURCE_REPO_ROOT, 'package.json'), 'utf8'));
  const loops = Object.entries(scripts).filter(([, value]) => /ops-run\.js\b.*--action=dev-/.test(String(value)));
  assert.deepEqual(loops, []);
});

test('template source dev shortcuts block at the first level because no service command is configured', { skip: TEMPLATE_SOURCE_ONLY }, (t) => {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-source-dev-'));
  t.after(() => fs.rmSync(container, { recursive: true, force: true }));
  const script = path.join(SOURCE_REPO_ROOT, 'infra/scripts/ops-tools/ops-run.js');
  const cases = [
    ...['start', 'restart', 'stop', 'status', 'logs'].map((action) => [[`--action=dev-${action}`], `dev-${action}`]),
    [['--action=dev-restart', '--target=private'], 'dev-restart:private'],
  ];
  for (const [args, label] of cases) {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: SOURCE_REPO_ROOT,
      env: {
        ...process.env,
        AGENT_TMP_DIR: path.join(container, 'tmp'),
        AGENT_CACHE_DIR: path.join(container, 'cache'),
        AGENT_ARTIFACTS_DIR: path.join(container, 'artifacts'),
        AGENT_OPS_CALL_STACK: '',
      },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000,
    });
    assert.equal(result.status, 1, `${label}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, new RegExp(`^REASON=no command configured for ${label}$`, 'm'), label);
    // A single-level block resolves no command, so nothing is spawned and no nested shortcut runs.
    assert.doesNotMatch(result.stdout, /^COMMAND=/m, label);
    assert.doesNotMatch(result.stdout + result.stderr, /STATUS=RUNNING|recursive ops shortcut/, label);
  }
});

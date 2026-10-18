'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  bootstrap,
  ghTokenMode,
  hashInputs,
  renderEnvFile,
  renderSetupScript,
  shellQuote,
} = require('../cloud-session');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-session-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function cloudConfig(overrides = {}) {
  return {
    cloud: {
      enabled: true,
      setup: { images: [], prefetch: 'pnpm fetch', extra: [] },
      session: {
        install: 'pnpm install --frozen-lockfile --prefer-offline',
        installHashFiles: ['package.json'],
        compose: { file: 'compose.dev.yml', project: 'demo-dev', services: ['postgres'], waitTimeoutSec: 30 },
        envFile: {
          target: '.env.local',
          template: '.env.example',
          overrides: { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' },
          generateSecrets: ['AUTH_JWT_SECRET'],
        },
        steps: [
          { name: 'migrate', command: 'pnpm db:migrate', hashFiles: ['migrations'] },
          { name: 'seed', command: 'pnpm db:seed' },
        ],
        exportEnv: { APP_ENVIRONMENT: 'development' },
        ...overrides,
      },
    },
  };
}

function fakeRunner({ fail = [] } = {}) {
  const calls = [];
  const run = (command) => {
    calls.push(command);
    if (fail.some((pattern) => command.includes(pattern))) return { status: 1, stdout: '', stderr: 'boom' };
    if (command.includes(' ps -q')) return { status: 0, stdout: 'container-a\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { calls, run };
}

function seedRepo(dir) {
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"demo"}\n');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.mkdirSync(path.join(dir, 'migrations'));
  fs.writeFileSync(path.join(dir, 'migrations', '001.sql'), 'select 1;\n');
  fs.writeFileSync(
    path.join(dir, '.env.example'),
    '# comment\nDATABASE_URL="postgresql://placeholder"\nAUTH_JWT_SECRET=\nGH_TOKEN=\nOPENAI_API_KEY=\n'
  );
}

test('bootstrap skips without side effects outside Claude Code cloud sessions', (t) => {
  const repoRoot = tempDir(t);
  const { calls, run } = fakeRunner();
  const result = bootstrap({ repoRoot, env: {}, config: cloudConfig(), run, stateDir: path.join(repoRoot, 's') });
  assert.equal(result.status, 'SKIPPED');
  assert.match(result.summary, /CLAUDE_CODE_REMOTE/u);
  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(path.join(repoRoot, 's')), false);
});

test('bootstrap skips when cloud bootstrap is not enabled for the project', (t) => {
  const repoRoot = tempDir(t);
  const { calls, run } = fakeRunner();
  const config = cloudConfig();
  config.cloud.enabled = false;
  const result = bootstrap({ repoRoot, env: { CLAUDE_CODE_REMOTE: 'true' }, config, run, stateDir: path.join(repoRoot, 's') });
  assert.equal(result.status, 'SKIPPED');
  assert.match(result.summary, /cloud\.enabled/u);
  assert.deepEqual(calls, []);
});

test('renderEnvFile applies overrides, generated secrets and session env without ever writing GitHub tokens', () => {
  const text = renderEnvFile({
    templateText: '# keep\nDATABASE_URL="placeholder"\nAUTH_JWT_SECRET=\nGH_TOKEN=\nGITHUB_TOKEN=x\nOPENAI_API_KEY=\nPLAIN=value\n',
    overrides: { DATABASE_URL: 'postgresql://u:p@localhost/db', EXTRA_KEY: 'extra' },
    generateSecrets: ['AUTH_JWT_SECRET'],
    env: { OPENAI_API_KEY: 'from-cloud-env', GH_TOKEN: 'proxy-injected', GITHUB_TOKEN: 'proxy-injected' },
    randomBytes: (size) => Buffer.alloc(size, 1),
  });
  assert.match(text, /^# keep$/mu);
  assert.match(text, /^DATABASE_URL='postgresql:\/\/u:p@localhost\/db'$/mu);
  assert.match(text, /^AUTH_JWT_SECRET='0101(01)+'$/mu);
  assert.match(text, /^OPENAI_API_KEY='from-cloud-env'$/mu);
  assert.match(text, /^PLAIN=value$/mu);
  assert.match(text, /^EXTRA_KEY='extra'$/mu);
  assert.doesNotMatch(text, /proxy-injected/u);
  assert.match(text, /^# GH_TOKEN omitted/mu);
  assert.doesNotMatch(text, /^GH_TOKEN=/mu);
  assert.doesNotMatch(text, /^GITHUB_TOKEN=/mu);
});

test('bootstrap prepares a cloud session once and skips unchanged work on the next run', (t) => {
  const repoRoot = tempDir(t);
  seedRepo(repoRoot);
  const stateDir = path.join(repoRoot, 'state');
  const envFile = path.join(repoRoot, 'claude-env');
  const env = { CLAUDE_CODE_REMOTE: 'true', CLAUDE_ENV_FILE: envFile };

  const first = fakeRunner();
  const result = bootstrap({ repoRoot, env, config: cloudConfig(), run: first.run, stateDir });
  assert.equal(result.status, 'OK', JSON.stringify(result.steps));
  assert.ok(first.calls.some((command) => command.startsWith('pnpm install --frozen-lockfile')));
  assert.ok(first.calls.some((command) => /docker compose -f .*compose\.dev\.yml.* -p 'demo-dev' up -d --wait/u.test(command)));
  assert.ok(first.calls.includes('pnpm db:migrate'));
  assert.ok(first.calls.includes('pnpm db:seed'));

  const generated = fs.readFileSync(path.join(repoRoot, '.env.local'), 'utf8');
  assert.match(generated, /^DATABASE_URL='postgresql:\/\/u:p@localhost:5432\/db'$/mu);
  assert.match(generated, /^AUTH_JWT_SECRET='[0-9a-f]{64}'$/mu);
  assert.match(fs.readFileSync(envFile, 'utf8'), /^export APP_ENVIRONMENT='development'$/mu);

  const second = fakeRunner();
  const again = bootstrap({ repoRoot, env, config: cloudConfig(), run: second.run, stateDir });
  assert.equal(again.status, 'OK');
  assert.equal(second.calls.some((command) => command.startsWith('pnpm install')), false);
  assert.equal(second.calls.includes('pnpm db:migrate'), false);
  // 无 hashFiles 的步骤每次执行（自身需幂等）。
  assert.ok(second.calls.includes('pnpm db:seed'));
  assert.equal(fs.readFileSync(path.join(repoRoot, '.env.local'), 'utf8'), generated);
  assert.equal(again.steps.find((step) => step.name === 'env-file').status, 'KEPT');
});

test('bootstrap appends exportEnv lines to CLAUDE_ENV_FILE once and keeps lines written by other hooks', (t) => {
  const repoRoot = tempDir(t);
  seedRepo(repoRoot);
  const stateDir = path.join(repoRoot, 'state');
  const envFile = path.join(repoRoot, 'claude-env');
  fs.writeFileSync(envFile, 'export OTHER_HOOK=1');
  const env = { CLAUDE_CODE_REMOTE: 'true', CLAUDE_ENV_FILE: envFile };

  bootstrap({ repoRoot, env, config: cloudConfig(), run: fakeRunner().run, stateDir });
  bootstrap({ repoRoot, env, config: cloudConfig(), run: fakeRunner().run, stateDir });

  const lines = fs.readFileSync(envFile, 'utf8').split('\n').filter(Boolean);
  assert.deepEqual(lines, ['export OTHER_HOOK=1', "export APP_ENVIRONMENT='development'"]);
});

test('bootstrap runs project steps with the env file and exportEnv loaded but never GitHub tokens', (t) => {
  const repoRoot = tempDir(t);
  seedRepo(repoRoot);
  fs.writeFileSync(
    path.join(repoRoot, '.env.local'),
    "# kept\nDATABASE_URL='postgresql://kept@localhost/db'\nQUOTED=\"a\\nb\"\nPLAIN=v # note\nGH_TOKEN=should-not-leak\n"
  );
  const seen = new Map();
  const run = (command, options = {}) => {
    seen.set(command, options.env);
    if (command.includes(' ps -q')) return { status: 0, stdout: 'container-a\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const result = bootstrap({
    repoRoot,
    env: { CLAUDE_CODE_REMOTE: 'true', PATH: '/bin', GH_TOKEN: 'proxy-injected' },
    config: cloudConfig(),
    run,
    stateDir: path.join(repoRoot, 'state'),
  });
  assert.equal(result.status, 'OK');
  const stepEnv = seen.get('pnpm db:migrate');
  assert.equal(stepEnv.DATABASE_URL, 'postgresql://kept@localhost/db');
  assert.equal(stepEnv.QUOTED, 'a\nb');
  assert.equal(stepEnv.PLAIN, 'v');
  assert.equal(stepEnv.APP_ENVIRONMENT, 'development');
  assert.equal(stepEnv.PATH, '/bin');
  // 进程自身的代理占位 token 原样保留，env 文件里的 GH_TOKEN 不注入。
  assert.equal(stepEnv.GH_TOKEN, 'proxy-injected');
});

test('bootstrap reruns hashed steps when the service containers were recreated', (t) => {
  const repoRoot = tempDir(t);
  seedRepo(repoRoot);
  const stateDir = path.join(repoRoot, 'state');
  const env = { CLAUDE_CODE_REMOTE: 'true' };
  bootstrap({ repoRoot, env, config: cloudConfig(), run: fakeRunner().run, stateDir });

  const calls = [];
  const run = (command) => {
    calls.push(command);
    if (command.includes(' ps -q')) return { status: 0, stdout: 'container-b\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const result = bootstrap({ repoRoot, env, config: cloudConfig(), run, stateDir });
  assert.equal(result.status, 'OK');
  assert.ok(calls.includes('pnpm db:migrate'));
});

test('bootstrap never overwrites an existing env file', (t) => {
  const repoRoot = tempDir(t);
  seedRepo(repoRoot);
  fs.writeFileSync(path.join(repoRoot, '.env.local'), 'DATABASE_URL=mine\n');
  const result = bootstrap({
    repoRoot,
    env: { CLAUDE_CODE_REMOTE: 'true' },
    config: cloudConfig(),
    run: fakeRunner().run,
    stateDir: path.join(repoRoot, 'state'),
  });
  assert.equal(result.status, 'OK');
  assert.equal(fs.readFileSync(path.join(repoRoot, '.env.local'), 'utf8'), 'DATABASE_URL=mine\n');
});

test('bootstrap reports FAILED, stops dependent steps and does not record their hashes', (t) => {
  const repoRoot = tempDir(t);
  seedRepo(repoRoot);
  const stateDir = path.join(repoRoot, 'state');
  const env = { CLAUDE_CODE_REMOTE: 'true' };
  const failing = fakeRunner({ fail: ['pnpm db:migrate'] });
  const result = bootstrap({ repoRoot, env, config: cloudConfig(), run: failing.run, stateDir });
  assert.equal(result.status, 'FAILED');
  assert.equal(failing.calls.includes('pnpm db:seed'), false);
  assert.match(result.nextAction, /pnpm db:migrate/u);

  const retry = fakeRunner();
  bootstrap({ repoRoot, env, config: cloudConfig(), run: retry.run, stateDir });
  assert.ok(retry.calls.includes('pnpm db:migrate'));
});

test('hashInputs changes when a tracked input file changes and marks missing inputs', (t) => {
  const repoRoot = tempDir(t);
  seedRepo(repoRoot);
  const before = hashInputs(repoRoot, ['migrations', 'missing.lock']);
  fs.writeFileSync(path.join(repoRoot, 'migrations', '002.sql'), 'select 2;\n');
  assert.notEqual(hashInputs(repoRoot, ['migrations', 'missing.lock']), before);
  assert.notEqual(hashInputs(repoRoot, ['missing.lock']), hashInputs(repoRoot, []));
});

test('renderSetupScript emits a snapshot script that always exits 0', () => {
  const config = cloudConfig();
  config.cloud.setup = {
    images: ['pgvector/pgvector:pg17', 'redis:7-alpine'],
    prefetch: 'pnpm fetch',
    extra: ['pnpm exec playwright install chromium'],
  };
  const script = renderSetupScript(config);
  assert.match(script, /^#!\/bin\/bash/u);
  assert.match(script, /docker pull 'pgvector\/pgvector:pg17' \|\| true/u);
  assert.match(script, /docker pull 'redis:7-alpine' \|\| true/u);
  assert.match(script, /pnpm fetch \|\| true/u);
  assert.match(script, /pnpm exec playwright install chromium \|\| true/u);
  assert.match(script.trimEnd(), /exit 0$/u);
  assert.doesNotMatch(script, /set -e\b/u);
});

test('ghTokenMode distinguishes proxy, explicit token and missing credentials', () => {
  assert.equal(ghTokenMode({ GH_TOKEN: 'proxy-injected' }), 'proxy');
  assert.equal(ghTokenMode({ CLAUDE_CODE_REMOTE: 'true' }), 'proxy');
  assert.equal(ghTokenMode({ GH_TOKEN: 'ghp_realLookingValue' }), 'token');
  assert.equal(ghTokenMode({}), 'missing');
});

test('shellQuote produces single-quoted shell literals', () => {
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  assessGuardReadiness,
  formatReadiness,
  reportGuardReadiness,
} = require('../deploy-guard-readiness');

const READY_SHIP = 'bash deploy.sh {source_args}';

function opsConfig(ops) {
  return { ops: { deployEnabled: true, ...ops } };
}

function codes(result, key = 'gaps') {
  return result[key].map((gap) => gap.code).sort();
}

test('AC1: no ship/cd command for guarded envs is NOT_APPLICABLE', () => {
  const result = assessGuardReadiness({
    config: opsConfig({ commands: { ship: { dev: 'bash dev.sh', staging: '', production: '' }, cd: {} } }),
    isShallow: false,
    hasToken: true,
  });
  assert.equal(result.readiness, 'NOT_APPLICABLE');
  assert.equal(result.guardEnabled, false);
  assert.deepEqual(result.targets, []);
  assert.deepEqual(result.gaps, []);
});

test('AC1: disabled guard with every prerequisite met is READY and hints enabling', () => {
  const result = assessGuardReadiness({
    config: opsConfig({
      rollbackGuard: { enabled: false, readDeployedCommand: 'curl -fsS https://x/version' },
      commands: { ship: { staging: READY_SHIP, production: READY_SHIP }, cd: { production: 'bash cd.sh {source_args}' } },
    }),
    isShallow: false,
    hasToken: true,
  });
  assert.equal(result.readiness, 'READY');
  assert.deepEqual(result.targets, ['ship:staging', 'ship:production', 'cd:production']);
  assert.deepEqual(result.gaps, []);
  assert.match(result.next, /rollbackGuard\.enabled=true/u);
});

test('AC1: disabled guard with gaps is NOT_READY and lists each gap', () => {
  const result = assessGuardReadiness({
    config: opsConfig({ commands: { ship: { staging: 'bash deploy.sh', production: READY_SHIP }, cd: { staging: 'bash cd.sh' } } }),
    isShallow: true,
    hasToken: false,
  });
  assert.equal(result.readiness, 'NOT_READY');
  assert.deepEqual(codes(result), ['GH_TOKEN_MISSING', 'MISSING_SOURCE_ARGS', 'MISSING_SOURCE_ARGS', 'SHALLOW_CLONE']);
  assert.deepEqual(
    result.gaps.filter((gap) => gap.code === 'MISSING_SOURCE_ARGS').map((gap) => gap.subject).sort(),
    ['cd:staging', 'ship:staging'],
  );
  assert.deepEqual(codes(result, 'warnings'), ['NO_READ_DEPLOYED_COMMAND', 'NO_READ_DEPLOYED_COMMAND']);
});

test('AC1: enabled guard with gaps is BLOCKED', () => {
  const result = assessGuardReadiness({
    config: opsConfig({ rollbackGuard: { enabled: true }, commands: { ship: { production: 'bash deploy.sh' } } }),
    isShallow: false,
    hasToken: true,
  });
  assert.equal(result.readiness, 'BLOCKED');
  assert.equal(result.guardEnabled, true);
  assert.deepEqual(codes(result), ['MISSING_SOURCE_ARGS']);
});

test('AC1: enabled guard fully prepared is READY without enable hint', () => {
  const result = assessGuardReadiness({
    config: opsConfig({
      rollbackGuard: { enabled: true, environments: ['production'], readDeployedCommand: { production: 'curl x' } },
      commands: { ship: { staging: 'bash unguarded.sh', production: READY_SHIP } },
    }),
    isShallow: false,
    hasToken: true,
  });
  assert.equal(result.readiness, 'READY');
  assert.deepEqual(result.targets, ['ship:production']);
  assert.deepEqual(result.warnings, []);
  assert.doesNotMatch(result.next, /enabled=true/u);
});

test('AC1: profile ship commands are checked under their own scope', () => {
  const result = assessGuardReadiness({
    config: opsConfig({
      rollbackGuard: { readDeployedCommand: { production: 'curl x' } },
      commands: { ship: { production: READY_SHIP, private: { production: 'bash private.sh' } } },
    }),
    isShallow: false,
    hasToken: true,
  });
  assert.equal(result.readiness, 'NOT_READY');
  assert.deepEqual(result.targets, ['ship:production', 'ship:private-production']);
  assert.deepEqual(result.gaps.map((gap) => gap.subject), ['ship:private-production']);
  // readDeployedCommand[scope] falls back to [env], exactly as resolveGuardConfig does at deploy time.
  assert.deepEqual(result.warnings, []);
});

test('AC1: invalid guard config is reported as CONFIG_INVALID', () => {
  const result = assessGuardReadiness({
    config: opsConfig({ rollbackGuard: { enabled: true, remote: 'bad remote' }, commands: { ship: { staging: READY_SHIP } } }),
    isShallow: false,
    hasToken: true,
  });
  assert.equal(result.readiness, 'BLOCKED');
  assert.deepEqual(codes(result), ['CONFIG_INVALID']);
});

test('AC1: unknown shallow/token state is a warning, not a gap', () => {
  const result = assessGuardReadiness({
    config: opsConfig({ rollbackGuard: { readDeployedCommand: 'curl x' }, commands: { ship: { staging: READY_SHIP } } }),
    isShallow: null,
    hasToken: null,
  });
  assert.equal(result.readiness, 'READY');
  assert.deepEqual(codes(result, 'warnings'), ['GH_TOKEN_NOT_EVALUATED', 'SHALLOW_NOT_EVALUATED']);
});

test('AC1: formatReadiness emits parseable lines without secrets', () => {
  const result = assessGuardReadiness({
    config: opsConfig({ commands: { ship: { staging: 'bash deploy.sh' } } }),
    isShallow: false,
    hasToken: false,
  });
  const lines = formatReadiness(result);
  assert.ok(lines.includes('DEPLOY_GUARD_READINESS=NOT_READY'));
  assert.ok(lines.includes('ROLLBACK_GUARD=DISABLED'));
  assert.ok(lines.includes('DEPLOY_GUARD_TARGETS=ship:staging'));
  assert.ok(lines.some((line) => line.startsWith('DEPLOY_GUARD_GAP=MISSING_SOURCE_ARGS|ship:staging|')));
  assert.ok(lines.some((line) => line.startsWith('DEPLOY_GUARD_NEXT=')));
});

function makeRepo(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-ready-'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(root, 'agent.config.json'), `${JSON.stringify(config, null, 2)}\n`);
  return root;
}

test('AC2: reportGuardReadiness reads the target project and never throws', () => {
  const root = makeRepo(opsConfig({ commands: { ship: { staging: 'bash deploy.sh' } } }));
  try {
    const lines = [];
    const result = reportGuardReadiness({ repoRoot: root, log: (line) => lines.push(line), env: {} });
    assert.equal(result.readiness, 'NOT_READY');
    assert.ok(lines.includes('DEPLOY_GUARD_READINESS=NOT_READY'));
    assert.ok(lines.some((line) => line.startsWith('DEPLOY_GUARD_GAP=MISSING_SOURCE_ARGS|ship:staging|')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('AC2: reportGuardReadiness reports UNKNOWN when the check fails', () => {
  const lines = [];
  const result = reportGuardReadiness({
    repoRoot: '/nonexistent',
    log: (line) => lines.push(line),
    loadConfig: () => { throw new Error('boom'); },
  });
  assert.equal(result.readiness, 'UNKNOWN');
  assert.ok(lines.includes('DEPLOY_GUARD_READINESS=UNKNOWN'));
  assert.ok(lines.some((line) => line.startsWith('DEPLOY_GUARD_READINESS_ERROR=boom')));
});

test('AC2: reportGuardReadiness skips the template source repository', () => {
  const lines = [];
  const result = reportGuardReadiness({
    repoRoot: '/nonexistent',
    log: (line) => lines.push(line),
    loadConfig: () => ({ template: { role: 'source' } }),
  });
  assert.equal(result.readiness, 'SKIPPED');
  assert.deepEqual(lines, ['DEPLOY_GUARD_READINESS=SKIPPED']);
});

const CLI = path.join(__dirname, '..', 'deploy-guard-readiness.js');

test('AC3: standalone CLI exits non-zero only when the enabled guard is not ready', () => {
  const blocked = makeRepo(opsConfig({ rollbackGuard: { enabled: true }, commands: { ship: { staging: 'bash deploy.sh' } } }));
  const notReady = makeRepo(opsConfig({ commands: { ship: { staging: 'bash deploy.sh' } } }));
  try {
    const env = { ...process.env };
    const runBlocked = spawnSync(process.execPath, [CLI], { cwd: blocked, encoding: 'utf8', env });
    assert.equal(runBlocked.status, 1, runBlocked.stderr);
    assert.match(runBlocked.stdout, /^DEPLOY_GUARD_READINESS=BLOCKED$/mu);
    assert.match(runBlocked.stdout, /^STATUS=BLOCKED$/mu);
    assert.match(runBlocked.stdout, /^NEXT_ACTION=/mu);

    const runNotReady = spawnSync(process.execPath, [CLI], { cwd: notReady, encoding: 'utf8', env });
    assert.equal(runNotReady.status, 0, runNotReady.stderr);
    assert.match(runNotReady.stdout, /^DEPLOY_GUARD_READINESS=NOT_READY$/mu);
    assert.match(runNotReady.stdout, /^STATUS=OK$/mu);
  } finally {
    fs.rmSync(blocked, { recursive: true, force: true });
    fs.rmSync(notReady, { recursive: true, force: true });
  }
});

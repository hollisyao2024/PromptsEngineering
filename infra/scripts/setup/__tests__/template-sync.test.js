'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SYNC_SCRIPT = path.join(ROOT, 'infra/scripts/setup/template-sync.js');
const TEMPLATE_IDENTITY = Object.freeze({
  id: 'xirang',
  name: '息壤',
  englishName: 'Xirang',
});
const OFFICIAL_REPOSITORY = 'https://github.com/hollisyao2024/PromptsEngineering.git';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function initializeRepository(root) {
  fs.mkdirSync(root, { recursive: true });
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Xirang Test']);
  git(root, ['config', 'user.email', 'xirang-test@example.invalid']);
  git(root, ['branch', '-M', 'main']);
}

function commitAll(root, message) {
  git(root, ['add', '--all']);
  git(root, ['commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function createUpstream(testRoot, options = {}) {
  const upstream = path.join(testRoot, options.name || 'upstream');
  initializeRepository(upstream);

  const defaults = {
    containerDirs: {
      worktrees: '../worktrees',
      tmp: '../tmp',
      cache: '../cache',
      artifacts: '../artifacts',
    },
    template: {
      role: 'consumer',
      identity: TEMPLATE_IDENTITY,
      upstream: {
        repository: OFFICIAL_REPOSITORY,
        branch: 'main',
        fetchRequired: true,
      },
      manifest: 'infra/templates/agent/template.manifest.json',
      applyReportDir: '../tmp/template-apply-reports',
      sourceRepo: '',
    },
  };
  const manifest = {
    schemaVersion: 1,
    templateVersion: '99.0.0-test',
    template: {
      ...TEMPLATE_IDENTITY,
      repository: OFFICIAL_REPOSITORY,
      branch: 'main',
    },
    capabilities: {
      officialSync: {
        schemaVersion: 1,
        convergenceRequired: true,
      },
    },
    rules: [
      { path: 'AGENTS.md', strategy: 'overwrite' },
      {
        path: 'package.json',
        source: 'infra/templates/agent/package-scripts.example.json',
        strategy: 'merge-package-scripts',
      },
      { path: 'RULES.md', strategy: 'project-owned' },
      { path: 'src', strategy: 'project-owned' },
    ],
  };
  if (options.missingManifestSource) {
    manifest.rules.splice(1, 0, { path: 'MISSING-TEMPLATE-FILE.md', strategy: 'overwrite' });
  }

  write(upstream, 'AGENTS.md', '# 息壤 upstream v1\n');
  write(upstream, 'infra/templates/agent/config.example.json', `${JSON.stringify(defaults, null, 2)}\n`);
  write(upstream, 'infra/templates/agent/template.manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  write(upstream, 'infra/templates/agent/package-scripts.example.json', `${JSON.stringify({
    scripts: { agent: 'node infra/scripts/agent-runner/agent-cli.js' },
  }, null, 2)}\n`);

  if (!options.invalidShape) {
    for (const relativePath of [
      'infra/scripts/setup/template-apply-engine.js',
      'infra/scripts/setup/update-template.js',
      'infra/scripts/shared/config.js',
    ]) {
      const content = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
      const marker = relativePath.endsWith('update-template.js')
        ? `${content}\nconsole.log('UPDATER_ORIGIN=FETCHED_SNAPSHOT');\nconsole.log(\`UPDATER_GH_TOKEN_PRESENT=\${Boolean(process.env.GH_TOKEN)}\`);\n`
        : content;
      write(upstream, relativePath, marker);
    }
  }

  commitAll(upstream, 'xirang fixture v1');
  write(upstream, 'AGENTS.md', '# 息壤 upstream v2\n');
  const latestCommit = commitAll(upstream, 'xirang fixture v2');
  return { latestCommit, upstream };
}

function createTarget(testRoot, options = {}) {
  const container = path.join(testRoot, options.name || 'target');
  const mainRoot = path.join(container, 'repo');
  const linkedRoot = path.join(container, 'worktrees', 'xirang-sync');
  initializeRepository(mainRoot);
  write(mainRoot, 'AGENTS.md', '# local old template\n');
  write(mainRoot, 'RULES.md', 'PROJECT_RULE_SENTINEL\n');
  write(mainRoot, 'src/business.js', 'module.exports = "PROJECT_BUSINESS_SENTINEL";\n');
  write(mainRoot, 'package.json', `${JSON.stringify({
    name: 'actual-project',
    private: true,
    scripts: {
      agent: options.agentCommand || 'node infra/scripts/agent-runner/agent-cli.js',
    },
  }, null, 2)}\n`);
  for (const file of [
    '.env.example',
    '.env.staging.example',
    '.env.production.example',
    '.env.local',
    '.env.staging',
    '.env.production',
  ]) {
    write(mainRoot, file, `${file}=PROJECT_SENTINEL\n`);
  }
  if (options.role) {
    write(mainRoot, 'agent.config.json', `${JSON.stringify({ template: { role: options.role } }, null, 2)}\n`);
  }
  commitAll(mainRoot, 'target fixture');
  fs.mkdirSync(path.dirname(linkedRoot), { recursive: true });
  git(mainRoot, ['worktree', 'add', '-b', `test-${path.basename(container)}`, linkedRoot, 'main']);
  return { container, linkedRoot, mainRoot };
}

function runSync(cwd, args) {
  return spawnSync(process.execPath, [SYNC_SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: 'xirang-test-token' },
  });
}

function combinedOutput(result) {
  return `${result.stdout || ''}${result.stderr || ''}`;
}

test('sync fetches the advanced upstream SHA, executes its updater, preserves project-owned files, and converges', (t) => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-sync-success-'));
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const { latestCommit, upstream } = createUpstream(testRoot);
  const { container, linkedRoot } = createTarget(testRoot);

  const first = runSync(linkedRoot, [
    `--source-repo=${upstream}`,
    '--source-branch=main',
  ]);
  const firstOutput = combinedOutput(first);
  assert.equal(first.status, 0, firstOutput);
  assert.match(firstOutput, /UPDATER_ORIGIN=FETCHED_SNAPSHOT/u);
  assert.match(firstOutput, /UPDATER_GH_TOKEN_PRESENT=false/u);
  assert.match(firstOutput, new RegExp(`TEMPLATE_COMMIT=${latestCommit}`, 'u'));
  assert.match(firstOutput, /TEMPLATE_FETCH_STATUS=OK/u);
  assert.match(firstOutput, /TEMPLATE_APPLY_STATUS=UPDATED/u);
  assert.match(firstOutput, /TEMPLATE_CONVERGENCE_STATUS=OK/u);
  assert.equal(fs.readFileSync(path.join(linkedRoot, 'AGENTS.md'), 'utf8'), '# 息壤 upstream v2\n');
  assert.equal(fs.readFileSync(path.join(linkedRoot, 'RULES.md'), 'utf8'), 'PROJECT_RULE_SENTINEL\n');
  assert.equal(
    fs.readFileSync(path.join(linkedRoot, 'src/business.js'), 'utf8'),
    'module.exports = "PROJECT_BUSINESS_SENTINEL";\n',
  );
  assert.equal(git(linkedRoot, ['status', '--porcelain']), 'M AGENTS.md');

  commitAll(linkedRoot, 'apply xirang v2');
  const second = runSync(linkedRoot, [
    `--source-repo=${upstream}`,
    '--source-branch=main',
  ]);
  const secondOutput = combinedOutput(second);
  assert.equal(second.status, 0, secondOutput);
  assert.match(secondOutput, /TEMPLATE_CONVERGENCE_STATUS=OK/u);
  assert.equal(git(linkedRoot, ['status', '--porcelain']), '');

  const runsRoot = path.join(container, 'tmp', 'template-sync-runs');
  assert.deepEqual(fs.existsSync(runsRoot) ? fs.readdirSync(runsRoot) : [], []);
});

test('required fetch failure blocks without changing target tracked files or using a stale local snapshot', (t) => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-sync-fetch-failure-'));
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const { linkedRoot } = createTarget(testRoot);
  const before = git(linkedRoot, ['status', '--porcelain']);

  const result = runSync(linkedRoot, [
    `--source-repo=${path.join(testRoot, 'missing-upstream.git')}`,
    '--source-branch=main',
  ]);
  const output = combinedOutput(result);
  assert.notEqual(result.status, 0, output);
  assert.match(output, /TEMPLATE_FETCH_STATUS=BLOCKED/u);
  assert.match(output, /TEMPLATE_APPLY_STATUS=NOT_STARTED/u);
  assert.equal(git(linkedRoot, ['status', '--porcelain']), before);
  assert.equal(fs.readFileSync(path.join(linkedRoot, 'AGENTS.md'), 'utf8'), '# local old template\n');
});

test('official anonymous fetch failure never falls back to project credentials or writes the target', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-official-reject-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { linkedRoot } = createTarget(root);
  const program = `
    const assert = require('node:assert/strict');
    const cp = require('node:child_process');
    const spawn = cp.spawnSync;
    let fetches = 0;
    cp.spawnSync = (command, args, options) => {
      if (command === 'git' && args[0] === 'fetch') {
        fetches++;
        assert.ok(!options.env.GH_TOKEN && !options.env.GITHUB_TOKEN, 'anonymous request');
        return { status: 128, stdout: '', stderr: 'test-only upstream denial' };
      }
      return spawn(command, args, options);
    };
    const sync = require(process.argv[1]);
    assert.throws(() => sync.executeTemplateSync([], { cwd: process.cwd() }), error => {
      assert.equal(error.stage, 'fetch');
      assert.equal(error.audit.authMode, 'ANONYMOUS');
      assert.equal(error.audit.fetchStatus, 'BLOCKED');
      assert.equal(error.audit.applyStatus, 'NOT_STARTED');
      return true;
    });
    assert.equal(fetches, 1, 'no credential retry');
    console.log('OFFICIAL_FAILURE_ZERO_WRITE');
  `;
  const result = spawnSync(process.execPath, ['-e', program, SYNC_SCRIPT], {
    cwd: linkedRoot, encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: 'invalid-test-credential' },
  });
  assert.equal(result.status, 0, combinedOutput(result));
  assert.equal(git(linkedRoot, ['status', '--porcelain']), '');
  assert.equal(fs.readFileSync(path.join(linkedRoot, 'AGENTS.md'), 'utf8'), '# local old template\n');
});

test('invalid fetched template shape blocks before any target tracked write', (t) => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-sync-invalid-source-'));
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const { upstream } = createUpstream(testRoot, { invalidShape: true });
  const { linkedRoot } = createTarget(testRoot);

  const result = runSync(linkedRoot, [
    `--source-repo=${upstream}`,
    '--source-branch=main',
  ]);
  const output = combinedOutput(result);
  assert.notEqual(result.status, 0, output);
  assert.match(output, /TEMPLATE_FETCH_STATUS=OK/u);
  assert.match(output, /TEMPLATE_APPLY_STATUS=NOT_STARTED/u);
  assert.match(output, /REASON=.*source/u);
  assert.equal(git(linkedRoot, ['status', '--porcelain']), '');
});

test('a manifest source gap blocks in dry-run before partial template writes', (t) => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-sync-source-gap-'));
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const { upstream } = createUpstream(testRoot, { missingManifestSource: true });
  const { linkedRoot } = createTarget(testRoot);

  const result = runSync(linkedRoot, [
    `--source-repo=${upstream}`,
    '--source-branch=main',
  ]);
  const output = combinedOutput(result);
  assert.notEqual(result.status, 0, output);
  assert.match(output, /TEMPLATE_APPLY_STATUS=BLOCKED/u);
  assert.equal(git(linkedRoot, ['status', '--porcelain']), '');
  assert.equal(fs.readFileSync(path.join(linkedRoot, 'AGENTS.md'), 'utf8'), '# local old template\n');
});

test('package command conflicts block during dry-run before target writes', (t) => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-sync-conflict-'));
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const { upstream } = createUpstream(testRoot);
  const { linkedRoot } = createTarget(testRoot, {
    agentCommand: 'node project-owned-agent.js',
  });
  const beforePackage = fs.readFileSync(path.join(linkedRoot, 'package.json'), 'utf8');

  const result = runSync(linkedRoot, [
    `--source-repo=${upstream}`,
    '--source-branch=main',
  ]);
  const output = combinedOutput(result);
  assert.notEqual(result.status, 0, output);
  assert.match(output, /package\.json script conflicts/u);
  assert.match(output, /TEMPLATE_APPLY_STATUS=BLOCKED/u);
  assert.equal(git(linkedRoot, ['status', '--porcelain']), '');
  assert.equal(fs.readFileSync(path.join(linkedRoot, 'package.json'), 'utf8'), beforePackage);
  assert.equal(fs.readFileSync(path.join(linkedRoot, 'AGENTS.md'), 'utf8'), '# local old template\n');
});

test('sync refuses the main worktree and the template source role', (t) => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-sync-eligibility-'));
  t.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));
  const { upstream } = createUpstream(testRoot);
  const mainTarget = createTarget(testRoot, { name: 'main-target' });
  const sourceTarget = createTarget(testRoot, { name: 'source-target', role: 'source' });
  const args = [`--source-repo=${upstream}`, '--source-branch=main'];

  const mainResult = runSync(mainTarget.mainRoot, args);
  assert.notEqual(mainResult.status, 0, combinedOutput(mainResult));
  assert.match(combinedOutput(mainResult), /linked worktree/u);

  const sourceResult = runSync(sourceTarget.linkedRoot, args);
  assert.notEqual(sourceResult.status, 0, combinedOutput(sourceResult));
  assert.match(combinedOutput(sourceResult), /source role/u);
  assert.equal(git(sourceTarget.linkedRoot, ['status', '--porcelain']), '');
});

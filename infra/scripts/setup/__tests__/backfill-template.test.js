'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const BACKFILL_SCRIPT = path.join(ROOT, 'infra/scripts/setup/backfill-template.js');
const backfill = require(BACKFILL_SCRIPT);
const OFFICIAL_REPOSITORY = 'https://github.com/hollisyao2024/PromptsEngineering.git';
const IDENTITY = Object.freeze({ id: 'xirang', name: '息壤', englishName: 'Xirang' });

function git(cwd, args) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();
}

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function initRepo(root) {
  fs.mkdirSync(root, { recursive: true });
  git(root, ['init']);
  write(root, '.gitattributes', '* text eol=lf\n');
  git(root, ['config', 'user.name', 'Xirang Test']);
  git(root, ['config', 'user.email', 'xirang-test@example.invalid']);
  git(root, ['branch', '-M', 'main']);
}

function commitAll(root, message) {
  git(root, ['add', '--all']);
  git(root, ['commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function createUpstream(testRoot) {
  const upstream = path.join(testRoot, 'upstream');
  initRepo(upstream);
  write(upstream, 'infra/templates/agent/config.example.json', `${JSON.stringify({
    template: { identity: IDENTITY },
  }, null, 2)}\n`);
  write(upstream, 'infra/templates/agent/template.manifest.json', `${JSON.stringify({
    schemaVersion: 1,
    template: { ...IDENTITY, repository: OFFICIAL_REPOSITORY, branch: 'main' },
    capabilities: { officialSync: { schemaVersion: 1, convergenceRequired: true } },
    rules: [
      { path: 'infra/scripts', strategy: 'overwrite' },
      { path: 'AgentRoles', strategy: 'overwrite' },
      { path: 'README.md', strategy: 'overwrite' },
      { path: 'src', strategy: 'project-owned' },
    ],
  }, null, 2)}\n`);
  for (const file of [
    'infra/scripts/setup/update-template.js',
    'infra/scripts/setup/template-apply-engine.js',
    'infra/scripts/shared/config.js',
  ]) write(upstream, file, `// upstream ${file}\n`);
  write(upstream, 'infra/scripts/tool.js', '// upstream tool v1\n');
  write(upstream, 'AgentRoles/TDD.md', '# upstream role\n');
  commitAll(upstream, 'upstream fixture');
  return upstream;
}

function createProject(testRoot, options = {}) {
  const container = path.join(testRoot, 'project');
  const mainRoot = path.join(container, 'repo');
  initRepo(mainRoot);
  write(mainRoot, 'infra/scripts/tool.js', '// upstream tool v1\n');
  write(mainRoot, 'AgentRoles/TDD.md', '# upstream role\n');
  write(mainRoot, 'README.md', '# project readme\n');
  write(mainRoot, 'src/business.js', 'module.exports = 1;\n');
  write(mainRoot, '.gitignore', '.env.local\n');
  if (options.role) {
    write(mainRoot, 'agent.config.json', `${JSON.stringify({ template: { role: options.role } })}\n`);
  }
  const baseline = commitAll(mainRoot, 'project baseline');
  if (!options.noBaseline) git(mainRoot, ['update-ref', 'refs/agent/backfill-baseline', baseline]);
  write(mainRoot, 'infra/scripts/tool.js', '// project improved tool v2\n');
  write(mainRoot, 'infra/scripts/new-tool.js', '// brand new template tool\n');
  write(mainRoot, 'AgentRoles/TDD.md', '# project edited role\n');
  write(mainRoot, 'README.md', '# project readme changed\n');
  write(mainRoot, 'src/business.js', 'module.exports = 2;\n');
  commitAll(mainRoot, 'project template-owned edits');
  return { container, mainRoot };
}

// Stands in for `node agent-cli.js ...` inside the official clone: records calls and
// creates the task worktree the way `worktree new` would.
function fakeSourceCli(calls) {
  return (sourceRoot, argv) => {
    calls.push({ sourceRoot, argv });
    if (argv[0] === 'worktree' && argv[1] === 'new') {
      const task = argv[argv.indexOf('--task') + 1];
      const worktree = path.join(path.dirname(sourceRoot), 'worktrees', `tdd-${task}`);
      git(sourceRoot, ['worktree', 'add', '-b', `feature/${task}`, worktree, 'main']);
      return { status: 0, stdout: `STATUS=CREATED\nBRANCH_NAME=feature/${task}\nNEXT_CWD=${worktree}\nBASE_COMMIT=${git(sourceRoot, ['rev-parse', 'main'])}\n`, stderr: '' };
    }
    return { status: 0, stdout: 'STATUS=STARTED\n', stderr: '' };
  };
}

// The official source keeps its own credential file outside the project.
function officialSourceEnv(project, content = 'GH_TOKEN=test-only-placeholder\n') {
  const file = path.join(path.dirname(project.container), 'official-source', '.env.local');
  write(path.dirname(file), '.env.local', content);
  return file;
}

function execute(project, upstream, argv, extra = {}) {
  const calls = extra.calls || [];
  const env = (extra.options && extra.options.env)
    || { XIRANG_SOURCE_ENV_FILE: officialSourceEnv(project) };
  const result = backfill.executeBackfill(argv, {
    cwd: project.mainRoot,
    upstreamRepository: upstream,
    runSourceCli: fakeSourceCli(calls),
    taskId: 'backfill-test',
    ...extra.options,
    env,
  });
  return { result, calls };
}

function tmpRoot(t, name) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `xirang-${name}-`)));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('official upstream is fixed to the Xirang GitHub main branch', () => {
  assert.equal(backfill.OFFICIAL_UPSTREAM.repository, OFFICIAL_REPOSITORY);
  assert.equal(backfill.OFFICIAL_UPSTREAM.branch, 'main');
});

test('parseArgs rejects source arguments and the removed self-backfill flag', () => {
  for (const argv of [
    ['../template'],
    ['--target', '../template'],
    ['--target=../template'],
    ['--template', '../template'],
    ['--source', '../template'],
    ['--source-repo=../template'],
    ['--allow-self'],
  ]) {
    assert.throws(() => backfill.parseArgs(argv), /official|unknown option|positional/iu, argv.join(' '));
  }
  const parsed = backfill.parseArgs(['--dry-run', '--base', 'abc', '--include', 'infra/scripts,AgentRoles']);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.base, 'abc');
  assert.deepEqual(parsed.include, ['infra/scripts', 'AgentRoles']);
});

test('dry run plans template-owned files from the official upstream without creating tasks or worktrees', t => {
  const testRoot = tmpRoot(t, 'backfill-dry');
  const upstream = createUpstream(testRoot);
  const project = createProject(testRoot);
  const { result, calls } = execute(project, upstream, ['--dry-run']);
  assert.equal(result.dryRun, true);
  assert.equal(calls.length, 0, 'dry run must not start a source task or worktree');
  const byFile = Object.fromEntries(result.items.map((item) => [item.file, item.status]));
  assert.deepEqual(byFile, {
    'AgentRoles/TDD.md': 'updated',
    'infra/scripts/new-tool.js': 'created',
    'infra/scripts/tool.js': 'updated',
  });
  const skipped = Object.fromEntries(result.skipped.map((item) => [item.file, item.reason]));
  assert.match(skipped['README.md'], /blocked/u);
  assert.match(skipped['src/business.js'], /allowlist/u);
  assert.equal(result.worktree, null);
  assert.equal(result.audit.repository, upstream);
  assert.equal(result.audit.branch, 'main');
  assert.match(result.audit.commit, /^[0-9a-f]{40}$/u);
  // Official clone lives in the project's rebuildable cache container.
  const expectedClone = path.join(project.container, 'cache', 'xirang', 'backfill-source', 'repo');
  assert.equal(result.sourceRoot, expectedClone);
  assert.equal(git(expectedClone, ['rev-parse', 'HEAD']), result.audit.commit);
  assert.equal(fs.readFileSync(path.join(expectedClone, 'infra/scripts/tool.js'), 'utf8'), '// upstream tool v1\n');
});

test('apply creates a task and worktree inside the official clone and copies only template-owned files', t => {
  const testRoot = tmpRoot(t, 'backfill-apply');
  const upstream = createUpstream(testRoot);
  const project = createProject(testRoot);
  const { result, calls } = execute(project, upstream, []);
  assert.equal(result.dryRun, false);
  assert.deepEqual(calls.map((call) => call.argv.slice(0, 2)), [['task', 'start'], ['worktree', 'new']]);
  assert.ok(calls.every((call) => call.sourceRoot === result.sourceRoot));
  const taskStart = calls[0].argv;
  assert.equal(taskStart[taskStart.indexOf('--task') + 1], 'backfill-test');
  assert.ok(taskStart.includes('--acceptance'));
  assert.ok(taskStart.includes('mutation'));
  const worktree = result.worktree.path;
  assert.equal(result.worktree.branch, 'feature/backfill-test');
  assert.equal(fs.readFileSync(path.join(worktree, 'infra/scripts/tool.js'), 'utf8'), '// project improved tool v2\n');
  assert.equal(fs.readFileSync(path.join(worktree, 'infra/scripts/new-tool.js'), 'utf8'), '// brand new template tool\n');
  assert.equal(fs.readFileSync(path.join(worktree, 'AgentRoles/TDD.md'), 'utf8'), '# project edited role\n');
  assert.equal(fs.existsSync(path.join(worktree, 'src/business.js')), false);
  assert.equal(fs.existsSync(path.join(worktree, 'README.md')), false, 'blocked project-owned README must not be backfilled');
  // The official clone main branch stays pristine; no fixed ops/backfill-template branch exists anywhere.
  assert.equal(git(result.sourceRoot, ['status', '--porcelain']), '');
  assert.equal(git(result.sourceRoot, ['branch', '--list', 'ops/backfill-template']), '');
  assert.equal(fs.existsSync(path.join(project.container, 'worktrees', 'ops-backfill-template')), false);
});

test('legacy sourceRepo config and AGENT_TEMPLATE_SOURCE_REPO never redirect the destination', t => {
  const testRoot = tmpRoot(t, 'backfill-legacy-source');
  const upstream = createUpstream(testRoot);
  const decoy = path.join(testRoot, 'decoy-template');
  initRepo(decoy);
  write(decoy, 'README.md', 'decoy\n');
  commitAll(decoy, 'decoy');
  const project = createProject(testRoot);
  write(project.mainRoot, 'agent.config.json', `${JSON.stringify({ template: { sourceRepo: decoy } })}\n`);
  const previous = process.env.AGENT_TEMPLATE_SOURCE_REPO;
  process.env.AGENT_TEMPLATE_SOURCE_REPO = decoy;
  t.after(() => {
    if (previous === undefined) delete process.env.AGENT_TEMPLATE_SOURCE_REPO;
    else process.env.AGENT_TEMPLATE_SOURCE_REPO = previous;
  });
  const { result } = execute(project, upstream, []);
  assert.ok(result.worktree.path.startsWith(path.join(project.container, 'cache', 'xirang')));
  assert.equal(git(decoy, ['status', '--porcelain']), '');
  assert.equal(git(decoy, ['worktree', 'list']).split('\n').length, 1);
});

test('the template source role cannot backfill into itself', t => {
  const testRoot = tmpRoot(t, 'backfill-source-role');
  const upstream = createUpstream(testRoot);
  const project = createProject(testRoot, { role: 'source' });
  assert.throws(() => execute(project, upstream, ['--dry-run']), /template source/iu);
});

test('missing backfill baseline blocks before contacting upstream', t => {
  const testRoot = tmpRoot(t, 'backfill-no-baseline');
  const project = createProject(testRoot, { noBaseline: true });
  const missingUpstream = path.join(testRoot, 'does-not-exist');
  assert.throws(() => execute(project, missingUpstream, ['--dry-run']), /baseline/iu);
  assert.equal(fs.existsSync(path.join(project.container, 'cache')), false);
});

test('an unreachable upstream is a required-fetch failure with no local fallback', t => {
  const testRoot = tmpRoot(t, 'backfill-fetch-fail');
  const project = createProject(testRoot);
  assert.throws(
    () => execute(project, path.join(testRoot, 'does-not-exist'), ['--dry-run']),
    /fetch/iu,
  );
});

test('a reused official clone fast-forwards to the latest upstream main', t => {
  const testRoot = tmpRoot(t, 'backfill-reuse');
  const upstream = createUpstream(testRoot);
  const project = createProject(testRoot);
  const first = execute(project, upstream, ['--dry-run']).result;
  write(upstream, 'infra/scripts/tool.js', '// upstream tool v1\n// upstream moved\n');
  const latest = commitAll(upstream, 'upstream moves');
  const second = execute(project, upstream, ['--dry-run']).result;
  assert.equal(second.sourceRoot, first.sourceRoot);
  assert.equal(second.audit.commit, latest);
});

test('a dirty or diverged official clone blocks instead of being overwritten', t => {
  const testRoot = tmpRoot(t, 'backfill-dirty-clone');
  const upstream = createUpstream(testRoot);
  const project = createProject(testRoot);
  const first = execute(project, upstream, ['--dry-run']).result;
  write(first.sourceRoot, 'infra/scripts/tool.js', '// local drift\n');
  assert.throws(() => execute(project, upstream, ['--dry-run']), /clean|drift|diverged/iu);
});

function withEnv(t, key, value) {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

function readExclude(sourceRoot) {
  return fs.readFileSync(path.join(sourceRoot, '.git', 'info', 'exclude'), 'utf8');
}

test('a fresh official clone works when git init has no template info directory', t => {
  const testRoot = tmpRoot(t, 'backfill-no-template');
  const upstream = createUpstream(testRoot);
  const project = createProject(testRoot);
  // The anonymous official environment sets init.templateDir='', so git init creates no .git/info.
  const emptyTemplate = path.join(testRoot, 'empty-git-template');
  fs.mkdirSync(emptyTemplate);
  withEnv(t, 'GIT_TEMPLATE_DIR', emptyTemplate);
  const { result } = execute(project, upstream, ['--dry-run']);
  assert.match(readExclude(result.sourceRoot), /^\.env\.local$/mu);
});

test('a reused official clone restores a missing env exclusion exactly once', t => {
  const testRoot = tmpRoot(t, 'backfill-exclude-repair');
  const upstream = createUpstream(testRoot);
  const project = createProject(testRoot);
  const first = execute(project, upstream, ['--dry-run']).result;
  fs.rmSync(path.join(first.sourceRoot, '.git', 'info'), { recursive: true, force: true });
  execute(project, upstream, ['--dry-run']);
  execute(project, upstream, ['--dry-run']);
  assert.equal(readExclude(first.sourceRoot).match(/^\.env\.local$/gmu).length, 1);
});

test('the official clone links only the configured official-source credential file', t => {
  const testRoot = tmpRoot(t, 'backfill-auth-link');
  const upstream = createUpstream(testRoot);
  const project = createProject(testRoot);
  write(project.mainRoot, '.env.local', 'GH_TOKEN=project-only-placeholder\n');
  const { result } = execute(project, upstream, []);
  const linked = path.join(result.sourceRoot, '.env.local');
  assert.equal(fs.lstatSync(linked).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(linked), fs.realpathSync(officialSourceEnv(project)));
  assert.notEqual(fs.realpathSync(linked), fs.realpathSync(path.join(project.mainRoot, '.env.local')));
  assert.equal(result.authStatus, 'LINKED');
  assert.equal(result.sourceAuth.source, 'env');
});

test('source credential precedence is --source-env, then XIRANG_SOURCE_ENV_FILE, then the project .env.local key', t => {
  const testRoot = tmpRoot(t, 'backfill-auth-precedence');
  const project = createProject(testRoot);
  const fromFlag = path.join(testRoot, 'flag', '.env.local');
  const fromEnv = path.join(testRoot, 'env', '.env.local');
  const fromProject = path.join(testRoot, 'project-key', '.env.local');
  for (const file of [fromFlag, fromEnv, fromProject]) write(path.dirname(file), '.env.local', 'GH_TOKEN=test-only-placeholder\n');
  write(project.mainRoot, '.env.local', `GH_TOKEN=project-only-placeholder\nXIRANG_SOURCE_ENV_FILE=${fromProject}\n`);
  const resolve = (args, env) => backfill.resolveSourceCredentials({
    args, env, cwd: project.mainRoot, projectMainRoot: project.mainRoot,
  });
  assert.deepEqual(
    [resolve({ sourceEnv: fromFlag }, { XIRANG_SOURCE_ENV_FILE: fromEnv }).file, resolve({}, { XIRANG_SOURCE_ENV_FILE: fromEnv }).file, resolve({}, {}).file],
    [fromFlag, fromEnv, fromProject],
  );
  assert.equal(resolve({}, {}).status, 'CONFIGURED');
  assert.equal(resolve({}, {}).source, 'project-env-local');
  assert.equal(backfill.parseArgs(['--source-env', fromFlag]).sourceEnv, fromFlag);
});

test('without a configured source credential file a real backfill blocks before any source task or worktree', t => {
  const testRoot = tmpRoot(t, 'backfill-auth-missing');
  const upstream = createUpstream(testRoot);
  const project = createProject(testRoot);
  // Neither the project token nor a process GH_TOKEN may stand in for the official source's credentials.
  write(project.mainRoot, '.env.local', 'GH_TOKEN=project-only-placeholder\n');
  const calls = [];
  assert.throws(
    () => execute(project, upstream, [], { calls, options: { env: { GH_TOKEN: 'process-only-placeholder' } } }),
    (error) => /source credential|XIRANG_SOURCE_ENV_FILE/iu.test(error.message)
      && /XIRANG_SOURCE_ENV_FILE/u.test(error.nextAction)
      && !/placeholder/u.test(`${error.message} ${error.nextAction}`),
  );
  assert.equal(calls.length, 0);
  const sourceRoot = path.join(project.container, 'cache', 'xirang', 'backfill-source', 'repo');
  assert.equal(fs.existsSync(path.join(sourceRoot, '.env.local')), false);
});

test('dry run only reports an unconfigured source credential', t => {
  const testRoot = tmpRoot(t, 'backfill-auth-dry');
  const upstream = createUpstream(testRoot);
  const project = createProject(testRoot);
  const { result, calls } = execute(project, upstream, ['--dry-run'], { options: { env: {} } });
  assert.equal(calls.length, 0);
  assert.equal(result.sourceAuth.status, 'NOT_CONFIGURED');
});

test('a configured source credential file that is missing, lacks GH_TOKEN or is the project file blocks', t => {
  const testRoot = tmpRoot(t, 'backfill-auth-invalid');
  const upstream = createUpstream(testRoot);
  const project = createProject(testRoot);
  write(project.mainRoot, '.env.local', 'GH_TOKEN=project-only-placeholder\n');
  const noToken = path.join(testRoot, 'no-token', '.env.local');
  write(path.dirname(noToken), '.env.local', 'OTHER=1\n');
  for (const file of [path.join(testRoot, 'absent', '.env.local'), noToken, path.join(project.mainRoot, '.env.local')]) {
    const calls = [];
    assert.throws(
      () => execute(project, upstream, [], { calls, options: { env: { XIRANG_SOURCE_ENV_FILE: file } } }),
      /source credential/iu,
      file,
    );
    assert.equal(calls.length, 0, file);
  }
});

test('a stale clone credential symlink is repointed to the configured official-source file', t => {
  const testRoot = tmpRoot(t, 'backfill-auth-relink');
  const upstream = createUpstream(testRoot);
  const project = createProject(testRoot);
  write(project.mainRoot, '.env.local', 'GH_TOKEN=project-only-placeholder\n');
  const sourceRoot = execute(project, upstream, ['--dry-run']).result.sourceRoot;
  fs.symlinkSync(path.join(project.mainRoot, '.env.local'), path.join(sourceRoot, '.env.local'));
  const { result } = execute(project, upstream, []);
  assert.equal(result.authStatus, 'RELINKED');
  assert.equal(fs.realpathSync(path.join(sourceRoot, '.env.local')), fs.realpathSync(officialSourceEnv(project)));
});

test('a regular credential file inside the clone blocks instead of being trusted or overwritten', t => {
  const testRoot = tmpRoot(t, 'backfill-auth-regular');
  const upstream = createUpstream(testRoot);
  const project = createProject(testRoot);
  const sourceRoot = execute(project, upstream, ['--dry-run']).result.sourceRoot;
  write(sourceRoot, '.env.local', 'GH_TOKEN=unknown-placeholder\n');
  const calls = [];
  assert.throws(() => execute(project, upstream, [], { calls }), /\.env\.local/u);
  assert.equal(calls.length, 0);
  assert.equal(fs.readFileSync(path.join(sourceRoot, '.env.local'), 'utf8'), 'GH_TOKEN=unknown-placeholder\n');
});

test('the official source CLI environment drops project GH_TOKEN and AGENT_* overrides', () => {
  const env = backfill.sourceCliEnvironment({
    PATH: '/bin', GH_TOKEN: 'x', GITHUB_TOKEN: 'y', AGENT_TMP_DIR: '/tmp', XIRANG_SOURCE_ENV_FILE: '/a',
  });
  assert.deepEqual(env, { PATH: '/bin' });
});

test('CLI blocks with parseable output and never reaches the network without a baseline', t => {
  const testRoot = tmpRoot(t, 'backfill-cli');
  const project = createProject(testRoot, { noBaseline: true });
  const result = spawnSync(process.execPath, [BACKFILL_SCRIPT, '--dry-run'], {
    cwd: project.mainRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^STATUS=BLOCKED$/mu);
  assert.match(result.stderr, /^REASON=.*baseline/mu);
  assert.match(result.stderr, /^NEXT_ACTION=/mu);
});

test('CLI rejects a positional template source', t => {
  const testRoot = tmpRoot(t, 'backfill-cli-positional');
  const project = createProject(testRoot);
  const result = spawnSync(process.execPath, [BACKFILL_SCRIPT, '../template'], {
    cwd: project.mainRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^REASON=.*official/mu);
});

test('help documents the official-only command shape', () => {
  const result = spawnSync(process.execPath, [BACKFILL_SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /template backfill/u);
  assert.match(result.stdout, /官方|official/iu);
  assert.doesNotMatch(result.stdout, /<source>/u);
  assert.match(result.stdout, /--source-env/u);
  assert.match(result.stdout, /XIRANG_SOURCE_ENV_FILE/u);
});

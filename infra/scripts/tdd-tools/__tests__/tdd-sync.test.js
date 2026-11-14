'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { resolveProjectChecks, runMigrationRegistryCheck, runProjectChecks } = require('../tdd-sync');

test('/tdd sync --help exits before Schema-Doc Sync Gate', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const script = path.join(repoRoot, 'infra/scripts/tdd-tools/tdd-sync.js');

  const result = spawnSync(process.execPath, [script, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node infra\/scripts\/tdd-tools\/tdd-sync\.js/);
  assert.doesNotMatch(result.stderr, /Schema-Doc Sync Gate/);
});

test('/tdd sync runs configured tdd.projectChecks before document synchronization', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const script = fs.readFileSync(path.join(repoRoot, 'infra/scripts/tdd-tools/tdd-sync.js'), 'utf8');
  const defaults = JSON.parse(fs.readFileSync(path.join(repoRoot, 'infra/templates/agent/config.example.json'), 'utf8'));

  assert.deepEqual(defaults.tdd.projectChecks, []);
  assert.match(script, /tdd\.projectChecks/);
  assert.match(script, /Project Check Gate/);
});

test('/tdd sync blocks when a required project check fails', () => {
  const config = { tdd: { projectChecks: [{ name: 'check:db-migrations', required: true }] } };
  assert.deepEqual(resolveProjectChecks(config), [{ name: 'check:db-migrations', required: true }]);
  assert.equal(runProjectChecks(config, {
    cwd: process.cwd(),
    pnpmBin: 'pnpm',
    spawn: () => ({ status: 1 }),
  }), false);
});

test('/tdd sync rejects unsafe project check names', () => {
  assert.throws(
    () => resolveProjectChecks({ tdd: { projectChecks: [{ name: 'check && unsafe', required: true }] } }),
    /invalid tdd\.projectChecks entry/,
  );
});

test('/tdd sync skips the migration registry gate unless a registry file is configured', () => {
  let called = false;
  assert.equal(runMigrationRegistryCheck({
    paths: { migrationsDir: 'database/migrations' },
    tdd: { migrationRegistry: { registryFile: '' } },
  }, {
    spawn: () => {
      called = true;
      return { status: 0 };
    },
  }), true);
  assert.equal(called, false);
});

test('/tdd sync blocks when the configured migration registry gate fails', () => {
  assert.equal(runMigrationRegistryCheck({
    paths: { migrationsDir: 'database/migrations' },
    tdd: { migrationRegistry: { registryFile: 'database/migrations/index.ts' } },
  }, {
    spawn: () => ({ status: 1 }),
  }), false);
});

// /tdd sync merges origin/<base> into the feature branch before the document gates so that qa verify never sees a
// STALE_QA_BASE that the executor could have resolved locally. Conflicts stop the sync with a stable reason code.
const { syncWithBase } = require('../tdd-sync');

function fakeGit(responses) {
  const calls = [];
  const runGit = (args) => {
    calls.push(args);
    const match = responses.find(([prefix]) => prefix.every((part, index) => args[index] === part));
    return match ? { status: 0, stdout: '', stderr: '', ...match[1] } : { status: 0, stdout: '', stderr: '' };
  };
  return { calls, runGit };
}

test('syncWithBase fetches origin/<base> and reports up-to-date when it is already an ancestor of HEAD', () => {
  const { calls, runGit } = fakeGit([
    [['rev-parse', '--abbrev-ref', 'HEAD'], { stdout: 'feature/x\n' }],
    [['rev-parse', '--verify'], { stdout: `${'a'.repeat(40)}\n` }],
  ]);
  const result = syncWithBase({ repoRoot: '/repo', baseBranch: 'main', runGit });
  assert.deepEqual(result, { status: 'OK', baseRef: 'origin/main', baseSha: 'a'.repeat(40), merged: false });
  assert.deepEqual(calls[0], ['remote', 'get-url', 'origin']);
  assert.ok(calls.some((args) => args[0] === 'fetch' && args.includes('origin') && args.includes('main')));
  assert.ok(calls.some((args) => args[0] === 'merge-base' && args[1] === '--is-ancestor'));
  assert.ok(!calls.some((args) => args[0] === 'merge'));
});

test('syncWithBase merges a newer base with --no-edit and skips on the base branch or without origin', () => {
  const merged = fakeGit([
    [['rev-parse', '--abbrev-ref', 'HEAD'], { stdout: 'feature/x\n' }],
    [['rev-parse', '--verify'], { stdout: `${'b'.repeat(40)}\n` }],
    [['merge-base', '--is-ancestor'], { status: 1 }],
  ]);
  assert.deepEqual(syncWithBase({ repoRoot: '/repo', baseBranch: 'main', runGit: merged.runGit }), {
    status: 'OK', baseRef: 'origin/main', baseSha: 'b'.repeat(40), merged: true,
  });
  assert.ok(merged.calls.some((args) => args.join(' ') === 'merge --no-edit origin/main'));

  const onBase = fakeGit([[['rev-parse', '--abbrev-ref', 'HEAD'], { stdout: 'main\n' }]]);
  assert.equal(syncWithBase({ repoRoot: '/repo', baseBranch: 'main', runGit: onBase.runGit }).status, 'SKIPPED');
  assert.ok(!onBase.calls.some((args) => args[0] === 'fetch' || args[0] === 'merge'));

  const noRemote = fakeGit([[['remote', 'get-url', 'origin'], { status: 2, stderr: 'error: No such remote' }]]);
  assert.equal(syncWithBase({ repoRoot: '/repo', baseBranch: 'main', runGit: noRemote.runGit }).status, 'SKIPPED');
  assert.ok(!noRemote.calls.some((args) => args[0] === 'fetch'));
});

test('syncWithBase surfaces fetch failures and merge conflicts as coded errors and aborts the merge', () => {
  const fetchFailed = fakeGit([
    [['rev-parse', '--abbrev-ref', 'HEAD'], { stdout: 'feature/x\n' }],
    [['fetch'], { status: 128, stderr: 'fatal: unable to access' }],
  ]);
  assert.throws(() => syncWithBase({ repoRoot: '/repo', baseBranch: 'main', runGit: fetchFailed.runGit }), (error) => {
    assert.equal(error.code, 'BASE_FETCH_FAILED');
    assert.match(error.message, /unable to access/);
    return true;
  });

  const conflict = fakeGit([
    [['rev-parse', '--abbrev-ref', 'HEAD'], { stdout: 'feature/x\n' }],
    [['rev-parse', '--verify'], { stdout: `${'c'.repeat(40)}\n` }],
    [['merge-base', '--is-ancestor'], { status: 1 }],
    [['merge', '--no-edit'], { status: 1, stdout: 'CONFLICT (content): Merge conflict in a.js' }],
  ]);
  assert.throws(() => syncWithBase({ repoRoot: '/repo', baseBranch: 'main', runGit: conflict.runGit }), (error) => {
    assert.equal(error.code, 'BASE_MERGE_CONFLICT');
    assert.match(error.message, /Merge conflict in a\.js/);
    assert.match(error.nextAction, /merge --no-edit origin\/main/);
    return true;
  });
  assert.ok(conflict.calls.some((args) => args.join(' ') === 'merge --abort'));
});

test('syncWithBase merges a real newer base and leaves no MERGE_HEAD after a conflict', (t) => {
  const os = require('node:os');
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'xirang-base-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (cwd, args) => {
    const result = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  const origin = path.join(root, 'origin.git');
  fs.mkdirSync(origin);
  git(origin, ['init', '--quiet', '--bare', '--initial-branch=main']);
  const seed = path.join(root, 'seed');
  git(root, ['clone', '--quiet', origin, seed]);
  fs.writeFileSync(path.join(seed, 'a.txt'), 'base\n');
  git(seed, ['add', '-A']);
  git(seed, ['commit', '--quiet', '-m', 'seed']);
  git(seed, ['push', '--quiet', 'origin', 'HEAD:main']);

  const work = path.join(root, 'work');
  git(root, ['clone', '--quiet', origin, work]);
  git(work, ['config', 'user.name', 'Fixture']);
  git(work, ['config', 'user.email', 'fixture@example.invalid']);
  git(work, ['config', 'commit.gpgsign', 'false']);
  git(work, ['checkout', '--quiet', '-b', 'feature/x']);
  fs.writeFileSync(path.join(work, 'b.txt'), 'feature\n');
  git(work, ['add', '-A']);
  git(work, ['commit', '--quiet', '-m', 'feature']);

  fs.writeFileSync(path.join(seed, 'c.txt'), 'newer base\n');
  git(seed, ['add', '-A']);
  git(seed, ['commit', '--quiet', '-m', 'advance base']);
  git(seed, ['push', '--quiet', 'origin', 'HEAD:main']);
  const baseSha = git(seed, ['rev-parse', 'HEAD']);

  const merged = syncWithBase({ repoRoot: work, baseBranch: 'main' });
  assert.deepEqual(merged, { status: 'OK', baseRef: 'origin/main', baseSha, merged: true });
  assert.ok(fs.existsSync(path.join(work, 'c.txt')));
  assert.equal(syncWithBase({ repoRoot: work, baseBranch: 'main' }).merged, false);

  fs.writeFileSync(path.join(seed, 'a.txt'), 'base again\n');
  git(seed, ['commit', '--quiet', '-am', 'base edit']);
  git(seed, ['push', '--quiet', 'origin', 'HEAD:main']);
  fs.writeFileSync(path.join(work, 'a.txt'), 'feature edit\n');
  git(work, ['commit', '--quiet', '-am', 'feature edit']);
  assert.throws(() => syncWithBase({ repoRoot: work, baseBranch: 'main' }), (error) => error.code === 'BASE_MERGE_CONFLICT');
  assert.equal(spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: work, encoding: 'utf8' }).status, 1);
  assert.equal(git(work, ['status', '--porcelain']), '');
});

// Base Sync 合并主干后，lockfile 等依赖输入可能变化；Deps Sync Gate 依据 bootstrap 输入戳刷新依赖或明确阻断，
// 避免后续 typecheck/项目门禁在过期 node_modules 上失败。
const { syncDependencies } = require('../tdd-sync');

test('syncDependencies refreshes dependencies after a base merge changes the lockfile and blocks in check mode', (t) => {
  const os = require('node:os');
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'xirang-deps-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (cwd, args) => {
    const result = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  const origin = path.join(root, 'origin.git');
  fs.mkdirSync(origin);
  git(origin, ['init', '--quiet', '--bare', '--initial-branch=main']);
  const seed = path.join(root, 'seed');
  git(root, ['clone', '--quiet', origin, seed]);
  fs.writeFileSync(path.join(seed, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(seed, 'deps.lock'), 'v1\n');
  git(seed, ['add', '-A']);
  git(seed, ['commit', '--quiet', '-m', 'seed']);
  git(seed, ['push', '--quiet', 'origin', 'HEAD:main']);

  const work = path.join(root, 'work');
  git(root, ['clone', '--quiet', origin, work]);
  git(work, ['config', 'user.name', 'Fixture']);
  git(work, ['config', 'user.email', 'fixture@example.invalid']);
  git(work, ['config', 'commit.gpgsign', 'false']);
  git(work, ['checkout', '--quiet', '-b', 'feature/x']);
  fs.mkdirSync(path.join(work, 'node_modules'));
  fs.writeFileSync(path.join(work, 'node_modules', 'ready'), 'ready\n');
  const countPath = path.join(work, 'node_modules', 'install-count');
  const count = () => (fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, 'utf8')) : 0);
  const command = 'node -e "const fs=require(\'fs\');const p=\'node_modules/install-count\';const n=fs.existsSync(p)?Number(fs.readFileSync(p,\'utf8\')):0;fs.writeFileSync(p,String(n+1))"';
  const config = (mode) => ({
    projectName: 'deps-sync-test',
    containerDirs: { tmp: path.join(root, 'tmp') },
    worktree: {
      lockDir: path.join(root, 'tmp', 'locks'),
      bootstrap: {
        mode,
        inputs: ['deps.lock'],
        command,
        checkCommand: 'node -e "process.exit(require(\'fs\').existsSync(\'node_modules/ready\')?0:1)"',
      },
    },
  });

  assert.equal(syncDependencies({ repoRoot: work, config: config('auto') }).status, 'REFRESHED');
  assert.equal(syncDependencies({ repoRoot: work, config: config('auto') }).status, 'READY');
  assert.equal(count(), 1);

  // 主干升级 lockfile；功能分支带着未提交工作执行 Base Sync。
  fs.writeFileSync(path.join(seed, 'deps.lock'), 'v2\n');
  git(seed, ['commit', '--quiet', '-am', 'bump lockfile']);
  git(seed, ['push', '--quiet', 'origin', 'HEAD:main']);
  fs.writeFileSync(path.join(work, 'wip.txt'), 'uncommitted\n');
  assert.equal(syncWithBase({ repoRoot: work, baseBranch: 'main' }).merged, true);
  const refreshed = syncDependencies({ repoRoot: work, config: config('auto') });
  assert.equal(refreshed.status, 'REFRESHED');
  assert.match(refreshed.reason, /dependency inputs changed/);
  assert.equal(count(), 2);
  assert.equal(fs.readFileSync(path.join(work, 'wip.txt'), 'utf8'), 'uncommitted\n');

  fs.writeFileSync(path.join(seed, 'deps.lock'), 'v3\n');
  git(seed, ['commit', '--quiet', '-am', 'bump lockfile again']);
  git(seed, ['push', '--quiet', 'origin', 'HEAD:main']);
  assert.equal(syncWithBase({ repoRoot: work, baseBranch: 'main' }).merged, true);
  assert.throws(() => syncDependencies({ repoRoot: work, config: config('check') }), (error) => {
    assert.equal(error.code, 'DEPS_STALE');
    assert.match(error.message, /dependency inputs changed/);
    assert.ok(error.nextAction.includes(command));
    return true;
  });
  assert.equal(count(), 2);

  assert.equal(syncDependencies({ repoRoot: work, config: config('skip') }).status, 'SKIPPED');
});

test('syncDependencies maps bootstrap failures to a coded blocker', () => {
  const failure = Object.assign(new Error('worktree bootstrap command failed (exit 1)'), {
    bootstrapStatus: 'FAILED',
    nextManualAction: 'cd "/repo" && pnpm install --frozen-lockfile',
  });
  assert.throws(() => syncDependencies({
    repoRoot: '/repo',
    config: {},
    bootstrap: () => { throw failure; },
  }), (error) => {
    assert.equal(error.code, 'DEPS_SYNC_FAILED');
    assert.match(error.message, /exit 1/);
    assert.match(error.nextAction, /pnpm install --frozen-lockfile/);
    return true;
  });
});

test('/tdd sync runs the deps sync right after the base sync and before the project gates', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const script = fs.readFileSync(path.join(repoRoot, 'infra/scripts/tdd-tools/tdd-sync.js'), 'utf8');
  const main = script.slice(script.indexOf('function main()'));
  const depsAt = main.indexOf('syncDependencies({');
  assert.ok(depsAt > main.indexOf('syncWithBase({'), 'deps sync follows base sync');
  assert.ok(depsAt < main.indexOf('runArchitectureCheck'));
  assert.ok(depsAt < main.indexOf('runProjectChecks(config, projectCheckOptions)'));
  assert.match(script, /DEPS_SYNC=/);
});

test('/tdd sync runs the base sync before the document gates and blocks on its coded errors', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const script = fs.readFileSync(path.join(repoRoot, 'infra/scripts/tdd-tools/tdd-sync.js'), 'utf8');
  const syncAt = script.indexOf('syncWithBase({');
  assert.ok(syncAt > 0, 'main() calls syncWithBase');
  assert.ok(syncAt < script.indexOf('runMigrationRegistryCheck(config)'));
  assert.match(script, /BASE_SYNC=/);
});

test('/tdd sync skips the doc size gate unless tdd.docSize.enabled is true', () => {
  const { runDocSizeCheck } = require('../tdd-sync');
  let called = false;
  assert.equal(runDocSizeCheck({ tdd: { docSize: { enabled: false } } }, {
    spawn: () => {
      called = true;
      return { status: 0 };
    },
  }), true);
  assert.equal(called, false);
});

test('/tdd sync blocks when the enabled doc size gate fails', () => {
  const { runDocSizeCheck } = require('../tdd-sync');
  let args;
  assert.equal(runDocSizeCheck({ tdd: { docSize: { enabled: true } } }, {
    spawn: (_bin, spawnArgs) => {
      args = spawnArgs;
      return { status: 1 };
    },
  }), false);
  assert.match(args[0], /check-doc-size\.js$/);
});

test('/tdd sync launches a bare pnpm.cmd through its absolute path so the npm shim finds pnpm.mjs', { skip: process.platform !== 'win32' }, (t) => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'xirang-tdd-pnpm-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bin = path.join(tmp, 'npm');
  const cwd = path.join(tmp, 'worktree');
  fs.mkdirSync(path.join(bin, 'node_modules', 'pnpm', 'bin'), { recursive: true });
  fs.mkdirSync(cwd);
  // 与 npm 全局 shim 同形：经 %~dp0 定位 node_modules\pnpm\bin\pnpm.mjs
  fs.writeFileSync(path.join(bin, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
    'process.exit(process.argv.slice(2).join(" ") === "run check:x" ? 0 : 4);\n');
  fs.writeFileSync(path.join(bin, 'pnpm.cmd'), '@node "%~dp0node_modules\\pnpm\\bin\\pnpm.mjs" %*\r\n');
  const env = { ...process.env, Path: [bin, process.env.Path || process.env.PATH].join(path.delimiter) };
  delete env.PATH;
  delete env.AGENT_PNPM_BIN;

  assert.equal(runProjectChecks({ tdd: { projectChecks: [{ name: 'check:x', required: true }] } }, {
    cwd,
    env,
    pnpmBin: 'pnpm.cmd',
  }), true);
});

// Project Check Gate 范围、计时与失败即停：实际项目把上百个测试脚本登记为 projectChecks 后，每次 /tdd sync 串行全跑数十分钟。
// 按 diff 只跑相关检查（未声明 paths 的检查始终运行）、输出逐项耗时与汇总，required 失败默认立即停止。
const {
  collectChangedFiles,
  parseProjectCheckFlags,
  resolveProjectChecksRunAll,
} = require('../tdd-sync');

function projectCheckHarness({ failing = [], durations = {} } = {}) {
  const ran = [];
  const lines = [];
  let now = 0;
  let pending = 0;
  return {
    ran,
    lines,
    output: () => lines.join('\n'),
    options: (extra = {}) => ({
      cwd: process.cwd(),
      pnpmBin: 'pnpm',
      logger: { log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) },
      // 可控时钟：每次 spawn 推进对应检查的耗时，便于断言计时与最慢项排序。
      clock: () => {
        now += pending;
        pending = 0;
        return now;
      },
      spawn: (_bin, args) => {
        const name = args[args.indexOf('run') + 1];
        ran.push(name);
        pending = durations[name] || 0;
        return { status: failing.includes(name) ? 1 : 0 };
      },
      ...extra,
    }),
  };
}

const scopedConfig = {
  tdd: {
    projectChecks: [
      { name: 'check:always', required: true },
      { name: 'test:web', required: true, paths: ['apps/web/**'] },
      { name: 'test:db', required: true, paths: ['database/**', 'packages/db/**'] },
    ],
    projectChecksRunAll: ['pnpm-lock.yaml', 'packages/shared/**'],
  },
};

test('/tdd sync runs unscoped checks always and path-scoped checks only when a changed file matches', () => {
  const harness = projectCheckHarness();
  assert.equal(runProjectChecks(scopedConfig, harness.options({ changedFiles: ['apps/web/src/page.tsx', 'README.md'] })), true);
  assert.deepEqual(harness.ran, ['check:always', 'test:web']);
  const output = harness.output();
  assert.match(output, /PROJECT_CHECKS_SELECTION=SCOPED\s+CHANGED_FILES=2/);
  assert.match(output, /PROJECT_CHECK=check:always\|PASS\|\d+ms\|required\|/);
  assert.match(output, /PROJECT_CHECK=test:db\|SKIPPED\|0ms\|required\|paths not matched/);
  // SKIPPED 不计为通过：汇总分别统计。
  assert.match(output, /PROJECT_CHECKS_SUMMARY=total=3 ran=2 passed=2 failed=0 skipped=1 not_run=0 duration=\d+ms/);
});

test('/tdd sync runs every project check when a run-all glob matches, --all-checks is set, or the diff is unavailable', () => {
  const runAll = projectCheckHarness();
  assert.equal(runProjectChecks(scopedConfig, runAll.options({ changedFiles: ['pnpm-lock.yaml'] })), true);
  assert.deepEqual(runAll.ran, ['check:always', 'test:web', 'test:db']);
  assert.match(runAll.output(), /PROJECT_CHECKS_SELECTION=RUN_ALL_MATCH\s+CHANGED_FILES=1\s+REASON=pnpm-lock\.yaml matches pnpm-lock\.yaml/);

  const nested = projectCheckHarness();
  runProjectChecks(scopedConfig, nested.options({ changedFiles: ['packages/shared/src/index.ts'] }));
  assert.deepEqual(nested.ran, ['check:always', 'test:web', 'test:db']);

  const flag = projectCheckHarness();
  runProjectChecks(scopedConfig, flag.options({ changedFiles: [], allChecks: true }));
  assert.deepEqual(flag.ran, ['check:always', 'test:web', 'test:db']);
  assert.match(flag.output(), /PROJECT_CHECKS_SELECTION=ALL_CHECKS_FLAG/);

  // diff 无法计算时宁可全跑，也不静默跳过。
  const unknown = projectCheckHarness();
  runProjectChecks(scopedConfig, unknown.options({ diffError: 'merge-base origin/main HEAD failed' }));
  assert.deepEqual(unknown.ran, ['check:always', 'test:web', 'test:db']);
  assert.match(unknown.output(), /PROJECT_CHECKS_SELECTION=DIFF_UNAVAILABLE\s+CHANGED_FILES=unknown\s+REASON=merge-base origin\/main HEAD failed/);

  // 未提供 changedFiles 的旧调用方保持全跑。
  const legacy = projectCheckHarness();
  runProjectChecks(scopedConfig, legacy.options());
  assert.deepEqual(legacy.ran, ['check:always', 'test:web', 'test:db']);
});

test('/tdd sync stops at the first required project check failure unless --keep-going is set', () => {
  const config = {
    tdd: {
      projectChecks: [
        { name: 'check:optional', required: false },
        { name: 'check:a', required: true },
        { name: 'check:b', required: true },
        { name: 'check:c', required: false },
      ],
    },
  };
  const failFast = projectCheckHarness({ failing: ['check:optional', 'check:a'] });
  assert.equal(runProjectChecks(config, failFast.options({ allChecks: true })), false);
  // 非 required 失败不终止；required 失败后剩余检查标记 NOT_RUN，不计为通过。
  assert.deepEqual(failFast.ran, ['check:optional', 'check:a']);
  const output = failFast.output();
  assert.match(output, /PROJECT_CHECK=check:optional\|FAIL\|\d+ms\|optional\|exit 1/);
  assert.match(output, /PROJECT_CHECK=check:a\|FAIL\|\d+ms\|required\|exit 1/);
  assert.match(output, /PROJECT_CHECK=check:b\|NOT_RUN\|0ms\|required\|stopped after required failure: check:a/);
  assert.match(output, /PROJECT_CHECKS_SUMMARY=total=4 ran=2 passed=0 failed=2 skipped=0 not_run=2 /);
  assert.match(output, /--keep-going/);

  const keepGoing = projectCheckHarness({ failing: ['check:a'] });
  assert.equal(runProjectChecks(config, keepGoing.options({ allChecks: true, keepGoing: true })), false);
  assert.deepEqual(keepGoing.ran, ['check:optional', 'check:a', 'check:b', 'check:c']);

  const optionalOnly = projectCheckHarness({ failing: ['check:optional'] });
  assert.equal(runProjectChecks(config, optionalOnly.options({ allChecks: true })), true);
  assert.equal(optionalOnly.ran.length, 4);
});

test('/tdd sync reports per-check duration and the slowest project checks', () => {
  const harness = projectCheckHarness({ durations: { 'check:always': 1500, 'test:web': 42000, 'test:db': 300 } });
  runProjectChecks(scopedConfig, harness.options({ allChecks: true }));
  const output = harness.output();
  assert.match(output, /PROJECT_CHECK=check:always\|PASS\|1500ms\|required\|/);
  assert.match(output, /PROJECT_CHECK=test:web\|PASS\|42000ms\|required\|/);
  assert.match(output, /PROJECT_CHECKS_SUMMARY=total=3 ran=3 passed=3 failed=0 skipped=0 not_run=0 duration=43800ms/);
  assert.match(output, /PROJECT_CHECKS_SLOWEST=test:web:42000ms,check:always:1500ms,test:db:300ms/);
});

test('/tdd sync validates project check paths and run-all globs', () => {
  for (const paths of [[], [''], 'apps/**', [1], ['ok/**', '  ']]) {
    assert.throws(
      () => resolveProjectChecks({ tdd: { projectChecks: [{ name: 'check:x', required: true, paths }] } }),
      /invalid tdd\.projectChecks entry/,
      `paths=${JSON.stringify(paths)}`,
    );
  }
  assert.deepEqual(
    resolveProjectChecks({ tdd: { projectChecks: [{ name: 'check:x', required: false, paths: ['apps/**'] }] } }),
    [{ name: 'check:x', required: false, paths: ['apps/**'] }],
  );
  assert.deepEqual(resolveProjectChecksRunAll({}), []);
  assert.deepEqual(resolveProjectChecksRunAll({ tdd: { projectChecksRunAll: ['pnpm-lock.yaml'] } }), ['pnpm-lock.yaml']);
  for (const runAll of ['pnpm-lock.yaml', [''], [null]]) {
    assert.throws(() => resolveProjectChecksRunAll({ tdd: { projectChecksRunAll: runAll } }), /invalid tdd\.projectChecksRunAll/);
  }
});

test('/tdd sync parses --all-checks and --keep-going and documents them in --help', () => {
  assert.deepEqual(parseProjectCheckFlags([]), { allChecks: false, keepGoing: false });
  assert.deepEqual(parseProjectCheckFlags(['--project', '--all-checks', '--keep-going']), { allChecks: true, keepGoing: true });
  const repoRoot = path.resolve(__dirname, '../../../..');
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'infra/scripts/tdd-tools/tdd-sync.js'), '--help'], { cwd: repoRoot, encoding: 'utf8' });
  assert.match(result.stdout, /--all-checks/);
  assert.match(result.stdout, /--keep-going/);
});

test('collectChangedFiles unions committed, staged, unstaged and untracked paths since the merge-base', (t) => {
  const os = require('node:os');
  const repo = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'xirang-changed-files-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (args) => {
    const result = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: repo, encoding: 'utf8', stdio: 'pipe' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), content);
  };
  git(['init', '--quiet', '--initial-branch=main']);
  write('.gitignore', '*.log\n');
  write('README.md', 'base\n');
  write('old.md', 'old\n');
  write('untouched.md', 'same\n');
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'base']);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(['checkout', '--quiet', '-b', 'feature/x']);
  write('apps/web/a.ts', 'export {};\n');
  git(['rm', '--quiet', 'old.md']);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'feature']);
  write('README.md', 'edited\n');
  write('staged.ts', 'staged\n');
  git(['add', 'staged.ts']);
  write('docs/中文 文件.md', 'untracked\n');
  write('debug.log', 'ignored\n');

  const changed = collectChangedFiles({ repoRoot: repo, baseRef: 'origin/main' });
  assert.equal(changed.ok, true);
  assert.deepEqual(changed.files, ['README.md', 'apps/web/a.ts', 'docs/中文 文件.md', 'old.md', 'staged.ts']);

  const missing = collectChangedFiles({ repoRoot: repo, baseRef: 'origin/absent' });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /merge-base origin\/absent HEAD failed/);
});

test('/tdd sync collects changed files after the base sync and passes the CLI flags to the project check gate', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const script = fs.readFileSync(path.join(repoRoot, 'infra/scripts/tdd-tools/tdd-sync.js'), 'utf8');
  const main = script.slice(script.indexOf('function main()'));
  const collectAt = main.indexOf('collectChangedFiles({');
  assert.ok(collectAt > main.indexOf('syncWithBase({'), 'changed files use the merged base');
  assert.ok(collectAt < main.indexOf('runProjectChecks(config, projectCheckOptions)'));
  assert.match(main, /parseProjectCheckFlags\(argv\)/);
});

// AC4 codemap-stable-timestamp：codemap 未改写文件时，tdd sync 不应再提示“tdd push 会自动提交并改变 HEAD”。
test('AC4 codemap-stable-timestamp: the HEAD-change notice follows the codemap status', () => {
  const { codemapChangedFromOutput } = require('../tdd-sync');
  assert.equal(codemapChangedFromOutput('✅ ...\nCODEMAP_STATUS=UNCHANGED\n'), false);
  assert.equal(codemapChangedFromOutput('CODEMAP_STATUS=UPDATED\n'), true);
  assert.equal(codemapChangedFromOutput('CODEMAP_STATUS=CREATED\n'), true);
  // 无法识别状态时保守提示，宁可多提醒也不漏掉 HEAD 变化
  assert.equal(codemapChangedFromOutput(''), true);
});

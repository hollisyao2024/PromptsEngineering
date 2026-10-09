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

test('/tdd sync runs the base sync before the document gates and blocks on its coded errors', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const script = fs.readFileSync(path.join(repoRoot, 'infra/scripts/tdd-tools/tdd-sync.js'), 'utf8');
  const syncAt = script.indexOf('syncWithBase({');
  assert.ok(syncAt > 0, 'main() calls syncWithBase');
  assert.ok(syncAt < script.indexOf('runMigrationRegistryCheck(config)'));
  assert.match(script, /BASE_SYNC=/);
});

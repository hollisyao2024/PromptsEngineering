'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  auditManagedWorktrees,
} = require('../worktree-audit');
const {
  readSessions,
  safeRemoveTreeNoFollow,
  writeManagedMarker,
  writeSession,
} = require('../worktree-core');
const { NOW, safeEvidence } = require('./worktree-audit.helpers');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || '').trim());
  return result.stdout.trim();
}

test('real Git audit removes a clean merged expired managed worktree and its session', (t) => {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const container = fs.mkdtempSync(path.join(temporaryRoot, 'worktree-audit-real-'));
  const mainRoot = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  const tmpRoot = path.join(container, 'tmp');
  const worktreePath = path.join(worktreesRoot, 'stale');
  const branch = 'feature/audit-real-stale';
  const config = {
    baseBranch: 'main',
    containerDirs: { worktrees: worktreesRoot, tmp: tmpRoot },
    worktree: {
      sessionDir: path.join(tmpRoot, 'worktree-sessions'),
      lockDir: path.join(tmpRoot, 'agent-locks'),
      leaseTtlMinutes: 60,
    },
  };
  fs.mkdirSync(mainRoot, { recursive: true });
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: temporaryRoot }));
  git(mainRoot, ['init', '-b', 'main']);
  git(mainRoot, ['config', 'user.email', 'audit@example.com']);
  git(mainRoot, ['config', 'user.name', 'Audit Test']);
  fs.writeFileSync(path.join(mainRoot, 'README.md'), 'base\n');
  git(mainRoot, ['add', '.']);
  git(mainRoot, ['commit', '-m', 'base']);
  git(mainRoot, ['worktree', 'add', '-b', branch, worktreePath]);
  const head = git(worktreePath, ['rev-parse', 'HEAD']);
  writeManagedMarker(mainRoot, worktreePath, branch);
  writeSession(config, mainRoot, {
    phase: 'tdd', branch, worktree: worktreePath, head,
    status: 'in_progress', step: 'created', lifecycle: { keys: ['task:audit-real-stale'] },
  });
  const sessionFile = fs.readdirSync(config.worktree.sessionDir)
    .map((name) => path.join(config.worktree.sessionDir, name))
    .find((file) => JSON.parse(fs.readFileSync(file, 'utf8')).branch === branch);
  const stale = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  stale.lease.expires_at = '2000-01-01T00:00:00.000Z';
  fs.writeFileSync(sessionFile, `${JSON.stringify(stale, null, 2)}\n`);

  const result = auditManagedWorktrees({
    mainRoot,
    cwd: mainRoot,
    config,
    baseRef: 'main',
    apply: true,
    dependencies: {
      listTaskStates: () => [],
      inspectWorktreeUsers: () => ({ supported: true, users: [] }),
    },
  });

  assert.equal(result.records.find((record) => record.branch === branch).state, 'cleaned');
  assert.equal(fs.existsSync(worktreePath), false);
  assert.equal(git(mainRoot, ['branch', '--list', branch]), '');
  assert.equal(readSessions(config, mainRoot).some((session) => session.branch === branch), false);
});

test('64-worktree dry-run audit stays under the two-second P95 target with one process snapshot', () => {
  const sessions = [];
  const entries = [];
  for (let index = 0; index < 64; index += 1) {
    const branch = `feature/perf-${index}`;
    const worktree = `/container/worktrees/perf-${index}`;
    const head = `head-${index}`;
    sessions.push({
      ...safeEvidence().session,
      branch,
      worktree,
      head,
      lifecycle: { keys: [`task:perf-${index}`] },
    });
    entries.push({ branch, path: worktree, head, locked: false });
  }
  let processSnapshots = 0;
  const durations = [];
  for (let sample = 0; sample < 20; sample += 1) {
    const started = performance.now();
    const result = auditManagedWorktrees({
      mainRoot: '/container/repo',
      cwd: '/container/repo',
      config: { containerDirs: { worktrees: '/container/worktrees', tmp: '/container/tmp' } },
      baseRef: 'main',
      now: NOW,
      dependencies: {
        readSessions: () => sessions,
        listWorktrees: () => entries,
        listTaskStates: () => [],
        inspectProcessSnapshot: () => {
          processSnapshots += 1;
          return { supported: true, records: [], excludePids: [] };
        },
        inspectGitEvidence: () => ({ dirty: false, uniqueCommits: 0 }),
        hasOwnedWorktreeMarker: () => true,
      },
    });
    durations.push(performance.now() - started);
    assert.equal(result.records.length, 64);
  }
  durations.sort((left, right) => left - right);
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
  assert.ok(p95 <= 2000, `expected P95 <= 2000ms, observed ${p95.toFixed(2)}ms`);
  assert.equal(processSnapshots, 20);
});

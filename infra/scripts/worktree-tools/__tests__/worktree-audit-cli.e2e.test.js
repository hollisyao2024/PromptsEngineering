'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  readSessions,
  safeRemoveTreeNoFollow,
  writeManagedMarker,
  writeSession,
} = require('../worktree-core');
const { getQaPlanSessionStatePath } = require('../qa-plan-state-audit');

const auditCli = path.resolve(__dirname, '..', 'worktree-audit-cli.js');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || '').trim());
  return result.stdout.trim();
}

test('CLI apply converges a real clean orphan across worktree, branch, and session state', (t) => {
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const container = fs.mkdtempSync(path.join(temporaryRoot, 'worktree-audit-cli-e2e-'));
  const mainRoot = path.join(container, 'repo');
  const worktreesRoot = path.join(container, 'worktrees');
  const tmpRoot = path.join(container, 'tmp');
  const worktreePath = path.join(worktreesRoot, 'orphan');
  const branch = 'feature/audit-cli-e2e-orphan';
  const config = {
    baseBranch: 'main',
    containerDirs: { worktrees: worktreesRoot, tmp: tmpRoot },
    worktree: {
      sessionDir: path.join(tmpRoot, 'worktree-sessions'),
      lockDir: path.join(tmpRoot, 'agent-locks'),
      leaseTtlMinutes: 60,
      bootstrap: { mode: 'skip' },
    },
  };
  fs.mkdirSync(mainRoot, { recursive: true });
  t.after(() => safeRemoveTreeNoFollow(container, { allowedRoot: temporaryRoot }));
  git(mainRoot, ['init', '-b', 'main']);
  git(mainRoot, ['config', 'user.email', 'audit-cli@example.com']);
  git(mainRoot, ['config', 'user.name', 'Audit CLI Test']);
  fs.writeFileSync(path.join(mainRoot, 'README.md'), 'base\n');
  fs.writeFileSync(path.join(mainRoot, 'agent.config.json'), `${JSON.stringify(config, null, 2)}\n`);
  git(mainRoot, ['add', '.']);
  git(mainRoot, ['commit', '-m', 'base']);
  git(mainRoot, ['worktree', 'add', '-b', branch, worktreePath]);
  const head = git(worktreePath, ['rev-parse', 'HEAD']);
  writeManagedMarker(mainRoot, worktreePath, branch);
  writeSession(config, mainRoot, {
    phase: 'tdd', branch, worktree: worktreePath, head,
    status: 'in_progress', step: 'created', lifecycle: { keys: ['task:audit-cli-e2e'] },
  });
  const sessionFile = fs.readdirSync(config.worktree.sessionDir)
    .map((name) => path.join(config.worktree.sessionDir, name))
    .find((file) => JSON.parse(fs.readFileSync(file, 'utf8')).branch === branch);
  const stale = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  stale.lease.expires_at = '2000-01-01T00:00:00.000Z';
  fs.writeFileSync(sessionFile, `${JSON.stringify(stale, null, 2)}\n`);
  const qaPlanState = getQaPlanSessionStatePath({ config, mainRoot, worktreeRoot: worktreePath });
  fs.mkdirSync(path.dirname(qaPlanState), { recursive: true });
  fs.writeFileSync(qaPlanState, `${JSON.stringify({ branch })}\n`, 'utf8');

  const result = spawnSync(process.execPath, [auditCli, '--apply'], {
    cwd: mainRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30000,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /STATUS=OK/);
  assert.match(result.stdout, /STATE=cleaned/);
  assert.match(result.stdout, /QA_PLAN_STATE=cleaned/);
  assert.equal(fs.existsSync(worktreePath), false);
  assert.equal(git(mainRoot, ['branch', '--list', branch]), '');
  assert.equal(readSessions(config, mainRoot).some((session) => session.branch === branch), false);
  assert.equal(fs.existsSync(qaPlanState), false);
});

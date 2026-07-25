const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildArtifactCleanupPlan,
  buildTmpCleanupPlan,
  parseArgs,
} = require('../container-storage-cleanup');

const OLD = new Date('2026-07-01T00:00:00.000Z');
const NEW = new Date('2026-07-24T00:00:00.000Z');

test('keeps protected and recent tmp entries, but selects old disposable entries', () => {
  const plan = buildTmpCleanupPlan([
    { name: 'worktree-sessions', path: 'tmp/worktree-sessions', modified: OLD, isDirectory: true },
    { name: 'dev-app-win', path: 'tmp/dev-app-win', modified: OLD, isDirectory: true },
    { name: 'junction-node-probe-old', path: 'tmp/junction-node-probe-old', modified: OLD, isDirectory: true },
    { name: 'recent.log', path: 'tmp/recent.log', modified: NEW, isDirectory: false },
  ], { now: new Date('2026-07-25T00:00:00.000Z'), tmpDays: 7 });

  assert.deepEqual(plan.remove.map((entry) => entry.name), ['junction-node-probe-old']);
  assert.deepEqual(plan.keep.map((entry) => entry.name).sort(), ['dev-app-win', 'recent.log', 'worktree-sessions']);
});

test('keeps only the newest configured release groups and never includes backups', () => {
  const plan = buildArtifactCleanupPlan({
    releases: [
      { name: 'app-v1-2026-07-01T00-00-00Z.tar.gz', path: 'releases/v1.tar.gz', modified: OLD, isDirectory: false },
      { name: 'app-v2-2026-07-10T00-00-00Z.tar.gz', path: 'releases/v2.tar.gz', modified: new Date('2026-07-10T00:00:00.000Z'), isDirectory: false },
      { name: 'app-v3-2026-07-24T00-00-00Z.tar.gz', path: 'releases/v3.tar.gz', modified: NEW, isDirectory: false },
    ],
    privateEdition: [
      { name: 'pr-1317', path: 'private-edition/pr-1317', modified: OLD, isDirectory: true },
      { name: 'backups', path: 'private-edition/backups', modified: OLD, isDirectory: true },
    ],
  }, { now: new Date('2026-07-25T00:00:00.000Z'), releaseKeep: 2, prArtifactDays: 7 });

  assert.deepEqual(plan.remove.map((entry) => entry.path), ['releases/v1.tar.gz', 'private-edition/pr-1317']);
  assert.ok(plan.keep.some((entry) => entry.path === 'private-edition/backups'));
});

test('requires --apply for mutation and permits retention overrides', () => {
  assert.deepEqual(parseArgs([]), { apply: false, tmpDays: undefined, releaseKeep: undefined, prArtifactDays: undefined });
  assert.deepEqual(parseArgs(['--apply', '--tmp-days=3', '--release-keep', '4', '--pr-artifact-days', '9']), {
    apply: true, tmpDays: 3, releaseKeep: 4, prArtifactDays: 9,
  });
});

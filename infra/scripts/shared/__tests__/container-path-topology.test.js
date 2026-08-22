'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { resolveContainerPath, resolveRuntimePath, validateContainerTopology } = require('../config');

test('container paths stay anchored to main root when called from a linked worktree', () => {
  const mainRoot = path.resolve('/container/repo');
  const config = { containerDirs: { worktrees: '../worktrees', tmp: '../tmp' } };
  assert.equal(resolveContainerPath(config, mainRoot, 'tmp'), path.resolve('/container/tmp'));
  assert.doesNotThrow(() => validateContainerTopology(config, mainRoot));
});

test('session and lock runtime paths must remain inside the container tmp root', () => {
  const mainRoot = path.resolve('/container/repo');
  const config = { containerDirs: { worktrees: '../worktrees', tmp: '../tmp' } };
  assert.equal(
    resolveRuntimePath(config, mainRoot, '../tmp/worktree-sessions', 'worktree-sessions'),
    path.resolve('/container/tmp/worktree-sessions'),
  );
  assert.throws(
    () => resolveRuntimePath(config, mainRoot, '../worktrees/locks', 'agent-locks'),
    /runtime path.*container tmp/iu,
  );
});

test('container topology fails closed when tmp is inside the worktrees root', () => {
  const mainRoot = path.resolve('/container/repo');
  const config = { containerDirs: { worktrees: '../worktrees', tmp: '../worktrees/tmp' } };
  assert.throws(
    () => validateContainerTopology(config, mainRoot),
    /tmp.*worktrees|worktrees.*tmp/iu,
  );
});

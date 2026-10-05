'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isHelpRequest } = require('../cli-help');

const scriptsRoot = path.resolve(__dirname, '../..');
// Entries whose default action mutates Git, GitHub, worktrees, templates or environments.
const SIDE_EFFECT_ENTRIES = [
  'tdd-tools/tdd-push.js',
  'tdd-tools/tdd-commit.js',
  'tdd-tools/tdd-new-branch.js',
  'qa-tools/generate-qa.js',
  'qa-tools/qa-verify.js',
  'qa-tools/qa-merge.js',
  'worktree-tools/worktree-remove.js',
  'worktree-tools/worktree-cancel.js',
  'worktree-tools/worktree-resume.js',
  'worktree-tools/worktree-bootstrap.js',
  'setup/template-sync.js',
  'setup/update-template.js',
  'setup/backfill-template.js',
  'devops-tools/devops-run.js',
];

test('help is recognized only before the pass-through separator', () => {
  assert.equal(isHelpRequest(['--help']), true);
  assert.equal(isHelpRequest(['--scope', 'project', '-h']), true);
  assert.equal(isHelpRequest([]), false);
  assert.equal(isHelpRequest(['--', '--help']), false);
  assert.equal(isHelpRequest(['--env=dev', '--', '-h']), false);
});

test('side-effecting entries print help and exit before any work when invoked directly', () => {
  for (const entry of SIDE_EFFECT_ENTRIES) {
    const file = path.join(scriptsRoot, entry);
    // Spawn only guarded entries so a missing guard can never trigger real side effects in this test.
    assert.match(fs.readFileSync(file, 'utf8'), /exitOnHelp\(/, `${entry} must call exitOnHelp`);
    const result = spawnSync(process.execPath, [file, '--help'], { cwd: os.tmpdir(), encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 0, `${entry}: ${result.stderr}`);
    assert.match(result.stdout, /^Usage: /m, entry);
  }
});

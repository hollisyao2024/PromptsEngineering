'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveCommand } = require('../agent-cli');

test('unified agent CLI routes stable workflow commands', () => {
  assert.deepEqual(resolveCommand(['task', 'resume', '--auto']), {
    script: 'infra/scripts/agent-runner/agent-task.js',
    args: ['resume', '--auto'],
  });
  assert.deepEqual(resolveCommand(['worktree', 'new', '--desc', 'demo']), {
    script: 'infra/scripts/worktree-tools/worktree-new.js',
    args: ['--desc', 'demo'],
  });
  assert.deepEqual(resolveCommand(['worktree', 'audit', '--apply']), {
    script: 'infra/scripts/worktree-tools/worktree-audit-cli.js',
    args: ['--apply'],
  });
  assert.deepEqual(resolveCommand(['qa', 'verify']), {
    script: 'infra/scripts/qa-tools/qa-verify.js',
    args: [],
  });
  assert.deepEqual(resolveCommand(['finish']), {
    script: 'infra/scripts/tdd-tools/tdd-finish.js',
    args: [],
  });
  assert.deepEqual(resolveCommand(['app', 'dev', '--platform=mac']), {
    script: 'infra/scripts/devops-tools/devops-run.js',
    args: ['--action=app-dev', '--platform=mac'],
  });
  assert.deepEqual(resolveCommand(['app', 'build', '--platform=win']), {
    script: 'infra/scripts/devops-tools/devops-run.js',
    args: ['--action=app-build', '--platform=win'],
  });
  assert.deepEqual(resolveCommand(['build', 'server', '--env=production']), {
    script: 'infra/scripts/devops-tools/devops-run.js',
    args: ['--action=build', '--env=production'],
  });
  assert.deepEqual(resolveCommand(['private', 'restart']), {
    script: 'infra/scripts/devops-tools/devops-run.js',
    args: ['--action=dev-restart', '--target=private'],
  });
  assert.deepEqual(resolveCommand(['dev', 'app', 'mac']), {
    script: 'infra/scripts/devops-tools/devops-run.js',
    args: ['--action=app-dev', '--platform=mac'],
  });
  assert.deepEqual(resolveCommand(['build', 'app', 'win']), {
    script: 'infra/scripts/devops-tools/devops-run.js',
    args: ['--action=app-build', '--platform=win'],
  });
  assert.deepEqual(resolveCommand(['build', 'prod']), {
    script: 'infra/scripts/devops-tools/devops-run.js',
    args: ['--action=build', '--env=prod'],
  });
  assert.deepEqual(resolveCommand(['private', 'dev', 'app', 'mac']), {
    script: 'infra/scripts/devops-tools/devops-run.js',
    args: ['--action=app-dev', '--platform=mac', '--target=private'],
  });
  assert.deepEqual(resolveCommand(['private', 'build', 'app', 'win']), {
    script: 'infra/scripts/devops-tools/devops-run.js',
    args: ['--action=app-build', '--platform=win', '--target=private'],
  });
  assert.deepEqual(resolveCommand(['private', 'build', 'prod']), {
    script: 'infra/scripts/devops-tools/devops-run.js',
    args: ['--action=build', '--env=prod', '--target=private'],
  });
  assert.deepEqual(resolveCommand(['private', 'ship', 'prod']), {
    script: 'infra/scripts/devops-tools/devops-run.js',
    args: ['--action=ship', '--env=prod', '--target=private'],
  });
});

test('private service shortcut only accepts lifecycle actions', () => {
  assert.throws(() => resolveCommand(['private', 'unknown']), /private requires/u);
});

test('unified agent CLI rejects unknown routes', () => {
  assert.throws(() => resolveCommand(['unknown']), /unknown agent command/u);
});

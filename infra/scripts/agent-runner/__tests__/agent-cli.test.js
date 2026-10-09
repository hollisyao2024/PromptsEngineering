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
  assert.deepEqual(resolveCommand(['template', 'sync', '--dry-run']), {
    script: 'infra/scripts/setup/template-sync.js',
    args: ['--dry-run'],
  });
  assert.deepEqual(resolveCommand(['finish']), {
    script: 'infra/scripts/tdd-tools/tdd-finish.js',
    args: [],
  });
  assert.deepEqual(resolveCommand(['test', '--file', 'tests/unit.test.js', '--', 'node', '--test']), {
    script: 'infra/scripts/agent-runner/targeted-test.js',
    args: ['--file', 'tests/unit.test.js', '--', 'node', '--test'],
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

test('unified agent CLI routes tdd commit to the GH_TOKEN-identity commit entry and lists it in help', () => {
  const { main } = require('../agent-cli');
  assert.deepEqual(resolveCommand(['tdd', 'commit', '-m', 'feat: x', '--no-verify']), {
    script: 'infra/scripts/tdd-tools/tdd-commit.js',
    args: ['-m', 'feat: x', '--no-verify'],
  });

  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    assert.equal(main(['--help']), 0);
  } finally {
    console.log = originalLog;
  }
  assert.match(lines.join('\n'), /tdd <sync\|push\|commit\|review-gate\|finish\|guard>/u);
});

test('unified agent CLI routes qa paths and qa run to the business-test entries and lists them in help', () => {
  const { main } = require('../agent-cli');
  assert.deepEqual(resolveCommand(['qa', 'paths']), {
    script: 'infra/scripts/qa-tools/qa-paths.js',
    args: [],
  });
  assert.deepEqual(resolveCommand(['qa', 'run']), {
    script: 'infra/scripts/qa-tools/qa-run.js',
    args: [],
  });
  assert.deepEqual(resolveCommand(['--', 'qa', 'run', '--help']), {
    script: 'infra/scripts/qa-tools/qa-run.js',
    args: ['--help'],
  });
  assert.deepEqual(resolveCommand(['qa', 'verify']), {
    script: 'infra/scripts/qa-tools/qa-verify.js',
    args: [],
  });

  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    assert.equal(main(['--help']), 0);
  } finally {
    console.log = originalLog;
  }
  assert.match(lines.join('\n'), /qa <plan\|paths\|run\|verify\|merge>/u);
});

test('private service shortcut only accepts lifecycle actions', () => {
  assert.throws(() => resolveCommand(['private', 'unknown']), /private requires/u);
});

test('unified agent CLI rejects unknown routes', () => {
  assert.throws(() => resolveCommand(['unknown']), /unknown agent command/u);
});

test('unified agent CLI only treats help flags before the forwarded command separator as CLI help', () => {
  const { isHelpRequest } = require('../agent-cli');
  assert.equal(isHelpRequest([]), true);
  assert.equal(isHelpRequest(['--help']), true);
  assert.equal(isHelpRequest(['tdd', 'sync', '-h']), true);
  assert.equal(isHelpRequest(['task', 'exec', '--task', 'demo', '--name', 'ls', '--', 'ls', '-h']), false);
  assert.equal(isHelpRequest(['test', '--file', 'a.test.js', '--', 'node', '--test', '--help']), false);
});

test('unified agent CLI fails when the routed script is killed by a signal', () => {
  const os = require('node:os');
  const { exitCodeFor } = require('../agent-cli');
  assert.equal(exitCodeFor({ status: null, signal: 'SIGKILL' }), 128 + os.constants.signals.SIGKILL);
  assert.equal(exitCodeFor({ status: 2, signal: null }), 2);
});

// /tdd review-gate was documented in the tdd-tools README but had no unified-CLI route, so `pnpm agent -- tdd
// review-gate` was rejected as an unknown command.
test('unified agent CLI routes tdd review-gate to the review gate entry', () => {
  assert.deepEqual(resolveCommand(['tdd', 'review-gate', '--base', 'main', '--record', 'required']), {
    script: 'infra/scripts/tdd-tools/tdd-review-gate.js',
    args: ['--base', 'main', '--record', 'required'],
  });
});

// `pnpm agent -- architecture check` in a project that never pulled the architecture package used to crash with a
// MODULE_NOT_FOUND stack. The CLI checks the routed script first and names the command that installs it.
test('unified agent CLI blocks with a next action when the routed script is not installed', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const cwd = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'xirang-cli-missing-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../agent-cli.js'), 'architecture', 'check'], {
    cwd, encoding: 'utf8', stdio: 'pipe',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^STATUS=BLOCKED$/mu);
  assert.match(result.stderr, /^REASON=.*architecture\/scripts\/cli\.js.*not installed/mu);
  assert.match(result.stderr, /^NEXT_ACTION=pnpm agent -- template sync --include architecture$/mu);
  assert.doesNotMatch(result.stderr, /MODULE_NOT_FOUND|at Module\._/u);
});

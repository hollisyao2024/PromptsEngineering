const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const {
  shouldSwitchVscodeWindow,
  switchVscodeWindow,
} = require('./qa-merge');

test('switchVscodeWindow skips Codex and CI environments by default', () => {
  for (const env of [
    { CODEX_CI: '1' },
    { CODEX_THREAD_ID: '019f' },
    { CI: 'true' },
    { GITHUB_ACTIONS: 'true' },
    { TERM: 'dumb' },
    { AGENT_QA_MERGE_FOCUS_VSCODE: '0' },
    { AGENT_SKIP_QA_MERGE_FOCUS_VSCODE: '1' },
    { AGENT_SKIP_VSCODE_FOCUS: '1' },
  ]) {
    let spawnCalled = false;
    const switched = switchVscodeWindow('/repo', {
      env,
      spawn: () => {
        spawnCalled = true;
      },
    });

    assert.equal(switched, false);
    assert.equal(spawnCalled, false);
    assert.equal(shouldSwitchVscodeWindow({ env }), false);
  }
});

test('switchVscodeWindow can be explicitly enabled for local interactive use', () => {
  const child = new EventEmitter();
  let unrefCalled = false;
  child.unref = () => {
    unrefCalled = true;
  };

  let spawnArgs;
  const switched = switchVscodeWindow('/repo', {
    env: {
      CODEX_CI: '1',
      AGENT_QA_MERGE_FOCUS_VSCODE: '1',
    },
    spawn: (...args) => {
      spawnArgs = args;
      return child;
    },
  });

  assert.equal(switched, true);
  assert.equal(unrefCalled, true);
  assert.equal(child.listenerCount('error'), 1);
  assert.deepEqual(spawnArgs, [
    'code',
    ['-r', '/repo'],
    {
      detached: true,
      stdio: 'ignore',
    },
  ]);
  assert.doesNotThrow(() => child.emit('error', new Error('spawn code ENOENT')));
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  generateModuleList,
  generateProjectOverview,
  getQaPlanSessionStatePath,
  validateUpstreamModuleAlignment,
} = require('../generate-qa');

const modules = [
  {
    moduleDir: 'auth',
    moduleName: 'Auth',
    qaPath: 'docs/qa-modules/auth/QA.md',
    stories: [{ id: 'US-AUTH-001' }],
  },
];

test('project QA overview always indexes module QA documents', () => {
  const markdown = generateProjectOverview(modules);

  assert.match(markdown, /作为测试总纲与模块索引/);
  assert.match(markdown, /qa-modules\/auth\/QA\.md/);
  assert.doesNotMatch(markdown, /大型项目|小型项目|单一 QA/);
});

test('project QA generation includes a canonical module list', () => {
  const markdown = generateModuleList(modules);

  assert.match(markdown, /# QA 模块清单/);
  assert.match(markdown, /\| Auth \| auth \| \[auth\/QA\.md\]/);
});

test('QA generation detects upstream module set drift', () => {
  const result = validateUpstreamModuleAlignment(modules, ['auth', 'orphan'], []);

  assert.deepEqual(result.missingArch, []);
  assert.deepEqual(result.extraArch, ['orphan']);
  assert.deepEqual(result.missingTask, ['auth']);
  assert.deepEqual(result.extraTask, []);
});

test('QA plan session state defaults to the container worktree session directory', () => {
  const mainRoot = '/workspace/project/repo';
  const worktreeRoot = '/workspace/project/worktrees/fix-a';
  const statePath = getQaPlanSessionStatePath({
    env: {},
    mainRoot,
    worktreeRoot,
    config: { worktree: { sessionDir: '../tmp/worktree-sessions' } },
  });

  assert.equal(path.dirname(statePath), '/workspace/project/tmp/worktree-sessions/qa-plan');
  assert.match(path.basename(statePath), /^fix-a-[a-f0-9]{12}\.json$/);
});

test('QA plan session state is stable per worktree and isolated across worktrees', () => {
  const options = {
    env: {},
    mainRoot: '/workspace/project/repo',
    config: { worktree: { sessionDir: '../tmp/worktree-sessions' } },
  };
  const first = getQaPlanSessionStatePath({
    ...options,
    worktreeRoot: '/workspace/project/worktrees/fix-a',
  });
  const firstAgain = getQaPlanSessionStatePath({
    ...options,
    worktreeRoot: '/workspace/project/worktrees/fix-a',
  });
  const second = getQaPlanSessionStatePath({
    ...options,
    worktreeRoot: '/workspace/project/worktrees/fix-b',
  });

  assert.equal(firstAgain, first);
  assert.notEqual(second, first);
});

test('QA plan session state path keeps the explicit environment override', () => {
  const statePath = getQaPlanSessionStatePath({
    env: { QA_PLAN_SESSION_STATE_PATH: '/custom/qa-session.json' },
  });

  assert.equal(statePath, '/custom/qa-session.json');
});

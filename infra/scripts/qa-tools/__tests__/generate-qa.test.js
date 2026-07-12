'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateModuleList,
  generateProjectOverview,
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

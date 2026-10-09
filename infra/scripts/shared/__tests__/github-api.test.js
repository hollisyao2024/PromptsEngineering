'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createGitHubBackend } = require('../github-api');

const remoteUrl = 'https://github.com/owner/repo.git';

test('project token selects REST API even when gh is available', () => {
  const apiRequest = async () => ({});
  for (const ghAvailable of [true, false]) {
    const backend = createGitHubBackend({ token: 'project-token', ghAvailable, remoteUrl, apiRequest });
    assert.deepEqual(backend, { mode: 'api', token: 'project-token', owner: 'owner', repo: 'repo', apiRequest });
  }
});

test('token path never probes or invokes gh', () => {
  const result = spawnSync(process.execPath, ['-e', `
    require('node:child_process').spawnSync = () => { throw new Error('unexpected gh probe'); };
    const { createGitHubBackend } = require(${JSON.stringify(require.resolve('../github-api'))});
    const backend = createGitHubBackend({ token: 'project-token', remoteUrl: ${JSON.stringify(remoteUrl)} });
    require('node:assert/strict').equal(backend.mode, 'api');
  `], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('missing token preserves explicit CLI compatibility and otherwise fails', () => {
  assert.deepEqual(createGitHubBackend({ token: '', ghAvailable: true, remoteUrl }), { mode: 'gh' });
  assert.throws(() => createGitHubBackend({ token: '', ghAvailable: false, remoteUrl }), /GH_TOKEN/);
});

test('invalid remote with token fails even when gh is available', () => {
  for (const remoteUrl of ['', 'https://gitlab.com/owner/repo.git']) {
    assert.throws(() => createGitHubBackend({ token: 'project-token', ghAvailable: true, remoteUrl }), /origin remote/);
  }
});

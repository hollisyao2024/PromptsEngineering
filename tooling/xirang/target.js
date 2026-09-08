const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { read, parseJson } = require('./engine');

function assertMutationTarget(target) {
  const config = read(target, 'agent.config.json');
  if (config && parseJson(config, 'agent.config.json').template?.role === 'source') {
    throw new Error('Architecture generation/recovery cannot target the Xirang source repository');
  }
  const git = spawnSync('git', ['rev-parse', '--git-common-dir', '--git-dir'], { cwd: target, encoding: 'utf8', shell: false });
  if (git.status === 0) {
    const [common, directory] = git.stdout.trim().split('\n');
    if (path.resolve(target, common) === path.resolve(target, directory)) {
      throw new Error('Existing Git project mutations require a dedicated linked worktree');
    }
  }
}
module.exports = { assertMutationTarget };

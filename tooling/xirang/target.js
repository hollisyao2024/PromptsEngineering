const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { read, parseJson, safePath } = require('./engine');

function assertMutationTarget(target) {
  const config = read(target, 'agent.config.json');
  if (config && parseJson(config, 'agent.config.json').template?.role === 'source') {
    throw new Error('Template and architecture mutations cannot target the Xirang source repository');
  }
  const git = spawnSync('git', ['rev-parse', '--git-common-dir', '--git-dir'], { cwd: target, encoding: 'utf8', shell: false });
  if (git.status === 0) {
    const [common, directory] = git.stdout.trim().split('\n');
    if (path.resolve(target, common) === path.resolve(target, directory)) {
      throw new Error('Existing Git project mutations require a dedicated linked worktree');
    }
  }
}

function canonicalPath(value) {
  let existing = path.resolve(value); const tail = [];
  while (!fs.existsSync(existing)) { tail.unshift(path.basename(existing)); existing = path.dirname(existing); }
  return path.join(fs.realpathSync(existing), ...tail);
}

function assertPlanOutput(target, output) {
  const out = path.resolve(output);
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: target, encoding: 'utf8', shell: false });
  const boundaries = [target, ...(common.status === 0 ? [path.dirname(common.stdout.trim())] : [])];
  for (const boundary of boundaries) {
    const relative = path.relative(canonicalPath(boundary), canonicalPath(out));
    if (!relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
      throw new Error('Save frozen plans outside the project (container tmp)');
    }
  }
  // Reuse the managed-file symlink rules, including the standard macOS aliases.
  safePath(path.dirname(out), path.basename(out));
  return out;
}

module.exports = { assertMutationTarget, assertPlanOutput, canonicalPath };

const { spawnSync } = require('node:child_process');
const { safePath, parseJson } = require('./engine');

// An explicit, reviewed consumer commit is a migration trust decision, not
// evidence that the old files came from an authenticated upstream release.
function loadLegacyBaseline(target, ref, assets) {
  function git(args) {
    const result = spawnSync('git', args, { cwd: target, encoding: 'utf8', shell: false, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new Error('legacy baseline Git lookup failed; verify the explicit ref and manifest');
    return result.stdout;
  }
  const commit = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('invalid legacy baseline commit');
  const manifest = parseJson(git(['show', `${commit}:infra/templates/agent/template.manifest.json`]), 'legacy baseline manifest');
  if (manifest.template?.id !== 'xirang' || !Array.isArray(manifest.rules)) throw new Error('legacy baseline must contain a Xirang manifest');
  const rules = manifest.rules;
  const paths = new Set();
  for (const rule of rules) {
    if (!rule || typeof rule.strategy !== 'string' || typeof rule.path !== 'string' || !rule.path
      || rule.path.includes('\\') || rule.path.includes('\0') || rule.path.startsWith('/') || /^[A-Za-z]:/.test(rule.path)
      || rule.path.split('/').some(p => !p || p === '.' || p === '..') || paths.has(rule.path)) throw new Error('invalid or duplicate legacy baseline rule');
    paths.add(rule.path);
  }
  const files = Object.create(null);
  for (const asset of assets) {
    if (asset.strategy !== 'overwrite') continue;
    const effective = rules.filter(rule => asset.path === rule.path || asset.path.startsWith(rule.path + '/')).sort((a, b) => b.path.length - a.path.length)[0];
    if (effective?.strategy !== 'overwrite') continue;
    safePath(target, asset.path);
    const entry = git(['ls-tree', '-z', commit, '--', `:(literal)${asset.path}`]);
    const match = /^(100644|100755) blob ([a-f0-9]+)\t([^\0]+)\0$/.exec(entry);
    if (!match || match[3] !== asset.path) continue;
    files[asset.path] = git(['cat-file', 'blob', match[2]]);
  }
  return { commit, files };
}
module.exports = { loadLegacyBaseline };

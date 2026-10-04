const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getMainRepoRoot } = require('../shared/config');
function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw Error(`Version gate git ${args[0]} failed`);
  return result.stdout.trim();
}
function nextVersion(base, current) {
  const parse = value => {
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw Error('Invalid source release version');
    const parts = value.split('.').map(Number);
    if (parts.some(x => !Number.isSafeInteger(x))) throw Error('Unsafe source release version');
    return parts;
  };
  const before = parse(base), after = parse(current);
  const index = before.findIndex((value, i) => value !== after[i]);
  if (index !== -1) {
    if (after[index] < before[index]) throw Error('Source release version regression');
    return current;
  }
  if (!Number.isSafeInteger(after[2] + 1)) throw Error('Unsafe source release version increment');
  return `${after[0]}.${after[1]}.${after[2] + 1}`;
}
// Move [Unreleased] entries under the release heading so published versions never accumulate unlabeled notes.
function releaseChangelog(text, version, date) {
  const marker = '## [Unreleased]\n';
  const start = text.indexOf(marker);
  if (start === -1) return text;
  const bodyStart = start + marker.length;
  const next = text.indexOf('\n## [', bodyStart - 1);
  const bodyEnd = next === -1 ? text.length : next + 1;
  const body = text.slice(bodyStart, bodyEnd).trim();
  if (!body) return text;
  const heading = `## [v${version}]`;
  const rest = text.slice(bodyEnd);
  const prefix = text.slice(0, bodyStart) + '\n';
  if (rest.startsWith(heading)) {
    const lineEnd = rest.indexOf('\n');
    const headingLine = lineEnd === -1 ? rest : rest.slice(0, lineEnd);
    return `${prefix}${headingLine}\n\n${body}\n${rest.slice(headingLine.length).replace(/^\n+/, '')}`;
  }
  return `${prefix}${heading} - ${date}\n\n${body}\n${rest ? '\n' + rest : ''}`;
}
function localDate() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((x, i) => String(x).padStart(i ? 2 : 4, '0')).join('-');
}
function syncSourceVersions({ repoRoot, config, fetchBase, today = localDate() } = {}) {
  if (config?.template?.role !== 'source') return { status: 'SKIPPED' };
  const origin = git(repoRoot, ['remote', 'get-url', 'origin']);
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:)hollisyao2024\/PromptsEngineering(?:\.git)?$/.test(origin)) return { status: 'SKIPPED' };
  if (path.resolve(repoRoot) === path.resolve(getMainRepoRoot(repoRoot))) throw Error('Source version publishing requires a linked worktree');
  const baseBranch = config.baseBranch || 'main';
  if (fetchBase) fetchBase();
  else {
    const result = spawnSync(process.execPath, [path.join(repoRoot, 'infra/scripts/shared/github-auth-run.js'), '--', 'git', 'fetch', 'origin', baseBranch], { cwd: repoRoot, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw Error('Source version required fetch failed');
  }
  const baseSha = git(repoRoot, ['rev-parse', '--verify', `refs/remotes/origin/${baseBranch}^{commit}`]);
  const files = [...new Set([
    ...git(repoRoot, ['diff', '--name-only', `${baseSha}...HEAD`]).split('\n'),
    ...git(repoRoot, ['diff', '--name-only', 'HEAD']).split('\n'),
    ...git(repoRoot, ['ls-files', '--others', '--exclude-standard']).split('\n'),
  ].filter(Boolean))];
  if (!files.length) return { status: 'UNCHANGED', baseSha };
  const read = name => JSON.parse(fs.readFileSync(path.join(repoRoot, name), 'utf8'));
  const previous = name => JSON.parse(git(repoRoot, ['show', `${baseSha}:${name}`]));
  const pkg = read('package.json'), agent = read('agent/manifest.json'), apply = read('infra/templates/agent/template.manifest.json');
  const version = nextVersion(previous('package.json').version, pkg.version);
  pkg.version = version; agent.version = version; apply.templateVersion = version;
  const updates = [['package.json', pkg], ['agent/manifest.json', agent], ['infra/templates/agent/template.manifest.json', apply]];
  let architectureVersion;
  if (files.some(name => name.startsWith('architecture/'))) {
    const manifest = read('architecture/manifest.json');
    architectureVersion = nextVersion(previous('architecture/manifest.json').version, manifest.version);
    manifest.version = architectureVersion; updates.push(['architecture/manifest.json', manifest]);
  }
  const changelog = path.join(repoRoot, 'CHANGELOG.md');
  if (fs.existsSync(changelog)) updates.push(['CHANGELOG.md', releaseChangelog(fs.readFileSync(changelog, 'utf8'), version, today)]);
  // Parse and validate every version before any file write; reruns converge on the same fetched baseline.
  const changed = [];
  for (const [name, value] of updates) {
    const file = path.join(repoRoot, name), content = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
    if (fs.readFileSync(file, 'utf8') === content) continue;
    fs.writeFileSync(file + '.version-sync-tmp', content, { flag: 'wx' });
    fs.renameSync(file + '.version-sync-tmp', file); changed.push(name);
  }
  return { status: 'OK', version, architectureVersion, baseSha, changed };
}
module.exports = { syncSourceVersions, nextVersion, releaseChangelog };

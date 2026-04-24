#!/usr/bin/env node
/**
 * Apply or update this agent template in a target project.
 *
 * Default mode is dry-run. Use --write to modify the target.
 * Project-owned files are never overwritten.
 */

const fs = require('fs');
const path = require('path');

const SKIP_NAMES = new Set(['.git', 'node_modules', '.DS_Store']);
const DEFAULT_MANIFEST = 'infra/templates/agent/template.manifest.json';
const LEGACY_MANIFEST = 'agent.template.manifest.json';

function parseArgs(argv) {
  const args = { include: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq !== -1) {
      const key = raw.slice(2, eq);
      const value = raw.slice(eq + 1);
      if (key === 'include') args.include.push(...value.split(',').filter(Boolean));
      else args[key] = value;
      continue;
    }
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      if (key === 'include') args.include.push(...next.split(',').filter(Boolean));
      else args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function firstExistingPath(paths) {
  return paths.find((filePath) => fs.existsSync(filePath)) || paths[0];
}

function ensureDir(dirPath, write) {
  if (write) fs.mkdirSync(dirPath, { recursive: true });
}

function pathExists(filePath) {
  return fs.existsSync(filePath);
}

function isDirectory(filePath) {
  return pathExists(filePath) && fs.statSync(filePath).isDirectory();
}

function listFiles(root) {
  if (!pathExists(root)) return [];
  if (!isDirectory(root)) return [root];
  const output = [];
  for (const name of fs.readdirSync(root)) {
    if (SKIP_NAMES.has(name)) continue;
    output.push(...listFiles(path.join(root, name)));
  }
  return output;
}

function copyFile(sourcePath, targetPath, write) {
  const sourceContent = fs.readFileSync(sourcePath);
  const exists = pathExists(targetPath);
  const same = exists && Buffer.compare(sourceContent, fs.readFileSync(targetPath)) === 0;
  if (same) return 'unchanged';
  if (write) {
    ensureDir(path.dirname(targetPath), true);
    fs.copyFileSync(sourcePath, targetPath);
  }
  return exists ? 'updated' : 'created';
}

function copyPath(sourceRoot, targetRoot, rule, write) {
  const sourcePath = path.join(sourceRoot, rule.source || rule.path);
  const targetPath = path.join(targetRoot, rule.path);
  if (!pathExists(sourcePath)) return [{ status: 'blocked', path: rule.path, reason: 'source missing' }];

  const sourceFiles = listFiles(sourcePath);
  return sourceFiles.map((sourceFile) => {
    const relative = path.relative(sourcePath, sourceFile);
    const destination = isDirectory(sourcePath)
      ? path.join(targetPath, relative)
      : targetPath;
    return {
      status: copyFile(sourceFile, destination, write),
      path: path.relative(targetRoot, destination),
      strategy: rule.strategy,
    };
  });
}

function initIfMissing(sourceRoot, targetRoot, rule, write) {
  const targetPath = path.join(targetRoot, rule.path);
  if (pathExists(targetPath)) {
    return [{ status: 'skipped', path: rule.path, strategy: rule.strategy, reason: 'target exists' }];
  }
  return copyPath(sourceRoot, targetRoot, rule, write).map((item) => ({
    ...item,
    status: item.status === 'blocked' ? item.status : 'initialized',
  }));
}

function markerBlock(marker, content) {
  const body = content.endsWith('\n') ? content.trimEnd() : content;
  return `# >>> ${marker}\n${body}\n# <<< ${marker}\n`;
}

function appendBlock(sourceRoot, targetRoot, rule, write) {
  const sourcePath = path.join(sourceRoot, rule.source);
  const targetPath = path.join(targetRoot, rule.path);
  if (!pathExists(sourcePath)) {
    return [{ status: 'blocked', path: rule.path, strategy: rule.strategy, reason: 'source missing' }];
  }

  const marker = rule.marker || `agent-template:${rule.path}`;
  const block = markerBlock(marker, fs.readFileSync(sourcePath, 'utf8'));
  const current = pathExists(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  const start = `# >>> ${marker}`;
  const end = `# <<< ${marker}`;
  let next;
  let status;

  if (current.includes(start) && current.includes(end)) {
    const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`);
    next = current.replace(pattern, block);
    status = next === current ? 'unchanged' : 'updated';
  } else {
    const prefix = current && !current.endsWith('\n') ? `${current}\n\n` : current ? `${current}\n` : '';
    next = `${prefix}${block}`;
    status = pathExists(targetPath) ? 'updated' : 'created';
  }

  if (write && next !== current) {
    ensureDir(path.dirname(targetPath), true);
    fs.writeFileSync(targetPath, next);
  }
  return [{ status, path: rule.path, strategy: rule.strategy }];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mergePackageScripts(sourceRoot, targetRoot, rule, write) {
  const sourcePath = path.join(sourceRoot, rule.source);
  const targetPath = path.join(targetRoot, rule.path);
  if (!pathExists(targetPath)) {
    return [{ status: 'skipped', path: rule.path, strategy: rule.strategy, reason: 'package.json missing' }];
  }
  const pkg = readJson(targetPath);
  const manifest = readJson(sourcePath);
  const sourceScripts = manifest.scripts || {};
  const scripts = pkg.scripts || {};
  const added = [];
  const conflicts = [];
  const unchanged = [];

  for (const [name, command] of Object.entries(sourceScripts)) {
    if (!Object.prototype.hasOwnProperty.call(scripts, name)) {
      scripts[name] = command;
      added.push(name);
    } else if (scripts[name] === command) {
      unchanged.push(name);
    } else {
      conflicts.push(name);
    }
  }

  if (write && added.length > 0) {
    pkg.scripts = scripts;
    fs.writeFileSync(targetPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  return [{
    status: added.length > 0 ? 'merged' : 'unchanged',
    path: rule.path,
    strategy: rule.strategy,
    added,
    conflicts,
    unchanged,
  }];
}

function isTemplateOwnedJson(filePath) {
  if (!pathExists(filePath)) return false;
  try {
    const content = readJson(filePath);
    if (content._templateNotice || content._configNotice) return true;
    if (content.schemaVersion && Array.isArray(content.rules)) return true;
    if (content.scripts && content.scripts['agent:update-template']) return true;
    if (content.projectName === 'portable-agent-template' && content.containerDirs) return true;
  } catch (_error) {
    return false;
  }
  return false;
}

function removeIfTemplateOwned(_sourceRoot, targetRoot, rule, write) {
  const targetPath = path.join(targetRoot, rule.path);
  if (!pathExists(targetPath)) {
    return [{ status: 'skipped', path: rule.path, strategy: rule.strategy, reason: 'target missing' }];
  }
  if (!isTemplateOwnedJson(targetPath)) {
    return [{ status: 'skipped', path: rule.path, strategy: rule.strategy, reason: 'not template-owned' }];
  }
  if (write) fs.unlinkSync(targetPath);
  return [{ status: write ? 'removed' : 'would-remove', path: rule.path, strategy: rule.strategy, reason: rule.reason || 'template-owned legacy path' }];
}

function shouldApplyRule(rule, includeGroups) {
  if (rule.strategy !== 'opt-in') return true;
  return includeGroups.has(rule.group) || includeGroups.has('examples') || includeGroups.has('all');
}

function applyRule(sourceRoot, targetRoot, rule, write, includeGroups) {
  if (!shouldApplyRule(rule, includeGroups)) {
    return [{ status: 'skipped', path: rule.path, strategy: rule.strategy, reason: `opt-in:${rule.group}` }];
  }

  if (rule.strategy === 'overwrite') return copyPath(sourceRoot, targetRoot, rule, write);
  if (rule.strategy === 'init-if-missing') return initIfMissing(sourceRoot, targetRoot, rule, write);
  if (rule.strategy === 'append-block') return appendBlock(sourceRoot, targetRoot, rule, write);
  if (rule.strategy === 'merge-package-scripts') return mergePackageScripts(sourceRoot, targetRoot, rule, write);
  if (rule.strategy === 'remove-if-template-owned') return removeIfTemplateOwned(sourceRoot, targetRoot, rule, write);
  if (rule.strategy === 'project-owned') {
    return [{ status: 'skipped', path: rule.path, strategy: rule.strategy, reason: 'target-owned' }];
  }
  if (rule.strategy === 'generated') {
    return [{ status: 'skipped', path: rule.path, strategy: rule.strategy, reason: 'generated' }];
  }
  if (rule.strategy === 'exclude') {
    return [{ status: 'skipped', path: rule.path, strategy: rule.strategy, reason: rule.reason || 'excluded' }];
  }
  return [{ status: 'blocked', path: rule.path, strategy: rule.strategy, reason: 'unknown strategy' }];
}

function summarize(results) {
  const counts = {};
  for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1;
  return counts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceRoot = path.resolve(args.source || path.join(__dirname, '..', '..', '..'));
  const targetRoot = path.resolve(args.target || process.cwd());
  const manifestPath = args.manifest
    ? path.resolve(sourceRoot, args.manifest)
    : firstExistingPath([
      path.join(sourceRoot, DEFAULT_MANIFEST),
      path.join(sourceRoot, LEGACY_MANIFEST),
    ]);
  const write = Boolean(args.write);
  const includeGroups = new Set(args.include || []);

  if (!pathExists(manifestPath)) throw new Error(`manifest not found: ${manifestPath}`);
  const manifest = readJson(manifestPath);
  const results = [];

  for (const rule of manifest.rules || []) {
    results.push(...applyRule(sourceRoot, targetRoot, rule, write, includeGroups));
  }

  const counts = summarize(results);
  console.log(write ? 'STATUS=UPDATED' : 'STATUS=DRY_RUN');
  console.log(`SOURCE=${sourceRoot}`);
  console.log(`TARGET=${targetRoot}`);
  console.log(`MANIFEST=${manifestPath}`);
  console.log(`COUNTS=${JSON.stringify(counts)}`);
  console.log('DETAILS_START');
  for (const result of results) {
    const extras = [];
    if (result.reason) extras.push(`reason=${result.reason}`);
    if (result.added && result.added.length) extras.push(`added=${result.added.join(',')}`);
    if (result.conflicts && result.conflicts.length) extras.push(`conflicts=${result.conflicts.join(',')}`);
    console.log(`${result.status}\t${result.strategy || ''}\t${result.path}${extras.length ? `\t${extras.join('\t')}` : ''}`);
  }
  console.log('DETAILS_END');
  if (!write) console.log('NEXT_ACTION=rerun with --write to modify target project');
}

try {
  main();
} catch (error) {
  console.error('STATUS=BLOCKED');
  console.error(`REASON=${error.message}`);
  process.exit(1);
}

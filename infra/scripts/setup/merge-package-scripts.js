#!/usr/bin/env node
/**
 * Safely merge optional template scripts into a target package.json.
 *
 * Default mode is dry-run. Use --write to add missing scripts.
 * Existing scripts are never overwritten, except that exact template-owned
 * script paths renamed by the template are rewritten in place.
 */

const fs = require('fs');
const path = require('path');
const { resolveRepoRoot } = require('../shared/config');

const DEFAULT_SCRIPT_MANIFEST = 'infra/templates/agent/package-scripts.example.json';

// 模板自有脚本路径的更名表：只替换 scripts 值中独立出现的旧路径，
// 前缀须为开头/空白/引号（可带 ./），后缀须为结尾/空白/引号，避免误伤 vendor/ 副本或 .bak 文件。
const RENAMED_SCRIPT_PATHS = [
  ['infra/scripts/devops-tools/devops-run.js', 'infra/scripts/ops-tools/ops-run.js'],
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteRenamedPaths(command) {
  if (typeof command !== 'string') return { command, count: 0 };
  let count = 0;
  let next = command;
  for (const [legacy, current] of RENAMED_SCRIPT_PATHS) {
    const pattern = new RegExp(`(^|[\\s"'])(\\./)?${escapeRegExp(legacy)}(?=$|[\\s"'])`, 'g');
    next = next.replace(pattern, (match, lead, dot) => {
      count += 1;
      return `${lead}${dot || ''}${current}`;
    });
  }
  return { command: next, count };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq !== -1) {
      args[raw.slice(2, eq)] = raw.slice(eq + 1);
      continue;
    }
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
  const packagePath = path.resolve(process.cwd(), args.package || 'package.json');
  const manifestPath = args.manifest
    ? path.resolve(repoRoot, args.manifest)
    : path.join(repoRoot, DEFAULT_SCRIPT_MANIFEST);
  const write = Boolean(args.write);

  if (!fs.existsSync(packagePath)) {
    throw new Error(`package.json not found: ${packagePath}`);
  }
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`script manifest not found: ${manifestPath}`);
  }

  const pkg = readJson(packagePath);
  const manifest = readJson(manifestPath);
  const sourceScripts = manifest.scripts || {};
  const scripts = pkg.scripts || {};
  const added = [];
  const unchanged = [];
  const conflicts = [];
  const renamed = [];
  let renamedPathCount = 0;

  // 先重写已更名的模板路径，再与模板清单比较，避免旧路径被误判为冲突。
  for (const [name, command] of Object.entries(scripts)) {
    const rewrite = rewriteRenamedPaths(command);
    if (rewrite.count === 0) continue;
    scripts[name] = rewrite.command;
    renamed.push(name);
    renamedPathCount += rewrite.count;
  }

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

  if (write && (added.length > 0 || renamed.length > 0)) {
    pkg.scripts = scripts;
    fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
  }

  console.log(write ? 'STATUS=UPDATED' : 'STATUS=DRY_RUN');
  console.log(`PACKAGE_JSON=${packagePath}`);
  console.log(`MANIFEST=${manifestPath}`);
  console.log(`ADDED=${added.length ? added.join(',') : 'none'}`);
  console.log(`UNCHANGED=${unchanged.length ? unchanged.join(',') : 'none'}`);
  console.log(`CONFLICTS=${conflicts.length ? conflicts.join(',') : 'none'}`);
  console.log(`RENAMED_SCRIPT_PATHS=${renamedPathCount}`);
  console.log(`RENAMED_SCRIPTS=${renamed.length ? renamed.join(',') : 'none'}`);
  if (conflicts.length > 0) {
    console.log('CONFLICT_POLICY=existing scripts kept; template commands not installed for conflicts');
  }
  if (!write) {
    console.log('NEXT_ACTION=rerun with --write to add missing scripts and rewrite renamed template paths');
  }
}

try {
  main();
} catch (error) {
  console.error('STATUS=BLOCKED');
  console.error(`REASON=${error.message}`);
  process.exit(1);
}

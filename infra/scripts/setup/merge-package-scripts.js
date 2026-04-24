#!/usr/bin/env node
/**
 * Safely merge optional template scripts into a target package.json.
 *
 * Default mode is dry-run. Use --write to add missing scripts.
 * Existing scripts are never overwritten.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SCRIPT_MANIFEST = 'infra/templates/agent/package-scripts.example.json';

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
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
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
    fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
  }

  console.log(write ? 'STATUS=UPDATED' : 'STATUS=DRY_RUN');
  console.log(`PACKAGE_JSON=${packagePath}`);
  console.log(`MANIFEST=${manifestPath}`);
  console.log(`ADDED=${added.length ? added.join(',') : 'none'}`);
  console.log(`UNCHANGED=${unchanged.length ? unchanged.join(',') : 'none'}`);
  console.log(`CONFLICTS=${conflicts.length ? conflicts.join(',') : 'none'}`);
  if (conflicts.length > 0) {
    console.log('CONFLICT_POLICY=existing scripts kept; template commands not installed for conflicts');
  }
  if (!write) {
    console.log('NEXT_ACTION=rerun with --write to add missing scripts');
  }
}

try {
  main();
} catch (error) {
  console.error('STATUS=BLOCKED');
  console.error(`REASON=${error.message}`);
  process.exit(1);
}

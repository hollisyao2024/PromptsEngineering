#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadConfig, resolveRepoRoot } = require('../shared/config');

const DEFAULT_FILE_PATTERN = '^\\d{3}_[a-z0-9_]+\\.(?:[cm]?[jt]s)$';

function isSafeRepoRelative(value) {
  if (!value || path.isAbsolute(value)) return false;
  const normalized = path.normalize(value);
  return normalized !== '..' && !normalized.startsWith(`..${path.sep}`);
}

function stripComments(source) {
  let output = '';
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === '\n') {
        lineComment = false;
        output += current;
      }
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false;
        index += 1;
      } else if (current === '\n') {
        output += current;
      }
      continue;
    }
    if (quote) {
      output += current;
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === quote) quote = '';
      continue;
    }
    if (current === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === '"' || current === "'" || current === '`') quote = current;
    output += current;
  }
  return output;
}

function inspectMigrationRegistry({ migrationFiles, registryFile, registryContent }) {
  const orderedFiles = [...migrationFiles].sort((left, right) => left.localeCompare(right));
  const searchable = stripComments(registryContent);
  const positions = orderedFiles.map((file) => {
    const stem = path.basename(file, path.extname(file));
    return searchable.indexOf(stem);
  });
  const missing = orderedFiles.filter((_, index) => positions[index] === -1);
  if (missing.length > 0) {
    return [`${registryFile}: migration registry is missing: ${missing.join(', ')}`];
  }
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index] <= positions[index - 1]) {
      return [`${registryFile}: migration registry must follow migration filename order`];
    }
  }
  return [];
}

function resolveMigrationRegistryConfig(config = {}) {
  const migrationsDir = String(config.paths?.migrationsDir || '').trim();
  const registry = config.tdd?.migrationRegistry || {};
  const registryFile = String(registry.registryFile || '').trim();
  const filePattern = String(registry.filePattern || DEFAULT_FILE_PATTERN).trim();
  if (!registryFile) return null;
  if (!migrationsDir) {
    throw new Error('migration registry gate requires both paths.migrationsDir and tdd.migrationRegistry.registryFile');
  }
  if (!isSafeRepoRelative(migrationsDir) || !isSafeRepoRelative(registryFile)) {
    throw new Error('migration registry paths must be repository-relative and cannot traverse parents');
  }
  try {
    new RegExp(filePattern);
  } catch (error) {
    throw new Error(`invalid tdd.migrationRegistry.filePattern: ${error.message}`);
  }
  return { migrationsDir, registryFile, filePattern };
}

function main() {
  const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
  const config = loadConfig({ repoRoot });
  const registry = resolveMigrationRegistryConfig(config);
  if (!registry) {
    console.log('STATUS=SKIPPED');
    console.log('REASON=migration registry is not configured');
    return;
  }

  const migrationsDir = path.join(repoRoot, registry.migrationsDir);
  const registryPath = path.join(repoRoot, registry.registryFile);
  if (!fs.existsSync(migrationsDir) || !fs.statSync(migrationsDir).isDirectory()) {
    throw new Error(`configured migrations directory is missing: ${registry.migrationsDir}`);
  }
  if (!fs.existsSync(registryPath) || !fs.statSync(registryPath).isFile()) {
    throw new Error(`configured migration registry is missing: ${registry.registryFile}`);
  }

  const filenamePattern = new RegExp(registry.filePattern);
  const migrationFiles = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && filenamePattern.test(entry.name))
    .map((entry) => path.posix.join(registry.migrationsDir.split(path.sep).join('/'), entry.name));
  const errors = inspectMigrationRegistry({
    migrationFiles,
    registryFile: registry.registryFile,
    registryContent: fs.readFileSync(registryPath, 'utf8'),
  });
  if (errors.length > 0) {
    console.error('STATUS=BLOCKED');
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log('STATUS=OK');
  console.log(`MIGRATION_COUNT=${migrationFiles.length}`);
  console.log(`REGISTRY_FILE=${registry.registryFile}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('STATUS=BLOCKED');
    console.error(`REASON=${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_FILE_PATTERN,
  inspectMigrationRegistry,
  resolveMigrationRegistryConfig,
  stripComments,
};

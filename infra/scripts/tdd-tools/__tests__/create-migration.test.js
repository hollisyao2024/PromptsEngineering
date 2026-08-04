'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('create-migration normalizes dialect on the macOS Bash 3 runtime', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const script = path.join(repoRoot, 'infra/scripts/tdd-tools/create-migration.sh');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaolan-create-migration-'));

  try {
    const result = spawnSync('/bin/bash', [
      script,
      'portable_migration',
      '--dir',
      outputDir,
      '--dialect',
      'Postgres',
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const files = fs.readdirSync(outputDir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^\d{14}_portable_migration\.sql$/);
    assert.match(fs.readFileSync(path.join(outputDir, files[0]), 'utf8'), /数据库方言: postgres/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

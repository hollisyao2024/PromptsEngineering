'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('native Windows absolute output paths remain absolute in Bash', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-native-'));
  const script = path.resolve(__dirname, '../create-migration.sh');
  const bash = path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe');
  try {
    for (const [index, separator] of ['\\', '/'].entries()) {
      const output = path.join(root, `output space ${index}`);
      const argument = output.replace(/[\\/]/g, separator);
      const result = spawnSync(bash, [script, 'native_path', '--dir', argument], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(fs.existsSync(output), 'native absolute path must not be prefixed with the repository');
      assert.equal(fs.readdirSync(output).length, 1);
    }
    assert.deepEqual(fs.readdirSync(root).sort(), ['output space 0', 'output space 1']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('create-migration normalizes dialect with the platform Bash runtime', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const script = path.join(repoRoot, 'infra/scripts/tdd-tools/create-migration.sh');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaolan-create-migration-'));

  try {
    const bash = process.platform === 'win32'
      ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git', 'bin', 'bash.exe')
      : '/bin/bash';
    const bashOutputDir = process.platform === 'win32'
      ? outputDir.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
      : outputDir;
    const result = spawnSync(bash, [
      script,
      'portable_migration',
      '--dir',
      bashOutputDir,
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

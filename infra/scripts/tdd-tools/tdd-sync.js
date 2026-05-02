#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');

function parseScope(argv) {
  let scope = 'session';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project') {
      scope = 'project';
      continue;
    }
    if (arg === '--scope' && argv[i + 1]) {
      scope = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--scope=')) {
      scope = arg.split('=')[1];
    }
  }
  return scope === 'project' ? 'project' : 'session';
}

function runSchemaDocSyncCheck(argv) {
  const checkScript = path.join(__dirname, 'check-schema-doc-sync.js');
  const scriptArgs = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--skip-schema-doc-sync' || arg.startsWith('--skip-schema-doc-sync=')) {
      scriptArgs.push(arg);
      continue;
    }
    if (arg === '--base' && argv[i + 1]) {
      scriptArgs.push(arg, argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--base=') || arg === '--quiet') {
      scriptArgs.push(arg);
    }
  }
  const result = spawnSync('node', [checkScript, ...scriptArgs], {
    encoding: 'utf8',
    stdio: 'inherit',
  });
  return result.status === 0;
}

function main() {
  const argv = process.argv.slice(2);
  const scope = parseScope(argv);

  // Step 1.7：Schema-Doc Sync Gate（强制硬门禁，TDD-EXPERT.md §B.10）
  const schemaDocOk = runSchemaDocSyncCheck(argv);
  if (!schemaDocOk) {
    console.error('❌ /tdd sync 失败：Schema-Doc Sync Gate 未通过（详见上方提示）');
    process.exit(1);
  }

  const tickScript = path.join(__dirname, 'tdd-tick.js');
  const result = spawnSync('node', [tickScript, `--scope=${scope}`], {
    encoding: 'utf8',
    stdio: 'inherit'
  });

  if (result.error) {
    console.error(`❌ /tdd sync 失败: ${result.error.message}`);
    process.exit(1);
  }

  // tdd-tick 成功后自动生成 Codebase Map（非阻塞）
  if (result.status === 0) {
    const codemapScript = path.join(__dirname, 'generate-codemap.js');
    const codemapResult = spawnSync('node', [codemapScript, `--scope=${scope}`], {
      encoding: 'utf8',
      stdio: 'inherit'
    });
    if (codemapResult.status !== 0) {
      console.warn('⚠️  Codebase Map 生成失败（不影响 sync 结果）');
    }
  }

  process.exit(result.status || 0);
}

main();

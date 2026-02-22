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

function main() {
  const scope = parseScope(process.argv.slice(2));
  const tickScript = path.join(__dirname, 'tdd-tick.js');
  const result = spawnSync('node', [tickScript, `--scope=${scope}`], {
    encoding: 'utf8',
    stdio: 'inherit'
  });

  if (result.error) {
    console.error(`❌ /tdd sync 失败: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status || 0);
}

main();

#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

function translateArgs(argv) {
  const translated = ['--phase=tdd'];
  let isFix = false;
  const positional = [];
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--dry-run') {
      translated.push('--dry-run');
    } else if (arg === '--fix') {
      isFix = true;
    } else {
      positional.push(arg);
    }
  }
  const first = positional[0] || '';
  const second = positional[1] || '';
  if (first.toUpperCase().startsWith('TASK-')) {
    translated.push(`--task=${first.toUpperCase()}`);
    if (second) translated.push(`--desc=${second}`);
  } else {
    const desc = first || second;
    if (desc) translated.push(`--desc=${desc}`);
  }
  if (isFix) translated.push('--kind=fix');
  return translated;
}

const script = path.resolve(__dirname, '..', 'worktree-tools', 'worktree-new.js');
const result = spawnSync(process.execPath, [script, ...translateArgs(process.argv.slice(2))], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status || 0);

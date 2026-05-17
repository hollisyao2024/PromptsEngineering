#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

function translateArgs(argv) {
  const translated = ['--phase=tdd'];
  let isFix = false;
  const positional = [];
  const valueFlags = new Set(['--bootstrap', '--branch', '--desc', '--task', '--kind']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--dry-run') {
      translated.push('--dry-run');
    } else if (arg === '--skip-bootstrap' || arg.startsWith('--bootstrap=')) {
      translated.push(arg);
    } else if (valueFlags.has(arg) && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      translated.push(arg, argv[i + 1]);
      i += 1;
    } else if (arg === '--fix') {
      isFix = true;
    } else if (arg.startsWith('--')) {
      translated.push(arg);
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

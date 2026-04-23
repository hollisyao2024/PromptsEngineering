#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const script = path.resolve(__dirname, '..', 'worktree-tools', 'worktree-remove.js');
const result = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status || 0);

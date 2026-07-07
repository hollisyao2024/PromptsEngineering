'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chmodSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const {
  createWindowsCmdInvocation,
  resolvePnpmBin,
  resolvePnpmNearNodeRuntime,
} = require('../toolchain-env');

test('resolvePnpmBin prefers AGENT_PNPM_BIN when configured', () => {
  assert.equal(resolvePnpmBin('win32', { AGENT_PNPM_BIN: 'C:\\tools\\pnpm.cjs' }), 'C:\\tools\\pnpm.cjs');
});

test('resolvePnpmNearNodeRuntime prefers pnpm installed next to the active Node runtime', () => {
  const tmp = join(tmpdir(), `agent-toolchain-${process.pid}-${Date.now()}`);
  try {
    const bin = join(tmp, 'bin');
    mkdirSync(bin, { recursive: true });
    const node = join(bin, 'node');
    const pnpm = join(bin, 'pnpm');
    writeFileSync(node, '');
    writeFileSync(pnpm, '#!/usr/bin/env sh\n');
    chmodSync(pnpm, 0o755);

    assert.equal(resolvePnpmNearNodeRuntime('pnpm', node), pnpm);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('createWindowsCmdInvocation runs pnpm JS entry through current node runtime', () => {
  const invocation = createWindowsCmdInvocation(
    'C:\\tools\\pnpm.cjs',
    ['install'],
    { env: { PATH: 'C:\\Windows\\System32' } },
    'win32',
    { AGENT_PNPM_BIN: 'C:\\tools\\pnpm.cjs' }
  );

  assert.equal(invocation.bin, process.execPath);
  assert.deepEqual(invocation.args, ['C:\\tools\\pnpm.cjs', 'install']);
  assert.equal(invocation.options.windowsHide, true);
});

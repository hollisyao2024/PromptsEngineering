#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function createToolchainEnv(env = process.env, platform = process.platform) {
  return prependPath(env, resolveToolchainPathDirs(env, platform), platform);
}

function resolveToolchainPathDirs(env = process.env, platform = process.platform) {
  const dirs = [];
  const nodeDir = process.execPath ? path.dirname(process.execPath) : '';
  if (nodeDir) dirs.push(nodeDir);

  const pnpm = resolvePnpmBin(platform, env);
  if (path.isAbsolute(pnpm)) dirs.push(path.dirname(pnpm));

  return uniqueExistingDirs(dirs);
}

function resolvePnpmBin(platform = process.platform, env = process.env) {
  const configured = String(env.AGENT_PNPM_BIN || '').trim();
  if (configured) return configured;

  if (platform === 'win32') {
    const fromRuntimeJs = resolvePnpmJsNearNodeRuntime();
    if (fromRuntimeJs) return fromRuntimeJs;
  }

  const name = platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const fromRuntime = resolvePnpmNearNodeRuntime(name);
  if (fromRuntime) return fromRuntime;

  const pnpmHome = String(env.PNPM_HOME || '').trim();
  if (pnpmHome) {
    const candidate = path.join(pnpmHome, name);
    if (fs.existsSync(candidate)) return candidate;
  }

  return name;
}

function resolvePnpmNearNodeRuntime(name, execPath = process.execPath) {
  if (!execPath) return '';
  const nodeBin = path.dirname(execPath);
  const candidates = [
    path.join(nodeBin, name),
    path.resolve(nodeBin, '..', '..', 'bin', name),
    path.resolve(nodeBin, '..', name),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function resolvePnpmJsNearNodeRuntime() {
  if (!process.execPath) return '';
  const nodeBin = path.dirname(process.execPath);
  const candidates = [
    path.resolve(nodeBin, '..', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
    path.resolve(nodeBin, '..', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
    path.resolve(nodeBin, '..', '..', 'node', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
    path.resolve(nodeBin, '..', '..', 'node', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function prependPath(env = {}, dirs = [], platform = process.platform) {
  const next = { ...env };
  const key = Object.prototype.hasOwnProperty.call(next, 'Path') ? 'Path' : 'PATH';
  const current = next[key] || next.PATH || next.Path || '';
  const values = [
    ...dirs,
    ...String(current)
      .split(path.delimiter)
      .map((item) => item.trim())
      .filter(Boolean),
  ];
  const joined = uniquePathEntries(values).join(path.delimiter);
  next[key] = joined;
  if (platform === 'win32') {
    next.PATH = joined;
    next.Path = joined;
  }
  return next;
}

function createWindowsCmdInvocation(bin, args, options = {}, platform = process.platform, env = process.env) {
  const commandEnv = createToolchainEnv(options.env || env, platform);
  const commandOptions = { ...options, env: commandEnv };
  if (platform === 'win32' && /\.(cjs|mjs)$/i.test(bin)) {
    return {
      bin: process.execPath,
      args: [bin, ...args],
      options: { ...commandOptions, windowsHide: true },
    };
  }
  if (platform === 'win32' && /\.cmd$/i.test(bin)) {
    return {
      bin: createCmdCommandLine(bin, args),
      args: [],
      options: { ...commandOptions, shell: true, windowsHide: true },
    };
  }
  return { bin, args, options: commandOptions };
}

function createCmdCommandLine(bin, args = []) {
  return [quoteCmdArg(bin), ...args.map(quoteCmdArg)].join(' ');
}

function quoteCmdArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function uniqueExistingDirs(dirs) {
  return uniquePathEntries(dirs).filter((dir) => {
    try {
      return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

function uniquePathEntries(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const entry = String(value || '').trim();
    if (!entry) continue;
    const key = process.platform === 'win32' ? entry.toLowerCase() : entry;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

module.exports = {
  createCmdCommandLine,
  createToolchainEnv,
  createWindowsCmdInvocation,
  prependPath,
  quoteCmdArg,
  resolvePnpmBin,
  resolvePnpmNearNodeRuntime,
  resolvePnpmJsNearNodeRuntime,
  resolveToolchainPathDirs,
};

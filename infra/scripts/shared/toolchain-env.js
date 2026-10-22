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

function resolveBashBin(platform = process.platform, env = process.env, exists = fs.existsSync) {
  if (platform !== 'win32') return 'bash';

  const candidates = [
    String(env.BASH_PATH || '').trim(),
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ].filter(Boolean);

  return candidates.find((candidate) => exists(candidate)) || '';
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
  if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(bin)) {
    // cmd.exe 以“带引号的裸名”经 PATH 启动批处理时，把 %~dp0 算成当前目录而非脚本目录，
    // npm 全局 pnpm.cmd 因而去 <cwd>\node_modules\pnpm\bin\pnpm.mjs 找入口并失败。
    // 裸名先按子进程将看到的 PATH + PATHEXT 解析成绝对路径；找不到时保留原名，由 cmd.exe 报出原始错误。
    const resolved = /[\\/]/u.test(bin) ? bin : (resolveWindowsCommand(bin, options.cwd, commandEnv) || bin);
    return {
      bin: createCmdCommandLine(resolved, args),
      args: [],
      options: { ...commandOptions, shell: true, windowsHide: true },
    };
  }
  // Native executables (for example cargo.exe in the Windows GNU Tauri
  // runner) create a console unless this flag is also propagated.  The .cmd
  // branch above already hides its shell, but it does not cover cargo.exe.
  return {
    bin,
    args,
    options: platform === 'win32' ? { ...commandOptions, windowsHide: true } : commandOptions,
  };
}

// Windows 上 spawn(shell:false) 只补全 .com/.exe，Node 也拒绝直接启动 .cmd/.bat（EINVAL，CVE-2024-27980），
// 因此 `pnpm`、`npx` 这类批处理 shim 会报 ENOENT/EINVAL。按 PATH + PATHEXT 解析到批处理文件时，
// 改经 cmd.exe /d /s /c 启动并逐参数加引号；引号内仍会被 cmd 展开或截断的 " % ! 与换行直接拒绝，不尝试转义。
// 原生可执行文件和无法解析的命令原样返回，由 spawn 直接启动或报出原始错误。
function createWindowsSpawnInvocation(bin, args = [], options = {}, platform = process.platform) {
  if (platform !== 'win32') return { bin, args, options };
  const resolved = resolveWindowsCommand(bin, options.cwd, options.env || process.env);
  if (!/\.(?:cmd|bat)$/iu.test(resolved)) return { bin, args, options };
  const unsafe = [resolved, ...args].find((value) => /["%!\r\n]/u.test(String(value)));
  if (unsafe !== undefined) {
    throw new Error(`Windows batch runner argument cannot be passed safely through cmd.exe (contains ", %, ! or a line break): ${unsafe}`);
  }
  return {
    bin: createCmdCommandLine(resolved, args),
    args: [],
    options: { ...options, shell: true, windowsHide: true },
  };
}

// 与 cmd.exe 的查找顺序一致：逐个目录、按 PATHEXT 顺序补全扩展名；带路径的命令相对 cwd 解析。
// 不搜索当前目录，避免工作区内同名文件劫持 PATH 上的运行器。找不到时返回空串。
function resolveWindowsCommand(bin, cwd = process.cwd(), env = process.env) {
  const command = String(bin || '');
  if (!command) return '';
  const lookup = (name) => {
    const key = Object.keys(env).find((item) => item.toLowerCase() === name);
    return key ? String(env[key] || '') : '';
  };
  const extensions = (lookup('pathext') || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const names = extensions.includes(path.extname(command).toLowerCase())
    ? [command]
    : extensions.map((extension) => `${command}${extension}`);
  const directories = /[\\/]/u.test(command)
    ? [path.resolve(cwd || process.cwd())]
    : lookup('path').split(';').map((item) => item.trim().replace(/^"(.*)"$/u, '$1')).filter(Boolean);
  for (const directory of directories) {
    for (const name of names) {
      const candidate = path.resolve(directory, name);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // 候选不存在或不可访问：继续下一个。
      }
    }
  }
  return '';
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
  createWindowsSpawnInvocation,
  prependPath,
  quoteCmdArg,
  resolvePnpmBin,
  resolveBashBin,
  resolvePnpmNearNodeRuntime,
  resolvePnpmJsNearNodeRuntime,
  resolveToolchainPathDirs,
  resolveWindowsCommand,
};

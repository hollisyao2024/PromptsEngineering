'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

function parseLsofCwdOutput(output) {
  const records = [];
  let pid = 0;
  for (const line of String(output || '').split(/\r?\n/u)) {
    if (line.startsWith('p')) {
      pid = Number(line.slice(1)) || 0;
    } else if (pid && line.startsWith('n')) {
      records.push({ pid, path: line.slice(1), source: 'cwd' });
    }
  }
  return records;
}

function parseWindowsProcessOutput(output) {
  const text = String(output || '').trim();
  if (!text) return [];
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return [];
  }
  const rows = Array.isArray(payload) ? payload : [payload];
  return rows
    .map((row) => ({
      pid: Number(row && row.ProcessId) || 0,
      paths: [row && row.ExecutablePath, row && row.CommandLine].filter(
        (value) => typeof value === 'string' && value.trim(),
      ),
      source: 'process',
    }))
    .filter((row) => row.pid && row.paths.length > 0);
}

function comparable(value, platform = process.platform) {
  const normalized = String(value || '').replace(/[\\/]+/gu, path.sep);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isSameOrInside(targetPath, candidatePath, platform = process.platform) {
  const target = comparable(path.resolve(targetPath), platform);
  const candidate = comparable(path.resolve(candidatePath), platform);
  if (candidate === target) return true;
  return candidate.startsWith(`${target}${path.sep}`);
}

function textReferencesPath(text, targetPath, platform = process.platform) {
  const haystack = comparable(text, platform);
  const needle = comparable(targetPath, platform);
  let offset = haystack.indexOf(needle);
  while (offset !== -1) {
    const before = offset === 0 ? '' : haystack[offset - 1];
    const after = haystack[offset + needle.length] || '';
    const leftBoundary = !before || /[\s'"=]/u.test(before);
    const rightBoundary = !after || /[\s'"/\\]/u.test(after);
    if (leftBoundary && rightBoundary) return true;
    offset = haystack.indexOf(needle, offset + 1);
  }
  return false;
}

function findPathUsers(targetPath, records, options = {}) {
  const platform = options.platform || process.platform;
  const excluded = new Set((options.excludePids || []).map(Number));
  return (records || []).filter((record) => {
    if (!record || excluded.has(Number(record.pid))) return false;
    if (record.path) return isSameOrInside(targetPath, record.path, platform);
    return (record.paths || []).some((value) => textReferencesPath(value, targetPath, platform));
  });
}

function inspectWorktreeUsers(worktreePath, options = {}) {
  const platform = options.platform || process.platform;
  const spawn = options.spawnSync || spawnSync;
  const excludePids = [...(options.excludePids || []), process.pid];

  if (platform === 'win32') {
    const command = [
      'Get-CimInstance Win32_Process',
      'Select-Object ProcessId,ExecutablePath,CommandLine',
      'ConvertTo-Json -Compress',
    ].join(' | ');
    const result = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      return { supported: false, users: [], reason: result.error?.message || `powershell exit ${result.status}` };
    }
    return {
      supported: true,
      users: findPathUsers(worktreePath, parseWindowsProcessOutput(result.stdout), { platform, excludePids }),
    };
  }

  const result = spawn('lsof', ['-d', 'cwd', '-Fn'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.error || ![0, 1].includes(result.status)) {
    return { supported: false, users: [], reason: result.error?.message || `lsof exit ${result.status}` };
  }
  return {
    supported: true,
    users: findPathUsers(worktreePath, parseLsofCwdOutput(result.stdout), { platform, excludePids }),
  };
}

module.exports = {
  findPathUsers,
  inspectWorktreeUsers,
  parseLsofCwdOutput,
  parseWindowsProcessOutput,
};

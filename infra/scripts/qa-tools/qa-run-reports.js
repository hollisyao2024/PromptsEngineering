'use strict';

// qa run 的报告路径检查与读写：逐段 lstat 拒绝符号链接、拒绝已被 git 跟踪的路径，
// 运行前删除旧报告与旧结果，运行后以 O_NOFOLLOW 读取报告。只读文件系统与 git，不运行套件。

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { MAX_REPORT_BYTES, RESULTS_FILE } = require('./business-results');

const reportFile = (repoRoot, report) => path.join(repoRoot, ...report.split('/'));

function git(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });
  return { ok: !result.error && result.status === 0, status: result.status, stdout: result.stdout || '' };
}

// ---------------------------------------------------------------------------
// 报告路径
// ---------------------------------------------------------------------------

// 自仓库根逐段 lstat：任何一段是符号链接即拒绝；中间段必须是目录，最后一段必须是普通文件。
// 某段不存在则其后各段必然不存在，视为通过。
function inspectReportPath(repoRoot, report) {
  const segments = report.split('/');
  let current = repoRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const relative = segments.slice(0, index + 1).join('/');
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { problem: null, exists: false };
      return { problem: `无法检查 ${relative}：${error.code || error.message}`, exists: false };
    }
    if (stat.isSymbolicLink()) return { problem: `${relative} 是符号链接，报告路径中不允许出现符号链接`, exists: true };
    if (index < segments.length - 1) {
      if (!stat.isDirectory()) return { problem: `${relative} 不是目录`, exists: true };
    } else if (!stat.isFile()) {
      return { problem: `${relative} 不是普通文件`, exists: true };
    }
  }
  return { problem: null, exists: true };
}

// 运行前会删除旧报告：已被 git 跟踪（或其下有已跟踪文件）的路径不能碰；git 本身失败也按拒绝处理。
function trackedProblem(repoRoot, report) {
  const listed = git(repoRoot, ['--literal-pathspecs', 'ls-files', '-z', '--', report]);
  if (!listed.ok) {
    return `无法确认该路径是否已被 git 跟踪（git 退出码 ${listed.status ?? '-'}），为免覆盖受版本控制的文件已拒绝运行`;
  }
  if (listed.stdout !== '') {
    return '该路径已被 git 跟踪（或其下有已跟踪文件），运行前删除旧报告会破坏受版本控制的内容；请执行 git rm --cached 取消跟踪，并把报告路径加入 .gitignore';
  }
  return null;
}

// 返回 [{ suite, path, message }]，每个套件至多一项；只读，不删除任何文件。
function checkReportPaths({ repoRoot, suites }) {
  const problems = [];
  for (const suite of suites) {
    const message = inspectReportPath(repoRoot, suite.report).problem || trackedProblem(repoRoot, suite.report);
    if (message) problems.push({ suite: suite.name, path: suite.report, message });
  }
  return problems;
}

function removeReport(repoRoot, report) {
  fs.rmSync(reportFile(repoRoot, report), { force: true });
}

function removeResults(directory) {
  try {
    fs.rmSync(path.join(directory, RESULTS_FILE), { force: true });
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }
}

// 套件运行期间它可能改动了路径：读取前重新检查，并以 O_NOFOLLOW 打开。
// 返回 { bytes, problem }：报告不存在为 { bytes: null, problem: null }；读不了或不可信时给出 problem。
function readReport(repoRoot, report) {
  const inspected = inspectReportPath(repoRoot, report);
  if (inspected.problem) return { bytes: null, problem: inspected.problem };
  if (!inspected.exists) return { bytes: null, problem: null };

  let descriptor;
  try {
    descriptor = fs.openSync(reportFile(repoRoot, report), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { bytes: null, problem: null };
    return { bytes: null, problem: `无法读取 ${report}：${error.code || error.message}` };
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) return { bytes: null, problem: `${report} 不是普通文件` };
    // 多读一个字节，让解析器能识别超出上限的报告。
    const size = Math.min(stat.size, MAX_REPORT_BYTES + 1);
    const buffer = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const read = fs.readSync(descriptor, buffer, offset, size - offset, null);
      if (read === 0) break;
      offset += read;
    }
    return { bytes: buffer.subarray(0, offset), problem: null };
  } catch (error) {
    return { bytes: null, problem: `无法读取 ${report}：${error.code || error.message}` };
  } finally {
    fs.closeSync(descriptor);
  }
}

module.exports = { checkReportPaths, git, readReport, removeReport, removeResults };

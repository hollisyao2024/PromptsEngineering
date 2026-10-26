'use strict';

// 缺陷复现门禁（qa repro --bug <ID>，G7）：
// 在容器 tmp 建临时 detached worktree（base SHA），叠加 HEAD 相对 base 的测试文件改动并 bootstrap，
// 两侧各跑一次 qa.repro.command：绑定该 BUG 的用例须在 base 上失败、在 HEAD 上通过。
// 结论只以 JUnit 报告为准（退出码只记录）；结果绑定两个 SHA、测试文件摘要与命令，临时目录按精确路径清理。
// evaluateReproGate 供 qa verify 只读判定：本分支新增的 BUG 行缺少有效的复现 PASS 即阻断，不重跑测试。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { BUG_ID, DESIGN_FILE_NAME, QA_MODULES_DIR } = require('./business-spec-schema');
const { MAX_REPORT_BYTES, parseJunitReport } = require('./business-results-junit');
const { parseDesignDocument } = require('./qa-design-spec');
const { resolveIntegrityConfig, resolveRange } = require('./qa-integrity');
const { worktreeReceiptKey } = require('./qa-verification-state');

const CONFIG_KEYS = new Set(['enabled', 'command']);
const ARG_KEYS = Object.freeze(['bug', 'base']);
const RESULT_VERSION = 1;
const VERDICTS = Object.freeze(['PASS', 'PASS_WITH_RISK', 'FAIL']);
const OUTCOMES = Object.freeze(['passed', 'failed', 'error', 'skipped', 'missing']);
const CASE_STATUSES = Object.freeze(['passed', 'failed', 'error', 'skipped']);
const COMMAND_TIMEOUT_MS = 30 * 60 * 1000;
const LINE_LIMIT = 60;
const RUN_NAME = /^[a-z0-9-]+-(\d+)-(\d+)$/u;
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const DESIGN_PATH = new RegExp(`^${QA_MODULES_DIR}/[^/]+/${DESIGN_FILE_NAME.replace('.', '\\.')}$`, 'u');
const USAGE = '用法：pnpm agent -- qa repro --bug <BUG-ID> [--base <ref>]';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const flatten = (text) => String(text).replace(/\s+/gu, ' ').trim();
const compareCode = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const block = (code, subject, detail) => ({ code, subject, detail });
const risk = (code, detail) => ({ code, detail });

function reproError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

// 配置 fail-closed：只认 enabled（布尔）与 command（字符串），未知键与类型错误都在运行前抛错。
function resolveReproConfig(config) {
  const raw = config && config.qa && config.qa.repro;
  if (!isObject(raw)) {
    throw reproError('REPRO_CONFIG_INVALID', 'qa.repro 必须是对象（默认值见 infra/templates/agent/config.example.json）');
  }
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.has(key)) throw reproError('REPRO_CONFIG_INVALID', `qa.repro.${key} 不是可识别的键`);
  }
  if (typeof raw.enabled !== 'boolean') throw reproError('REPRO_CONFIG_INVALID', 'qa.repro.enabled 必须是布尔值');
  if (typeof raw.command !== 'string') throw reproError('REPRO_CONFIG_INVALID', 'qa.repro.command 必须是字符串');
  return { enabled: raw.enabled, command: raw.command.trim() };
}

function git(cwd, args, { allowFailure = false, buffer = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: buffer ? 'buffer' : 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    if (allowFailure) return null;
    const error = new Error(`git ${args.join(' ')} 失败：${String(result.stderr || (result.error && result.error.message) || '').trim()}`);
    error.code = 'REPRO_GIT_FAILED';
    throw error;
  }
  return result.stdout;
}

const nulFields = (text) => text.split('\0').filter((item) => item !== '');

// 指定提交中全部 TEST-DESIGN.md 的 BUG 行；同一 ID 出现多次时取路径序最先的一行。
function bugsAt(repoRoot, ref) {
  const files = nulFields(git(repoRoot, ['ls-tree', '-r', '-z', '--name-only', ref, '--', QA_MODULES_DIR]))
    .filter((file) => DESIGN_PATH.test(file))
    .sort(compareCode);
  const bugs = new Map();
  for (const file of files) {
    const doc = parseDesignDocument(git(repoRoot, ['show', `${ref}:${file}`]), { file });
    for (const bug of doc.bugs || []) if (!bugs.has(bug.id)) bugs.set(bug.id, { ...bug, file });
  }
  return bugs;
}

// base..HEAD 中命中 qa.integrity.testGlobs 的测试文件改动，附 HEAD 侧的 mode 与 blob。
// 删除记为 { status:'D', mode:null, blob:null }；按路径排序，摘要与叠加都以此为准。
function testChanges(repoRoot, baseSha, headSha, matchers) {
  const tokens = nulFields(git(repoRoot, ['diff', '--name-status', '-z', '--no-renames', baseSha, headSha]));
  const changed = [];
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const status = tokens[index][0];
    const file = tokens[index + 1];
    if (!['A', 'M', 'T', 'D'].includes(status)) {
      throw reproError('REPRO_DIFF_UNSUPPORTED', `无法处理 ${file} 的改动状态 ${tokens[index]}`);
    }
    if (matchers.some((matcher) => matcher.test(file))) changed.push({ status, file });
  }
  if (changed.length === 0) return [];
  const tree = new Map();
  for (const line of nulFields(git(repoRoot, ['ls-tree', '-r', '-z', headSha]))) {
    const tab = line.indexOf('\t');
    const [mode, , blob] = line.slice(0, tab).split(' ');
    tree.set(line.slice(tab + 1), { mode, blob });
  }
  return changed
    .map(({ status, file }) => {
      if (status === 'D') return { status, file, mode: null, blob: null };
      const entry = tree.get(file);
      if (!entry) throw reproError('REPRO_DIFF_UNSUPPORTED', `HEAD 中找不到测试文件 ${file}`);
      return { status, file, mode: entry.mode, blob: entry.blob };
    })
    .sort((left, right) => compareCode(left.file, right.file));
}

function testDigest(entries) {
  const hash = crypto.createHash('sha256');
  for (const entry of entries) hash.update(`${entry.file}\0${entry.mode || '-'}\0${entry.blob || '-'}\n`);
  return hash.digest('hex');
}

const isInside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

// 把 HEAD 的测试文件改动写进 base worktree；父目录经 realpath 复核，不经符号链接写出 worktree。
function overlayTests(repoRoot, worktree, entries) {
  for (const entry of entries) {
    const target = path.join(worktree, entry.file);
    if (!isInside(worktree, target)) throw reproError('REPRO_OVERLAY_INVALID', `测试文件路径越界：${entry.file}`);
    if (entry.mode === '160000') continue;
    if (entry.status !== 'D') fs.mkdirSync(path.dirname(target), { recursive: true });
    const parent = path.dirname(target);
    if (fs.existsSync(parent) && !isInside(worktree, fs.realpathSync(parent))) {
      throw reproError('REPRO_OVERLAY_INVALID', `测试文件目录经符号链接指向 worktree 之外：${entry.file}`);
    }
    fs.rmSync(target, { force: true });
    if (entry.status === 'D') continue;
    const content = git(repoRoot, ['cat-file', 'blob', entry.blob], { buffer: true });
    if (entry.mode === '120000') {
      fs.symlinkSync(content.toString('utf8'), target);
    } else {
      fs.writeFileSync(target, content);
      if (entry.mode === '100755') fs.chmodSync(target, 0o755);
    }
  }
}

// 用例名（仅 JUnit name）引用该 BUG 或其任一 TC 才算绑定；前后须是 ID 边界，避免 TC-USER-0201 误命中。
function bindingPattern(ids) {
  return new RegExp(`(?<![A-Z0-9-])(?:${ids.map(escapeRegExp).join('|')})(?![0-9])`, 'u');
}

// 单侧结论：有失败即 failed；否则有报错即 error；否则有跳过即 skipped；没有绑定用例为 missing。
function sideOutcome(cases) {
  if (cases.length === 0) return 'missing';
  const statuses = new Set(cases.map((item) => item.status));
  if (statuses.has('failed')) return 'failed';
  if (statuses.has('error')) return 'error';
  if (statuses.has('skipped')) return 'skipped';
  return 'passed';
}

// verdict 只由两侧结论决定，qa verify 用同一函数重算并与记录比对。
function judge(base, head) {
  if (head !== 'passed') return { verdict: 'FAIL', reason: 'REPRO_HEAD_NOT_PASSING', risks: [] };
  if (base === 'failed') return { verdict: 'PASS', reason: null, risks: [] };
  if (base === 'error') {
    return {
      verdict: 'PASS_WITH_RISK',
      reason: null,
      risks: [risk('REPRO_BASE_ERROR', 'base 侧绑定用例以报错（error）而非断言失败告终，复现可能来自环境或依赖差异')],
    };
  }
  if (base === 'passed') return { verdict: 'FAIL', reason: 'REPRO_BASE_PASSED', risks: [] };
  return { verdict: 'FAIL', reason: 'REPRO_BASE_MISSING', risks: [] };
}

function readBoundCases(report, pattern) {
  let stat;
  try {
    stat = fs.statSync(report);
  } catch {
    return { cases: [], detail: '命令未写出 $XIRANG_REPRO_REPORT 报告' };
  }
  if (!stat.isFile()) return { cases: [], detail: '$XIRANG_REPRO_REPORT 不是普通文件' };
  if (stat.size > MAX_REPORT_BYTES) return { cases: [], detail: `报告超过 ${MAX_REPORT_BYTES} 字节上限` };
  const parsed = parseJunitReport(fs.readFileSync(report), { maxBytes: MAX_REPORT_BYTES });
  if (!parsed.ok) return { cases: [], detail: flatten(parsed.message) };
  const cases = parsed.cases
    .filter((item) => pattern.test(String(item.name)))
    .map((item) => ({ name: String(item.name), classname: String(item.classname || ''), status: item.status }));
  return { cases, detail: cases.length === 0 ? '报告中没有用例名引用该 BUG 或其 TC' : '' };
}

// 子进程 stdout 转到 stderr，保持本命令 stdout 只有 KEY=VALUE 行。
function runSide({ side, cwd, command, bug, report, pattern }) {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    stdio: ['ignore', 2, 2],
    timeout: COMMAND_TIMEOUT_MS,
    env: {
      ...process.env,
      XIRANG_REPRO_BUG: bug.id,
      XIRANG_REPRO_TCS: bug.tcs.join(','),
      XIRANG_REPRO_PATTERN: [bug.id, ...bug.tcs].map(escapeRegExp).join('|'),
      XIRANG_REPRO_REPORT: report,
      XIRANG_REPRO_SIDE: side,
    },
  });
  const read = readBoundCases(report, pattern);
  return {
    outcome: sideOutcome(read.cases),
    cases: read.cases,
    exit_code: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal || null,
    detail: result.error ? flatten(result.error.message) : read.detail,
  };
}

function reproDirectory(config, mainRoot, repoRoot) {
  const { resolveContainerPath } = require('../shared/config');
  let real;
  try {
    real = fs.realpathSync(repoRoot);
  } catch {
    real = path.resolve(repoRoot);
  }
  return path.join(resolveContainerPath(config, mainRoot, 'tmp'), 'qa-repro', worktreeReceiptKey(real));
}

const resultFile = (directory, bugId) => path.join(directory, `${bugId}.json`);

function writeResult(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

// runs 根目录必须是容器 tmp 下的真实目录：mkdir 后经 realpath 复核，任何符号链接改道都阻断。
function prepareRunsRoot(tmpRoot) {
  const runsRoot = path.join(tmpRoot, 'qa-repro', 'runs');
  fs.mkdirSync(runsRoot, { recursive: true });
  const expected = path.join(fs.realpathSync(tmpRoot), 'qa-repro', 'runs');
  if (fs.realpathSync(runsRoot) !== expected) {
    throw reproError('REPRO_RUNS_ROOT_INVALID', `临时运行目录 ${runsRoot} 经符号链接指向 ${fs.realpathSync(runsRoot)}`);
  }
  return expected;
}

function worktreePaths(repoRoot) {
  return git(repoRoot, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

// 只删除 runsRoot 的直接子目录：先登记删除 worktree，再删目录并 prune，最后复核目录与登记都已消失。
function removeRun(repoRoot, runsRoot, runDir) {
  if (path.dirname(runDir) !== runsRoot) throw reproError('REPRO_CLEANUP_FAILED', `拒绝清理 runs 根目录之外的路径：${runDir}`);
  const worktree = path.join(runDir, 'wt');
  let stat = null;
  try {
    stat = fs.lstatSync(runDir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
    throw reproError('REPRO_CLEANUP_FAILED', `临时运行目录不是真实目录，拒绝清理：${runDir}`);
  }
  if (stat) {
    git(repoRoot, ['worktree', 'remove', '--force', worktree], { allowFailure: true });
    fs.rmSync(runDir, { recursive: true, force: true });
  }
  git(repoRoot, ['worktree', 'prune'], { allowFailure: true });
  if (fs.existsSync(runDir)) throw reproError('REPRO_CLEANUP_FAILED', `临时运行目录仍存在：${runDir}`);
  if (worktreePaths(repoRoot).includes(worktree)) throw reproError('REPRO_CLEANUP_FAILED', `临时 worktree 仍在登记中：${worktree}`);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

// 启动清扫：只回收命名合规、且 owner 进程确认已不存在（ESRCH）的残留运行目录；失败不阻断本次运行。
function sweepStaleRuns(repoRoot, runsRoot) {
  for (const name of fs.readdirSync(runsRoot)) {
    const match = RUN_NAME.exec(name);
    if (!match || pidAlive(Number(match[1]))) continue;
    try {
      removeRun(repoRoot, runsRoot, path.join(runsRoot, name));
    } catch (error) {
      process.stderr.write(`[qa repro] 残留运行目录清理失败，保留：${path.join(runsRoot, name)}（${error.message}）\n`);
    }
  }
}

function bootstrapWorktree({ worktree, config, mainRoot }) {
  const { runWorktreeBootstrap } = require('../worktree-tools/worktree-core');
  try {
    runWorktreeBootstrap({ worktreePath: worktree, config, cli: { bootstrap: 'auto' }, mainRoot, defaultMode: 'auto', allowDirty: true });
  } catch (error) {
    if (!error.bootstrapStatus) throw error;
    throw reproError('REPRO_BOOTSTRAP_FAILED', `临时 worktree 依赖准备失败：${error.message}`, {
      status: error.bootstrapStatus === 'FAILED' ? 'FAILED' : 'BLOCKED',
    });
  }
}

// 执行一次复现：返回 { record, file, cleanup }；中途抛错时 error.cleanup 记录清理结果。
function runRepro({ repoRoot, config, mainRoot, repro, bug, baseSha, headSha, matchers }) {
  const { resolveContainerPath } = require('../shared/config');
  const runsRoot = prepareRunsRoot(resolveContainerPath(config, mainRoot, 'tmp'));
  sweepStaleRuns(repoRoot, runsRoot);
  const entries = testChanges(repoRoot, baseSha, headSha, matchers);
  const digest = testDigest(entries);
  const runDir = path.join(runsRoot, `${bug.id.toLowerCase()}-${process.pid}-${Date.now()}`);
  const worktree = path.join(runDir, 'wt');
  const pattern = bindingPattern([bug.id, ...bug.tcs]);

  let outcome = null;
  let failure = null;
  fs.mkdirSync(runDir);
  try {
    git(repoRoot, ['worktree', 'add', '--detach', worktree, baseSha]);
    overlayTests(repoRoot, worktree, entries);
    bootstrapWorktree({ worktree, config, mainRoot });
    const shared = { command: repro.command, bug, pattern };
    const head = runSide({ ...shared, side: 'head', cwd: repoRoot, report: path.join(runDir, 'head.xml') });
    const base = runSide({ ...shared, side: 'base', cwd: worktree, report: path.join(runDir, 'base.xml') });
    const current = git(repoRoot, ['rev-parse', 'HEAD']).trim();
    if (current !== headSha) throw reproError('REPRO_HEAD_MOVED', `复现期间 HEAD 由 ${headSha} 变为 ${current}`);
    const judged = judge(base.outcome, head.outcome);
    const record = {
      version: RESULT_VERSION,
      bug: bug.id,
      file: bug.file,
      tcs: [...bug.tcs],
      base_sha: baseSha,
      head_sha: headSha,
      test_digest: digest,
      command: repro.command,
      generated_at: new Date().toISOString(),
      base,
      head,
      verdict: judged.verdict,
      reason: judged.reason,
      risks: judged.risks,
    };
    const file = resultFile(reproDirectory(config, mainRoot, repoRoot), bug.id);
    writeResult(file, record);
    outcome = { record, file };
  } catch (error) {
    failure = error;
  }

  let cleanup = { status: 'DONE', path: runDir, detail: '' };
  try {
    removeRun(repoRoot, runsRoot, runDir);
  } catch (error) {
    cleanup = { status: 'FAILED', path: runDir, detail: error.message };
  }
  if (failure) {
    failure.cleanup = cleanup;
    throw failure;
  }
  return { ...outcome, cleanup };
}

function cleanupLines(cleanup) {
  if (!cleanup) return [];
  return cleanup.status === 'DONE' ? ['REPRO_CLEANUP=DONE'] : ['REPRO_CLEANUP=FAILED', `REPRO_CLEANUP_PATH=${cleanup.path}`];
}

function sameList(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((item, index) => item === right[index]);
}

function sideShapeError(side, name, pattern) {
  if (!isObject(side)) return `${name} 段缺失`;
  if (!OUTCOMES.includes(side.outcome)) return `${name}.outcome 无效`;
  if (!Array.isArray(side.cases)) return `${name}.cases 须为数组`;
  for (const item of side.cases) {
    if (!isObject(item) || typeof item.name !== 'string' || typeof item.classname !== 'string' || !CASE_STATUSES.includes(item.status)) {
      return `${name}.cases 含无效用例`;
    }
    if (!pattern.test(item.name)) return `${name}.cases 含未绑定该 BUG 的用例 ${JSON.stringify(item.name)}`;
  }
  if (sideOutcome(side.cases) !== side.outcome) return `${name}.outcome 与用例状态不符`;
  if (side.exit_code !== null && !Number.isInteger(side.exit_code)) return `${name}.exit_code 无效`;
  return null;
}

function recordShapeError(record, bug) {
  if (!isObject(record)) return '结果不是对象';
  if (record.version !== RESULT_VERSION) return `version 须为 ${RESULT_VERSION}`;
  if (record.bug !== bug.id) return `bug 为 ${JSON.stringify(record.bug)}，与 ${bug.id} 不符`;
  if (!Array.isArray(record.tcs) || record.tcs.length === 0 || !record.tcs.every((item) => typeof item === 'string')) return 'tcs 无效';
  if (!SHA.test(String(record.base_sha)) || !SHA.test(String(record.head_sha))) return 'base_sha/head_sha 无效';
  if (!DIGEST.test(String(record.test_digest))) return 'test_digest 无效';
  if (typeof record.command !== 'string' || typeof record.generated_at !== 'string') return 'command/generated_at 无效';
  if (!VERDICTS.includes(record.verdict)) return 'verdict 无效';
  const pattern = bindingPattern([record.bug, ...record.tcs]);
  const side = sideShapeError(record.base, 'base', pattern) || sideShapeError(record.head, 'head', pattern);
  if (side) return side;
  const judged = judge(record.base.outcome, record.head.outcome);
  if (judged.verdict !== record.verdict || judged.reason !== (record.reason === undefined ? null : record.reason)) {
    return `verdict=${record.verdict} 与两侧结论（base=${record.base.outcome}，head=${record.head.outcome}）不符`;
  }
  return null;
}

// 逐条复核结果文件：缺失 → MISSING；结构或结论不可信 → INVALID；绑定的提交、摘要、TC 或命令变化 → STALE；
// 结论为 FAIL → FAILED；PASS_WITH_RISK 计为通过并披露风险。
function checkRecord({ directory, bug, baseSha, headSha, digest, command }) {
  const file = resultFile(directory, bug.id);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { block: block('REPRO_MISSING', bug.id, `没有复现结果，执行 pnpm agent -- qa repro --bug ${bug.id}`) };
    return { block: block('REPRO_INVALID', bug.id, `无法读取复现结果 ${file}：${error.message}`) };
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch (error) {
    return { block: block('REPRO_INVALID', bug.id, `复现结果无法解析为 JSON：${error.message}`) };
  }
  const shape = recordShapeError(record, bug);
  if (shape) return { block: block('REPRO_INVALID', bug.id, `复现结果不可信：${shape}`) };

  const stale = [];
  if (record.base_sha !== baseSha) stale.push(`base_sha ${record.base_sha.slice(0, 12)} ≠ ${baseSha.slice(0, 12)}`);
  if (record.head_sha !== headSha) stale.push(`head_sha ${record.head_sha.slice(0, 12)} ≠ ${headSha.slice(0, 12)}`);
  if (record.test_digest !== digest) stale.push('测试文件摘要已变化');
  if (!sameList(record.tcs, bug.tcs)) stale.push(`TC ${record.tcs.join(',')} ≠ ${bug.tcs.join(',')}`);
  if (record.command !== command) stale.push('qa.repro.command 已变化');
  if (stale.length > 0) {
    return { block: block('REPRO_STALE', bug.id, `复现结果已过期（${stale.join('；')}），重跑 pnpm agent -- qa repro --bug ${bug.id}`) };
  }
  if (record.verdict === 'FAIL') {
    return { block: block('REPRO_FAILED', bug.id, `复现未通过（${record.reason}：base=${record.base.outcome}，head=${record.head.outcome}）`) };
  }
  return { risks: judge(record.base.outcome, record.head.outcome).risks.map((item) => risk(item.code, `${bug.id}：${item.detail}`)) };
}

// qa verify 与 qa repro 共用的门禁求值：只读 HEAD/base 的 TEST-DESIGN 与复现结果文件。
function evaluateReproGate({ repoRoot, config, mainRoot, baseSha, headSha }) {
  const repro = resolveReproConfig(config);
  const baseBugs = bugsAt(repoRoot, baseSha);
  const added = [...bugsAt(repoRoot, headSha).values()]
    .filter((bug) => !baseBugs.has(bug.id))
    .sort((left, right) => compareCode(left.id, right.id));
  const total = added.length;
  const newDefects = added.filter((bug) => /^qa-/u.test(String(bug.origin))).length;
  const blocks = [];
  const risks = [];
  const finish = (status, passed) => ({ status, blocks, risks, defectRepro: { passed, total }, newDefects });

  if (!repro.enabled) {
    if (total > 0) risks.push(risk('REPRO_DISABLED', `qa.repro.enabled=false，本分支新增的 ${total} 条 BUG 行未经复现`));
    return finish('SKIPPED', 0);
  }
  if (total === 0) return finish('PASS', 0);
  if (!repro.command) {
    blocks.push(block('REPRO_COMMAND_MISSING', 'qa.repro.command', `本分支新增 ${total} 条 BUG 行，但未配置 qa.repro.command`));
    return finish('BLOCKED', 0);
  }

  const digest = testDigest(testChanges(repoRoot, baseSha, headSha, resolveIntegrityConfig(config).testMatchers));
  const directory = reproDirectory(config, mainRoot, repoRoot);
  let passed = 0;
  for (const bug of added) {
    if (bug.tcs.length === 0) {
      blocks.push(block('REPRO_MISSING', bug.id, 'BUG 行未列出 TC，无法复现'));
      continue;
    }
    const checked = checkRecord({ directory, bug, baseSha, headSha, digest, command: repro.command });
    if (checked.block) {
      blocks.push(checked.block);
    } else {
      passed += 1;
      risks.push(...checked.risks);
    }
  }
  return finish(blocks.length > 0 ? 'BLOCKED' : risks.length > 0 ? 'PASS_WITH_RISK' : 'PASS', passed);
}

function limitedLines(prefix, items, withSubject) {
  const lines = items.slice(0, LINE_LIMIT).map((item) => (withSubject
    ? `${prefix}=${item.code}|${item.subject}|${flatten(item.detail)}`
    : `${prefix}=${item.code}|${flatten(item.detail)}`));
  if (items.length > LINE_LIMIT) lines.push(`${prefix}_TRUNCATED=${items.length - LINE_LIMIT}`);
  return lines;
}

function reproLines(result) {
  return [
    `REPRO_GATE=${result.status}`,
    `DEFECT_REPRO=${result.defectRepro.passed}/${result.defectRepro.total}`,
    `NEW_DEFECTS=${result.newDefects}`,
    ...limitedLines('REPRO_BLOCK', result.blocks, true),
    ...limitedLines('REPRO_RISK', result.risks, false),
  ];
}

function parseCliArgs(argv) {
  const values = Object.fromEntries(ARG_KEYS.map((key) => [key, null]));
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw reproError('REPRO_INVALID_INPUT', `不支持的位置参数：${token}。${USAGE}`);
    const eq = token.indexOf('=');
    const key = token.slice(2, eq < 0 ? undefined : eq);
    if (!ARG_KEYS.includes(key)) throw reproError('REPRO_INVALID_INPUT', `qa repro 不支持 --${key}。${USAGE}`);
    const value = eq < 0 ? argv[index + 1] : token.slice(eq + 1);
    if (eq < 0) index += 1;
    if (value === undefined || value === '' || value.startsWith('--')) throw reproError('REPRO_INVALID_INPUT', `--${key} 需要一个值`);
    if (values[key] !== null) throw reproError('REPRO_INVALID_INPUT', `--${key} 重复`);
    values[key] = value;
  }
  if (!values.bug) throw reproError('REPRO_INVALID_INPUT', `缺少 --bug。${USAGE}`);
  if (!BUG_ID.test(values.bug)) throw reproError('REPRO_INVALID_INPUT', `--bug ${JSON.stringify(values.bug)} 不是合法的 BUG ID`);
  return values;
}

const blocked = (reason, summary, nextAction) => ({ status: 'BLOCKED', reason, summary, nextAction });

function main(argv) {
  const { ensureContainerDirectories, getMainRepoRoot, loadConfig, resolveRepoRoot } = require('../shared/config');
  const args = parseCliArgs(argv);
  const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
  const config = loadConfig({ repoRoot });
  const repro = resolveReproConfig(config);

  if (!repro.enabled) {
    return blocked('REPRO_DISABLED', 'qa.repro.enabled=false，未执行缺陷复现', '在 agent.config.json 开启 qa.repro.enabled 后重跑');
  }
  if (config.template && config.template.role === 'source') {
    console.log('REPRO_GATE=SKIPPED');
    return { status: 'OK', summary: '模板源不执行缺陷复现门禁', nextAction: '继续 TDD/QA 流程' };
  }
  if (!repro.command) {
    return blocked(
      'REPRO_COMMAND_MISSING',
      '未配置 qa.repro.command',
      '在 agent.config.json 配置 qa.repro.command：按 $XIRANG_REPRO_PATTERN 只跑绑定用例，并把 JUnit 报告写到 $XIRANG_REPRO_REPORT',
    );
  }
  const range = resolveRange(repoRoot, config, args.base);
  const bug = bugsAt(repoRoot, range.headSha).get(args.bug);
  if (!bug || bug.tcs.length === 0) {
    return blocked(
      'REPRO_BUG_UNKNOWN',
      bug ? `${args.bug} 未列出 TC` : `HEAD 的 TEST-DESIGN.md 中没有 ${args.bug}`,
      '先在 TEST-DESIGN.md 缺陷复现表登记该 BUG 及其 TC 并提交，再重跑 qa repro',
    );
  }
  if (git(repoRoot, ['status', '--porcelain', '--untracked-files=normal']).trim() !== '') {
    return blocked('REPRO_WORKTREE_DIRTY', '工作区有未提交改动，HEAD 侧结果无法绑定提交', '提交或移走改动后重跑 qa repro');
  }

  const matchers = resolveIntegrityConfig(config).testMatchers;
  const mainRoot = getMainRepoRoot(repoRoot);
  ensureContainerDirectories(config, mainRoot, ['tmp']);
  let run;
  try {
    run = runRepro({ repoRoot, config, mainRoot, repro, bug, baseSha: range.baseSha, headSha: range.headSha, matchers });
  } catch (error) {
    for (const line of cleanupLines(error.cleanup)) console.log(line);
    throw error;
  }

  const { record, file, cleanup } = run;
  console.log(`REPRO_BUG=${record.bug}`);
  console.log(`REPRO_BASE_SHA=${record.base_sha}`);
  console.log(`REPRO_HEAD_SHA=${record.head_sha}`);
  console.log(`REPRO_TEST_DIGEST=${record.test_digest}`);
  console.log(`REPRO_BASE=${record.base.outcome}`);
  console.log(`REPRO_HEAD=${record.head.outcome}`);
  console.log(`REPRO_VERDICT=${record.verdict}`);
  for (const line of limitedLines('REPRO_RISK', record.risks, false)) console.log(line);
  console.log(`REPRO_RESULT_FILE=${file}`);
  for (const line of cleanupLines(cleanup)) console.log(line);

  if (cleanup.status !== 'DONE') {
    return {
      status: 'FAILED',
      reason: 'REPRO_CLEANUP_FAILED',
      summary: `复现结论 ${record.verdict}，但临时目录清理失败：${cleanup.detail}`,
      nextAction: `核实 ${cleanup.path} 归属后手工执行 git worktree remove --force 与 git worktree prune`,
    };
  }
  if (record.verdict === 'FAIL') {
    const side = record.reason === 'REPRO_HEAD_NOT_PASSING' ? record.head : record.base;
    return blocked(
      record.reason,
      `${record.bug} 复现未通过：base=${record.base.outcome}，head=${record.head.outcome}${side.detail ? `（${side.detail}）` : ''}`,
      record.reason === 'REPRO_HEAD_NOT_PASSING'
        ? '修复实现或让绑定用例在 HEAD 上通过后重跑 qa repro'
        : '补强绑定用例，使其在缺陷版本（base）上以断言失败，再重跑 qa repro',
    );
  }
  return {
    status: 'OK',
    summary: record.verdict === 'PASS' ? `${record.bug} 复现通过：base 失败、HEAD 通过` : `${record.bug} 复现通过，附 ${record.risks.length} 项风险`,
    nextAction: record.verdict === 'PASS' ? '继续 TDD/QA 流程' : '在交付报告中披露 REPRO_RISK 行',
  };
}

if (require.main === module) {
  const { exitOnHelp } = require('../shared/cli-help');
  const { resultBlockLines, resultExitCode } = require('../shared/result-block');
  exitOnHelp([
    USAGE,
    '',
    '在容器 tmp 的临时 detached worktree（base SHA）上叠加 HEAD 的测试文件改动并 bootstrap，',
    '两侧各运行一次 qa.repro.command：绑定该 BUG 的用例须在 base 上失败、在 HEAD 上通过。',
    '命令可读取 XIRANG_REPRO_BUG / XIRANG_REPRO_TCS / XIRANG_REPRO_PATTERN / XIRANG_REPRO_SIDE，',
    '并须把 JUnit 报告写到 $XIRANG_REPRO_REPORT；结论只以报告为准。',
    '--base 缺省时取 origin/<baseBranch> 与 HEAD 的 merge-base。',
  ].join('\n'));
  let outcome;
  try {
    outcome = main(process.argv.slice(2));
  } catch (error) {
    outcome = {
      status: error.status || (/_GIT_FAILED$/u.test(error.code || '') ? 'FAILED' : 'BLOCKED'),
      reason: error.code || 'REPRO_INVALID_INPUT',
      summary: error.message,
      nextAction: '按 REASON 修复配置、参数或环境后重跑 pnpm agent -- qa repro --bug <BUG-ID>',
    };
  }
  for (const line of resultBlockLines(outcome)) console.log(line);
  process.exit(resultExitCode(outcome.status));
}

module.exports = {
  evaluateReproGate,
  judge,
  main,
  parseCliArgs,
  reproDirectory,
  reproLines,
  resolveReproConfig,
  runRepro,
  testChanges,
  testDigest,
};

#!/usr/bin/env node
'use strict';

// qa mutate（G5 变异门禁）：只对 base..HEAD 的变更源码运行项目配置的变异命令，
// 解析 Stryker mutation-testing-report-schema 报告并判定“测试能否抓错”。
// - 分数 = (Killed+Timeout) / (总数 − CompileError − RuntimeError − Ignored − 已豁免)，低于 minScore 阻断；
// - requireAcKill：绑定 P0 规则/AC 的测试至少杀死一个变异体；
// - 结果绑定 HEAD、base、配置摘要、变更文件摘要与报告副本 sha256，任何漂移都要求重跑；
// - 等价变异体经 `qa mutate accept` 生成证据行，写入任务 checkpoint 后豁免，源码 blob 变化即失效。
// qa verify 只调用 evaluateMutationGate 读取结果，不重跑变异命令；模板源跳过，默认关闭。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { DESIGN_FILE_NAME, QA_MODULES_DIR } = require('./business-spec-schema');
const { parseDesignDocument } = require('./qa-design-spec');
const { collectEvidenceRecords, globToRegExp, resolveRange } = require('./qa-integrity');
const { worktreeReceiptKey } = require('./qa-verification-state');

const LINE_LIMIT = 60;
const REPORT_MAX_BYTES = 64 * 1024 * 1024;
const KILL_GRACE_MS = 5000;
const ACCEPT_PREFIX = 'MUTATION_ACCEPT=';
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const DESIGN_PATH = new RegExp(`^${QA_MODULES_DIR}/[^/]+/${DESIGN_FILE_NAME.replace('.', '\\.')}$`, 'u');
const CONFIG_KEYS = new Set(['enabled', 'command', 'report', 'include', 'minScore', 'timeoutSeconds', 'requireAcKill']);
// mutation-testing-report-schema 的终态；Pending 表示报告未跑完，按无效处理。
const STATUSES = new Set(['Killed', 'Survived', 'NoCoverage', 'CompileError', 'RuntimeError', 'Timeout', 'Ignored']);
const KILLED = new Set(['Killed', 'Timeout']);
const EXCLUDED = new Set(['CompileError', 'RuntimeError', 'Ignored']);
const SURVIVING = new Set(['Survived', 'NoCoverage']);
const USAGE = '用法：pnpm agent -- qa mutate run [--base <ref>] | accept --mutant <id> --reason <原因> [--base <ref>]';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const flatten = (text) => String(text).replace(/\s+/gu, ' ').trim();
const compareCode = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const block = (code, subject, detail) => ({ code, subject, detail });
const risk = (code, subject, detail) => ({ code, subject: subject || '-', detail });
const isTemplateSource = (config) => Boolean(config && config.template && config.template.role === 'source');
const nulFields = (text) => text.split('\0').filter((item) => item !== '');
const isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== '');
const isPosition = (value) => isObject(value) && Number.isInteger(value.line) && value.line >= 0
  && Number.isInteger(value.column) && value.column >= 0;

function mutationError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

const configError = (message) => mutationError('MUTATION_CONFIG_INVALID', message);

// qa.mutation 配置 fail-closed：未知键、类型错误、仓库外报告路径都拒绝；include 为空时沿用 qa.design.sourceGlobs。
function resolveMutationConfig(config) {
  const raw = config && config.qa ? config.qa.mutation : undefined;
  if (!isObject(raw)) throw configError('qa.mutation 必须是对象（默认值见 infra/templates/agent/config.example.json）');
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.has(key)) throw configError(`qa.mutation.${key} 不是可识别的键`);
  }
  if (typeof raw.enabled !== 'boolean') throw configError('qa.mutation.enabled 必须是布尔值');
  if (typeof raw.command !== 'string') throw configError('qa.mutation.command 必须是字符串');
  if (typeof raw.report !== 'string') throw configError('qa.mutation.report 必须是字符串');
  const report = raw.report.trim().replace(/\\/gu, '/');
  if (report !== '' && (path.posix.isAbsolute(report) || path.win32.isAbsolute(raw.report.trim())
    || report.split('/').includes('..'))) {
    throw configError('qa.mutation.report 必须是仓库内的相对路径，不得为绝对路径或包含 ..');
  }
  if (!Array.isArray(raw.include) || !raw.include.every((item) => typeof item === 'string' && item.trim() !== '')) {
    throw configError('qa.mutation.include 必须是非空字符串数组（可为空数组）');
  }
  if (typeof raw.minScore !== 'number' || !Number.isFinite(raw.minScore) || raw.minScore < 0 || raw.minScore > 100) {
    throw configError('qa.mutation.minScore 必须是 0–100 的数字');
  }
  if (!Number.isInteger(raw.timeoutSeconds) || raw.timeoutSeconds <= 0) {
    throw configError('qa.mutation.timeoutSeconds 必须是正整数');
  }
  if (typeof raw.requireAcKill !== 'boolean') throw configError('qa.mutation.requireAcKill 必须是布尔值');

  // 源码与测试文件的判定复用设计门禁：测试文件即使命中 include 也不参与变异。
  const { resolveDesignConfig } = require('./qa-design');
  let design;
  try {
    design = resolveDesignConfig(config);
  } catch (error) {
    throw configError(`qa.mutation 依赖的 qa.design 配置无效：${error.message}`);
  }
  let includeMatchers;
  try {
    includeMatchers = raw.include.length > 0 ? raw.include.map(globToRegExp) : design.sourceMatchers;
  } catch (error) {
    throw configError(`qa.mutation.include 含无法解析的 glob：${error.message}`);
  }
  const command = raw.command.trim();
  return {
    enabled: raw.enabled,
    command,
    report,
    include: [...raw.include],
    minScore: raw.minScore,
    timeoutSeconds: raw.timeoutSeconds,
    requireAcKill: raw.requireAcKill,
    includeMatchers,
    testMatchers: design.testMatchers,
    requiredPriorities: design.requiredPriorities,
    // minScore 与 requireAcKill 只影响判定，不使已运行的结果失效。
    configDigest: sha256(JSON.stringify({ command, report, include: raw.include, timeoutSeconds: raw.timeoutSeconds })),
  };
}

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    if (allowFailure) return null;
    throw mutationError('MUTATION_GIT_FAILED', `git ${args.join(' ')} 失败：${String(result.stderr || (result.error && result.error.message) || '').trim()}`);
  }
  return result.stdout;
}

// base..HEAD 中命中 include、且不是测试文件的新增/修改源码，附 HEAD 侧 blob；删除的文件无可变异内容，跳过。
function mutationFiles(repoRoot, baseSha, headSha, settings) {
  const tokens = nulFields(git(repoRoot, ['diff', '--name-status', '-z', '--no-renames', baseSha, headSha]));
  const changed = [];
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const status = tokens[index][0];
    const file = tokens[index + 1];
    if (!['A', 'M', 'T', 'D'].includes(status)) {
      throw mutationError('MUTATION_DIFF_UNSUPPORTED', `无法处理 ${file} 的改动状态 ${tokens[index]}`);
    }
    if (status === 'D') continue;
    if (!settings.includeMatchers.some((matcher) => matcher.test(file))) continue;
    if (settings.testMatchers.some((matcher) => matcher.test(file))) continue;
    changed.push(file);
  }
  if (changed.length === 0) return [];
  const tree = new Map();
  for (const line of nulFields(git(repoRoot, ['ls-tree', '-r', '-z', headSha]))) {
    const tab = line.indexOf('\t');
    const [, , blob] = line.slice(0, tab).split(' ');
    tree.set(line.slice(tab + 1), blob);
  }
  return changed
    .map((file) => {
      const blob = tree.get(file);
      if (!blob) throw mutationError('MUTATION_DIFF_UNSUPPORTED', `HEAD 中找不到变更文件 ${file}`);
      return { file, blob };
    })
    .sort((left, right) => compareCode(left.file, right.file));
}

const filesDigest = (files) => sha256(JSON.stringify(files));

function mutateDirectory(config, mainRoot, repoRoot) {
  const { resolveContainerPath } = require('../shared/config');
  let real;
  try {
    real = fs.realpathSync(repoRoot);
  } catch {
    real = path.resolve(repoRoot);
  }
  return path.join(resolveContainerPath(config, mainRoot, 'tmp'), 'qa-mutate', worktreeReceiptKey(real));
}

const artifactPaths = (directory) => ({
  result: path.join(directory, 'result.json'),
  report: path.join(directory, 'report.json'),
  raw: path.join(directory, 'raw-report.json'),
});

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, file);
}

// 只删除普通文件；路径不存在视为已清理，符号链接或目录拒绝处理。
function removeRegularFile(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isFile()) throw mutationError('MUTATION_REPORT_INVALID', `${file} 不是普通文件，拒绝删除`);
  fs.unlinkSync(file);
}

const isInside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

// 配置的报告路径：父目录存在时经 realpath 复核仍在仓库内，防止通过符号链接写出仓库。
function configuredReportPath(repoRoot, report) {
  const target = path.join(repoRoot, ...report.split('/'));
  const root = fs.realpathSync(repoRoot);
  let parent = path.dirname(target);
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  if (!isInside(root, fs.realpathSync(parent))) {
    throw mutationError('MUTATION_CONFIG_INVALID', `qa.mutation.report 经符号链接指向仓库外：${report}`);
  }
  return target;
}

// 把报告里的文件键归一化为仓库相对的 POSIX 路径；仓库外的绝对路径原样保留（不会匹配任何变更文件）。
function normalizeReportPath(key, roots) {
  let file = key;
  if (path.isAbsolute(file) || path.win32.isAbsolute(file)) {
    for (const root of roots) {
      const relative = path.relative(root, file);
      if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) {
        file = relative;
        break;
      }
    }
  }
  file = file.replace(/\\/gu, '/');
  while (file.startsWith('./')) file = file.slice(2);
  return file;
}

function assertMutant(item, where) {
  const fail = (message) => {
    throw mutationError('MUTATION_REPORT_INVALID', `${where}：${message}`);
  };
  if (!isObject(item)) fail('变异体必须是对象');
  if (typeof item.id !== 'string' || item.id.trim() === '') fail('缺少 id');
  if (typeof item.mutatorName !== 'string' || item.mutatorName.trim() === '') fail(`变异体 ${item.id} 缺少 mutatorName`);
  if (!isObject(item.location) || !isPosition(item.location.start) || !isPosition(item.location.end)) {
    fail(`变异体 ${item.id} 的 location 不合法`);
  }
  if (!STATUSES.has(item.status)) fail(`变异体 ${item.id} 的状态 ${JSON.stringify(item.status)} 不是终态（${[...STATUSES].join('|')}）`);
  if (item.replacement !== undefined && typeof item.replacement !== 'string') fail(`变异体 ${item.id} 的 replacement 必须是字符串`);
  for (const key of ['killedBy', 'coveredBy']) {
    if (item[key] !== undefined && !(Array.isArray(item[key]) && item[key].every((id) => typeof id === 'string'))) {
      fail(`变异体 ${item.id} 的 ${key} 必须是字符串数组`);
    }
  }
}

// 解析并校验 mutation-testing-report-schema 报告；返回 { mutants:[...附 file], tests: Map(id → name) }。
function parseMutationReport(text, repoRoot) {
  let body;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw mutationError('MUTATION_REPORT_INVALID', `报告不是合法 JSON：${error.message}`);
  }
  if (!isObject(body) || !isObject(body.files)) {
    throw mutationError('MUTATION_REPORT_INVALID', '报告缺少 files 对象（mutation-testing-report-schema）');
  }
  const roots = [path.resolve(repoRoot)];
  try {
    const real = fs.realpathSync(repoRoot);
    if (!roots.includes(real)) roots.push(real);
  } catch {
    // 仓库根不可解析时只按原路径归一化。
  }
  const ids = new Set();
  const mutants = [];
  for (const [key, entry] of Object.entries(body.files)) {
    if (!isObject(entry) || !Array.isArray(entry.mutants)) {
      throw mutationError('MUTATION_REPORT_INVALID', `files[${JSON.stringify(key)}] 缺少 mutants 数组`);
    }
    const file = normalizeReportPath(key, roots);
    for (const item of entry.mutants) {
      assertMutant(item, `files[${JSON.stringify(key)}]`);
      if (ids.has(item.id)) throw mutationError('MUTATION_REPORT_INVALID', `变异体 id ${item.id} 重复`);
      ids.add(item.id);
      mutants.push({ ...item, file });
    }
  }
  const tests = new Map();
  if (body.testFiles !== undefined) {
    if (!isObject(body.testFiles)) throw mutationError('MUTATION_REPORT_INVALID', 'testFiles 必须是对象');
    for (const [key, entry] of Object.entries(body.testFiles)) {
      if (!isObject(entry) || !Array.isArray(entry.tests)) {
        throw mutationError('MUTATION_REPORT_INVALID', `testFiles[${JSON.stringify(key)}] 缺少 tests 数组`);
      }
      for (const item of entry.tests) {
        if (!isObject(item) || typeof item.id !== 'string' || item.id === '' || (item.name !== undefined && typeof item.name !== 'string')) {
          throw mutationError('MUTATION_REPORT_INVALID', `testFiles[${JSON.stringify(key)}] 的测试必须含字符串 id 与可选 name`);
        }
        tests.set(item.id, item.name || item.id);
      }
    }
  }
  return { mutants, tests };
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// result.json 的形状校验；任何字段不合法都视为结果损坏。
function validRecord(record) {
  return isObject(record)
    && record.version === 1
    && SHA.test(record.head_sha || '')
    && SHA.test(record.base_sha || '')
    && DIGEST.test(record.config_digest || '')
    && DIGEST.test(record.files_digest || '')
    && DIGEST.test(record.report_sha256 || '')
    && Array.isArray(record.files)
    && record.files.every((item) => isObject(item) && typeof item.file === 'string' && typeof item.blob === 'string')
    && (record.exit_code === null || Number.isInteger(record.exit_code))
    && (record.signal === null || record.signal === undefined || typeof record.signal === 'string');
}

// 读取并核对当前结果：缺失、损坏、过期、报告副本被改都返回阻断项；通过时返回解析后的报告。
function loadResult({ repoRoot, directory, settings, baseSha, headSha, files }) {
  const paths = artifactPaths(directory);
  if (!fs.existsSync(paths.result)) {
    return { block: block('MUTATION_RESULT_MISSING', 'result', '尚未运行 qa mutate run，或上次运行未产出有效结果') };
  }
  let record;
  try {
    record = readJsonFile(paths.result);
  } catch (error) {
    return { block: block('MUTATION_RESULT_INVALID', 'result', `结果文件无法解析：${error.message}`) };
  }
  if (!validRecord(record)) return { block: block('MUTATION_RESULT_INVALID', 'result', '结果文件字段缺失或格式不合法') };
  const stale = [];
  if (record.head_sha !== headSha) stale.push('head_sha');
  if (record.base_sha !== baseSha) stale.push('base_sha');
  if (record.config_digest !== settings.configDigest) stale.push('config_digest');
  if (record.files_digest !== filesDigest(files)) stale.push('files_digest');
  if (stale.length > 0) {
    return { block: block('MUTATION_RESULT_STALE', 'result', `结果与当前状态不一致：${stale.join(',')}；请重新运行 qa mutate run`) };
  }
  let bytes;
  try {
    bytes = fs.readFileSync(paths.report);
  } catch {
    return { block: block('MUTATION_RESULT_TAMPERED', 'result', '报告副本缺失') };
  }
  if (sha256(bytes) !== record.report_sha256) {
    return { block: block('MUTATION_RESULT_TAMPERED', 'result', '报告副本 sha256 与结果记录不一致') };
  }
  try {
    return { record, report: parseMutationReport(bytes.toString('utf8'), repoRoot) };
  } catch (error) {
    return { block: block('MUTATION_RESULT_INVALID', 'result', error.message) };
  }
}

// 指定提交中各 TEST-DESIGN.md 的必需优先级规则、引用它们的反例，以及业务规格里的必需 AC 的 ID 与 TC。
function requiredIds(repoRoot, headSha, settings) {
  const required = new Set(settings.requiredPriorities);
  const ids = new Set();
  const listing = git(repoRoot, ['ls-tree', '-r', '-z', '--name-only', headSha, '--', QA_MODULES_DIR], { allowFailure: true }) || '';
  const designFiles = nulFields(listing).filter((file) => DESIGN_PATH.test(file)).sort(compareCode);
  for (const file of designFiles) {
    const doc = parseDesignDocument(git(repoRoot, ['show', `${headSha}:${file}`]), { file });
    const rules = (doc.rules || []).filter((rule) => required.has(rule.priority));
    const ruleIds = new Set(rules.map((rule) => rule.id));
    for (const rule of rules) {
      ids.add(rule.id);
      for (const tc of rule.tcs || []) ids.add(tc);
    }
    for (const adv of doc.advs || []) {
      if (!(adv.rules || []).some((id) => ruleIds.has(id))) continue;
      ids.add(adv.id);
      for (const tc of adv.tcs || []) ids.add(tc);
    }
  }
  try {
    const { loadBusinessSpec } = require('./business-spec');
    for (const ac of loadBusinessSpec({ repoRoot }).acs || []) {
      if (!required.has(ac.priority)) continue;
      ids.add(ac.id);
      for (const tc of ac.tcs || []) ids.add(tc);
    }
  } catch {
    // 项目未提供 PRD 原子 AC 表时只按 TEST-DESIGN 绑定。
  }
  return [...ids].filter((id) => typeof id === 'string' && id !== '').sort(compareCode);
}

const bindingPattern = (ids) => new RegExp(`(?<![A-Z0-9-])(?:${ids.map(escapeRegExp).join('|')})(?![0-9])`, 'u');

function normalizeLocation(location) {
  return {
    start: { line: location.start.line, column: location.start.column },
    end: { line: location.end.line, column: location.end.column },
  };
}

// 豁免身份：文件、变异算子、替换文本、位置与源码 blob；blob 变化即失效，避免旧豁免掩盖新代码。
const acceptKey = (item) => JSON.stringify([item.file, item.mutator, item.replacement === undefined ? null : item.replacement,
  normalizeLocation(item.location), item.blob]);

function parseAcceptRecords(records) {
  const accepts = new Map();
  const invalid = [];
  for (const line of records) {
    const text = String(line).startsWith(ACCEPT_PREFIX) ? String(line).slice(ACCEPT_PREFIX.length) : String(line);
    try {
      const record = JSON.parse(text);
      if (!isObject(record) || typeof record.file !== 'string' || typeof record.mutator !== 'string' || typeof record.blob !== 'string'
        || !isObject(record.location) || !isPosition(record.location.start) || !isPosition(record.location.end)
        || typeof record.reason !== 'string' || record.reason.trim() === ''
        || (record.replacement !== null && record.replacement !== undefined && typeof record.replacement !== 'string')) {
        throw new Error('字段缺失或类型不合法');
      }
      accepts.set(acceptKey(record), record);
    } catch (error) {
      invalid.push(`${flatten(text).slice(0, 80)}：${error.message}`);
    }
  }
  return { accepts, invalid };
}

function acceptRecordFor(mutant, blob, reason) {
  return {
    file: mutant.file,
    mutator: mutant.mutatorName,
    replacement: mutant.replacement === undefined ? null : mutant.replacement,
    location: normalizeLocation(mutant.location),
    blob,
    reason,
  };
}

// P0 判定：有覆盖数据时逐个检查覆盖了变更代码的 P0 测试；没有覆盖数据时要求全部 P0 测试合计至少杀死一个。
function judgeP0({ repoRoot, headSha, settings, mutants, tests, blocks, risks }) {
  const ids = requiredIds(repoRoot, headSha, settings);
  const pattern = ids.length > 0 ? bindingPattern(ids) : null;
  const names = new Map(tests);
  for (const item of mutants) {
    for (const id of [...(item.killedBy || []), ...(item.coveredBy || [])]) if (!names.has(id)) names.set(id, id);
  }
  const p0 = [...names.entries()].filter(([, name]) => pattern && pattern.test(name)).map(([id]) => id);
  const killers = new Set(mutants.filter((item) => KILLED.has(item.status)).flatMap((item) => item.killedBy || []));
  const hasCoverage = mutants.some((item) => Array.isArray(item.coveredBy));
  let evaluated;
  if (hasCoverage) {
    const touched = new Set(mutants.flatMap((item) => [...(item.coveredBy || []), ...(item.killedBy || [])]));
    evaluated = p0.filter((id) => touched.has(id));
    for (const id of evaluated) {
      if (!killers.has(id)) blocks.push(block('MUTATION_P0_NO_KILL', names.get(id), '绑定 P0 的测试覆盖了变更代码，却没有杀死任何变异体'));
    }
  } else {
    evaluated = p0;
    risks.push(risk('MUTATION_COVERAGE_UNKNOWN', '-', '报告没有 coveredBy 覆盖数据，只能按全部 P0 测试合计判定'));
    if (evaluated.length > 0 && !evaluated.some((id) => killers.has(id))) {
      blocks.push(block('MUTATION_P0_NO_KILL', '*', `绑定 P0 的 ${evaluated.length} 个测试都没有杀死任何变异体`));
    }
  }
  if (evaluated.length === 0) {
    risks.push(risk('MUTATION_P0_UNBOUND', '-', '报告中没有覆盖变更代码且名称绑定 P0 规则/AC/TC 的测试'));
  }
  return { killing: evaluated.filter((id) => killers.has(id)).length, evaluated: evaluated.length };
}

const gateStatus = (blocks, risks) => (blocks.length > 0 ? 'BLOCKED' : risks.length > 0 ? 'PASS_WITH_RISK' : 'PASS');

function emptyVerdict(status, extra = {}) {
  return {
    status,
    blocks: [],
    risks: [],
    files: 0,
    score: null,
    minScore: null,
    killed: 0,
    valid: 0,
    accepted: 0,
    exitCode: null,
    p0Tests: null,
    survivors: [],
    ...extra,
  };
}

// 只读判定：qa mutate run 与 qa verify 共用；不运行命令，只核对当前结果。
function evaluateMutationGate({ repoRoot, config, mainRoot, baseSha, headSha, acceptRecords }) {
  const settings = resolveMutationConfig(config);
  if (isTemplateSource(config)) return emptyVerdict('SKIPPED');
  if (!settings.enabled) return emptyVerdict('DISABLED');
  const records = acceptRecords === undefined ? collectEvidenceRecords(repoRoot, ACCEPT_PREFIX).records : acceptRecords;
  const files = mutationFiles(repoRoot, baseSha, headSha, settings);
  if (files.length === 0) return emptyVerdict('PASS', { minScore: settings.minScore });

  const blocks = [];
  const risks = [];
  const base = { files: files.length, minScore: settings.minScore };
  const loaded = loadResult({ repoRoot, directory: mutateDirectory(config, mainRoot, repoRoot), settings, baseSha, headSha, files });
  if (loaded.block) return emptyVerdict('BLOCKED', { ...base, blocks: [loaded.block] });

  const blobs = new Map(files.map((item) => [item.file, item.blob]));
  const mutants = loaded.report.mutants.filter((item) => blobs.has(item.file));
  const present = new Set(mutants.map((item) => item.file));
  if (present.size === 0) {
    return emptyVerdict('BLOCKED', {
      ...base,
      exitCode: loaded.record.exit_code,
      blocks: [block('MUTATION_REPORT_EMPTY', 'report', `报告不含任何变更文件：${files.map((item) => item.file).join(',')}`)],
    });
  }
  for (const item of files) {
    if (!present.has(item.file)) risks.push(risk('MUTATION_REPORT_PARTIAL', item.file, '报告没有该变更文件的变异体'));
  }

  // 豁免：只对当前 blob 下存活或未覆盖的变异体生效。
  const { accepts, invalid } = parseAcceptRecords(records);
  for (const detail of invalid) risks.push(risk('MUTATION_ACCEPT_INVALID', '-', `无法解析的豁免证据：${detail}`));
  const acceptedIds = new Set();
  for (const item of mutants) {
    if (!SURVIVING.has(item.status)) continue;
    if (accepts.has(acceptKey(acceptRecordFor(item, blobs.get(item.file), '-')))) acceptedIds.add(item.id);
  }
  if (accepts.size > 0 && acceptedIds.size === 0) {
    risks.push(risk('MUTATION_ACCEPT_STALE', '-', `${accepts.size} 条豁免证据都不匹配当前结果（源码已变化或变异体不再存活）`));
  }

  const killed = mutants.filter((item) => KILLED.has(item.status)).length;
  const valid = mutants.filter((item) => !EXCLUDED.has(item.status) && !acceptedIds.has(item.id)).length;
  const score = valid > 0 ? Number(((killed / valid) * 100).toFixed(2)) : null;
  if (score === null) {
    risks.push(risk('MUTATION_NO_MUTANTS', '-', '变更文件没有可计分的变异体（全部为编译错误、运行错误、忽略或已豁免）'));
  } else if (score < settings.minScore) {
    blocks.push(block('MUTATION_SCORE_LOW', 'qa.mutation.minScore', `变异分数 ${score.toFixed(2)} 低于阈值 ${settings.minScore}`));
  }
  if (loaded.record.exit_code !== 0) {
    risks.push(risk('MUTATION_COMMAND_EXIT', '-', `变异命令以 ${loaded.record.exit_code === null ? `信号 ${loaded.record.signal || '未知'}` : `退出码 ${loaded.record.exit_code}`} 结束，报告仍有效`));
  }

  const p0Tests = settings.requireAcKill
    ? judgeP0({ repoRoot, headSha, settings, mutants, tests: loaded.report.tests, blocks, risks })
    : null;
  const survivors = mutants
    .filter((item) => SURVIVING.has(item.status) && !acceptedIds.has(item.id))
    .map((item) => ({ id: item.id, file: item.file, line: item.location.start.line, mutator: item.mutatorName }));

  return {
    status: gateStatus(blocks, risks),
    blocks,
    risks,
    files: files.length,
    score,
    minScore: settings.minScore,
    killed,
    valid,
    accepted: acceptedIds.size,
    exitCode: loaded.record.exit_code,
    p0Tests,
    survivors,
  };
}

function limitedLines(prefix, items, withSubject) {
  const lines = items.slice(0, LINE_LIMIT).map((item) => (withSubject
    ? `${prefix}=${item.code}|${item.subject}|${flatten(item.detail)}`
    : `${prefix}=${item.code}|${flatten(item.detail)}`));
  if (items.length > LINE_LIMIT) lines.push(`${prefix}_TRUNCATED=${items.length - LINE_LIMIT}`);
  return lines;
}

function mutationLines(verdict) {
  if (verdict.status === 'DISABLED' || verdict.status === 'SKIPPED') return [`MUTATION_GATE=${verdict.status}`];
  const survivors = verdict.survivors.slice(0, LINE_LIMIT).map((item) => `MUTATION_SURVIVOR=${item.id}|${item.file}:${item.line}|${item.mutator}`);
  if (verdict.survivors.length > LINE_LIMIT) survivors.push(`MUTATION_SURVIVOR_TRUNCATED=${verdict.survivors.length - LINE_LIMIT}`);
  return [
    `MUTATION_GATE=${verdict.status}`,
    `MUTATION_FILES=${verdict.files}`,
    `MUTATION_SCORE=${verdict.score === null ? 'NA' : verdict.score.toFixed(2)}`,
    `MUTATION_KILLED=${verdict.killed}`,
    `MUTATION_VALID=${verdict.valid}`,
    `MUTATION_ACCEPTED=${verdict.accepted}`,
    `MUTATION_P0_TESTS=${verdict.p0Tests ? `${verdict.p0Tests.killing}/${verdict.p0Tests.evaluated}` : 'NA'}`,
    ...survivors,
    ...limitedLines('MUTATION_BLOCK', verdict.blocks, true),
    ...limitedLines('MUTATION_RISK', verdict.risks, true),
  ];
}

function parseCliArgs(argv) {
  const [action, ...rest] = argv;
  if (action !== 'run' && action !== 'accept') {
    throw mutationError('MUTATION_INVALID_INPUT', `${action === undefined ? '缺少动作' : `不支持的动作：${action}`}。${USAGE}`);
  }
  const allowed = action === 'run' ? new Set(['base']) : new Set(['base', 'mutant', 'reason']);
  const args = { action };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw mutationError('MUTATION_INVALID_INPUT', `不支持的位置参数：${token}。${USAGE}`);
    const eq = token.indexOf('=');
    const key = eq === -1 ? token.slice(2) : token.slice(2, eq);
    if (!allowed.has(key)) throw mutationError('MUTATION_INVALID_INPUT', `qa mutate ${action} 不支持 --${key}。${USAGE}`);
    let value;
    if (eq === -1) {
      value = rest[index + 1];
      index += 1;
    } else {
      value = token.slice(eq + 1);
    }
    if (value === undefined || value === '' || value.startsWith('--')) throw mutationError('MUTATION_INVALID_INPUT', `--${key} 需要一个值`);
    if (args[key] !== undefined) throw mutationError('MUTATION_INVALID_INPUT', `--${key} 重复`);
    args[key] = value;
  }
  if (action === 'accept') {
    if (!args.mutant) throw mutationError('MUTATION_INVALID_INPUT', `accept 需要 --mutant <id>。${USAGE}`);
    if (!args.reason || args.reason.trim() === '') throw mutationError('MUTATION_INVALID_INPUT', `accept 需要 --reason <原因>。${USAGE}`);
  }
  return args;
}

const blocked = (reason, summary, nextAction, lines = []) => ({ status: 'BLOCKED', reason, summary, nextAction, lines });

// 运行前置：配置 → 模板源 → 开关 → 命令 → 范围 → 干净工作区；返回上下文或直接返回结果。
function prepare(args, { requireCommand }) {
  const { getMainRepoRoot, loadConfig, resolveRepoRoot } = require('../shared/config');
  const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
  const config = loadConfig({ repoRoot });
  const settings = resolveMutationConfig(config);
  if (isTemplateSource(config)) {
    return { outcome: { status: 'OK', summary: '模板源不执行变异门禁', nextAction: '无', lines: ['MUTATION_GATE=SKIPPED'] } };
  }
  if (!settings.enabled) {
    return {
      outcome: blocked('MUTATION_DISABLED', 'qa.mutation.enabled=false，变异门禁未启用',
        '在 agent.config.json 设置 qa.mutation.enabled=true 并配置 command 后重试', ['MUTATION_GATE=DISABLED']),
    };
  }
  if (requireCommand && settings.command === '') {
    return { outcome: blocked('MUTATION_COMMAND_MISSING', '未配置 qa.mutation.command', '在 agent.config.json 配置 qa.mutation.command（如 Stryker 命令）后重试') };
  }
  const { baseSha, headSha } = resolveRange(repoRoot, config, args.base);
  return { repoRoot, config, settings, mainRoot: getMainRepoRoot(repoRoot), baseSha, headSha };
}

async function runAction(args) {
  const prepared = prepare(args, { requireCommand: true });
  if (prepared.outcome) return prepared.outcome;
  const { repoRoot, config, settings, mainRoot, baseSha, headSha } = prepared;
  const dirty = git(repoRoot, ['status', '--porcelain', '--untracked-files=normal']).trim();
  if (dirty) {
    return blocked('MUTATION_WORKTREE_DIRTY', '工作区有未提交改动，变异结果无法绑定 HEAD', '提交或清理改动后重新运行 qa mutate run');
  }
  const files = mutationFiles(repoRoot, baseSha, headSha, settings);
  if (files.length === 0) {
    const verdict = evaluateMutationGate({ repoRoot, config, mainRoot, baseSha, headSha });
    return { status: 'OK', summary: 'base..HEAD 没有需要变异的源码', nextAction: '无', lines: mutationLines(verdict) };
  }

  const { ensureContainerDirectories } = require('../shared/config');
  ensureContainerDirectories(config, mainRoot, ['tmp']);
  const directory = mutateDirectory(config, mainRoot, repoRoot);
  fs.mkdirSync(directory, { recursive: true });
  const paths = artifactPaths(directory);
  const target = settings.report === '' ? paths.raw : configuredReportPath(repoRoot, settings.report);
  // 先清掉旧结果与旧报告：本轮失败时不得让上一轮结果冒充当前结果。
  for (const file of [paths.result, paths.report, paths.raw, target]) removeRegularFile(file);

  const { installSignalHandlers, runCommand } = require('./qa-run-process');
  const controller = { current: null, interrupted: null };
  const removeHandlers = installSignalHandlers(controller);
  let ran;
  try {
    ran = await runCommand({
      command: settings.command,
      cwd: repoRoot,
      env: {
        ...process.env,
        XIRANG_MUTATE_FILES: files.map((item) => item.file).join(','),
        XIRANG_MUTATE_REPORT: target,
        XIRANG_MUTATE_BASE: baseSha,
      },
      shell: true,
      timeoutMs: settings.timeoutSeconds * 1000,
      killGraceMs: KILL_GRACE_MS,
      controller,
    });
  } finally {
    removeHandlers();
  }
  if (controller.interrupted) {
    return { status: 'FAILED', reason: 'INTERRUPTED', summary: `收到 ${controller.interrupted}，已终止变异命令，未写入结果`, nextAction: '确认中断原因后重新运行 qa mutate run' };
  }
  if (ran.spawnError) {
    return { status: 'FAILED', reason: 'MUTATION_COMMAND_FAILED', summary: `变异命令无法启动：${ran.spawnError.message}`, nextAction: '检查 qa.mutation.command 后重试' };
  }
  if (ran.timedOut) {
    return blocked('MUTATION_TIMEOUT', `变异命令超过 ${settings.timeoutSeconds} 秒未结束，已终止`, '缩小变异范围或调大 qa.mutation.timeoutSeconds 后重试');
  }

  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return blocked('MUTATION_REPORT_MISSING', `变异命令没有写出报告：${target}`, '确认命令把 mutation-testing-report-schema JSON 写到 $XIRANG_MUTATE_REPORT（或 qa.mutation.report）');
  }
  if (!stat.isFile()) return blocked('MUTATION_REPORT_INVALID', `报告不是普通文件：${target}`, '让变异命令直接写出 JSON 文件，不使用符号链接或目录');
  if (stat.size > REPORT_MAX_BYTES) return blocked('MUTATION_REPORT_INVALID', `报告超过 ${REPORT_MAX_BYTES} 字节上限`, '缩小变异范围后重试');
  const bytes = fs.readFileSync(target);
  try {
    parseMutationReport(bytes.toString('utf8'), repoRoot);
  } catch (error) {
    if (error.code !== 'MUTATION_REPORT_INVALID') throw error;
    return blocked('MUTATION_REPORT_INVALID', error.message, '修正变异命令的报告输出（mutation-testing-report-schema）后重新运行 qa mutate run');
  }

  // 原样保存报告字节，再原子写结果；结果记录报告 sha256，之后副本任何改动都会被判为篡改。
  writeAtomic(paths.report, bytes);
  if (target === paths.raw) removeRegularFile(paths.raw);
  writeAtomic(paths.result, `${JSON.stringify({
    version: 1,
    head_sha: headSha,
    base_sha: baseSha,
    config_digest: settings.configDigest,
    files,
    files_digest: filesDigest(files),
    report_sha256: sha256(bytes),
    exit_code: ran.exitCode,
    signal: ran.signal,
    timed_out: false,
  }, null, 2)}\n`);

  const verdict = evaluateMutationGate({ repoRoot, config, mainRoot, baseSha, headSha });
  const lines = [`MUTATION_RESULT_FILE=${paths.result}`, `MUTATION_REPORT_FILE=${paths.report}`, ...mutationLines(verdict)];
  if (verdict.status === 'BLOCKED') {
    return blocked('MUTATION_GATE_BLOCKED', `变异门禁阻断：${verdict.blocks.map((item) => item.code).join(',')}`,
      '为存活变异体补充能杀死它的测试；确属等价变异体时用 qa mutate accept 豁免，然后重新运行 qa mutate run', lines);
  }
  return { status: 'OK', summary: `变异门禁 ${verdict.status}`, nextAction: '运行 pnpm agent -- qa verify', lines };
}

async function acceptAction(args) {
  const prepared = prepare(args, { requireCommand: false });
  if (prepared.outcome) return prepared.outcome;
  const { repoRoot, config, settings, mainRoot, baseSha, headSha } = prepared;
  const files = mutationFiles(repoRoot, baseSha, headSha, settings);
  if (files.length === 0) {
    return blocked('MUTATION_ACCEPT_INVALID', 'base..HEAD 没有需要变异的源码，无可豁免的变异体', '无');
  }
  const loaded = loadResult({ repoRoot, directory: mutateDirectory(config, mainRoot, repoRoot), settings, baseSha, headSha, files });
  if (loaded.block) return blocked(loaded.block.code, loaded.block.detail, '重新运行 pnpm agent -- qa mutate run 后再执行 accept');
  const blobs = new Map(files.map((item) => [item.file, item.blob]));
  const target = loaded.report.mutants.find((item) => item.id === args.mutant);
  if (!target || !blobs.has(target.file)) {
    return blocked('MUTATION_ACCEPT_INVALID', `当前结果中没有属于变更文件的变异体 ${args.mutant}`, '从 MUTATION_SURVIVOR= 行选择变异体 id');
  }
  if (!SURVIVING.has(target.status)) {
    return blocked('MUTATION_ACCEPT_INVALID', `变异体 ${args.mutant} 状态为 ${target.status}，只有 Survived 或 NoCoverage 可豁免`, '从 MUTATION_SURVIVOR= 行选择变异体 id');
  }
  const record = acceptRecordFor(target, blobs.get(target.file), args.reason.trim());
  return {
    status: 'OK',
    summary: `已生成变异体 ${args.mutant} 的豁免证据`,
    nextAction: '把上面的 MUTATION_ACCEPT= 行原样写入当前任务 checkpoint 的 --evidence（pnpm agent -- task checkpoint ... --evidence \'<该行>\'），再重跑 qa verify',
    lines: [`${ACCEPT_PREFIX}${JSON.stringify(record)}`],
  };
}

async function main(argv) {
  const args = parseCliArgs(argv);
  return args.action === 'run' ? runAction(args) : acceptAction(args);
}

module.exports = {
  evaluateMutationGate,
  main,
  mutateDirectory,
  mutationFiles,
  mutationLines,
  parseCliArgs,
  parseMutationReport,
  resolveMutationConfig,
};

if (require.main === module) {
  const { exitOnHelp } = require('../shared/cli-help');
  const { resultBlockLines, resultExitCode } = require('../shared/result-block');
  exitOnHelp([
    USAGE,
    '',
    'run：对 base..HEAD 中命中 qa.mutation.include（为空时用 qa.design.sourceGlobs）的非测试源码运行 qa.mutation.command。',
    '  命令环境：XIRANG_MUTATE_FILES（逗号分隔）、XIRANG_MUTATE_REPORT（报告写入路径）、XIRANG_MUTATE_BASE。',
    '  报告须为 mutation-testing-report-schema JSON；结果写入容器 tmp/qa-mutate/，绑定 HEAD、配置摘要与报告 sha256。',
    '  输出 MUTATION_GATE、MUTATION_SCORE、MUTATION_P0_TESTS、MUTATION_SURVIVOR、MUTATION_BLOCK、MUTATION_RISK。',
    'accept：为等价的存活变异体生成 MUTATION_ACCEPT= 证据行，写入任务 checkpoint 后在 qa verify 中豁免。',
  ].join('\n'));
  main(process.argv.slice(2))
    .catch((error) => ({
      status: error.status || (/_GIT_FAILED$/u.test(error.code || '') ? 'FAILED' : 'BLOCKED'),
      reason: error.code || 'MUTATION_INVALID_INPUT',
      summary: error.message,
      nextAction: '按 SUMMARY 修正输入或配置后重试 pnpm agent -- qa mutate',
    }))
    .then((outcome) => {
      for (const line of outcome.lines || []) console.log(line);
      for (const line of resultBlockLines(outcome)) console.log(line);
      process.exit(resultExitCode(outcome.status));
    });
}

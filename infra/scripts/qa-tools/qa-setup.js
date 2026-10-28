#!/usr/bin/env node
'use strict';

// qa setup：检测项目测试栈，把 qa 门禁配置一次写入稀疏 agent.config.json。
// 只补缺失的键：项目已写的值与显式 enabled:false 的门禁一律保持不动；
// 业务门禁仅在规格、用例引用、套件与端全部就绪时自动开启，否则保持默认关闭并说明原因。

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { exitOnHelp } = require('../shared/cli-help');
const { DEFAULT_CONFIG, deepMerge, resolveRepoRoot } = require('../shared/config');
const { oneLine } = require('../shared/result-block');
const { NO_PLATFORM, resolveBusinessConfig } = require('./business-config');
const { referencedIds } = require('./qa-automate');
const { resolveDesignConfig } = require('./qa-design');
const { resolveMutationConfig } = require('./qa-mutate');
const { analyzeSpec } = require('./qa-paths');
const { resolveReproConfig } = require('./qa-repro');

const USAGE = [
  'pnpm agent -- qa setup [--dry-run]',
  '  检测 vitest / jest / Playwright / pytest / Stryker，自动登记 qa.business.suites、qa.repro.command 与 qa.mutation，',
  '  规格与用例就绪时开启 qa.business.enabled，并把报告目录加入 .gitignore。',
  '  只补缺失的键；项目已写的值与显式 enabled:false 的门禁保持不动；重复执行幂等。',
  '  --dry-run  只输出 WRITE 计划，不写任何文件（主 worktree 上也可预览）',
];

const CONFIG_FILE = 'agent.config.json';
const SUITE_REPORT_DIR = 'reports/qa';
const MUTATION_REPORT = 'reports/mutation/mutation.json';
const MEMBER_ROOTS = ['apps', 'packages'];
const SUITE_NAME = /^[a-z][a-z0-9-]*$/;
const SAFE_SHELL_PATH = /^[A-Za-z0-9._/-]+$/;
// 复现命令优先级：能按名称过滤且启动快的单测运行器在前，E2E 最后。
const REPRO_RANK = { vitest: 0, jest: 1, pytest: 2, playwright: 3 };

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
// 空字符串与空数组等同“未设置”：模板默认值就是这两种形态。
const isSet = (value) => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);

function setupError(message, code = 'SETUP_BLOCKED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArgs(argv) {
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--dry-run') dryRun = true;
    else throw setupError(`未知参数：${arg}`, 'SETUP_USAGE');
  }
  return { dryRun };
}

function gitOut(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

// 主 worktree 的 git-dir 与 common-dir 相同；linked worktree 的 git-dir 在 .git/worktrees/<name>。
function isMainWorktree(repoRoot) {
  const gitDir = gitOut(repoRoot, ['rev-parse', '--path-format=absolute', '--git-dir']);
  const commonDir = gitOut(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!gitDir || !commonDir) throw setupError(`${repoRoot} 不是 Git 仓库或 git 不可用，无法判定写入位置`);
  return path.resolve(gitDir) === path.resolve(commonDir);
}

function readRawConfig(repoRoot) {
  const file = path.join(repoRoot, CONFIG_FILE);
  if (!fs.existsSync(file)) return {};
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw setupError(`${CONFIG_FILE} 无法解析：${error.message}`);
  }
  if (!isObject(raw)) throw setupError(`${CONFIG_FILE} 顶层须为 JSON 对象`);
  return raw;
}

// 用各门禁自己的解析器校验，确保写出的配置能被 qa run / repro / mutate / verify 直接读取。
function validateQaConfig(raw) {
  const merged = deepMerge(DEFAULT_CONFIG, raw);
  const problems = [];
  const business = resolveBusinessConfig(merged);
  if (!business.ok) problems.push(...business.errors.map((item) => `${item.field} ${item.message}`));
  for (const resolve of [resolveReproConfig, resolveMutationConfig, resolveDesignConfig]) {
    try {
      resolve(merged);
    } catch (error) {
      problems.push(error.message);
    }
  }
  return { merged, business, problems };
}

const exists = (repoRoot, relative) => fs.existsSync(path.join(repoRoot, relative));

// JS 运行器的启动前缀：成员目录自带锁文件时优先，其次仓库根；都没有时 npx 只用本地已装版本。
function jsExec(repoRoot, dir) {
  for (const base of dir === '.' ? ['.'] : [dir, '.']) {
    if (exists(repoRoot, path.join(base, 'pnpm-lock.yaml'))) return 'pnpm exec';
    if (exists(repoRoot, path.join(base, 'yarn.lock'))) return 'yarn';
    if (exists(repoRoot, path.join(base, 'bun.lock')) || exists(repoRoot, path.join(base, 'bun.lockb'))) return 'bunx';
    if (exists(repoRoot, path.join(base, 'package-lock.json'))) return 'npx --no-install';
  }
  return 'npx --no-install';
}

function pythonExec(repoRoot) {
  if (exists(repoRoot, 'uv.lock')) return 'uv run';
  if (exists(repoRoot, 'poetry.lock')) return 'poetry run';
  return 'python -m';
}

function readDependencies(repoRoot, dir, risks) {
  const file = path.join(repoRoot, dir, 'package.json');
  if (!fs.existsSync(file)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
  } catch (error) {
    risks.push(`RISK=PACKAGE_JSON_INVALID|${dir}/package.json 无法解析，跳过检测：${oneLine(error.message)}`);
    return null;
  }
}

function memberDirs(repoRoot) {
  const dirs = [];
  for (const root of MEMBER_ROOTS) {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(repoRoot, root), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') dirs.push(`${root}/${entry.name}`);
    }
  }
  return dirs.sort();
}

function detectPytest(repoRoot) {
  const mentions = (relative) => {
    try {
      return /\bpytest\b/.test(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));
    } catch {
      return false;
    }
  };
  if (mentions('pyproject.toml')) return 'pyproject.toml';
  let requirements = [];
  try {
    requirements = fs.readdirSync(repoRoot).filter((name) => /^requirements.*\.txt$/.test(name)).sort();
  } catch {
    // 仓库根不可读时由后续写入阶段报错。
  }
  const listed = requirements.find(mentions);
  if (listed) return listed;
  for (const marker of ['pytest.ini', 'conftest.py']) if (exists(repoRoot, marker)) return marker;
  return '';
}

// 根目录全部运行器排在成员目录之前；同一目录内按 vitest、jest、playwright、pytest 顺序。
function detectRunners(repoRoot) {
  const runners = [];
  const manual = [];
  const risks = [];
  let rootStryker = false;
  for (const dir of ['.', ...memberDirs(repoRoot)]) {
    const deps = readDependencies(repoRoot, dir, risks);
    const where = dir === '.' ? 'package.json' : `${dir}/package.json`;
    if (deps) {
      if (deps.has('vitest')) runners.push({ runner: 'vitest', dir, source: where });
      if (deps.has('jest')) {
        if (deps.has('jest-junit')) runners.push({ runner: 'jest', dir, source: where });
        else manual.push(`jest|${dir}|安装 jest-junit（devDependency）后重跑 qa setup，或手动登记输出 JUnit 的套件`);
      }
      if (deps.has('@playwright/test')) runners.push({ runner: 'playwright', dir, source: where });
      if (deps.has('@stryker-mutator/core')) {
        if (dir === '.') rootStryker = true;
        else manual.push(`stryker|${dir}|成员目录的 Stryker 需手动设置 qa.mutation.command（进入成员目录并输出 mutation-testing-report JSON）`);
      }
    }
    if (dir === '.') {
      const pytestSource = detectPytest(repoRoot);
      if (pytestSource) runners.push({ runner: 'pytest', dir, source: pytestSource });
      if (exists(repoRoot, 'go.mod')) {
        manual.push('go|.|用 gotestsum --junitfile "$PWD/reports/qa/go.junit.xml" -- ./... 手动登记 qa.business.suites 套件');
      }
    }
  }
  return { runners, manual, risks, rootStryker };
}

const shellPath = (dir) => (SAFE_SHELL_PATH.test(dir) ? dir : `'${dir.replace(/'/g, "'\\''")}'`);
const inDir = (dir, command) => (dir === '.' ? command : `cd ${shellPath(dir)} && ${command}`);

function suiteName(runner, dir, taken) {
  const base = dir === '.' ? runner : `${path.posix.basename(dir)}-${runner}`;
  let name = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^[^a-z]+|-+$/g, '');
  if (!SUITE_NAME.test(name)) name = `suite-${runner}`;
  let unique = name;
  for (let index = 2; taken.has(unique); index += 1) unique = `${name}-${index}`;
  taken.add(unique);
  return unique;
}

// qa run 在仓库根经 shell 执行套件命令；报告用 $PWD 锚定为绝对路径，进入成员目录后仍指回仓库根的报告位置。
function buildSuite({ runner, dir }, repoRoot, taken) {
  const name = suiteName(runner, dir, taken);
  const report = `${SUITE_REPORT_DIR}/${name}.junit.xml`;
  const target = `$PWD/${dir === '.' ? report : path.posix.relative(dir, report)}`;
  const exec = jsExec(repoRoot, dir);
  const commands = {
    vitest: `${exec} vitest run --reporter=default --reporter=junit --outputFile.junit="${target}"`,
    jest: `JEST_JUNIT_OUTPUT_FILE="${target}" ${exec} jest --ci --reporters=default --reporters=jest-junit`,
    playwright: `PLAYWRIGHT_JUNIT_OUTPUT_FILE="${target}" ${exec} playwright test --reporter=list,junit`,
    pytest: `${pythonExec(repoRoot)} pytest --junitxml="${target}"`,
  };
  return { name, platform: runner === 'playwright' ? 'web' : NO_PLATFORM, command: inDir(dir, commands[runner]), report };
}

// qa repro 注入的 $XIRANG_REPRO_REPORT 是绝对路径，进入成员目录不影响报告位置。
function buildReproCommand(runners, repoRoot) {
  const [best] = [...runners].sort((a, b) => (a.dir === '.' ? 0 : 1) - (b.dir === '.' ? 0 : 1) || REPRO_RANK[a.runner] - REPRO_RANK[b.runner]);
  if (!best) return '';
  const exec = jsExec(repoRoot, best.dir);
  const commands = {
    vitest: `${exec} vitest run -t "$XIRANG_REPRO_PATTERN" --reporter=default --reporter=junit --outputFile.junit="$XIRANG_REPRO_REPORT"`,
    jest: `JEST_JUNIT_OUTPUT_FILE="$XIRANG_REPRO_REPORT" ${exec} jest --ci --reporters=default --reporters=jest-junit -t "$XIRANG_REPRO_PATTERN"`,
    playwright: `PLAYWRIGHT_JUNIT_OUTPUT_FILE="$XIRANG_REPRO_REPORT" ${exec} playwright test -g "$XIRANG_REPRO_PATTERN" --reporter=list,junit`,
    // pytest -k 不接受正则；跑全量后由 qa repro 按报告中的用例名绑定 BUG/TC。
    pytest: `${pythonExec(repoRoot)} pytest --junitxml="$XIRANG_REPRO_REPORT"`,
  };
  return inDir(best.dir, commands[best.runner]);
}

// 业务门禁的开启条件与 qa verify 的阻断条件对齐：任一不满足就保持关闭，避免一开就阻断合并。
function businessReadiness({ repoRoot, requiredPriorities, suites }) {
  const analysis = analyzeSpec({ repoRoot });
  const acs = analysis.spec.acs;
  if (acs.length === 0) return ['NO_ATOMIC_AC'];
  const reasons = [];
  if (analysis.violations.length > 0) {
    const codes = [...new Set(analysis.violations.map((item) => item.code))].join(',');
    reasons.push(`SPEC_VIOLATIONS:${analysis.violations.length}(${codes})`);
  }
  const required = new Set(requiredPriorities);
  const requiredAuto = acs.filter((ac) => ac.verification === 'auto' && required.has(ac.priority));
  const referenced = referencedIds(repoRoot);
  const unreferenced = requiredAuto.filter((ac) => !referenced.has(ac.id) && !ac.tcs.some((tc) => referenced.has(tc)));
  if (unreferenced.length > 0) reasons.push(`UNREFERENCED_AC:${unreferenced.map((ac) => ac.id).join(',')}`);
  if (suites.length === 0) reasons.push('NO_SUITE');
  const suitePlatforms = new Set(suites.map((suite) => suite.platform || NO_PLATFORM));
  const declared = new Set(requiredAuto.flatMap((ac) => ac.platforms).filter((platform) => platform !== NO_PLATFORM));
  const missing = [...declared].filter((platform) => !suitePlatforms.has(platform)).sort();
  if (missing.length > 0) reasons.push(`PLATFORM_SUITE_MISSING:${missing.join(',')}`);
  return reasons;
}

function setPath(target, keys, value) {
  let node = target;
  for (const key of keys.slice(0, -1)) {
    if (!isObject(node[key])) node[key] = {};
    node = node[key];
  }
  node[keys[keys.length - 1]] = value;
}

function planSetup({ repoRoot, raw, merged, business }) {
  const rawQa = isObject(raw.qa) ? raw.qa : {};
  const section = (name) => (isObject(rawQa[name]) ? rawQa[name] : {});
  const detection = detectRunners(repoRoot);
  const writes = [];
  const skips = [];
  const gates = [];
  const plan = (key, current, value, shown) => {
    if (isSet(current)) {
      skips.push(`${key}|已由项目设置，保持不变`);
      return false;
    }
    writes.push({ key, value, shown });
    return true;
  };

  const taken = new Set();
  const suites = detection.runners.map((item) => buildSuite(item, repoRoot, taken));
  const reproCommand = buildReproCommand(detection.runners, repoRoot);
  const reportDirs = new Set();

  // 业务门禁：先登记套件，再按就绪条件决定是否写 enabled:true。
  const rawBusiness = section('business');
  let businessOn = false;
  if (rawBusiness.enabled === false) {
    skips.push('qa.business|显式关闭，整节保持不变');
    gates.push('business|off|显式关闭');
  } else {
    if (suites.length > 0 && plan('qa.business.suites', rawBusiness.suites, suites, suites.map((suite) => suite.name).join(','))) {
      reportDirs.add(`${SUITE_REPORT_DIR}/`);
    }
    const effectiveSuites = isSet(rawBusiness.suites) ? rawBusiness.suites.filter(isObject) : suites;
    if (rawBusiness.enabled === true) {
      skips.push('qa.business.enabled|已由项目开启，保持不变');
      gates.push('business|on|已由项目开启');
      businessOn = true;
    } else {
      const reasons = businessReadiness({ repoRoot, requiredPriorities: business.requiredPriorities, suites: effectiveSuites });
      if (reasons.length === 0) {
        writes.push({ key: 'qa.business.enabled', value: true, shown: 'true' });
        gates.push(`business|on|规格、用例引用、套件与端均就绪（${effectiveSuites.length} 个套件）`);
        businessOn = true;
      } else {
        gates.push(`business|off|${reasons.join(';')}`);
      }
    }
  }

  // 缺陷复现门禁：默认开启，只补 command。
  const rawRepro = section('repro');
  if (rawRepro.enabled === false) {
    skips.push('qa.repro|显式关闭，整节保持不变');
    gates.push('repro|off|显式关闭');
  } else if (reproCommand) {
    plan('qa.repro.command', rawRepro.command, reproCommand, reproCommand);
    gates.push('repro|on|command 已配置');
  } else if (isSet(rawRepro.command)) {
    gates.push('repro|on|command 已由项目设置');
  } else {
    detection.manual.push('repro|.|没有可自动生成复现命令的运行器：手动设置 qa.repro.command，按 $XIRANG_REPRO_PATTERN 过滤用例并把 JUnit 写到 $XIRANG_REPRO_REPORT');
    gates.push('repro|on|缺少 command：本分支新增 BUG 行时 qa verify 会阻断');
  }

  // 变异门禁：只有仓库根装了 Stryker 才自动开启；其余情况保持项目当前值。
  const rawMutation = section('mutation');
  if (rawMutation.enabled === false) {
    skips.push('qa.mutation|显式关闭，整节保持不变');
    gates.push('mutation|off|显式关闭');
  } else if (detection.rootStryker) {
    const exec = jsExec(repoRoot, '.');
    plan('qa.mutation.enabled', rawMutation.enabled, true, 'true');
    plan('qa.mutation.command', rawMutation.command, `${exec} stryker run --mutate "$XIRANG_MUTATE_FILES" --reporters json`, 'stryker');
    if (plan('qa.mutation.report', rawMutation.report, MUTATION_REPORT, MUTATION_REPORT)) reportDirs.add(`${path.posix.dirname(MUTATION_REPORT)}/`);
    gates.push('mutation|on|检测到 @stryker-mutator/core');
  } else if (merged.qa.mutation.enabled === true) {
    gates.push('mutation|on|已由项目开启');
  } else {
    gates.push('mutation|off|未检测到仓库根的 @stryker-mutator/core');
  }

  return { detection, writes, skips, gates, reportDirs, businessOn };
}

// 只追加尚未被忽略的报告目录：git check-ignore 同时识别父目录规则（如 reports/）。
function planIgnore(repoRoot, reportDirs) {
  const missing = [];
  for (const dir of reportDirs) {
    const result = spawnSync('git', ['check-ignore', '-q', '--no-index', `${dir}.xirang-probe`], { cwd: repoRoot });
    if (result.status === 0) continue;
    if (result.status !== 1) throw setupError(`git check-ignore ${dir} 失败：${String(result.stderr || (result.error && result.error.message) || '').trim()}`, 'SETUP_FAILED');
    missing.push(dir);
  }
  return missing;
}

// 同目录临时文件 + rename，避免中断时留下半截配置。
function writeAtomic(file, text) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temp, text, { flag: 'wx' });
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function applyWrites({ repoRoot, raw, writes, ignoreDirs }) {
  const next = structuredClone(raw);
  for (const write of writes) setPath(next, write.key.split('.'), write.value);
  writeAtomic(path.join(repoRoot, CONFIG_FILE), `${JSON.stringify(next, null, 2)}\n`);
  if (ignoreDirs.length > 0) {
    const file = path.join(repoRoot, '.gitignore');
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const prefix = current && !current.endsWith('\n') ? '\n' : '';
    writeAtomic(file, `${current}${prefix}# 息壤 qa setup：测试与变异报告\n${ignoreDirs.join('\n')}\n`);
  }
}

function sourceGlobRisk(repoRoot, merged) {
  const design = resolveDesignConfig(merged);
  const listed = gitOut(repoRoot, ['ls-files', '-z']);
  if (listed === null) return [];
  const files = listed.split('\0').filter(Boolean);
  if (files.some((file) => design.sourceMatchers.some((matcher) => matcher.test(file)))) return [];
  return [`RISK=SOURCE_GLOBS_UNMATCHED|qa.design.sourceGlobs（${design.sourceGlobs.join(',')}）没有匹配任何已跟踪文件：设计先于实现与变异范围依赖它，请改成项目源码目录`];
}

function run(argv) {
  const { dryRun } = parseArgs(argv);
  const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
  const raw = readRawConfig(repoRoot);
  const current = validateQaConfig(raw);
  if (current.merged.template && current.merged.template.role === 'source') {
    return {
      status: 'SKIPPED',
      lines: ['SUMMARY=模板源仓库不配置项目 qa 门禁', 'NEXT_ACTION=无需操作；qa setup 只用于实际项目'],
    };
  }
  if (current.problems.length > 0) throw setupError(`qa 配置不合法，先修正 ${CONFIG_FILE}：${current.problems.join('；')}`);
  if (!dryRun && isMainWorktree(repoRoot)) {
    return {
      status: 'BLOCKED',
      exitCode: 1,
      lines: [
        'SUMMARY=主 worktree 不改 tracked 文件，qa setup 写入被阻断',
        'NEXT_ACTION=执行 pnpm agent -- worktree new --phase=tdd --task <id> 后在 NEXT_CWD 重跑 pnpm agent -- qa setup；只预览可加 --dry-run',
      ],
    };
  }

  const planned = planSetup({ repoRoot, raw, merged: current.merged, business: current.business });
  const ignoreDirs = planIgnore(repoRoot, planned.reportDirs);
  const next = structuredClone(raw);
  for (const write of planned.writes) setPath(next, write.key.split('.'), write.value);
  const result = validateQaConfig(next);
  if (result.problems.length > 0) throw setupError(`生成的 qa 配置未通过校验，未写入：${result.problems.join('；')}`);

  const writeLines = [
    ...planned.writes.map((write) => `WRITE=${write.key}|${oneLine(write.shown)}`),
    ...ignoreDirs.map((dir) => `WRITE=.gitignore|${dir}`),
  ];
  if (!dryRun && planned.writes.length > 0) applyWrites({ repoRoot, raw, writes: planned.writes, ignoreDirs });
  else if (!dryRun && ignoreDirs.length > 0) applyWrites({ repoRoot, raw, writes: [], ignoreDirs });

  const { detection } = planned;
  const pending = detection.manual.length > 0 ? '；另按 MANUAL 行手动补齐' : '';
  let nextAction;
  if (dryRun) nextAction = '在 linked worktree 中去掉 --dry-run 重跑 pnpm agent -- qa setup 写入上述计划';
  else if (planned.businessOn) {
    nextAction = writeLines.length > 0
      ? `提交 agent.config.json 与 .gitignore 后，在干净工作区执行 pnpm agent -- qa run${pending}`
      : `执行 pnpm agent -- qa run${pending}`;
  } else {
    nextAction = `执行 pnpm agent -- qa automate --all 起草规格、路径与用例，完成后重跑 pnpm agent -- qa setup 自动开启业务门禁${pending}`;
  }
  const verb = dryRun ? '计划写入' : '写入';
  return {
    status: 'OK',
    lines: [
      `SUMMARY=检测到 ${detection.runners.length} 个运行器；${verb} ${writeLines.length} 项、跳过 ${planned.skips.length} 项、手动 ${detection.manual.length} 项；业务门禁${planned.businessOn ? '开启' : '关闭'}`,
      `NEXT_ACTION=${nextAction}`,
      `MODE=${dryRun ? 'dry-run' : 'write'}`,
      ...detection.runners.map((item) => `DETECTED=${item.runner}|${item.dir}|${item.source}`),
      ...writeLines,
      ...planned.skips.map((line) => `SKIP=${line}`),
      ...detection.manual.map((line) => `MANUAL=${line}`),
      ...planned.gates.map((line) => `GATE=${line}`),
      `GATE=design|on|mode=${result.merged.qa.design.mode}`,
      `GATE=integrity|on|mode=${result.merged.qa.integrity.mode}`,
      ...detection.risks,
      ...sourceGlobRisk(repoRoot, result.merged),
      ...(process.platform === 'win32' ? ['RISK=POSIX_SHELL|生成的命令使用 POSIX shell 语法（$PWD、VAR=value），Windows 上请在 Git Bash 中运行或手动改写'] : []),
    ],
  };
}

function main(argv = process.argv.slice(2)) {
  let outcome;
  try {
    outcome = run(argv);
  } catch (error) {
    const usage = error.code === 'SETUP_USAGE';
    const blocked = usage || error.code === 'SETUP_BLOCKED';
    console.log([
      `STATUS=${blocked ? 'BLOCKED' : 'FAILED'}`,
      `SUMMARY=${oneLine(blocked ? error.message : `qa setup 执行失败：${error.message}`)}`,
      `NEXT_ACTION=${usage ? '执行 pnpm agent -- qa setup [--dry-run]' : `修正上述问题后重跑 pnpm agent -- qa setup；${CONFIG_FILE} 与 .gitignore 未被修改`}`,
    ].join('\n'));
    process.exitCode = usage ? 2 : 1;
    return;
  }
  console.log([`STATUS=${outcome.status}`, ...outcome.lines].join('\n'));
  process.exitCode = outcome.exitCode ?? 0;
}

if (require.main === module) {
  exitOnHelp(USAGE);
  main();
}

module.exports = { buildReproCommand, buildSuite, businessReadiness, detectRunners, main, parseArgs, planSetup };

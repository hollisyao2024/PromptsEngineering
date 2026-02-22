#!/usr/bin/env node

/**
 * /qa verify — QA 验收检查
 *
 * 作用域：
 * - 默认 session：优先基于 /qa plan 会话状态文件验证（仅当前会话 QA 目标）
 * - --project：执行全项目验证（复用现有 qa:* 脚本）
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  buildModuleEntries,
  inferSessionModules,
  resolveExplicitModules,
  getQaPlanSessionStatePath,
} = require('./generate-qa');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

const CONFIG = {
  paths: {
    mainQA: 'docs/QA.md',
    prdModulesDir: 'docs/prd-modules',
    qaModulesDir: 'docs/qa-modules',
  },
};

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function parseModuleList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function parseArgs(argv) {
  let scope = 'session';
  let writeReports = false;
  const moduleSet = new Set(
    parseModuleList(process.env.QA_SESSION_MODULES || process.env.QA_MODULES || '')
  );

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project') {
      scope = 'project';
      continue;
    }
    if (arg === '--scope' && argv[i + 1]) {
      scope = argv[i + 1] === 'project' ? 'project' : 'session';
      i += 1;
      continue;
    }
    if (arg.startsWith('--scope=')) {
      scope = arg.split('=')[1] === 'project' ? 'project' : 'session';
      continue;
    }
    if (arg === '--modules' && argv[i + 1]) {
      parseModuleList(argv[i + 1]).forEach((moduleDir) => moduleSet.add(moduleDir));
      i += 1;
      continue;
    }
    if (arg.startsWith('--modules=')) {
      parseModuleList(arg.slice('--modules='.length)).forEach((moduleDir) => moduleSet.add(moduleDir));
      continue;
    }
    if (arg === '--module' && argv[i + 1]) {
      parseModuleList(argv[i + 1]).forEach((moduleDir) => moduleSet.add(moduleDir));
      i += 1;
      continue;
    }
    if (arg.startsWith('--module=')) {
      parseModuleList(arg.slice('--module='.length)).forEach((moduleDir) => moduleSet.add(moduleDir));
      continue;
    }
    if (arg === '--write-reports') {
      writeReports = true;
      continue;
    }
  }

  return {
    scope: scope === 'project' ? 'project' : 'session',
    modules: Array.from(moduleSet),
    writeReports,
  };
}

function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.error) {
    if (allowFailure) return '';
    throw result.error;
  }

  if (result.status !== 0) {
    if (allowFailure) return '';
    const stderr = (result.stderr || '').trim();
    throw new Error(`git ${args.join(' ')} failed (${result.status})${stderr ? `: ${stderr}` : ''}`);
  }

  return result.stdout || '';
}

function readFile(filePath) {
  const fullPath = path.resolve(repoRoot, filePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf8');
}

function readJson(filePath) {
  const content = readFile(filePath);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function uniqueMatches(content, regex) {
  if (!content) return new Set();
  return new Set(content.match(regex) || []);
}

function parseModuleFromQaPath(filePath) {
  const normalized = normalizePath(filePath);
  const match = normalized.match(/^docs\/qa-modules\/([^/]+)\/QA\.md$/i);
  return match ? match[1] : null;
}

function getChangedQaFilesFromWorkingTree() {
  const statusOut = runGit(['status', '--porcelain'], { allowFailure: true });
  if (!statusOut.trim()) return [];

  return statusOut
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const rawPath = line.slice(3).trim();
      return rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1).trim() : rawPath;
    })
    .map(normalizePath)
    .filter((file) => file === CONFIG.paths.mainQA || /^docs\/qa-modules\/[^/]+\/QA\.md$/i.test(file));
}

function getChangedFilesForSession() {
  const fileSet = new Set();
  const diffSources = [
    ['diff', '--name-only', '--diff-filter=ACMR', 'origin/main...HEAD'],
    ['diff', '--name-only', '--diff-filter=ACMR', 'origin/master...HEAD'],
    ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD~1..HEAD'],
  ];

  for (const args of diffSources) {
    const out = runGit(args, { allowFailure: true });
    if (!out.trim()) continue;
    out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => fileSet.add(normalizePath(line)));
    break;
  }

  getChangedQaFilesFromWorkingTree().forEach((line) => fileSet.add(line));
  return Array.from(fileSet).sort();
}

function resolveExplicitTargets(args, moduleEntries) {
  if (args.modules.length === 0) return null;

  const { resolved, unknown } = resolveExplicitModules(moduleEntries, args.modules);
  if (unknown.length > 0) {
    log(`⚠️ 忽略未知模块: ${unknown.join(', ')}`, 'yellow');
  }

  return {
    source: 'explicit-modules',
    files: resolved.map((entry) => entry.qaPath),
    modules: resolved.map((entry) => entry.moduleDir),
    sessionState: null,
  };
}

function resolveTargetsFromQaPlanState() {
  const statePath = getQaPlanSessionStatePath();
  const state = readJson(statePath);
  if (!state || state.scope !== 'session' || !Array.isArray(state.touchedFiles) || state.touchedFiles.length === 0) return null;

  const files = Array.from(
    new Set(
      state.touchedFiles
        .map(normalizePath)
        .filter((file) => file === CONFIG.paths.mainQA || /^docs\/qa-modules\/[^/]+\/QA\.md$/i.test(file))
    )
  );

  if (files.length === 0) return null;

  return {
    source: `qa-plan-session-state (${statePath})`,
    files,
    modules: Array.isArray(state.modules) ? state.modules : files.map(parseModuleFromQaPath).filter(Boolean),
    sessionState: state,
  };
}

function resolveTargetsFromChangedQaFiles() {
  const files = Array.from(new Set(getChangedQaFilesFromWorkingTree()));
  if (files.length === 0) return null;
  return {
    source: 'working-tree-qa-changes',
    files,
    modules: files.map(parseModuleFromQaPath).filter(Boolean),
    sessionState: null,
  };
}

function resolveTargetsFromInference(moduleEntries) {
  const changedFiles = getChangedFilesForSession();
  const branchName = runGit(['branch', '--show-current'], { allowFailure: true }).trim();
  const modules = inferSessionModules(moduleEntries, changedFiles, branchName).map((entry) => entry.moduleDir);
  if (modules.length === 0) return null;

  const files = modules.map((moduleDir) =>
    path.posix.join(CONFIG.paths.qaModulesDir, moduleDir, 'QA.md')
  );

  return {
    source: 'session-diff-inference',
    files,
    modules,
    sessionState: null,
  };
}

function resolveSessionTargets(args, moduleEntries) {
  const explicitTargets = resolveExplicitTargets(args, moduleEntries);
  if (explicitTargets) return explicitTargets;

  const stateTargets = resolveTargetsFromQaPlanState();
  if (stateTargets) return stateTargets;

  const changedTargets = resolveTargetsFromChangedQaFiles();
  if (changedTargets) return changedTargets;

  return resolveTargetsFromInference(moduleEntries);
}

function validateQaFile(filePath) {
  const content = readFile(filePath);
  const result = {
    target: filePath,
    errors: [],
    warnings: [],
    stats: {
      headingCount: 0,
      storyCount: 0,
      testCaseCount: 0,
      validStoryRefCount: 0,
      storyCoverage: null,
    },
  };

  if (!content) {
    result.errors.push('文件不存在');
    return result;
  }

  if (!content.trim()) {
    result.errors.push('文件为空');
    return result;
  }

  const headingMatches = content.match(/^##\s+/gm) || [];
  result.stats.headingCount = headingMatches.length;
  if (headingMatches.length === 0) {
    result.warnings.push('未检测到二级章节（##）');
  }

  const storyIds = Array.from(uniqueMatches(content, /\bUS-[A-Z]+-\d{3}\b/g));
  const testCaseIds = Array.from(uniqueMatches(content, /\bTC-[A-Z0-9]+-[A-Z0-9]+\b/g));
  result.stats.storyCount = storyIds.length;
  result.stats.testCaseCount = testCaseIds.length;

  if (storyIds.length === 0) {
    result.warnings.push('未检测到 Story ID（US-XXX-001）');
  }
  if (testCaseIds.length === 0) {
    result.warnings.push('未检测到 Test Case ID（TC-XXX-001）');
  }

  const invalidTcIds = testCaseIds.filter((id) => !/^TC-[A-Z]+-\d{3}$/.test(id));
  if (invalidTcIds.length > 0) {
    result.errors.push(`Test Case ID 格式异常: ${invalidTcIds.join(', ')}`);
  }

  const moduleDir = parseModuleFromQaPath(filePath);
  if (!moduleDir) return result;

  const prdPath = path.posix.join(CONFIG.paths.prdModulesDir, moduleDir, 'PRD.md');
  const prdContent = readFile(prdPath);
  if (!prdContent) {
    result.warnings.push(`模块 PRD 不存在，跳过 Story 参照校验: ${prdPath}`);
    return result;
  }

  const prdStories = uniqueMatches(prdContent, /\bUS-[A-Z]+-\d{3}\b/g);
  if (prdStories.size === 0) {
    result.warnings.push('模块 PRD 未检测到 Story ID，跳过覆盖率统计');
    return result;
  }

  const invalidStoryRefs = storyIds.filter((id) => !prdStories.has(id));
  if (invalidStoryRefs.length > 0) {
    result.errors.push(`引用了 PRD 不存在的 Story: ${invalidStoryRefs.join(', ')}`);
  }

  const validStoryRefCount = storyIds.filter((id) => prdStories.has(id)).length;
  result.stats.validStoryRefCount = validStoryRefCount;
  result.stats.storyCoverage = Math.round((validStoryRefCount / prdStories.size) * 100);

  return result;
}

function printSessionSummary(targets, results) {
  log('\n🧪 session 验证范围', 'cyan');
  log(`   - 来源: ${targets.source}`, 'gray');
  if (targets.modules.length > 0) {
    log(`   - 模块: ${targets.modules.join(', ')}`, 'gray');
  }
  if (targets.sessionState && targets.sessionState.generatedAt) {
    log(`   - 对应 /qa plan 时间: ${targets.sessionState.generatedAt}`, 'gray');
  }

  results.forEach((item) => {
    log(`\n📄 ${item.target}`, 'cyan');
    log(
      `   headings=${item.stats.headingCount} | stories=${item.stats.storyCount} | tc=${item.stats.testCaseCount}`,
      'gray'
    );
    if (item.stats.storyCoverage !== null) {
      log(`   prd-story-coverage=${item.stats.storyCoverage}%`, 'gray');
    }
    if (item.errors.length === 0 && item.warnings.length === 0) {
      log('   ✅ 通过', 'green');
      return;
    }
    item.errors.forEach((msg) => log(`   ❌ ${msg}`, 'red'));
    item.warnings.forEach((msg) => log(`   ⚠️  ${msg}`, 'yellow'));
  });
}

function calculateVerdict(results) {
  const errorCount = results.reduce((sum, item) => sum + item.errors.length, 0);
  const warningCount = results.reduce((sum, item) => sum + item.warnings.length, 0);

  if (errorCount > 0) return { verdict: 'No-Go', errorCount, warningCount, exitCode: 1 };
  if (warningCount > 0) return { verdict: 'Conditional', errorCount, warningCount, exitCode: 0 };
  return { verdict: 'Go', errorCount, warningCount, exitCode: 0 };
}

function runProjectVerify(args) {
  log('🧭 作用域：project（全项目验收）', 'cyan');
  log(
    args.writeReports
      ? '📝 报告输出：开启（将写入 docs/data/qa-reports）'
      : '📝 报告输出：关闭（默认只校验，不写入报告）',
    'gray'
  );

  const checks = [
    { name: 'qa:lint', required: true },
    { name: 'qa:sync-prd-qa-ids', required: true },
    { name: 'qa:coverage-report', required: false },
    { name: 'qa:check-defect-blockers', required: true },
  ];

  let requiredFailed = false;
  for (const check of checks) {
    log(`\n▶ 运行 ${check.name}`, 'cyan');
    const result = spawnSync('pnpm', ['run', check.name], {
      cwd: repoRoot,
      stdio: 'inherit',
      encoding: 'utf8',
      env: {
        ...process.env,
        QA_WRITE_REPORTS: args.writeReports ? '1' : '0',
      },
    });
    if (result.status === 0) {
      log(`✅ ${check.name} 通过`, 'green');
    } else {
      log(`❌ ${check.name} 失败（exit ${result.status}）`, 'red');
      if (check.required) requiredFailed = true;
    }
  }

  if (requiredFailed) {
    log('\n发布建议: ❌ No-Go', 'red');
    return 1;
  }

  log('\n发布建议: ✅ Go / ⚠️ Conditional（请结合覆盖率报告）', 'green');
  return 0;
}

function runSessionVerify(args) {
  log('🧭 作用域：session（仅会话相关 QA 变更）', 'cyan');

  const moduleEntries = buildModuleEntries();
  if (moduleEntries.length === 0) {
    log('❌ 未找到模块目录（docs/prd-modules/*/PRD.md 或 docs/qa-modules/*/QA.md）', 'red');
    return 1;
  }

  const targets = resolveSessionTargets(args, moduleEntries);
  if (!targets || targets.files.length === 0) {
    log('ℹ️ 未识别到当前会话 QA 目标（no-op）。', 'yellow');
    return 0;
  }

  const results = targets.files.map((file) => validateQaFile(file));
  printSessionSummary(targets, results);

  const summary = calculateVerdict(results);
  log('\n============================================================', 'cyan');
  log('QA Verify 汇总', 'cyan');
  log('============================================================', 'cyan');
  log(
    `结论: ${summary.verdict}`,
    summary.verdict === 'No-Go' ? 'red' : summary.verdict === 'Conditional' ? 'yellow' : 'green'
  );
  log(`错误: ${summary.errorCount} | 警告: ${summary.warningCount}`, 'gray');

  return summary.exitCode;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  log('============================================================', 'cyan');
  log('QA 验收检查工具 v1.1.0', 'cyan');
  log('============================================================', 'cyan');

  const exitCode = args.scope === 'project' ? runProjectVerify(args) : runSessionVerify(args);
  process.exit(exitCode);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    log(`\n❌ 执行失败: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  resolveSessionTargets,
  validateQaFile,
};

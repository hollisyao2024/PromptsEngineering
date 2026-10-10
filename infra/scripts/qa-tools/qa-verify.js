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
const {
  getMainRepoRoot,
  loadConfig,
  resolveRepoRoot,
} = require('../shared/config');
const { buildGitHubGitEnv } = require('../shared/github-auth');
const {
  buildQaVerificationReceipt,
  removeQaVerificationReceipt,
  writeQaVerificationReceipt,
} = require('./qa-verification-state');
const { createWindowsCmdInvocation, resolvePnpmBin } = require('../shared/toolchain-env');
const { listTaskStates, runtimeContext } = require('../agent-runner/agent-task');
const { verifyTestScopeEvidence } = require('./qa-test-scope');
const { verifyBusinessAcceptance } = require('./qa-business-gate');
const { parsePrdStories } = require('./business-spec');
const { exitOnHelp } = require('../shared/cli-help');
const { oneLine, resultBlockLines, resultExitCode } = require('../shared/result-block');

const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
const MODULE_ID_SOURCE = '[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*';
const STORY_ID_SOURCE = `US-${MODULE_ID_SOURCE}-\\d{3}`;
const TEST_CASE_ID_SOURCE = `TC-${MODULE_ID_SOURCE}-\\d{3}`;

const CONFIG = {
  paths: {
    mainQA: 'docs/QA.md',
    prdModulesDir: 'docs/prd-modules',
    qaModulesDir: 'docs/qa-modules',
  },
};

function isTemplateRepository(root = repoRoot) {
  const configPath = path.join(root, 'agent.config.json');
  if (!fs.existsSync(configPath)) return false;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')).template?.role === 'source';
  } catch {
    return false;
  }
}

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

function runGit(args, { allowFailure = false, cwd = repoRoot } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: buildGitHubGitEnv({ repoRoot, cwd, args, env: process.env }),
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

// The receipt fetch is the only network step in qa verify. A transient failure (proxy reset, DNS hiccup) gets one
// bounded retry of the identical command; the second failure propagates with code QA_FETCH_FAILED so the caller
// reports it as a tool_error instead of a stale base, and nothing else is retried.
const QA_FETCH_ATTEMPTS = 2;

function codedError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function fetchWithBoundedRetry(_runGit, args, attempts = QA_FETCH_ATTEMPTS) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return _runGit(args);
    } catch (error) {
      lastError = error;
    }
  }
  throw codedError('QA_FETCH_FAILED', `git fetch failed after ${attempts} attempts: ${lastError.message}`, lastError);
}

// qa verify ends with the parsable block from docs/CONVENTIONS.md §7. Gate failures the operator can act on are
// BLOCKED with a stable reason code and the matching next action; a failed tool (network) or an unexpected error is
// FAILED so the caller records a tool_error instead of treating it as a stale base.
const QA_VERIFY_BLOCKED_NEXT_ACTION = {
  STALE_QA_BASE: '在当前 worktree 执行 git merge --no-edit origin/<base>，重跑受影响测试并追加 TEST_SCOPE_DECISION/RESULT，再执行 pnpm agent -- tdd push 与 pnpm agent -- qa verify',
  HEAD_NOT_PUSHED: '执行 pnpm agent -- tdd push 推送当前 HEAD 后重跑 pnpm agent -- qa verify',
  QA_BRANCH_REQUIRED: '在任务功能分支的 worktree 中重跑 pnpm agent -- qa verify',
  TEST_SCOPE_EVIDENCE: '在当前 mutation 任务 checkpoint 中补录 TEST_SCOPE_DECISION 与绑定当前 HEAD 的 TEST_SCOPE_RESULT 后重跑 pnpm agent -- qa verify',
  QA_VERDICT_NO_GO: '修复上方列出的 QA 文档错误后重跑 pnpm agent -- qa verify',
  BUSINESS_GATE_BLOCKED: '按 BUSINESS_BLOCK 行补齐业务验收并重跑 pnpm agent -- qa run，再执行 pnpm agent -- qa verify',
  ARCHITECTURE_PACKAGE_MISSING: '执行 pnpm agent -- template sync --include architecture 安装架构包后重跑 pnpm agent -- qa verify',
  ARCHITECTURE_CHECK_FAILED: '执行 pnpm agent -- architecture check 并修复列出的失败项后重跑 pnpm agent -- qa verify',
};
const QA_VERIFY_FAILED_NEXT_ACTION = {
  QA_FETCH_FAILED: '核实网络、代理与 GH_TOKEN 后重试 pnpm agent -- qa verify；按 tool_error 留痕，不改写命令或更换入口',
};

const QA_VERIFY_BLOCKED_SUMMARY = {
  QA_VERDICT_NO_GO: 'QA 验收检查存在错误，回执未签发',
  BUSINESS_GATE_BLOCKED: '业务验收门禁未通过，回执未签发',
};

// 门禁阻断 { reason, summary? } → 单条阻断时与改造前的结果块逐字一致；多条时 REASON 取第一条（按门禁执行顺序），
// SUMMARY 点名全部代码，NEXT_ACTION 按代码汇总各门禁的下一步。
function normalizeBlockers(blockers) {
  return blockers.map(({ reason, summary }) => ({
    reason,
    summary: summary || QA_VERIFY_BLOCKED_SUMMARY[reason] || QA_VERIFY_BLOCKED_SUMMARY.QA_VERDICT_NO_GO,
    nextAction: QA_VERIFY_BLOCKED_NEXT_ACTION[reason] || QA_VERIFY_BLOCKED_NEXT_ACTION.QA_VERDICT_NO_GO,
  }));
}

function describeBlockers(blockers) {
  const described = normalizeBlockers(blockers);
  if (described.length === 1) return { status: 'BLOCKED', ...described[0] };
  return {
    status: 'BLOCKED',
    reason: described[0].reason,
    summary: `${described.length} 项门禁阻断（${described.map((item) => item.reason).join('、')}），回执未签发：`
      + described.map((item) => `${item.reason}: ${item.summary}`).join('；'),
    nextAction: described.map((item) => `${item.reason}: ${item.nextAction}`).join('；'),
  };
}

function describeQaVerifyOutcome({ error, blockers, exitCode = 0, failureReason, receipt, receiptPath } = {}) {
  if (blockers && blockers.length > 0) return describeBlockers(blockers);
  if (error) {
    const code = error.code;
    if (QA_VERIFY_BLOCKED_NEXT_ACTION[code]) {
      return { status: 'BLOCKED', reason: code, summary: error.message, nextAction: QA_VERIFY_BLOCKED_NEXT_ACTION[code] };
    }
    if (QA_VERIFY_FAILED_NEXT_ACTION[code]) {
      return { status: 'FAILED', reason: code, summary: error.message, nextAction: QA_VERIFY_FAILED_NEXT_ACTION[code] };
    }
    return {
      status: 'FAILED',
      reason: 'UNEXPECTED_ERROR',
      summary: `qa verify 执行失败：${error.message}`,
      nextAction: '查看 stderr 中的堆栈，修复后重跑 pnpm agent -- qa verify',
    };
  }
  if (exitCode !== 0) return describeBlockers([{ reason: failureReason || 'QA_VERDICT_NO_GO' }]);
  return {
    status: 'OK',
    summary: `QA 验收通过并签发回执 ${receiptPath}（BASE_SHA=${receipt.base_sha} HEAD_SHA=${receipt.head_sha}）`,
    nextAction: '执行 pnpm agent -- qa merge',
  };
}

function printResultBlock(outcome) {
  const color = outcome.status === 'OK' ? 'green' : outcome.status === 'BLOCKED' ? 'yellow' : 'red';
  for (const line of resultBlockLines(outcome)) log(line, color);
}

function captureQaVerificationIdentity({
  config = loadConfig({ repoRoot }),
  runGit: _runGit = runGit,
  verifiedAt,
} = {}) {
  const baseBranch = config.baseBranch || 'main';
  const branch = _runGit(['branch', '--show-current']).trim();
  if (!branch) throw codedError('QA_BRANCH_REQUIRED', 'QA verification requires an attached feature branch.');
  if (branch === baseBranch) {
    throw codedError('QA_BRANCH_REQUIRED', `QA verification must run on a feature branch, not configured base ${baseBranch}.`);
  }

  fetchWithBoundedRetry(_runGit, [
    'fetch', '--prune', 'origin',
    `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`,
    `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
  ]);

  const baseSha = _runGit([
    'rev-parse', '--verify', `refs/remotes/origin/${baseBranch}^{commit}`,
  ]).trim().toLowerCase();
  const remoteHeadSha = _runGit([
    'rev-parse', '--verify', `refs/remotes/origin/${branch}^{commit}`,
  ]).trim().toLowerCase();
  const localHeadSha = _runGit(['rev-parse', '--verify', 'HEAD^{commit}']).trim().toLowerCase();

  if (localHeadSha !== remoteHeadSha) {
    throw codedError(
      'HEAD_NOT_PUSHED',
      `local HEAD ${localHeadSha || '<missing>'} does not match origin/${branch} ` +
      `${remoteHeadSha || '<missing>'}; push the exact branch and rerun qa verify.`,
    );
  }

  try {
    _runGit(['merge-base', '--is-ancestor', baseSha, remoteHeadSha]);
  } catch {
    const error = new Error(
      `origin/${baseBranch} (${baseSha}) is not an ancestor of origin/${branch} (${remoteHeadSha}); ` +
      'synchronize the feature branch and rerun QA.',
    );
    error.code = 'STALE_QA_BASE';
    throw error;
  }

  return buildQaVerificationReceipt({
    baseBranch,
    branch,
    baseSha,
    headSha: remoteHeadSha,
    verifiedAt,
  });
}

function readFile(filePath, root = repoRoot) {
  const fullPath = path.resolve(root, filePath);
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

function collectAllPrdStories(root = repoRoot) {
  const modulesRoot = path.resolve(root, CONFIG.paths.prdModulesDir);
  const stories = new Set();
  if (!fs.existsSync(modulesRoot)) return stories;

  for (const entry of fs.readdirSync(modulesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const content = readFile(path.posix.join(CONFIG.paths.prdModulesDir, entry.name, 'PRD.md'), root);
    for (const storyId of uniqueMatches(content, new RegExp(`\\b${STORY_ID_SOURCE}\\b`, 'g'))) {
      stories.add(storyId);
    }
  }

  return stories;
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

function getChangedFilesForSession(config = loadConfig({ repoRoot })) {
  const fileSet = new Set();
  const baseBranch = config.baseBranch || 'main';
  const diffSources = [
    ['diff', '--name-only', '--diff-filter=ACMR', `origin/${baseBranch}...HEAD`],
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

function resolveTargetsFromQaPlanState(statePath = getQaPlanSessionStatePath()) {
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

// root 仅供测试把夹具放在临时目录，生产调用沿用当前 worktree 根。
function validateQaFile(filePath, { root = repoRoot } = {}) {
  const content = readFile(filePath, root);
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

  // Module IDs may include digits and multiple uppercase segments, such as E2E or MODEL-CONFIG.
  const storyIds = Array.from(uniqueMatches(content, new RegExp(`\\b${STORY_ID_SOURCE}\\b`, 'g')));
  const testCaseIds = Array.from(uniqueMatches(content, new RegExp(`\\b${TEST_CASE_ID_SOURCE}\\b`, 'g')));
  result.stats.storyCount = storyIds.length;
  result.stats.testCaseCount = testCaseIds.length;

  if (storyIds.length === 0) {
    result.warnings.push('未检测到 Story ID（US-XXX-001）');
  }
  if (testCaseIds.length === 0) {
    result.warnings.push('未检测到 Test Case ID（TC-XXX-001）');
  }

  const validTestCaseId = new RegExp(`^${TEST_CASE_ID_SOURCE}$`);
  const invalidTcIds = testCaseIds.filter((id) => !validTestCaseId.test(id));
  if (invalidTcIds.length > 0) {
    result.errors.push(`Test Case ID 格式异常: ${invalidTcIds.join(', ')}`);
  }

  const moduleDir = parseModuleFromQaPath(filePath);
  if (!moduleDir) return result;

  const prdPath = path.posix.join(CONFIG.paths.prdModulesDir, moduleDir, 'PRD.md');
  const prdContent = readFile(prdPath, root);
  if (!prdContent) {
    result.warnings.push(`模块 PRD 不存在，跳过 Story 参照校验: ${prdPath}`);
    return result;
  }

  // 覆盖率分母是本模块自己的 Story（Story 表 + 原子 AC 表），横幅、依赖列等处提到的他模块 Story 不计入。
  const prdStories = new Set(parsePrdStories(prdContent).stories);
  if (prdStories.size === 0) {
    result.warnings.push('模块 PRD 未检测到 Story ID，跳过覆盖率统计');
    return result;
  }

  // Cross-module aggregate QA files may reference Stories owned by sibling modules.
  // Validate references against the global PRD set while keeping coverage module-local.
  const allPrdStories = collectAllPrdStories(root);
  const invalidStoryRefs = storyIds.filter((id) => !allPrdStories.has(id));
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

const BASE_PROJECT_CHECKS = Object.freeze([
  { name: 'qa:lint', required: true },
  { name: 'qa:sync-prd-qa-ids', required: true },
  { name: 'qa:coverage-report', required: false },
  { name: 'qa:check-defect-blockers', required: true },
]);

function resolveProjectChecks(config = {}) {
  const configured = config.qa?.projectChecks || [];
  if (!Array.isArray(configured)) {
    throw new Error('invalid qa.projectChecks entry: expected an array');
  }
  const checks = new Map(BASE_PROJECT_CHECKS.map((check) => [check.name, { ...check }]));
  for (const entry of configured) {
    if (
      !entry
      || typeof entry !== 'object'
      || Array.isArray(entry)
      || typeof entry.name !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(entry.name)
      || typeof entry.required !== 'boolean'
    ) {
      throw new Error(`invalid qa.projectChecks entry: ${JSON.stringify(entry)}`);
    }
    const current = checks.get(entry.name);
    checks.set(entry.name, {
      name: entry.name,
      required: Boolean(entry.required || current?.required),
    });
  }
  return Array.from(checks.values());
}

function runProjectVerify(args, config = loadConfig({ repoRoot })) {
  log('🧭 作用域：project（全项目验收）', 'cyan');
  log(
    args.writeReports
      ? '📝 报告输出：开启（将写入 docs/data/qa-reports）'
      : '📝 报告输出：关闭（默认只校验，不写入报告）',
    'gray'
  );

  const checks = resolveProjectChecks(config);

  let requiredFailed = false;
  for (const check of checks) {
    log(`\n▶ 运行 ${check.name}`, 'cyan');
    const invocation = createPnpmRunInvocation(check.name, {
      cwd: repoRoot,
      env: {
        ...process.env,
        QA_WRITE_REPORTS: args.writeReports ? '1' : '0',
      },
    });
    const result = spawnSync(invocation.bin, invocation.args, invocation.options);
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

function createPnpmRunInvocation(scriptName, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const pnpmBin = options.pnpmBin || resolvePnpmBin(platform, env);
  return createWindowsCmdInvocation(
    pnpmBin,
    ['run', scriptName],
    {
      cwd: options.cwd || repoRoot,
      stdio: 'inherit',
      encoding: 'utf8',
      env,
    },
    platform,
    env,
  );
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

// 业务验收门禁：qa.business 启用时复验 `qa run` 写出的结果。
// 返回 { passed, business }：阻断时 passed 为 false（调用方不得签发回执）；放行且门禁已启用时 business 是写进回执的摘要。
// 未启用时什么都不读、不输出，business 为 null，回执保持门禁接入前的结构。
function checkBusinessGate({ config, mainRoot, headSha }) {
  const gate = verifyBusinessAcceptance({ repoRoot, mainRoot, config, headSha });
  if (!gate.enabled) return { passed: true, business: null };
  for (const line of gate.lines) {
    log(line, line.startsWith('BUSINESS_RISK=') ? 'yellow' : gate.blocked ? 'red' : 'green');
  }
  if (gate.blocked) {
    log('业务验收未通过，回执未签发。', 'red');
    return { passed: false, business: null };
  }
  const { outcome } = gate;
  return {
    passed: true,
    business: {
      gate: 'PASS',
      required_priorities: outcome.requiredPriorities,
      acs_proven: outcome.provenCount,
      risk_count: outcome.riskCount,
      config_digest: outcome.configDigest,
    },
  };
}

// 只在单个门禁内被吞下的已知阻断码；其余异常（配置非法、未预期错误）照常抛出，以 FAILED 结束。
function collectGateError(blockers, error) {
  if (!QA_VERIFY_BLOCKED_NEXT_ACTION[error.code]) throw error;
  blockers.push({ reason: error.code, summary: error.message });
}

// 执行分两段：
// 1. 前置条件，失败即立即退出——后续门禁没有可信的判定对象：配置加载失败、不在功能分支（QA_BRANCH_REQUIRED）、
//    fetch 失败（QA_FETCH_FAILED）、本地 HEAD 与远端分支不一致（HEAD_NOT_PUSHED）、功能分支落后配置主干
//    （STALE_QA_BASE），以及任何未预期异常。
// 2. 可独立评估的门禁，全部执行完再统一判定：架构检查、QA 文档或 projectChecks、测试范围证据、业务验收门禁。
//    每个门禁照常打印自己的明细行（❌ 文档错误、BUSINESS_BLOCK= 等），阻断另汇总为 QA_VERIFY_BLOCK=<code>|<summary>；
//    任一阻断即不签发回执。
function main() {
  const args = parseArgs(process.argv.slice(2));

  const config = loadConfig({ repoRoot });
  const mainRoot = getMainRepoRoot(repoRoot);
  removeQaVerificationReceipt(config, mainRoot, repoRoot);

  log('============================================================', 'cyan');
  log('QA 验收检查工具 v1.1.0', 'cyan');
  log('============================================================', 'cyan');

  const receipt = captureQaVerificationIdentity({ config });

  const blockers = [];
  try {
    require('../shared/architecture-check').runArchitectureCheck(repoRoot);
  } catch (error) {
    collectGateError(blockers, error);
  }

  const templateSource = (config.template && config.template.role === 'source') || isTemplateRepository();
  if (templateSource) {
    log('模板源仓库：跳过业务 PRD/QA 验收门禁。', 'yellow');
  } else {
    const verdictExit = args.scope === 'project' ? runProjectVerify(args, config) : runSessionVerify(args);
    if (verdictExit !== 0) blockers.push({ reason: 'QA_VERDICT_NO_GO' });

    const taskContext = runtimeContext(repoRoot);
    try {
      const scope = verifyTestScopeEvidence({
        states: listTaskStates({ runsRoot: taskContext.runsRoot }),
        context: taskContext,
        headSha: receipt.head_sha,
        runsRoot: taskContext.runsRoot,
      });
      if (scope.skipped) log('TEST_SCOPE_CHECK=SKIPPED_NON_MUTATION', 'gray');
      else log(`TEST_SCOPE_TASK=${scope.taskId} TEST_SCOPE_MODE=${scope.mode}`, 'gray');
    } catch (error) {
      if (!error.code) error.code = 'TEST_SCOPE_EVIDENCE';
      collectGateError(blockers, error);
    }

    const gate = checkBusinessGate({ config, mainRoot, headSha: receipt.head_sha });
    if (!gate.passed) blockers.push({ reason: 'BUSINESS_GATE_BLOCKED' });
    else if (gate.business) receipt.business = gate.business;
  }

  if (blockers.length > 0) {
    for (const { reason, summary } of normalizeBlockers(blockers)) log(`QA_VERIFY_BLOCK=${reason}|${oneLine(summary)}`, 'red');
    return describeQaVerifyOutcome({ blockers });
  }

  const receiptPath = writeQaVerificationReceipt(config, mainRoot, repoRoot, receipt);
  log(`QA_RECEIPT=${receiptPath}`, 'green');
  log(`BASE_BRANCH=${receipt.base_branch}`, 'gray');
  log(`BASE_SHA=${receipt.base_sha}`, 'gray');
  log(`HEAD_SHA=${receipt.head_sha}`, 'gray');
  return describeQaVerifyOutcome({ exitCode: 0, receipt, receiptPath });
}

if (require.main === module) {
  exitOnHelp('Usage: pnpm agent -- qa verify [--project | --scope <session|project>] [--module <name>]\n\nRun QA verification and write the local base/head SHA receipt.\nWhen qa.business.enabled is true, also re-check the results written by `pnpm agent -- qa run`\nand withhold the receipt unless every required acceptance criterion is proven.');
  let outcome;
  try {
    outcome = main();
  } catch (error) {
    outcome = describeQaVerifyOutcome({ error });
    if (outcome.status === 'FAILED') console.error(error);
  }
  log('');
  printResultBlock(outcome);
  process.exit(resultExitCode(outcome.status));
}

module.exports = {
  captureQaVerificationIdentity,
  describeQaVerifyOutcome,
  isTemplateRepository,
  createPnpmRunInvocation,
  parseArgs,
  resolveProjectChecks,
  resolveTargetsFromQaPlanState,
  resolveSessionTargets,
  validateQaFile,
};

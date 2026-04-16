#!/usr/bin/env node

/**
 * QA 文档自动生成工具
 * - 默认 session 作用域：仅更新当前会话关联模块的 QA 文档
 * - 显式 --project：执行全项目刷新（主 QA + 模块 QA）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writeInProgressFields } = require('../tdd-tools/agent-state-utils');

const CONFIG = {
  paths: {
    prd: 'docs/PRD.md',
    arch: 'docs/ARCH.md',
    task: 'docs/TASK.md',
    qa: 'docs/QA.md',
    traceabilityMatrix: 'docs/data/traceability-matrix.md',
    prdModulesDir: 'docs/prd-modules',
    qaModulesDir: 'docs/qa-modules',
  },
  splitThresholds: {
    minStories: 50,
    minTestCases: 100,
    minDomains: 3,
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

function parseModuleList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function parseCliArgs(argv) {
  let scope = 'session';
  let dryRun = false;
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
    if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { scope, dryRun, modules: Array.from(moduleSet) };
}

function readFile(filePath) {
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf8');
}

function writeFile(filePath, content) {
  const fullPath = path.resolve(process.cwd(), filePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

function fileExists(filePath) {
  return fs.existsSync(path.resolve(process.cwd(), filePath));
}

function writeJsonFile(filePath, payload) {
  writeFile(filePath, JSON.stringify(payload, null, 2) + '\n');
}

function getQaPlanSessionStatePath() {
  const customPath = process.env.QA_PLAN_SESSION_STATE_PATH;
  if (customPath && customPath.trim()) return customPath.trim();
  return path.join(os.tmpdir(), 'linghuiai-qa-plan-session.json');
}

function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.error) {
    if (allowFailure) return '';
    throw result.error;
  }

  if (result.status !== 0) {
    if (allowFailure) return '';
    throw new Error(`git ${args.join(' ')} failed with exit ${result.status}`);
  }

  return result.stdout || '';
}

function listDirsWithRequiredFile(baseDir, requiredFile) {
  const fullBaseDir = path.resolve(process.cwd(), baseDir);
  if (!fs.existsSync(fullBaseDir)) return [];

  return fs
    .readdirSync(fullBaseDir, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory()) return false;
      const requiredPath = path.join(fullBaseDir, entry.name, requiredFile);
      return fs.existsSync(requiredPath);
    })
    .map((entry) => entry.name)
    .sort();
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
      .forEach((line) => fileSet.add(line));
    break;
  }

  const statusOut = runGit(['status', '--porcelain'], { allowFailure: true });
  if (statusOut.trim()) {
    statusOut
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const rawPath = line.slice(3).trim();
        const normalizedPath = rawPath.includes(' -> ')
          ? rawPath.split(' -> ').at(-1).trim()
          : rawPath;
        if (normalizedPath) fileSet.add(normalizedPath);
      });
  }

  return Array.from(fileSet).sort();
}

function parsePRD(content) {
  if (!content) return { stories: [], domains: [] };

  const storyIdRegex = /US-([A-Z0-9]+)-(\d+)/g;
  const stories = [];
  const domainSet = new Set();

  let match;
  while ((match = storyIdRegex.exec(content)) !== null) {
    const domain = match[1];
    const number = match[2];
    stories.push({
      id: `US-${domain}-${number}`,
      domain,
      number: parseInt(number, 10),
    });
    domainSet.add(domain);
  }

  return { stories, domains: Array.from(domainSet) };
}

function parseARCH(content) {
  if (!content) return { components: [], isMicroservice: false };

  const isMicroservice = /微服务|microservice|service-oriented/i.test(content);
  const componentRegex = /(?:Component|组件|服务)[:\s]+([^\n]+)/gi;
  const components = [];

  let match;
  while ((match = componentRegex.exec(content)) !== null) {
    components.push(match[1].trim());
  }

  return { components, isMicroservice };
}

function parseTASK(content) {
  if (!content) return { milestones: [], owners: [] };

  const milestoneRegex = /(?:M\d+|里程碑)[:\s]+([^\n]+)/gi;
  const ownerRegex = /@([a-zA-Z0-9_-]+)/g;

  const milestones = [];
  const ownerSet = new Set();

  let match;
  while ((match = milestoneRegex.exec(content)) !== null) {
    milestones.push(match[1].trim());
  }

  while ((match = ownerRegex.exec(content)) !== null) {
    ownerSet.add(match[1]);
  }

  return { milestones, owners: Array.from(ownerSet) };
}

function parseTraceabilityMatrix(content) {
  if (!content) return { mappings: [] };

  const mappings = [];
  for (const line of content.split('\n')) {
    const storyMatch = line.match(/US-([A-Z0-9]+)-(\d+)/);
    const testCaseMatch = line.match(/TC-([A-Z0-9]+)-(\d+)/);
    if (storyMatch && testCaseMatch) {
      mappings.push({ storyId: storyMatch[0], testCaseId: testCaseMatch[0] });
    }
  }
  return { mappings };
}

function shouldSplit(prdData) {
  const storyCount = prdData.stories.length;
  const domainCount = prdData.domains.length;
  const estimatedTestCases = storyCount * 3;

  return (
    storyCount > CONFIG.splitThresholds.minStories ||
    estimatedTestCases > CONFIG.splitThresholds.minTestCases ||
    domainCount >= CONFIG.splitThresholds.minDomains
  );
}

function prettifyModuleName(moduleDir) {
  return moduleDir
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function extractModuleNameFromPRD(prdContent, moduleDir) {
  if (!prdContent) return prettifyModuleName(moduleDir);
  const heading = prdContent.match(/^#\s+(.+)$/m);
  if (!heading) return prettifyModuleName(moduleDir);
  const text = heading[1].replace(/\[|\]|\(|\)/g, '').trim();
  return text || prettifyModuleName(moduleDir);
}

function buildModuleEntries() {
  const prdModuleDirs = listDirsWithRequiredFile(CONFIG.paths.prdModulesDir, 'PRD.md');
  const qaModuleDirs = listDirsWithRequiredFile(CONFIG.paths.qaModulesDir, 'QA.md');
  const moduleSet = new Set([...prdModuleDirs, ...qaModuleDirs]);

  return Array.from(moduleSet)
    .sort()
    .map((moduleDir) => {
      const prdPath = path.join(CONFIG.paths.prdModulesDir, moduleDir, 'PRD.md');
      const qaPath = path.join(CONFIG.paths.qaModulesDir, moduleDir, 'QA.md');
      const prdContent = readFile(prdPath);
      const prdData = parsePRD(prdContent || '');

      return {
        moduleDir,
        moduleName: extractModuleNameFromPRD(prdContent, moduleDir),
        prdPath,
        qaPath,
        stories: prdData.stories,
      };
    });
}

function escapeRegex(source) {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function parseModuleFromModuleDocPath(filePath, moduleSet) {
  const normalized = normalizePath(filePath);
  const match = normalized.match(/^docs\/(?:prd|arch|task|qa)-modules\/([^/]+)\//i);
  if (!match) return null;
  const moduleDir = match[1];
  return moduleSet.has(moduleDir) ? moduleDir : null;
}

function matchModuleInText(text, moduleDir) {
  const normalized = normalizePath(text.toLowerCase());
  const token = moduleDir.toLowerCase();
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(token)}([^a-z0-9]|$)`);
  return pattern.test(normalized);
}

function inferSessionModules(moduleEntries, changedFiles, branchName) {
  const moduleMap = new Map(moduleEntries.map((entry) => [entry.moduleDir, entry]));
  const moduleSet = new Set(moduleEntries.map((entry) => entry.moduleDir));
  const scores = new Map(moduleEntries.map((entry) => [entry.moduleDir, 0]));

  for (const file of changedFiles) {
    const normalized = normalizePath(file);

    // 规则 1：若改动落在模块文档目录，直接高权重命中该模块
    const fromDocPath = parseModuleFromModuleDocPath(normalized, moduleSet);
    if (fromDocPath) {
      scores.set(fromDocPath, (scores.get(fromDocPath) || 0) + 100);
      continue;
    }

    // 规则 2：按完整模块目录名在改动路径中匹配（不使用硬编码别名）
    for (const moduleDir of moduleSet) {
      if (matchModuleInText(normalized, moduleDir)) {
        scores.set(moduleDir, (scores.get(moduleDir) || 0) + 20);
      }
    }
  }

  // 规则 3：分支名仅作为弱信号，不覆盖文件路径推断
  if (branchName) {
    for (const moduleDir of moduleSet) {
      if (matchModuleInText(branchName, moduleDir)) {
        scores.set(moduleDir, (scores.get(moduleDir) || 0) + 5);
      }
    }
  }

  return Array.from(scores.entries())
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([moduleDir]) => moduleMap.get(moduleDir));
}

function resolveExplicitModules(moduleEntries, requestedModules) {
  const moduleMap = new Map(moduleEntries.map((entry) => [entry.moduleDir.toLowerCase(), entry]));
  const resolved = [];
  const unknown = [];
  const seen = new Set();

  for (const rawModule of requestedModules) {
    const key = String(rawModule || '').trim().toLowerCase();
    if (!key) continue;

    const entry = moduleMap.get(key);
    if (!entry) {
      unknown.push(rawModule);
      continue;
    }

    if (seen.has(entry.moduleDir)) continue;
    seen.add(entry.moduleDir);
    resolved.push(entry);
  }

  return { resolved, unknown };
}

function generateTestCasesTable(stories, prefix = 'GEN') {
  if (!stories || stories.length === 0) return '（暂无用户故事，请先完善模块 PRD）';

  let table = '| 用例 ID | 用例名称 | 关联 Story | 优先级 | 前置条件 | 状态 | 执行人 |\n';
  table += '|---------|---------|-----------|--------|---------|------|--------|\n';

  stories.slice(0, 10).forEach((story, index) => {
    const testCaseId = `TC-${prefix}-${String(index + 1).padStart(3, '0')}`;
    table += `| ${testCaseId} | ${story.id} 功能测试 | ${story.id} | P0 | （待补充） | 📝 待执行 | TBD |\n`;
  });

  if (stories.length > 10) {
    table += '| （更多） | ... | ... | ... | ... | ... | ... |\n';
    table += `\n> 共 ${stories.length} 个 Story，建议每个 Story 至少 3 条测试用例（正常/边界/异常）。\n`;
  }

  return table;
}

function toTestCaseDomainTag(moduleEntry) {
  const firstDomain = moduleEntry.stories[0]?.domain;
  if (firstDomain) return firstDomain;

  return moduleEntry.moduleDir
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 12) || 'MODULE';
}

function generateModuleQA(moduleEntry) {
  const today = new Date().toISOString().split('T')[0];
  const moduleTag = toTestCaseDomainTag(moduleEntry);
  const storyCount = moduleEntry.stories.length;

  return `# ${moduleEntry.moduleName} - 测试计划

> **所属主 QA**: [QA.md](../../QA.md)
> **最后更新**: ${today}
> **版本**: v0.1.0

---

## 1. 模块概述

**测试范围**：${moduleEntry.moduleName}（包含 ${storyCount} 个用户故事）

**测试关键指标**：
- 测试用例总数：${storyCount * 3} 条（预估）
- 测试通过率目标：≥ 95%
- 需求覆盖率目标：100%

**关联文档**：
- **模块 PRD**: [../../${moduleEntry.prdPath}](${path.posix.join('..', '..', moduleEntry.prdPath)})
- **模块 ARCH**: [../../docs/arch-modules/${moduleEntry.moduleDir}/ARCH.md](../../docs/arch-modules/${moduleEntry.moduleDir}/ARCH.md)
- **模块 TASK**: [../../docs/task-modules/${moduleEntry.moduleDir}/TASK.md](../../docs/task-modules/${moduleEntry.moduleDir}/TASK.md)

---

## 2. 测试策略

### 2.1 测试类型覆盖
| 测试类型 | 优先级 | 覆盖目标 |
|---------|--------|---------|
| 功能测试 | P0/P1 | 100% Story 覆盖 |
| 集成测试 | P0/P1 | 所有模块内集成点 |
| E2E 测试 | P0 | 核心用户旅程 |

### 2.2 测试优先级定义
- **P0（阻塞）**：核心功能，必须通过才能发布
- **P1（严重）**：重要功能，发布前必须修复
- **P2（一般）**：增值功能，可延迟修复

---

## 3. 测试用例

### 3.1 功能测试用例

${generateTestCasesTable(moduleEntry.stories, moduleTag)}

---

## 4. 缺陷列表
（待补充）

---

## 5. 测试执行记录
（待补充）

---

## 6. 测试指标
- **总用例数**：${storyCount * 3} 条（预估）
- **通过率**：N/A（待执行）

---

> **生成信息**：
> - 生成时间：${today}
> - 生成方式：自动生成（\`pnpm run qa:generate\`）
> - 作用域：session/project（由命令参数决定）
`;
}

function generateLargeProjectOverview(moduleEntries, prdData) {
  const today = new Date().toISOString().split('T')[0];
  const totalStories = moduleEntries.reduce((sum, entry) => sum + entry.stories.length, 0);

  return `# 测试与质量保证文档（总纲）
日期：${today}   版本：v0.1.0

> 本文档由 \`/qa plan --project\` 自动生成，作为大型项目测试总纲与模块索引。

## 1. 测试概览
- **项目规模**：大型（${totalStories} 个 Story，${moduleEntries.length} 个模块）
- **测试目标**：确保所有功能模块质量达标
- **测试范围**：${moduleEntries.map((entry) => entry.moduleName).join('、')}

## 2. 模块测试计划索引

| 模块名称 | 负责团队 | 文档链接 | Story 数 | 状态 | 最后更新 |
|---------|---------|---------|---------|------|---------|
${moduleEntries
  .map(
    (entry) =>
      `| ${entry.moduleName} | @qa-team | [qa-modules/${entry.moduleDir}/QA.md](qa-modules/${entry.moduleDir}/QA.md) | ${entry.stories.length} | 📝 待测试 | ${today} |`
  )
  .join('\n')}

## 3. 全局测试策略

### 3.1 测试类型覆盖
| 测试类型 | 优先级 | 覆盖目标 | 自动化要求 |
|---------|--------|---------|-----------|
| 功能测试 | P0/P1 | 100% Story 覆盖 | ≥ 80% |
| 集成测试 | P0/P1 | 所有模块内集成点 | ≥ 70% |
| E2E 测试 | P0 | 核心用户旅程 | ≥ 90% |
| 回归测试 | P0/P1 | 核心功能 | 100% |
| 性能测试 | P1 | 关键接口 | 100% |
| 安全测试 | P0 | OWASP Top 10 | 100% |

### 3.2 全局质量指标
- **目标通过率**：≥ 90%
- **P0 通过率**：100%
- **需求覆盖率**：≥ 85%
- **缺陷密度**：< 1 个/KLOC

## 4. 发布建议
- **结论**：📝 待测试执行
- **前置条件**：所有模块 QA 验证通过

## 5. 附录
- **PRD 文档**：[PRD.md](PRD.md)
- **追溯矩阵**：[traceability-matrix.md](data/traceability-matrix.md)

---

> **生成信息**：
> - 生成时间：${today}
> - 生成方式：自动生成（\`pnpm run qa:generate -- --project\`）
> - Story 总数（根 PRD）：${prdData.stories.length}
`;
}

function generateSmallProjectQA(prdData, archData, taskData) {
  const today = new Date().toISOString().split('T')[0];
  const storyCount = prdData.stories.length;
  const estimatedTestCases = storyCount * 3;

  return `# 测试与质量保证文档
日期：${today}   版本：v0.1.0

> 本文档由 \`/qa plan --project\` 自动生成，基于 PRD、ARCH、TASK 文档。

## 1. 测试概述
- **测试目标**：确保所有用户故事（共 ${storyCount} 个）的验收标准得到验证
- **测试范围**：${prdData.domains.join('、')}

## 2. 测试策略

### 2.1 测试类型覆盖
| 测试类型 | 优先级 | 覆盖目标 | 自动化要求 |
|---------|--------|---------|-----------|
| 功能测试 | P0/P1 | 100% Story 覆盖 | ≥ 80% |
| 集成测试 | P0/P1 | 所有模块内集成点 | ≥ 70% |
| E2E 测试 | P0 | 核心用户旅程 | ≥ 90% |

## 3. 测试用例概览
预计测试用例：~${estimatedTestCases} 条

${generateTestCasesTable(prdData.stories, 'GEN')}

## 4. 执行统计
- **用例总数**：${estimatedTestCases} 条（预估）
- **测试通过率**：N/A（待执行）

## 5. 发布建议
- **结论**：📝 待测试执行

---

> **生成信息**：
> - 生成时间：${today}
> - 架构组件数：${archData.components.length}
> - 任务里程碑数：${taskData.milestones.length}
`;
}

function runSessionPlan(moduleEntries, dryRun, explicitModules = []) {
  log('🧭 作用域：session（仅当前会话相关模块）', 'cyan');

  let targetSource = 'session-diff-inference';
  let matchedModules = [];
  if (explicitModules.length > 0) {
    const { resolved, unknown } = resolveExplicitModules(moduleEntries, explicitModules);
    if (unknown.length > 0) {
      log(`⚠️ 忽略未知模块: ${unknown.join(', ')}`, 'yellow');
    }
    if (resolved.length === 0) {
      log('ℹ️ 显式传入的模块均未命中现有模块目录，本次不改写 QA 文档（no-op）。', 'yellow');
      return { touched: [], modules: [], targetSource: 'explicit-modules' };
    }
    matchedModules = resolved;
    targetSource = 'explicit-modules';
    log(`🤖 使用显式传入模块：${matchedModules.map((entry) => entry.moduleDir).join(', ')}`, 'gray');
  } else {
    const branchName = runGit(['branch', '--show-current'], { allowFailure: true }).trim();
    const changedFiles = getChangedFilesForSession();
    matchedModules = inferSessionModules(moduleEntries, changedFiles, branchName);
  }

  if (matchedModules.length === 0) {
    log('ℹ️ 未识别到当前会话关联模块，本次不改写 QA 文档（no-op）。', 'yellow');
    return { touched: [], modules: [], targetSource };
  }

  log(`📌 识别到会话模块：${matchedModules.map((entry) => entry.moduleDir).join(', ')}`, 'gray');

  const touched = [];
  for (const entry of matchedModules) {
    const content = generateModuleQA(entry);
    if (!dryRun) writeFile(entry.qaPath, content);
    touched.push(entry.qaPath);
    log(`   ✅ 已${dryRun ? '预览' : '更新'}模块 QA: ${entry.qaPath}`, 'green');
  }

  log('ℹ️ session 模式不会全量重写 docs/QA.md。', 'yellow');
  return {
    touched,
    modules: matchedModules.map((entry) => entry.moduleDir),
    targetSource,
  };
}

function runProjectPlan(moduleEntries, prdData, archData, taskData, dryRun) {
  log('🧭 作用域：project（全项目刷新）', 'cyan');

  const needsSplit = shouldSplit(prdData);
  const touched = [];

  if (needsSplit) {
    log(`✅ 大型项目（${prdData.stories.length} 个 Story）→ 生成主 QA + 模块 QA`, 'green');
    const mainQA = generateLargeProjectOverview(moduleEntries, prdData);
    if (!dryRun) writeFile(CONFIG.paths.qa, mainQA);
    touched.push(CONFIG.paths.qa);
    log(`   ✅ 已${dryRun ? '预览' : '生成'}主 QA: ${CONFIG.paths.qa}`, 'green');

    for (const entry of moduleEntries) {
      const content = generateModuleQA(entry);
      if (!dryRun) writeFile(entry.qaPath, content);
      touched.push(entry.qaPath);
      log(`   ✅ 已${dryRun ? '预览' : '生成'}模块 QA: ${entry.qaPath}`, 'green');
    }
  } else {
    log(`✅ 小型项目（${prdData.stories.length} 个 Story）→ 生成单一 QA`, 'green');
    const qa = generateSmallProjectQA(prdData, archData, taskData);
    if (!dryRun) writeFile(CONFIG.paths.qa, qa);
    touched.push(CONFIG.paths.qa);
    log(`   ✅ 已${dryRun ? '预览' : '生成'} QA: ${CONFIG.paths.qa}`, 'green');
  }

  return touched;
}

function main() {
  const cli = parseCliArgs(process.argv.slice(2));

  log('='.repeat(60), 'cyan');
  log('QA 文档自动生成工具 v1.2.0', 'cyan');
  log('='.repeat(60), 'cyan');

  log('📖 读取输入文件...', 'cyan');
  const prdContent = readFile(CONFIG.paths.prd);
  const archContent = readFile(CONFIG.paths.arch);
  const taskContent = readFile(CONFIG.paths.task);
  const matrixContent = readFile(CONFIG.paths.traceabilityMatrix);

  if (!prdContent) {
    log('❌ PRD 文档不存在，请先完成 docs/PRD.md', 'red');
    process.exit(1);
  }

  const prdData = parsePRD(prdContent);
  const archData = parseARCH(archContent);
  const taskData = parseTASK(taskContent);
  const matrixData = parseTraceabilityMatrix(matrixContent);
  const moduleEntries = buildModuleEntries();

  log(`   - Story 数: ${prdData.stories.length}`, 'gray');
  log(`   - 功能域数: ${prdData.domains.length}`, 'gray');
  log(`   - 模块数（PRD/QA 目录）: ${moduleEntries.length}`, 'gray');
  log(`   - 架构组件数: ${archData.components.length}`, 'gray');
  log(`   - 追溯映射数: ${matrixData.mappings.length}`, 'gray');
  if (cli.modules.length > 0) {
    log(`   - 显式模块: ${cli.modules.join(', ')}`, 'gray');
  }

  if (moduleEntries.length === 0) {
    log('❌ 未找到任何模块（docs/prd-modules/*/PRD.md 或 docs/qa-modules/*/QA.md）', 'red');
    process.exit(1);
  }

  if (cli.dryRun) {
    log('⚠️ DRY RUN 模式：不会写入文件。', 'yellow');
  }

  let touched = [];
  let sessionMeta = null;
  if (cli.scope === 'project') {
    if (cli.modules.length > 0) {
      log('ℹ️ --modules 仅在 session 模式生效；当前 project 模式将忽略该参数。', 'yellow');
    }
    touched = runProjectPlan(moduleEntries, prdData, archData, taskData, cli.dryRun);
  } else {
    const sessionResult = runSessionPlan(moduleEntries, cli.dryRun, cli.modules);
    touched = sessionResult.touched;

    sessionMeta = {
      tool: 'qa:generate',
      scope: 'session',
      generatedAt: new Date().toISOString(),
      branch: runGit(['branch', '--show-current'], { allowFailure: true }).trim(),
      dryRun: cli.dryRun,
      targetSource: sessionResult.targetSource,
      modules: sessionResult.modules,
      touchedFiles: sessionResult.touched,
      explicitModules: cli.modules,
    };

    if (!cli.dryRun) {
      const statePath = getQaPlanSessionStatePath();
      writeJsonFile(statePath, sessionMeta);
      log(`🧾 已记录会话计划上下文: ${statePath}`, 'gray');
    }
  }

  log('');
  log('='.repeat(60), 'cyan');
  log('✅ QA 计划生成完成', 'green');
  log('='.repeat(60), 'cyan');

  if (touched.length > 0) {
    log('📄 本次回写文件：', 'cyan');
    touched.forEach((file) => log(`   - ${file}`, 'gray'));
  } else {
    log('📄 本次未产生文档改动。', 'yellow');
  }

  writeInProgressFields(path.resolve(process.cwd(), 'docs/AGENT_STATE.md'), {
    step: '/qa plan 完成，等待 /qa verify',
  });

  process.exit(0);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    log(`\n❌ 执行出错: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

module.exports = {
  parseCliArgs,
  parseModuleList,
  parsePRD,
  parseARCH,
  parseTASK,
  parseTraceabilityMatrix,
  shouldSplit,
  buildModuleEntries,
  inferSessionModules,
  resolveExplicitModules,
  getQaPlanSessionStatePath,
};

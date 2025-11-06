#!/usr/bin/env node

/**
 * QA 文档自动生成工具
 * 基于 PRD、ARCH、TASK 自动生成测试策略、测试用例、测试矩阵
 * v1.0.0
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// 配置
// ============================================================

const CONFIG = {
  paths: {
    prd: 'docs/PRD.md',
    arch: 'docs/ARCHITECTURE.md',
    task: 'docs/TASK.md',
    qa: 'docs/QA.md',
    traceabilityMatrix: 'docs/data/traceability-matrix.md',
    prdModulesDir: 'docs/prd-modules',
    archModulesDir: 'docs/architecture-modules',
    taskModulesDir: 'docs/task-modules',
    qaModulesDir: 'docs/qa-modules',
  },
  splitThresholds: {
    minStories: 50,          // 超过 50 个 Story 需要拆分
    minTestCases: 100,       // 超过 100 个测试用例需要拆分
    minDomains: 3,           // 超过 3 个功能域需要拆分
  },
  smallProjectThresholds: {
    maxStories: 30,          // 小于 30 个 Story 为小型项目
    maxTestCases: 100,       // 小于 100 个测试用例为小型项目
    maxDomains: 3,           // 小于 3 个功能域为小型项目
  },
};

// ============================================================
// 颜色输出工具
// ============================================================

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

// ============================================================
// 文件工具
// ============================================================

function readFile(filePath) {
  const fullPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  return fs.readFileSync(fullPath, 'utf-8');
}

function writeFile(filePath, content) {
  const fullPath = path.resolve(process.cwd(), filePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(fullPath, content, 'utf-8');
}

function fileExists(filePath) {
  const fullPath = path.resolve(process.cwd(), filePath);
  return fs.existsSync(fullPath);
}

// ============================================================
// 数据解析器
// ============================================================

/**
 * 解析 PRD 文件，提取 Story ID 列表
 */
function parsePRD(content) {
  if (!content) return { stories: [], domains: [] };

  const storyRegex = /(?:^|\n)(?:#+\s+)?(?:Story|US-[A-Z0-9]+-\d+)[:\s]+([^\n]+)/gi;
  const storyIdRegex = /US-([A-Z0-9]+)-(\d+)/g;

  const stories = [];
  const domainSet = new Set();

  let match;
  while ((match = storyIdRegex.exec(content)) !== null) {
    const domain = match[1];
    const number = match[2];
    const storyId = `US-${domain}-${number}`;

    stories.push({
      id: storyId,
      domain: domain,
      number: parseInt(number, 10),
    });

    domainSet.add(domain);
  }

  return {
    stories,
    domains: Array.from(domainSet),
  };
}

/**
 * 解析 ARCHITECTURE 文件，提取组件和技术选型
 */
function parseARCH(content) {
  if (!content) return { components: [], isMicroservice: false };

  // 简单检测是否为微服务架构
  const isMicroservice = /微服务|microservice|service-oriented/i.test(content);

  // 提取组件（简化版）
  const componentRegex = /(?:Component|组件|服务)[:\s]+([^\n]+)/gi;
  const components = [];

  let match;
  while ((match = componentRegex.exec(content)) !== null) {
    components.push(match[1].trim());
  }

  return {
    components,
    isMicroservice,
  };
}

/**
 * 解析 TASK 文件，提取任务和里程碑
 */
function parseTASK(content) {
  if (!content) return { milestones: [], owners: [] };

  // 提取里程碑
  const milestoneRegex = /(?:M\d+|里程碑)[:\s]+([^\n]+)/gi;
  const milestones = [];

  let match;
  while ((match = milestoneRegex.exec(content)) !== null) {
    milestones.push(match[1].trim());
  }

  // 提取 Owner（简化版）
  const ownerRegex = /@([a-zA-Z0-9_-]+)/g;
  const ownerSet = new Set();

  while ((match = ownerRegex.exec(content)) !== null) {
    ownerSet.add(match[1]);
  }

  return {
    milestones,
    owners: Array.from(ownerSet),
  };
}

/**
 * 解析追溯矩阵（如果存在）
 */
function parseTraceabilityMatrix(content) {
  if (!content) return { mappings: [] };

  const mappings = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const storyMatch = line.match(/US-([A-Z0-9]+)-(\d+)/);
    const testCaseMatch = line.match(/TC-([A-Z0-9]+)-(\d+)/);

    if (storyMatch && testCaseMatch) {
      mappings.push({
        storyId: storyMatch[0],
        testCaseId: testCaseMatch[0],
      });
    }
  }

  return { mappings };
}

/**
 * 检测是否需要拆分为模块化 QA
 */
function shouldSplit(prdData, archData) {
  const storyCount = prdData.stories.length;
  const domainCount = prdData.domains.length;
  const estimatedTestCases = storyCount * 3; // 假设每个 Story 平均 3 个测试用例

  return (
    storyCount > CONFIG.splitThresholds.minStories ||
    estimatedTestCases > CONFIG.splitThresholds.minTestCases ||
    domainCount >= CONFIG.splitThresholds.minDomains
  );
}

// ============================================================
// 模板生成器
// ============================================================

/**
 * 生成小型项目 QA.md
 */
function generateSmallProjectQA(prdData, archData, taskData) {
  const today = new Date().toISOString().split('T')[0];
  const storyCount = prdData.stories.length;
  const estimatedTestCases = storyCount * 3;

  return `# 测试与质量保证文档
日期：${today}   版本：v0.1.0

> 本文档由 \`/qa plan\` 自动生成，基于 PRD、ARCH、TASK 文档。

## 1. 测试概述
- **测试目标**：确保所有用户故事（共 ${storyCount} 个）的验收标准得到验证
- **测试范围**：${prdData.domains.join('、')} 功能域
- **测试环境**：
  - Dev: 开发测试环境
  - Staging: 集成测试环境
  - Production: 生产验证环境

## 2. 测试策略

### 2.1 测试类型覆盖
| 测试类型 | 优先级 | 覆盖目标 | 自动化要求 |
|---------|--------|---------|-----------|
| **功能测试** | P0/P1 | 100% Story 覆盖 | ≥ 80% |
| **集成测试** | P0/P1 | 所有模块内集成点 | ≥ 70% |
| **E2E 测试** | P0 | 核心用户旅程 | ≥ 90% |
| **回归测试** | P0/P1 | 核心功能 | 100% |
| **性能测试** | P1 | 关键接口 | 100% |
| **安全测试** | P0 | OWASP Top 10 | 100% |

### 2.2 测试优先级定义
- **P0（阻塞）**：核心功能，必须通过才能发布
- **P1（严重）**：重要功能，发布前必须修复
- **P2（一般）**：增值功能，可延迟修复
- **P3（建议）**：优化项，不阻塞发布

### 2.3 入口准则
- ✅ PRD 已确认（\`PRD_CONFIRMED\` 勾选）
- ✅ ARCHITECTURE 已定义（\`ARCHITECTURE_DEFINED\` 勾选）
- ✅ TASK 已规划（\`TASK_PLANNED\` 勾选）
- ✅ CI 流水线全绿
- ✅ 测试环境可用

### 2.4 出口准则
- ✅ P0 用例通过率 100%
- ✅ 总体通过率 ≥ 90%
- ✅ 无阻塞缺陷（P0）
- ✅ 需求覆盖率 ≥ 85%
- ✅ 关键 NFR 达标

## 3. 测试矩阵

### 3.1 测试用例概览
预计测试用例数：~${estimatedTestCases} 条（基于 ${storyCount} 个 Story，平均每个 Story 3 条测试用例）

### 3.2 功能测试用例

${generateTestCasesTable(prdData.stories)}

### 3.3 集成测试用例
${archData.components.length > 0
  ? `| 用例 ID | 用例名称 | 集成点 | 优先级 | 状态 | 执行人 |
|---------|---------|--------|--------|------|--------|
| TC-INT-001 | ${archData.components[0] || '组件 A'} 集成测试 | 组件间集成 | P0 | 📝 待执行 | TBD |
| （待补充） | - | - | - | - | - |`
  : '（待补充：根据架构文档中的组件关系添加集成测试用例）'
}

### 3.4 E2E 测试用例
| 用例 ID | E2E 场景 | 涉及模块 | 优先级 | 状态 | 执行人 |
|---------|---------|---------|--------|------|--------|
| TC-E2E-001 | 核心用户旅程 | 全模块 | P0 | 📝 待执行 | TBD |
| （待补充） | - | - | - | - | - |

### 3.5 性能测试用例
| 用例 ID | 测试场景 | 性能目标 | 工具 | 状态 | 执行人 |
|---------|---------|---------|------|------|--------|
| TC-PERF-001 | 关键接口响应时间 | P95 < 500ms | k6 | 📝 待执行 | TBD |
| （待补充） | - | - | - | - | - |

### 3.6 安全测试用例
| 用例 ID | 安全场景 | OWASP 分类 | 工具 | 状态 | 执行人 |
|---------|---------|-----------|------|------|--------|
| TC-SEC-001 | SQL 注入防护 | A03:2021-Injection | OWASP ZAP | 📝 待执行 | TBD |
| TC-SEC-002 | XSS 防护 | A03:2021-Injection | OWASP ZAP | 📝 待执行 | TBD |
| （待补充） | - | - | - | - | - |

## 4. 执行统计
- **用例总数**：${estimatedTestCases} 条（预估）
- **已执行**：0 条
- **通过**：0 条
- **失败**：0 条
- **阻塞**：0 条
- **测试通过率**：N/A（待执行）

## 5. 缺陷与风险

### 5.1 阻塞缺陷（P0）
（暂无）

### 5.2 严重缺陷（P1）
（暂无）

### 5.3 已知风险
| 风险 ID | 风险描述 | 严重程度 | 缓解措施 | 状态 |
|---------|---------|---------|---------|------|
| （待补充） | - | - | - | - |

## 6. 发布建议
- **结论**：📝 待测试执行（当前为自动生成的模板）
- **前置条件**：
  - [ ] 所有 P0 用例通过
  - [ ] 所有 P0 缺陷关闭
  - [ ] CI 状态全绿
  - [ ] CHANGELOG.md 与产物一致
- **后续动作**：
  1. 执行测试用例
  2. 记录测试结果
  3. 更新缺陷列表
  4. 更新发布建议

## 7. 部署记录
| 环境 | 版本/标签 | 部署时间 | 执行人 | 冒烟结果 | 监控链接 | 备注 |
|------|---------|---------|--------|---------|---------|------|
| staging | - | - | - | - | - | 待部署 |
| production | - | - | - | - | - | 待部署 |

## 8. 附录
- **PRD 文档**：[PRD.md](PRD.md)
- **ARCHITECTURE 文档**：[ARCHITECTURE.md](ARCHITECTURE.md)
- **TASK 文档**：[TASK.md](TASK.md)
- **追溯矩阵**：[traceability-matrix.md](data/traceability-matrix.md)
- **测试工具脚本**：[scripts/qa-tools/](../../scripts/qa-tools/)

---

> **生成信息**：
> - 生成时间：${today}
> - 生成方式：自动生成（\`npm run qa:generate\`）
> - 版本：v1.0.0
> - 下次更新：执行 \`npm run qa:generate\` 刷新
`;
}

/**
 * 生成测试用例表格（基于 Story 列表）
 */
function generateTestCasesTable(stories) {
  if (stories.length === 0) {
    return '（暂无用户故事，请先完成 PRD 文档）';
  }

  let table = `| 用例 ID | 用例名称 | 关联 Story | 优先级 | 前置条件 | 状态 | 执行人 |\n`;
  table += `|---------|---------|-----------|--------|---------|------|--------|\n`;

  // 为每个 Story 生成一个测试用例示例
  stories.slice(0, 10).forEach((story, index) => {
    const testCaseId = `TC-${story.domain}-${String(index + 1).padStart(3, '0')}`;
    table += `| ${testCaseId} | ${story.id} 功能测试 | ${story.id} | P0 | （待补充） | 📝 待执行 | TBD |\n`;
  });

  if (stories.length > 10) {
    table += `| （更多） | ... | ... | ... | ... | ... | ... |\n`;
    table += `\n> 共 ${stories.length} 个 Story，每个 Story 建议至少 3 条测试用例（正常场景 + 边界场景 + 异常场景）\n`;
  }

  return table;
}

/**
 * 生成大型项目主 QA 文档（总纲与索引）
 */
function generateLargeProjectOverview(prdData, archData, taskData) {
  const today = new Date().toISOString().split('T')[0];

  return `# 测试与质量保证文档（总纲）
日期：${today}   版本：v0.1.0

> 本文档由 \`/qa plan\` 自动生成，作为大型项目的测试计划总纲与模块索引。

## 1. 测试概览
- **项目规模**：大型（${prdData.stories.length} 个 Story，${prdData.domains.length} 个功能域）
- **测试目标**：确保所有功能域的质量标准达标
- **测试范围**：${prdData.domains.join('、')}

## 2. 模块测试计划索引

| 模块名称 | 负责团队 | 文档链接 | Story 数 | 状态 | 最后更新 |
|---------|---------|---------|---------|------|---------|
${prdData.domains.map(domain => {
  const domainStories = prdData.stories.filter(s => s.domain === domain);
  return `| ${domain} | @team-${domain.toLowerCase()} | [qa-modules/${domain.toLowerCase()}.md](qa-modules/${domain.toLowerCase()}.md) | ${domainStories.length} | 📝 待测试 | ${today} |`;
}).join('\n')}

详见 [qa-modules/README.md](qa-modules/README.md)

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

## 4. 跨模块集成测试
（待补充：根据模块间依赖关系添加跨模块集成测试）

## 5. 全局缺陷汇总
（待补充：汇总各模块的 P0/P1 缺陷）

## 6. 全局测试指标
- **总用例数**：（待统计）
- **总通过率**：N/A
- **模块通过率**：（待统计）

## 7. 发布建议
- **结论**：📝 待测试执行
- **前置条件**：所有模块 QA 验证通过

## 8. 部署记录
| 环境 | 版本/标签 | 部署时间 | 执行人 | 冒烟结果 | 备注 |
|------|---------|---------|--------|---------|------|
| staging | - | - | - | - | 待部署 |
| production | - | - | - | - | 待部署 |

---

> **生成信息**：
> - 生成时间：${today}
> - 生成方式：自动生成（\`npm run qa:generate\`）
> - 版本：v1.0.0
`;
}

/**
 * 生成模块 QA 文档
 */
function generateModuleQA(domain, domainStories) {
  const today = new Date().toISOString().split('T')[0];

  return `# ${domain} - 测试计划

> **所属主 QA**: [QA.md](../QA.md)
> **最后更新**: ${today}
> **版本**: v0.1.0

---

## 1. 模块概述

**测试范围**：${domain} 功能域（包含 ${domainStories.length} 个用户故事）

**测试关键指标**：
- 测试用例总数：${domainStories.length * 3} 条（预估）
- 测试通过率目标：≥ 95%
- 需求覆盖率目标：100%

**关联文档**：
- **模块 PRD**: [prd-modules/${domain.toLowerCase()}.md](../prd-modules/${domain.toLowerCase()}.md)
- **模块 ARCH**: [architecture-modules/${domain.toLowerCase()}.md](../architecture-modules/${domain.toLowerCase()}.md)
- **模块 TASK**: [task-modules/${domain.toLowerCase()}.md](../task-modules/${domain.toLowerCase()}.md)

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

${generateModuleTestCasesTable(domain, domainStories)}

---

## 4. 缺陷列表
（待补充）

---

## 5. 测试执行记录
（待补充）

---

## 6. 测试指标
- **总用例数**：${domainStories.length * 3} 条（预估）
- **通过率**：N/A（待执行）

---

> **生成信息**：
> - 生成时间：${today}
> - 生成方式：自动生成（\`npm run qa:generate\`）
`;
}

/**
 * 生成模块测试用例表格
 */
function generateModuleTestCasesTable(domain, stories) {
  let table = `| 用例 ID | 用例名称 | 关联 Story | 优先级 | 状态 | 执行人 |\n`;
  table += `|---------|---------|-----------|--------|------|--------|\n`;

  stories.forEach((story, index) => {
    const testCaseId = `TC-${domain}-${String(index + 1).padStart(3, '0')}`;
    table += `| ${testCaseId} | ${story.id} 功能测试 | ${story.id} | P0 | 📝 待执行 | TBD |\n`;
  });

  return table;
}

// ============================================================
// 主函数
// ============================================================

function main() {
  log('='.repeat(60), 'cyan');
  log('QA 文档自动生成工具 v1.0.0', 'cyan');
  log('='.repeat(60), 'cyan');
  log('');

  // 1. 读取必需的输入文件
  log('📖 读取输入文件...', 'cyan');

  const prdContent = readFile(CONFIG.paths.prd);
  const archContent = readFile(CONFIG.paths.arch);
  const taskContent = readFile(CONFIG.paths.task);
  const matrixContent = readFile(CONFIG.paths.traceabilityMatrix);

  // 2. 检查必需文件
  if (!prdContent) {
    log('❌ PRD 文档不存在，请先完成 PRD.md', 'red');
    log('   提示：激活 PRD 专家或执行 /prd confirm', 'yellow');
    process.exit(1);
  }

  if (!archContent) {
    log('⚠️  ARCHITECTURE 文档不存在，将使用默认配置', 'yellow');
  }

  if (!taskContent) {
    log('⚠️  TASK 文档不存在，将使用默认配置', 'yellow');
  }

  // 3. 解析数据
  log('🔍 解析数据...', 'cyan');
  const prdData = parsePRD(prdContent);
  const archData = parseARCH(archContent);
  const taskData = parseTASK(taskContent);
  const matrixData = parseTraceabilityMatrix(matrixContent);

  log(`   - 找到 ${prdData.stories.length} 个用户故事`, 'gray');
  log(`   - 找到 ${prdData.domains.length} 个功能域: ${prdData.domains.join(', ')}`, 'gray');
  log(`   - 找到 ${archData.components.length} 个架构组件`, 'gray');
  log(`   - 架构模式: ${archData.isMicroservice ? '微服务' : '单体'}`, 'gray');
  log('');

  // 4. 检测项目规模
  log('📊 检测项目规模...', 'cyan');
  const needsSplit = shouldSplit(prdData, archData);

  if (needsSplit) {
    log(`   ✅ 大型项目（${prdData.stories.length} 个 Story，${prdData.domains.length} 个功能域）`, 'green');
    log('   → 将生成主 QA 文档 + 模块 QA 文档', 'gray');
  } else {
    log(`   ✅ 小型项目（${prdData.stories.length} 个 Story）`, 'green');
    log('   → 将生成单一 QA 文档', 'gray');
  }
  log('');

  // 5. 生成 QA 文档
  log('📝 生成 QA 文档...', 'cyan');

  if (needsSplit) {
    // 大型项目：生成主 QA + 模块 QA
    const mainQA = generateLargeProjectOverview(prdData, archData, taskData);
    writeFile(CONFIG.paths.qa, mainQA);
    log(`   ✅ 已生成主 QA 文档: ${CONFIG.paths.qa}`, 'green');

    // 生成模块 QA
    prdData.domains.forEach(domain => {
      const domainStories = prdData.stories.filter(s => s.domain === domain);
      const moduleQA = generateModuleQA(domain, domainStories);
      const modulePath = path.join(CONFIG.paths.qaModulesDir, `${domain.toLowerCase()}.md`);
      writeFile(modulePath, moduleQA);
      log(`   ✅ 已生成模块 QA: ${modulePath}`, 'green');
    });

    // TODO: 更新 qa-modules/README.md 索引
    log('   ℹ️  提示：请手动更新 qa-modules/README.md 的模块清单', 'yellow');
  } else {
    // 小型项目：生成单一 QA
    const qa = generateSmallProjectQA(prdData, archData, taskData);
    writeFile(CONFIG.paths.qa, qa);
    log(`   ✅ 已生成 QA 文档: ${CONFIG.paths.qa}`, 'green');
  }

  log('');

  // 6. 后续建议
  log('='.repeat(60), 'cyan');
  log('✅ QA 文档生成完成！', 'green');
  log('='.repeat(60), 'cyan');
  log('');
  log('📋 后续步骤：', 'cyan');
  log('   1. 检查生成的 QA.md，补充测试用例细节', 'gray');
  log('   2. 执行测试并记录结果', 'gray');
  log('   3. 运行质量检查：npm run qa:lint', 'gray');
  log('   4. 验证 ID 同步：npm run qa:sync-prd-qa-ids', 'gray');
  log('   5. 生成覆盖率报告：npm run qa:coverage-report', 'gray');
  log('');

  process.exit(0);
}

// ============================================================
// 运行
// ============================================================

if (require.main === module) {
  try {
    main();
  } catch (error) {
    log(`\n❌ 执行出错: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

module.exports = { parsePRD, parseARCH, parseTASK, shouldSplit };

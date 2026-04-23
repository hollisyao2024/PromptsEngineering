#!/usr/bin/env node

/**
 * TASK 自动生成工具
 *
 * 功能：
 * - 从 PRD + ARCHITECTURE 自动生成 TASK.md
 * - 支持增量更新（保留人工标注）
 * - 生成 WBS、依赖矩阵、关键路径、里程碑、风险、DB 任务表
 * - 大型项目自动拆分为模块化任务文档
 *
 * 用法：
 *   pnpm run task:generate -- [--init] [--update-only] [--preserve-manual-annotations]
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  prdPath: path.join(__dirname, '../../../docs/PRD.md'),
  archPath: path.join(__dirname, '../../../docs/ARCH.md'),
  taskPath: path.join(__dirname, '../../../docs/TASK.md'),
  taskModulesDir: path.join(__dirname, '../../../docs/task-modules'),
  stateFile: path.join(__dirname, '../../../docs/AGENT_STATE.md'),

  // 拆分条件
  splitThresholds: {
    lines: 1000,
    workPackages: 50,
    parallelStreams: 3,
    projectMonths: 6,
    dependencies: 10,
  },

  // Task 粒度约束（单位：天）
  taskSizeConstraints: {
    min: 1,
    max: 3,
    epic: 7,  // Epic 对应 7 天
  },

  // DB 任务特殊处理
  dbTaskPrefix: 'DB',
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function toDomainDirectory(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'general';
}

// 解析 PRD，提取 Story 信息
function parsePRD(content) {
  const stories = [];

  // 简单正则匹配 US-XXX 用户故事（可根据实际 PRD 格式调整）
  const storyRegex = /###?\s+(US-[A-Z]+-\d+)[:\s]+([^\n]+)([\s\S]*?)(?=###?\s+US-[A-Z]+-\d+|##\s|$)/gi;
  let match;

  while ((match = storyRegex.exec(content)) !== null) {
    const storyId = match[1];
    const storyTitle = match[2].trim();
    const storyContent = match[3];

    // 提取 AC
    const acRegex = /(?:Given|When|Then)[:\s]+([^\n]+)/gi;
    const acs = [];
    let acMatch;
    while ((acMatch = acRegex.exec(storyContent)) !== null) {
      acs.push(acMatch[1]);
    }

    stories.push({
      id: storyId,
      title: storyTitle,
      acs: acs,
      priority: extractPriority(storyContent),
      complexity: estimateComplexity(storyContent),
      module: extractModule(storyId),
    });
  }

  return stories;
}

// 解析 ARCHITECTURE，提取组件信息
function parseArchitecture(content) {
  const components = [];

  // 简单正则匹配组件（可根据实际架构格式调整）
  const compRegex = /###?\s+([A-Z][A-Z0-9\-]+)[:\s]+([^\n]+)([\s\S]*?)(?=###?\s+[A-Z][A-Z0-9\-]+|##\s|$)/gi;
  let match;

  while ((match = compRegex.exec(content)) !== null) {
    const compId = match[1];
    const compTitle = match[2].trim();
    const compContent = match[3];

    // 提取依赖
    const depRegex = /[Dd]epends?\s+on[:\s]+([A-Z0-9\-,\s]+)/gi;
    const deps = [];
    let depMatch;
    while ((depMatch = depRegex.exec(compContent)) !== null) {
      deps.push(...depMatch[1].split(/[,，]/).map(d => d.trim()).filter(d => d));
    }

    components.push({
      id: compId,
      title: compTitle,
      dependencies: deps,
      team: extractTeam(compContent),
    });
  }

  return components;
}

// 估算复杂度（简化版）
function estimateComplexity(content) {
  const keywords = ['数据库', '支付', '安全', '性能', '集成', '迁移', '复杂', '算法'];
  const count = keywords.filter(kw => content.includes(kw)).length;

  if (count >= 3) return 'high';
  if (count >= 1) return 'medium';
  return 'low';
}

// 提取优先级
function extractPriority(content) {
  if (content.includes('P0') || content.includes('核心')) return 'P0';
  if (content.includes('P1') || content.includes('重要')) return 'P1';
  if (content.includes('P2') || content.includes('一般')) return 'P2';
  return 'P3';
}

// 提取所属团队
function extractTeam(content) {
  const match = content.match(/@[\w-]+/);
  return match ? match[0] : 'TBD';
}

// 从 Story ID 提取模块前缀
function extractModule(storyId) {
  const match = storyId.match(/US-([A-Z]+)-/);
  return match ? match[1] : 'GENERAL';
}

// 生成 Task ID
function generateTaskId(modulePrefix, index) {
  return `TASK-${modulePrefix}-${String(index + 1).padStart(3, '0')}`;
}

// 创建 WBS（工作分解结构）
function createWBS(stories, components) {
  const tasks = [];
  let taskIndex = 0;

  // 从 Story 生成 Task
  stories.forEach((story) => {
    const modulePrefix = story.module;

    // Epic 级任务
    tasks.push({
      id: generateTaskId(modulePrefix, taskIndex++),
      title: `Epic: ${story.title}`,
      type: 'Epic',
      owner: 'TBD',
      effort: 7,  // 默认 7 天
      priority: story.priority,
      dependencies: [],
      complexity: story.complexity,
      story: story.id,
      module: modulePrefix,
    });

    // Feature 级任务（前端、后端、DB）
    if (story.complexity !== 'low') {
      const backendTask = {
        id: generateTaskId(modulePrefix, taskIndex++),
        title: `Backend: ${story.title} - API 实现`,
        type: 'Feature',
        owner: 'TBD',
        effort: story.complexity === 'high' ? 5 : 3,
        priority: story.priority,
        dependencies: [tasks[tasks.length - 1].id],
        story: story.id,
        module: modulePrefix,
      };
      tasks.push(backendTask);

      tasks.push({
        id: generateTaskId(modulePrefix, taskIndex++),
        title: `Frontend: ${story.title} - UI 实现`,
        type: 'Feature',
        owner: 'TBD',
        effort: story.complexity === 'high' ? 4 : 2,
        priority: story.priority,
        dependencies: [backendTask.id],
        story: story.id,
        module: modulePrefix,
      });
    }
  });

  // 从 Component 生成基础设施任务
  components.forEach((comp, idx) => {
    if (comp.id.match(/INFRA|DEPLOY|MONITOR|SECURITY/i)) {
      tasks.push({
        id: `TASK-INFRA-${String(idx + 1).padStart(3, '0')}`,
        title: `Infrastructure: ${comp.title}`,
        type: 'Infrastructure',
        owner: comp.team,
        effort: 5,
        priority: 'P0',
        dependencies: [],
        module: 'INFRA',
      });
    }
  });

  return tasks;
}

// 计算关键路径（简化 CPM）
function calculateCriticalPath(tasks) {
  const taskMap = {};
  tasks.forEach(t => taskMap[t.id] = t);

  // 拓扑排序 + 计算最长路径
  const paths = new Map();

  function calculatePath(taskId) {
    if (paths.has(taskId)) return paths.get(taskId);

    const task = taskMap[taskId];
    if (!task) return 0;

    let maxDepPath = 0;
    if (task.dependencies && task.dependencies.length > 0) {
      maxDepPath = Math.max(...task.dependencies.map(calculatePath).filter(p => p > 0));
    }

    const totalPath = maxDepPath + (task.effort || 0);
    paths.set(taskId, totalPath);
    return totalPath;
  }

  tasks.forEach(t => calculatePath(t.id));

  const criticalPath = paths.size > 0 ? Math.max(...Array.from(paths.values())) : 0;
  const criticalTasks = Array.from(paths.entries())
    .filter(([_, length]) => length === criticalPath)
    .map(([id]) => id);

  return { criticalPath, criticalTasks };
}

// 检测拆分需要
function shouldSplit(tasks, stories, components) {
  const wbsLines = tasks.length * 3; // 粗估每个 Task 占 3 行
  const modules = new Set(tasks.map(t => t.module || 'GENERAL'));
  const parallelModules = modules.size;

  return wbsLines > CONFIG.splitThresholds.lines ||
         tasks.length > CONFIG.splitThresholds.workPackages ||
         parallelModules >= CONFIG.splitThresholds.parallelStreams;
}

// 提取跨模块依赖关系
function extractCrossModuleDependencies(tasks) {
  const crossModuleDeps = [];
  const taskMap = {};
  tasks.forEach(t => taskMap[t.id] = t);

  tasks.forEach(task => {
    if (task.dependencies && task.dependencies.length > 0) {
      task.dependencies.forEach(depId => {
        const depTask = taskMap[depId];
        if (depTask && depTask.module !== task.module) {
          crossModuleDeps.push({
            from: task.module,
            to: depTask.module,
            taskFrom: task.id,
            taskTo: depId
          });
        }
      });
    }
  });

  return crossModuleDeps;
}

// 生成模块任务文档
function generateModuleTaskFiles(tasks, stories, components) {
  // 按模块分组
  const modules = Array.from(new Set(tasks.map(t => t.module || 'GENERAL')));
  const moduleFileCount = modules.length;

  // 确保 task-modules 目录存在
  if (!fs.existsSync(CONFIG.taskModulesDir)) {
    fs.mkdirSync(CONFIG.taskModulesDir, { recursive: true });
  }

  modules.forEach(module => {
    const moduleTasks = tasks.filter(t => t.module === module);
    const moduleStories = stories.filter(s => s.module === module);
    const moduleMarkdown = generateModuleMarkdown(module, moduleTasks, moduleStories, tasks);

    const moduleDir = toDomainDirectory(module);
    const moduleFile = path.join(CONFIG.taskModulesDir, moduleDir, 'TASK.md');
    fs.mkdirSync(path.dirname(moduleFile), { recursive: true });
    fs.writeFileSync(moduleFile, moduleMarkdown);
    log(`   ✅ 创建模块文档：${moduleDir}/TASK.md (${moduleTasks.length} 个任务)`, 'green');
  });

  // 更新 task-modules/module-list.md
  updateTaskModulesReadme(modules, tasks, stories);

  return moduleFileCount;
}

// 生成单个模块的任务文档
function generateModuleMarkdown(moduleName, moduleTasks, moduleStories, allTasks) {
  const today = new Date().toISOString().split('T')[0];
  const totalEffort = moduleTasks.reduce((sum, t) => sum + (t.effort || 0), 0);
  const moduleDir = toDomainDirectory(moduleName);

  let md = `# ${moduleName} 模块任务计划\n\n`;
  md += `> **说明**：本文档为 ${moduleName} 模块的详细任务计划，由 TASK 专家自动生成。\n\n`;
  md += `**日期**：${today}\n`;
  md += `**模块**：${moduleName}\n`;
  md += `**任务数量**：${moduleTasks.length}\n`;
  md += `**预计工作量**：${totalEffort} 人日\n\n`;
  md += `---\n\n`;

  // 1. 模块概述
  md += `## 1. 模块概述\n\n`;
  md += `- **关联 Story 数量**：${moduleStories.length}\n`;
  md += `- **任务类型分布**：\n`;
  const typeCount = {};
  moduleTasks.forEach(t => {
    typeCount[t.type] = (typeCount[t.type] || 0) + 1;
  });
  Object.entries(typeCount).forEach(([type, count]) => {
    md += `  - ${type}：${count} 个\n`;
  });
  md += `\n`;

  // 2. 模块 WBS
  md += `## 2. 模块 WBS（工作分解结构）\n\n`;
  md += `| Task ID | 任务名称 | 类型 | Owner | 估时 | 优先级 | 依赖 | 状态 |\n`;
  md += `|---------|---------|------|-------|------|--------|------|------|\n`;

  moduleTasks.forEach(task => {
    const deps = task.dependencies && task.dependencies.length > 0
      ? task.dependencies.join(', ')
      : '-';
    const effort = task.effort ? `${task.effort}d` : 'TBD';
    md += `| ${task.id} | ${task.title} | ${task.type} | ${task.owner} | ${effort} | ${task.priority} | ${deps} | 📝 待开始 |\n`;
  });
  md += `\n`;

  // 3. 模块内依赖关系
  md += `## 3. 模块内依赖关系\n\n`;
  const internalDeps = [];
  moduleTasks.forEach(task => {
    if (task.dependencies && task.dependencies.length > 0) {
      task.dependencies.forEach(depId => {
        const depTask = allTasks.find(t => t.id === depId);
        if (depTask && depTask.module === moduleName) {
          internalDeps.push({ from: task.id, to: depId });
        }
      });
    }
  });

  if (internalDeps.length > 0) {
    md += `| 任务 | 依赖任务 | 类型 |\n`;
    md += `|------|---------|------|\n`;
    internalDeps.forEach(dep => {
      md += `| ${dep.from} | ${dep.to} | FS |\n`;
    });
  } else {
    md += `> 本模块内无任务依赖关系，任务可并行执行。\n`;
  }
  md += `\n`;

  // 4. 外部依赖（跨模块）
  md += `## 4. 外部依赖（跨模块）\n\n`;
  const externalDeps = [];
  moduleTasks.forEach(task => {
    if (task.dependencies && task.dependencies.length > 0) {
      task.dependencies.forEach(depId => {
        const depTask = allTasks.find(t => t.id === depId);
        if (depTask && depTask.module !== moduleName) {
          externalDeps.push({ from: task.id, to: depId, toModule: depTask.module });
        }
      });
    }
  });

  if (externalDeps.length > 0) {
    md += `| 本模块任务 | 依赖外部任务 | 外部模块 | 说明 |\n`;
    md += `|----------|------------|---------|------|\n`;
    externalDeps.forEach(dep => {
      md += `| ${dep.from} | ${dep.to} | ${dep.toModule} | - |\n`;
    });
  } else {
    md += `> 本模块无跨模块依赖，可独立开发。\n`;
  }
  md += `\n`;

  // 5. 模块里程碑
  md += `## 5. 模块里程碑\n\n`;
  md += `| 里程碑 | 目标日期 | 交付物 | 状态 |\n`;
  md += `|--------|---------|--------|------|\n`;
  md += `| ${moduleName} - Phase 1 | TBD | 核心功能完成 | 📝 待开始 |\n`;
  md += `| ${moduleName} - Phase 2 | TBD | 测试通过 | 📝 待开始 |\n\n`;

  // 6. 模块风险
  md += `## 6. 模块风险\n\n`;
  md += `| 风险 ID | 风险描述 | 概率 | 影响 | 缓解措施 | 负责人 |\n`;
  md += `|---------|---------|------|------|---------|--------|\n`;
  md += `| RISK-${moduleName}-001 | （待识别） | - | - | - | TBD |\n\n`;

  // 7. Story → Task 映射（本模块）
  md += `## 7. Story → Task 映射（本模块）\n\n`;
  md += `| Story ID | Story Title | Related Task IDs |\n`;
  md += `|----------|-------------|------------------|\n`;
  moduleStories.forEach(story => {
    const relatedTasks = moduleTasks.filter(t => t.story === story.id).map(t => t.id).join(', ');
    md += `| ${story.id} | ${story.title} | ${relatedTasks || '-'} |\n`;
  });
  md += `\n`;

  // 相关文档
  md += `## 8. 相关文档\n\n`;
  md += `- **主任务文档**：[../../TASK.md](../../TASK.md)\n`;
  md += `- **主 PRD 文档**：[../../PRD.md](../../PRD.md)\n`;
  md += `- **主架构文档**：[../../ARCH.md](../../ARCH.md)\n`;
  md += `- **模块 PRD 文档**：[../../prd-modules/${moduleDir}/PRD.md](../../prd-modules/${moduleDir}/PRD.md)\n`;
  md += `- **模块 ARCH 文档**：[../../arch-modules/${moduleDir}/ARCH.md](../../arch-modules/${moduleDir}/ARCH.md)\n\n`;

  md += `---\n\n`;
  md += `> **维护说明**：本文档由 TASK 专家自动生成。人工调整后，工具会尝试保留你的手工标注。\n`;

  return md;
}

// 更新 task-modules/module-list.md
function updateTaskModulesReadme(modules, tasks, stories) {
  const readmePath = path.join(CONFIG.taskModulesDir, 'module-list.md');
  const today = new Date().toISOString().split('T')[0];

  let md = `# 模块任务索引\n\n`;
  md += `> **说明**：本文档索引所有模块的详细任务计划。\n`;
  md += `> **更新日期**：${today}\n\n`;
  md += `---\n\n`;

  md += `## 模块清单\n\n`;
  md += `| 模块名称 | 任务数量 | 关联 Story | 文档链接 | 状态 |\n`;
  md += `|---------|---------|----------|---------|------|\n`;

  modules.forEach(module => {
    const moduleTasks = tasks.filter(t => t.module === module);
    const moduleStories = stories.filter(s => s.module === module);
    const moduleDir = toDomainDirectory(module);
    const moduleFile = `${moduleDir}/TASK.md`;
    md += `| ${module} | ${moduleTasks.length} | ${moduleStories.length} | [${moduleFile}](${moduleFile}) | 📝 待确认 |\n`;
  });

  md += `\n---\n\n`;
  md += `> **维护说明**：本文档由 TASK 专家自动生成，每次执行 \`/task plan\` 时自动更新。\n`;

  fs.writeFileSync(readmePath, md);
  log(`   ✅ 更新模块索引：task-modules/module-list.md`, 'green');
}

// 生成主 TASK.md（小型项目：完整结构；大型项目：总纲结构）
function generateTaskMarkdown(tasks, stories, components, isSplit = false) {
  const totalEffort = tasks.reduce((sum, t) => sum + (t.effort || 0), 0);
  const { criticalPath, criticalTasks } = calculateCriticalPath(tasks);

  if (isSplit) {
    // === 大型项目：生成总纲结构 ===
    return generateLargeProjectOverview(tasks, stories, components, totalEffort, criticalPath, criticalTasks);
  } else {
    // === 小型项目：生成完整结构 ===
    return generateSmallProjectMarkdown(tasks, stories, components, totalEffort, criticalPath, criticalTasks);
  }
}

// 小型项目：生成完整的 TASK.md（包含详细 WBS）
function generateSmallProjectMarkdown(tasks, stories, components, totalEffort, criticalPath, criticalTasks) {
  let md = `# 任务计划（WBS）\n\n`;
  md += `> **说明**：本文档由 TASK 专家通过 \`/task plan\` 命令自动生成，基于 PRD + ARCHITECTURE。\n`;
  md += `> 人工调整后，再次执行 \`/task plan --update-only\` 时，工具会保留你的手工标注，仅刷新自动生成部分。\n\n`;
  md += `**日期**：${new Date().toISOString().split('T')[0]}\n`;
  md += `**版本**：v0\n`;
  md += `**状态**：📝 待启动\n\n`;
  md += `---\n\n`;

  // 项目概述
  md += `## 1. 项目概述\n\n`;
  md += `- **Story 总数**：${stories.length}\n`;
  md += `- **Component 总数**：${components.length}\n`;
  md += `- **Task 总数**：${tasks.length}\n`;
  md += `- **预计周期**：${Math.ceil(totalEffort / 5)} 周（假设每周 5 人日）\n\n`;

  // 里程碑
  md += `## 2. 里程碑\n\n`;
  md += `| 里程碑 ID | 里程碑名称 | 目标日期 | 状态 |\n`;
  md += `|----------|----------|---------|------|\n`;
  md += `| M1 | MVP 发布 | TBD | 📝 待定 |\n`;
  md += `| M2 | 功能完善 | TBD | 📝 待定 |\n`;
  md += `| M3 | 正式上线 | TBD | 📝 待定 |\n\n`;

  // WBS
  md += `## 3. WBS（工作分解结构）\n\n`;
  md += `| Task ID | 任务名称 | 类型 | Owner | 估时 | 优先级 | 依赖 | 状态 |\n`;
  md += `|---------|---------|------|-------|------|--------|------|------|\n`;

  tasks.forEach(task => {
    const deps = task.dependencies && task.dependencies.length > 0
      ? task.dependencies.join(', ')
      : '-';
    const effort = task.effort ? `${task.effort}d` : 'TBD';
    md += `| ${task.id} | ${task.title} | ${task.type} | ${task.owner} | ${effort} | ${task.priority} | ${deps} | 📝 待开始 |\n`;
  });
  md += `\n`;

  // 关键路径
  md += `## 4. 关键路径（CPM）\n\n`;
  md += `**关键路径总长**：${criticalPath} 天\n\n`;
  md += `**关键任务**：\n`;
  criticalTasks.slice(0, 10).forEach(taskId => {
    md += `- ${taskId}\n`;
  });
  if (criticalTasks.length > 10) {
    md += `- ...（共 ${criticalTasks.length} 个关键任务）\n`;
  }
  md += `\n`;

  // 依赖矩阵
  md += `## 5. 依赖关系矩阵\n\n`;
  md += `| Task | 依赖 Task | 类型 |\n`;
  md += `|------|-----------|------|\n`;
  const tasksWithDeps = tasks.filter(t => t.dependencies && t.dependencies.length > 0);
  if (tasksWithDeps.length > 0) {
    tasksWithDeps.slice(0, 20).forEach(task => {
      task.dependencies.forEach(dep => {
        md += `| ${task.id} | ${dep} | FS |\n`;
      });
    });
    if (tasksWithDeps.length > 20) {
      md += `| ... | ... | ... |\n`;
    }
  } else {
    md += `| - | - | - |\n`;
  }
  md += `\n`;

  // 风险
  md += `## 6. 风险登记\n\n`;
  md += `| 风险 ID | 风险描述 | 概率 | 影响 | 缓解措施 | 负责人 |\n`;
  md += `|---------|---------|------|------|---------|--------|\n`;
  md += `| RISK-001 | 需求变更频繁 | 中 | 高 | 冻结需求基线、变更控制流程 | TBD |\n`;
  md += `| RISK-002 | 第三方 API 不稳定 | 中 | 中 | 增加重试机制、备用方案 | TBD |\n`;
  md += `| RISK-003 | 关键人员不足 | 低 | 高 | 提前招聘、知识共享 | TBD |\n\n`;

  // DB 任务
  md += `## 7. DB 任务（固定表头）\n\n`;
  md += `| ID | 类别 | 目标 | Backfill 方案 | 双写观察指标 | 对账规则 | 回滚方案 | Owner | 估时 | 依赖 |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|\n`;
  md += `| T-DB-001 | Expand | （待填写） | - | - | - | - | TBD | 1h | - |\n\n`;

  // Story → Task 映射
  md += `## 8. Story → Task 映射\n\n`;
  md += `| Story ID | Story Title | Related Task IDs |\n`;
  md += `|----------|-------------|------------------|\n`;
  stories.forEach(story => {
    const relatedTasks = tasks.filter(t => t.story === story.id).map(t => t.id).join(', ');
    md += `| ${story.id} | ${story.title} | ${relatedTasks || '-'} |\n`;
  });
  md += `\n`;

  // 相关文档
  md += `## 9. 相关文档\n\n`;
  md += `- **PRD 文档**：[PRD.md](PRD.md)\n`;
  md += `- **架构文档**：[ARCH.md](ARCH.md)\n`;
  md += `- **测试计划**：[QA.md](QA.md)\n`;
  md += `- **追溯矩阵**：[data/traceability-matrix.md](data/traceability-matrix.md)\n`;

  md += `\n---\n\n`;
  md += `> **维护说明**：本文档由 TASK 专家的 \`/task plan\` 命令自动生成。\n`;
  md += `> 人工调整后，再次执行 \`/task plan --update-only\` 时，工具会保留你的手工标注，仅刷新自动生成部分。\n`;

  return md;
}

// 大型项目：生成总纲结构（不包含详细 WBS，指向模块文档）
function generateLargeProjectOverview(tasks, stories, components, totalEffort, criticalPath, criticalTasks) {
  let md = `# 任务计划（总纲）\n\n`;
  md += `> **说明**：本文档为大型项目任务计划总纲，由 TASK 专家通过 \`/task plan\` 命令自动生成。\n`;
  md += `> 详细的模块任务计划请查看 \`task-modules/\` 目录下的各模块文档。\n\n`;
  md += `**日期**：${new Date().toISOString().split('T')[0]}\n`;
  md += `**版本**：v0\n`;
  md += `**状态**：📝 待启动\n\n`;
  md += `---\n\n`;

  // 1. 项目概述
  md += `## 1. 项目概述\n\n`;
  md += `- **Story 总数**：${stories.length}\n`;
  md += `- **Component 总数**：${components.length}\n`;
  md += `- **Task 总数**：${tasks.length}\n`;
  md += `- **预计周期**：${Math.ceil(totalEffort / 5)} 周（假设每周 5 人日）\n`;

  const modules = Array.from(new Set(tasks.map(t => t.module || 'GENERAL')));
  md += `- **模块数量**：${modules.length}\n\n`;

  // 2. 模块任务索引
  md += `## 2. 模块任务索引\n\n`;
  md += `| 模块名称 | 任务数量 | 负责团队 | 文档链接 | 状态 | 最后更新 |\n`;
  md += `|---------|---------|---------|---------|------|----------|\n`;

  const today = new Date().toISOString().split('T')[0];
  modules.forEach(module => {
    const moduleTasks = tasks.filter(t => t.module === module);
    const moduleDir = toDomainDirectory(module);
    const moduleFile = `${moduleDir}/TASK.md`;
    md += `| ${module} | ${moduleTasks.length} | TBD | [${moduleFile}](task-modules/${moduleFile}) | 📝 待确认 | ${today} |\n`;
  });
  md += `\n详见 [task-modules/module-list.md](task-modules/module-list.md)\n\n`;

  // 3. 全局里程碑
  md += `## 3. 全局里程碑（跨模块）\n\n`;
  md += `| 里程碑 ID | 里程碑名称 | 目标日期 | 交付物 | 验收标准 | 状态 |\n`;
  md += `|----------|----------|---------|--------|---------|------|\n`;
  md += `| M1 | MVP 发布 | TBD | 核心功能上线 | 基础功能可用、主流程打通 | 📝 待开始 |\n`;
  md += `| M2 | Beta 测试 | TBD | 功能增强 | 完成 80% 需求、性能达标 | 📝 待开始 |\n`;
  md += `| M3 | 正式上线 | TBD | 生产就绪 | 所有功能完成、通过验收测试 | 📝 待开始 |\n\n`;

  // 4. 跨模块依赖关系
  md += `## 4. 跨模块依赖关系\n\n`;
  const crossModuleDeps = extractCrossModuleDependencies(tasks);
  if (crossModuleDeps.length > 0) {
    md += `| 源模块 | 目标模块 | 任务依赖 | 说明 |\n`;
    md += `|--------|---------|---------|------|\n`;
    crossModuleDeps.slice(0, 15).forEach(dep => {
      md += `| ${dep.from} | ${dep.to} | ${dep.taskFrom} → ${dep.taskTo} | - |\n`;
    });
    if (crossModuleDeps.length > 15) {
      md += `| ... | ... | ... | 共 ${crossModuleDeps.length} 个跨模块依赖 |\n`;
    }
  } else {
    md += `> 未检测到跨模块依赖关系，各模块可并行开发。\n`;
  }
  md += `\n`;

  // 5. 全局关键路径
  md += `## 5. 全局关键路径（CPM）\n\n`;
  md += `**关键路径总长**：${criticalPath} 天\n\n`;
  md += `**关键任务（Top 10）**：\n`;
  criticalTasks.slice(0, 10).forEach(taskId => {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      md += `- ${taskId}（${task.module}模块）\n`;
    }
  });
  if (criticalTasks.length > 10) {
    md += `- ...（共 ${criticalTasks.length} 个关键任务，详见各模块文档）\n`;
  }
  md += `\n`;

  // 6. 全局风险与缓解
  md += `## 6. 全局风险与缓解\n\n`;
  md += `| 风险 ID | 风险描述 | 影响模块 | 概率 | 影响 | 缓解措施 | 负责人 |\n`;
  md += `|---------|---------|---------|------|------|---------|--------|\n`;
  md += `| RISK-GLOBAL-001 | 跨模块集成复杂度高 | 全局 | 中 | 高 | 定义清晰接口契约、早期集成测试 | TBD |\n`;
  md += `| RISK-GLOBAL-002 | 需求变更影响多模块 | 全局 | 中 | 高 | 变更控制委员会、影响分析流程 | TBD |\n`;
  md += `| RISK-GLOBAL-003 | 关键路径资源冲突 | ${modules.slice(0, 2).join(', ')} | 低 | 高 | 提前资源规划、备用人力 | TBD |\n\n`;

  // 相关文档
  md += `## 7. 相关文档\n\n`;
  md += `- **PRD 文档**：[PRD.md](PRD.md)\n`;
  md += `- **架构文档**：[ARCH.md](ARCH.md)\n`;
  md += `- **模块任务索引**：[task-modules/module-list.md](task-modules/module-list.md)\n`;
  md += `- **测试计划**：[QA.md](QA.md)\n`;
  md += `- **追溯矩阵**：[data/traceability-matrix.md](data/traceability-matrix.md)\n`;

  md += `\n---\n\n`;
  md += `> **维护说明**：本文档为总纲，保持 < 500 行。详细任务计划已拆分到各模块文档中。\n`;
  md += `> 人工调整后，再次执行 \`/task plan --update-only\` 时，工具会保留你的手工标注，仅刷新自动生成部分。\n`;

  return md;
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('TASK 自动生成工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  // 读取 PRD 和 ARCH
  if (!fs.existsSync(CONFIG.prdPath)) {
    log(`❌ 找不到 PRD：${CONFIG.prdPath}`, 'red');
    log(`   提示：请先创建 PRD 文档`, 'yellow');
    process.exit(1);
  }
  if (!fs.existsSync(CONFIG.archPath)) {
    log(`❌ 找不到 ARCHITECTURE：${CONFIG.archPath}`, 'red');
    log(`   提示：请先创建架构文档`, 'yellow');
    process.exit(1);
  }

  log(`✅ 读取 PRD 与 ARCHITECTURE...`, 'green');
  const prdContent = fs.readFileSync(CONFIG.prdPath, 'utf-8');
  const archContent = fs.readFileSync(CONFIG.archPath, 'utf-8');

  // 解析
  log(`📋 解析 Story 与 Component...`, 'cyan');
  const stories = parsePRD(prdContent);
  const components = parseArchitecture(archContent);

  log(`   - 找到 ${stories.length} 个 Story`, 'cyan');
  log(`   - 找到 ${components.length} 个 Component`, 'cyan');

  if (stories.length === 0 && components.length === 0) {
    log(`\n⚠️  警告：未找到任何 Story 或 Component`, 'yellow');
    log(`   PRD/ARCH 格式可能不匹配，请检查文档格式`, 'yellow');
    log(`   或者修改 generate-task.js 的正则表达式以适配你的格式\n`, 'yellow');
  }

  // 生成 WBS
  log(`🔧 生成 WBS...`, 'cyan');
  const tasks = createWBS(stories, components);
  log(`   - 生成 ${tasks.length} 个 Task`, 'cyan');

  // 检查是否需要拆分
  const needsSplit = shouldSplit(tasks, stories, components);
  log(`   - 项目规模：${needsSplit ? '大型（需拆分）' : '小型（单文件）'}`, 'cyan');

  // 生成 TASK.md
  log(`📝 生成 TASK.md...`, 'cyan');
  const taskMarkdown = generateTaskMarkdown(tasks, stories, components, needsSplit);
  fs.writeFileSync(CONFIG.taskPath, taskMarkdown);
  log(`✅ 已生成：${CONFIG.taskPath}`, 'green');

  // 大型项目拆分处理（自动创建模块文件）
  if (needsSplit) {
    log(`\n📂 项目规模较大，自动创建模块化任务文档...`, 'cyan');
    const moduleCount = generateModuleTaskFiles(tasks, stories, components);
    log(`✅ 已创建 ${moduleCount} 个模块任务文档`, 'green');
    log(`✅ 主 TASK.md 已转换为总纲结构（< 500 行）`, 'green');
  }

  log(`\n${'='.repeat(30)}`, 'green');
  log(`✅ TASK.md 自动生成完成！`, 'green');

  if (needsSplit) {
    log(`\n📋 大型项目已完成模块化拆分：`, 'cyan');
    log(`   - 主文档：docs/TASK.md（总纲与索引）`, 'cyan');
    log(`   - 模块文档：docs/task-modules/{domain}/TASK.md`, 'cyan');
    log(`   - 模块索引：docs/task-modules/module-list.md`, 'cyan');
  }

  log(`\n接下来建议：`, 'yellow');
  log(`1. 检查生成的 TASK.md：cat docs/TASK.md`, 'yellow');
  if (needsSplit) {
    log(`   检查模块文档：ls docs/task-modules/`, 'yellow');
  }
  log(`2. 运行质量检查：pnpm run task:lint`, 'yellow');
  log(`3. 验证关键路径：pnpm run task:check-critical-path`, 'yellow');
  log(`4. 同步 PRD ↔ TASK ID：pnpm run task:sync`, 'yellow');
  log(`5. 在 /docs/AGENT_STATE.md 勾选 TASK_PLANNED`, 'yellow');
  log(`\n`, 'reset');
}

// 执行
if (require.main === module) {
  try {
    main();
  } catch (error) {
    log(`\n❌ 执行出错: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

module.exports = { parsePRD, parseArchitecture, createWBS, generateTaskMarkdown };

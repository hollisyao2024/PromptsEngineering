#!/usr/bin/env node

/**
 * TASK 自动生成工具
 *
 * 功能：
 * - 从 PRD + ARCHITECTURE 自动生成 TASK.md
 * - 支持增量更新（保留人工标注）
 * - 生成 WBS、依赖矩阵、关键路径、里程碑、风险、DB 任务表
 * - 始终生成主 TASK 总纲、模块索引与模块 TASK 文档
 *
 * 用法：
 *   pnpm run task:generate -- [--init] [--update-only] [--preserve-manual-annotations]
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  prdPath: path.join(__dirname, '../../../docs/PRD.md'),
  prdModulesDir: path.join(__dirname, '../../../docs/prd-modules'),
  archPath: path.join(__dirname, '../../../docs/ARCH.md'),
  archModulesDir: path.join(__dirname, '../../../docs/arch-modules'),
  taskPath: path.join(__dirname, '../../../docs/TASK.md'),
  taskModulesDir: path.join(__dirname, '../../../docs/task-modules'),
  stateFile: path.join(__dirname, '../../../docs/AGENT_STATE.md'),

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

function listModuleDocuments(baseDir, fileName) {
  if (!fs.existsSync(baseDir)) return [];
  return fs.readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      moduleDir: entry.name,
      filePath: path.join(baseDir, entry.name, fileName),
    }))
    .filter((entry) => fs.existsSync(entry.filePath))
    .sort((a, b) => a.moduleDir.localeCompare(b.moduleDir));
}

function validateModuleAlignment(prdModules, archModules) {
  const prdSet = new Set(prdModules.map((entry) => entry.moduleDir));
  const archSet = new Set(archModules.map((entry) => entry.moduleDir));
  return {
    missingArch: Array.from(prdSet).filter((moduleDir) => !archSet.has(moduleDir)).sort(),
    extraArch: Array.from(archSet).filter((moduleDir) => !prdSet.has(moduleDir)).sort(),
  };
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

function moduleCodeFromDirectory(moduleDir) {
  return String(moduleDir || 'general').replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'GENERAL';
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
      moduleDir: story.moduleDir || toDomainDirectory(modulePrefix),
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
        moduleDir: story.moduleDir || toDomainDirectory(modulePrefix),
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
        moduleDir: story.moduleDir || toDomainDirectory(modulePrefix),
      });
    }
  });

  // 从 Component 生成基础设施任务
  components.forEach((comp, idx) => {
    if (comp.id.match(/INFRA|DEPLOY|MONITOR|SECURITY/i)) {
      const moduleDir = comp.moduleDir || 'infrastructure';
      const modulePrefix = comp.module || moduleCodeFromDirectory(moduleDir);
      tasks.push({
        id: `TASK-${modulePrefix}-${String(idx + 1).padStart(3, '0')}`,
        title: `Infrastructure: ${comp.title}`,
        type: 'Infrastructure',
        owner: comp.team,
        effort: 5,
        priority: 'P0',
        dependencies: [],
        module: modulePrefix,
        moduleDir,
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
function generateModuleTaskFiles(tasks, stories, components, requiredModuleDirs = []) {
  const moduleDirs = requiredModuleDirs.length > 0
    ? Array.from(new Set(requiredModuleDirs)).sort()
    : Array.from(new Set(tasks.map((task) => task.moduleDir || toDomainDirectory(task.module || 'GENERAL')))).sort();
  const moduleFileCount = moduleDirs.length;

  // 确保 task-modules 目录存在
  if (!fs.existsSync(CONFIG.taskModulesDir)) {
    fs.mkdirSync(CONFIG.taskModulesDir, { recursive: true });
  }

  moduleDirs.forEach(moduleDir => {
    const moduleTasks = tasks.filter((task) => (task.moduleDir || toDomainDirectory(task.module)) === moduleDir);
    const moduleStories = stories.filter((story) => (story.moduleDir || toDomainDirectory(story.module)) === moduleDir);
    const moduleName = moduleStories[0]?.module || moduleCodeFromDirectory(moduleDir);
    const moduleMarkdown = generateModuleMarkdown(moduleName, moduleDir, moduleTasks, moduleStories, tasks);

    const moduleFile = path.join(CONFIG.taskModulesDir, moduleDir, 'TASK.md');
    fs.mkdirSync(path.dirname(moduleFile), { recursive: true });
    fs.writeFileSync(moduleFile, moduleMarkdown);
    log(`   ✅ 创建模块文档：${moduleDir}/TASK.md (${moduleTasks.length} 个任务)`, 'green');
  });

  // 更新 task-modules/module-list.md
  updateTaskModulesReadme(moduleDirs, tasks, stories);

  return moduleFileCount;
}

// 生成单个模块的任务文档
function generateModuleMarkdown(moduleName, moduleDir, moduleTasks, moduleStories, allTasks) {
  const today = new Date().toISOString().split('T')[0];
  const totalEffort = moduleTasks.reduce((sum, t) => sum + (t.effort || 0), 0);

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
function updateTaskModulesReadme(moduleDirs, tasks, stories) {
  const readmePath = path.join(CONFIG.taskModulesDir, 'module-list.md');
  const today = new Date().toISOString().split('T')[0];

  let md = `# 模块任务索引\n\n`;
  md += `> **说明**：本文档索引所有模块的详细任务计划。\n`;
  md += `> **更新日期**：${today}\n\n`;
  md += `---\n\n`;

  md += `## 模块清单\n\n`;
  md += `| 模块名称 | 任务数量 | 关联 Story | 文档链接 | 状态 |\n`;
  md += `|---------|---------|----------|---------|------|\n`;

  moduleDirs.forEach(moduleDir => {
    const moduleTasks = tasks.filter((task) => (task.moduleDir || toDomainDirectory(task.module)) === moduleDir);
    const moduleStories = stories.filter((story) => (story.moduleDir || toDomainDirectory(story.module)) === moduleDir);
    const module = moduleStories[0]?.module || moduleCodeFromDirectory(moduleDir);
    const moduleFile = `${moduleDir}/TASK.md`;
    md += `| ${module} | ${moduleTasks.length} | ${moduleStories.length} | [${moduleFile}](${moduleFile}) | 📝 待确认 |\n`;
  });

  md += `\n---\n\n`;
  md += `> **维护说明**：本文档由 TASK 专家自动生成，每次执行 \`/task plan\` 时自动更新。\n`;

  fs.writeFileSync(readmePath, md);
  log(`   ✅ 更新模块索引：task-modules/module-list.md`, 'green');
}

// 生成主 TASK.md 总纲；详细 WBS 始终写入模块文档。
function generateTaskMarkdown(tasks, stories, components, requiredModuleDirs = []) {
  const totalEffort = tasks.reduce((sum, t) => sum + (t.effort || 0), 0);
  const { criticalPath, criticalTasks } = calculateCriticalPath(tasks);
  return generateProjectOverview(tasks, stories, components, totalEffort, criticalPath, criticalTasks, requiredModuleDirs);
}

// 生成总纲结构（不包含详细 WBS，指向模块文档）
function generateProjectOverview(tasks, stories, components, totalEffort, criticalPath, criticalTasks, requiredModuleDirs = []) {
  let md = `# 任务计划（总纲）\n\n`;
  md += `> **说明**：本文档为任务计划总纲，由 TASK 专家通过 \`/task plan\` 命令自动生成。\n`;
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

  const moduleDirs = requiredModuleDirs.length > 0
    ? Array.from(new Set(requiredModuleDirs)).sort()
    : Array.from(new Set(tasks.map((task) => task.moduleDir || toDomainDirectory(task.module || 'GENERAL')))).sort();
  md += `- **模块数量**：${moduleDirs.length}\n\n`;

  // 2. 模块任务索引
  md += `## 2. 模块任务索引\n\n`;
  md += `| 模块名称 | 任务数量 | 负责团队 | 文档链接 | 状态 | 最后更新 |\n`;
  md += `|---------|---------|---------|---------|------|----------|\n`;

  const today = new Date().toISOString().split('T')[0];
  moduleDirs.forEach(moduleDir => {
    const moduleTasks = tasks.filter((task) => (task.moduleDir || toDomainDirectory(task.module)) === moduleDir);
    const module = moduleTasks[0]?.module || moduleCodeFromDirectory(moduleDir);
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
  md += `| RISK-GLOBAL-003 | 关键路径资源冲突 | ${moduleDirs.slice(0, 2).join(', ')} | 低 | 高 | 提前资源规划、备用人力 | TBD |\n\n`;

  // 模块同步与相关文档
  md += `## 7. 模块同步与相关文档\n\n`;
  md += `- PRD、ARCH、TASK、QA 的模块清单必须保持同一模块集合。\n`;
  md += `- 模块状态、依赖或里程碑变化时，同步主 TASK 与 \`task-modules/module-list.md\`。\n`;
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
  const prdModules = listModuleDocuments(CONFIG.prdModulesDir, 'PRD.md');
  const archModules = listModuleDocuments(CONFIG.archModulesDir, 'ARCH.md');
  if (prdModules.length === 0) {
    log('❌ 未找到 docs/prd-modules/{domain}/PRD.md；模块化结构是强制要求', 'red');
    process.exit(1);
  }
  const alignment = validateModuleAlignment(prdModules, archModules);
  if (alignment.missingArch.length > 0 || alignment.extraArch.length > 0) {
    log(`❌ PRD/ARCH 模块集合不一致：missingArch=${alignment.missingArch.join(',') || '-'} extraArch=${alignment.extraArch.join(',') || '-'}`, 'red');
    process.exit(1);
  }
  // 解析
  log(`📋 解析 Story 与 Component...`, 'cyan');
  const stories = prdModules.flatMap((entry) => parsePRD(fs.readFileSync(entry.filePath, 'utf-8'))
    .map((story) => ({ ...story, moduleDir: entry.moduleDir })));
  const components = archModules.flatMap((entry) => parseArchitecture(fs.readFileSync(entry.filePath, 'utf-8'))
    .map((component) => ({
      ...component,
      module: moduleCodeFromDirectory(entry.moduleDir),
      moduleDir: entry.moduleDir,
    })));

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

  log(`   - 文档模式：模块化（${prdModules.length} 个模块）`, 'cyan');

  // 生成 TASK.md
  log(`📝 生成 TASK.md...`, 'cyan');
  const requiredModuleDirs = prdModules.map((entry) => entry.moduleDir);
  const taskMarkdown = generateTaskMarkdown(tasks, stories, components, requiredModuleDirs);
  fs.writeFileSync(CONFIG.taskPath, taskMarkdown);
  log(`✅ 已生成：${CONFIG.taskPath}`, 'green');

  log(`\n📂 创建模块化任务文档...`, 'cyan');
  const moduleCount = generateModuleTaskFiles(tasks, stories, components, requiredModuleDirs);
  log(`✅ 已创建 ${moduleCount} 个模块任务文档`, 'green');
  log(`✅ 主 TASK.md 为总纲结构`, 'green');

  log(`\n${'='.repeat(30)}`, 'green');
  log(`✅ TASK.md 自动生成完成！`, 'green');

  log(`\n📋 模块化任务文档已生成：`, 'cyan');
  log(`   - 主文档：docs/TASK.md（总纲与索引）`, 'cyan');
  log(`   - 模块文档：docs/task-modules/{domain}/TASK.md`, 'cyan');
  log(`   - 模块索引：docs/task-modules/module-list.md`, 'cyan');

  log(`\n接下来建议：`, 'yellow');
  log(`1. 检查生成的 TASK.md：cat docs/TASK.md`, 'yellow');
  log(`   检查模块文档：ls docs/task-modules/`, 'yellow');
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

module.exports = {
  createWBS,
  generateTaskMarkdown,
  listModuleDocuments,
  moduleCodeFromDirectory,
  parseArchitecture,
  parsePRD,
  validateModuleAlignment,
};

#!/usr/bin/env node

/**
 * 任务依赖循环检查脚本
 *
 * 检查项：
 * - 解析所有 Task 的依赖关系
 * - 检测循环依赖（A → B → C → A）
 * - 检测无效依赖（依赖的 Task 不存在）
 * - 生成依赖关系报告
 */

const fs = require('fs');
const path = require('path');
const { TASK_ID_SOURCE, extractIds } = require('../shared/governance-ids');

// 配置
const CONFIG = {
  taskPath: path.join(__dirname, '../../../docs/TASK.md'),
  taskModulesDir: path.join(__dirname, '../../../docs/task-modules'),
  taskDependencyMatrixPath: path.join(__dirname, '../../../docs/data/task-dependency-matrix.md'),
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function parseMarkdownRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed.slice(1, -1).split('|').map(cell => cell.trim());
}

function isSeparatorRow(cells) {
  return cells && cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function mergeDependencies(dependencies, taskId, depIds) {
  const current = dependencies.get(taskId) || [];
  dependencies.set(taskId, [...new Set([
    ...current,
    ...depIds.filter(depId => depId !== taskId),
  ])]);
}

function attachDefinedTasks(dependencies) {
  Object.defineProperty(dependencies, 'definedTasks', {
    value: new Set(),
    enumerable: false,
  });
  return dependencies;
}

function isSchedulingDependency(type) {
  const normalized = String(type || '').trim().toUpperCase();
  return normalized === '' || ['FS', 'SS', 'FF', 'SF'].includes(normalized);
}

// 解析单个文件的依赖关系。WBS 表中的依赖列、模块矩阵和全局矩阵
// 具有不同方向；CHECK 是验证关系，不是调度边。
function parseDependencies(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const dependencies = attachDefinedTasks(new Map());
  const referencedByWbsOrHeading = new Set();

  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = parseMarkdownRow(lines[index]);
    const separator = parseMarkdownRow(lines[index + 1]);
    if (!header || !isSeparatorRow(separator)) continue;

    const normalizedHeader = header.map(cell => cell.replace(/\s+/g, ' ').trim());
    const taskColumn = normalizedHeader.findIndex(cell => /^(?:Task ID|任务)$/i.test(cell));
    const dependencyColumn = normalizedHeader.findIndex(cell => /^(?:Dependencies|依赖|前置任务)$/i.test(cell));
    const prerequisiteColumn = normalizedHeader.findIndex(cell => /^前置任务$/u.test(cell));
    const successorColumn = normalizedHeader.findIndex(cell => /^后置任务$/u.test(cell));
    const typeColumn = normalizedHeader.findIndex(cell => /^(?:类型|依赖类型)$/u.test(cell));
    const isGlobalMatrix = prerequisiteColumn >= 0 && successorColumn >= 0;
    const isModuleMatrix = !isGlobalMatrix && taskColumn >= 0 && dependencyColumn >= 0 && typeColumn >= 0;
    const isWbs = !isGlobalMatrix && !isModuleMatrix && taskColumn >= 0 && dependencyColumn >= 0;
    if (!isGlobalMatrix && !isModuleMatrix && !isWbs) continue;

    index += 2;
    while (index < lines.length) {
      const cells = parseMarkdownRow(lines[index]);
      if (!cells || isSeparatorRow(cells)) break;
      const nextCells = parseMarkdownRow(lines[index + 1] || '');
      if (isSeparatorRow(nextCells)) {
        // An adjacent Markdown table starts at the current line. Rewind once so
        // the outer loop can parse this header instead of treating it as data.
        index -= 1;
        break;
      }

      if (isGlobalMatrix || isModuleMatrix) {
        const type = typeColumn >= 0 ? cells[typeColumn] : '';
        if (isSchedulingDependency(type)) {
          const prerequisiteCell = isGlobalMatrix ? cells[prerequisiteColumn] : cells[dependencyColumn];
          const dependentCell = isGlobalMatrix ? cells[successorColumn] : cells[taskColumn];
          const prerequisites = extractIds(prerequisiteCell || '', TASK_ID_SOURCE);
          const dependents = extractIds(dependentCell || '', TASK_ID_SOURCE);
          for (const dependent of dependents) {
            mergeDependencies(dependencies, dependent, prerequisites);
          }
          for (const prerequisite of prerequisites) {
            if (!dependencies.has(prerequisite)) dependencies.set(prerequisite, []);
          }
        }
      } else {
        const tasks = extractIds(cells[taskColumn] || '', TASK_ID_SOURCE);
        const prerequisites = extractIds(cells[dependencyColumn] || '', TASK_ID_SOURCE);
        for (const taskId of tasks) {
          dependencies.definedTasks.add(taskId);
          mergeDependencies(dependencies, taskId, prerequisites);
        }
        prerequisites.forEach(taskId => referencedByWbsOrHeading.add(taskId));
      }
      index += 1;
    }
  }

  const headingRegex = new RegExp('^#{2,6}\\s+(' + TASK_ID_SOURCE + ')(?:\\s*[：:])?', 'u');
  let currentTask = null;
  for (const line of lines) {
    const heading = line.match(headingRegex);
    if (heading) {
      currentTask = heading[1];
      dependencies.definedTasks.add(currentTask);
      if (!dependencies.has(currentTask)) dependencies.set(currentTask, []);
      continue;
    }
    if (!currentTask || !/^\s*\*\*依赖\*\*[：:]?/u.test(line)) continue;
    const prerequisites = extractIds(line, TASK_ID_SOURCE);
    mergeDependencies(dependencies, currentTask, prerequisites);
    prerequisites.forEach(taskId => referencedByWbsOrHeading.add(taskId));
  }

  for (const referenced of referencedByWbsOrHeading) {
    if (!dependencies.has(referenced)) dependencies.set(referenced, []);
  }

  return dependencies;
}

// 收集所有依赖关系
function collectAllDependencies() {
  const allDeps = attachDefinedTasks(new Map());

  function mergeGraph(deps) {
    deps.forEach((value, key) => {
      if (allDeps.has(key)) {
        const existingDeps = allDeps.get(key);
        allDeps.set(key, [...new Set([...existingDeps, ...value])]);
      } else {
        allDeps.set(key, value);
      }
    });
    if (deps.definedTasks) {
      deps.definedTasks.forEach(taskId => allDeps.definedTasks.add(taskId));
    }
  }

  // 读取主 TASK
  if (fs.existsSync(CONFIG.taskPath)) {
    mergeGraph(parseDependencies(CONFIG.taskPath));
  }

  // 读取任务依赖矩阵
  if (fs.existsSync(CONFIG.taskDependencyMatrixPath)) {
    mergeGraph(parseDependencies(CONFIG.taskDependencyMatrixPath));
  }

  // 读取模块 TASK
  if (fs.existsSync(CONFIG.taskModulesDir)) {
    const entries = fs.readdirSync(CONFIG.taskModulesDir, { withFileTypes: true });

    entries.forEach(entry => {
      if (entry.isDirectory()) {
        // 扫描模块子目录下的 TASK.md
        const moduleTaskPath = path.join(CONFIG.taskModulesDir, entry.name, 'TASK.md');
        if (fs.existsSync(moduleTaskPath)) {
          mergeGraph(parseDependencies(moduleTaskPath));
        }
      }
    });
  }

  return allDeps;
}

// 检测循环依赖（DFS）
function detectCycles(dependencies) {
  const visited = new Set();
  const recStack = new Set();
  const cycles = [];

  function dfs(node, path = []) {
    if (recStack.has(node)) {
      // 找到循环
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat(node);
      cycles.push(cycle);
      return;
    }

    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    recStack.add(node);
    path.push(node);

    const deps = dependencies.get(node) || [];
    deps.forEach(dep => {
      if (dependencies.has(dep)) {
        dfs(dep, [...path]);
      }
    });

    recStack.delete(node);
  }

  // 从每个节点开始 DFS
  dependencies.forEach((_, node) => {
    if (!visited.has(node)) {
      dfs(node);
    }
  });

  return cycles;
}

// 检测无效依赖（依赖的 Task 不存在）
function detectInvalidDependencies(dependencies) {
  const allTasks = dependencies.definedTasks || new Set(dependencies.keys());
  const invalidDeps = [];
  const referencedTasks = new Set();

  dependencies.forEach((deps, taskId) => {
    deps.forEach(depId => {
      referencedTasks.add(depId);
      if (!allTasks.has(depId)) {
        invalidDeps.push({ taskId, depId });
      }
    });
  });

  // A matrix can introduce a dependent node without defining that Task in a
  // canonical WBS row or Task heading. Report it once unless another edge has
  // already exposed the same missing definition as a prerequisite.
  dependencies.forEach((_, taskId) => {
    if (!allTasks.has(taskId) && !referencedTasks.has(taskId)) {
      invalidDeps.push({ taskId, depId: null });
    }
  });

  return invalidDeps;
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('任务依赖循环检查工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  log('\n📖 解析依赖关系...', 'cyan');
  const dependencies = collectAllDependencies();

  if (dependencies.size === 0) {
    log('⚠️  未找到任何任务，请先创建 TASK 文档', 'yellow');
    process.exit(1);
  }

  log(`✅ 找到 ${dependencies.size} 个任务`, 'green');

  // 统计依赖关系
  const totalDeps = Array.from(dependencies.values())
    .reduce((sum, deps) => sum + deps.length, 0);
  log(`📊 总依赖关系数: ${totalDeps}`, 'cyan');

  // 检测循环依赖
  log('\n🔍 检测循环依赖...', 'cyan');
  const cycles = detectCycles(dependencies);

  if (cycles.length === 0) {
    log('✅ 未发现循环依赖', 'green');
  } else {
    log(`❌ 发现 ${cycles.length} 个循环依赖:`, 'red');
    cycles.forEach((cycle, index) => {
      log(`\n   循环 ${index + 1}:`, 'yellow');
      log(`   ${cycle.join(' → ')}`, 'yellow');
    });
  }

  // 检测无效依赖
  log('\n🔍 检测无效依赖...', 'cyan');
  const invalidDeps = detectInvalidDependencies(dependencies);

  if (invalidDeps.length === 0) {
    log('✅ 所有依赖关系有效', 'green');
  } else {
    log(`⚠️  发现 ${invalidDeps.length} 个无效依赖:`, 'yellow');
    invalidDeps.forEach(({ taskId, depId }) => {
      if (depId === null) {
        log(`   ${taskId} 仅在依赖矩阵中出现，未在 WBS 或 Task 标题中定义`, 'yellow');
      } else {
        log(`   ${taskId} 依赖的 ${depId} 不存在`, 'yellow');
      }
    });
  }

  // 汇总结果
  log('\n' + '='.repeat(60), 'cyan');
  log('检查结果汇总:', 'cyan');
  log('='.repeat(60), 'cyan');

  if (cycles.length === 0 && invalidDeps.length === 0) {
    log('✅ 依赖关系健康，无循环依赖和无效依赖！', 'green');
    process.exit(0);
  } else {
    log('❌ 发现问题，请修正：', 'red');
    if (cycles.length > 0) {
      log(`   - ${cycles.length} 个循环依赖`, 'red');
    }
    if (invalidDeps.length > 0) {
      log(`   - ${invalidDeps.length} 个无效依赖`, 'yellow');
    }
    log('\n建议：', 'yellow');
    log('1. 重新设计循环依赖的任务，消除循环', 'yellow');
    log('2. 删除或修正无效的依赖引用', 'yellow');
    log('3. 更新 /docs/data/task-dependency-matrix.md', 'yellow');
    process.exit(1);
  }
}

// 运行
if (require.main === module) {
  try {
    main();
  } catch (error) {
    log(`\n❌ 执行出错: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

module.exports = { parseDependencies, collectAllDependencies, detectCycles, detectInvalidDependencies };

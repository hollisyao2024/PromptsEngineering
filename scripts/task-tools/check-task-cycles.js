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

// 配置
const CONFIG = {
  taskPath: path.join(__dirname, '../../docs/TASK.md'),
  taskModulesDir: path.join(__dirname, '../../docs/task-modules'),
  taskDependencyMatrixPath: path.join(__dirname, '../../docs/data/task-dependency-matrix.md'),
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

// 解析单个文件的依赖关系
function parseDependencies(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const dependencies = new Map();

  // 方法 1: 匹配任务行和依赖列
  // 格式: | TASK-MODULE-NNN | 任务名称 | ... | TASK-XXX-YYY | ...
  const tableRowRegex = /\|\s*(TASK-[A-Z]+-\d{3})\s*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*([^|]*)\s*\|/g;
  let match;

  while ((match = tableRowRegex.exec(content)) !== null) {
    const taskId = match[1];
    const depColumn = match[2];

    // 提取依赖列中的所有 TASK-XXX-YYY
    const depIds = (depColumn.match(/TASK-[A-Z]+-\d{3}/g) || [])
      .filter(id => id !== taskId); // 排除自己

    if (dependencies.has(taskId)) {
      // 合并依赖
      const existingDeps = dependencies.get(taskId);
      dependencies.set(taskId, [...new Set([...existingDeps, ...depIds])]);
    } else {
      dependencies.set(taskId, depIds);
    }
  }

  // 方法 2: 匹配任务章节和依赖标记
  // 格式: ### TASK-MODULE-NNN: Title
  //      **依赖**：TASK-XXX-YYY, TASK-ZZZ-WWW
  const taskRegex = /###?\s+(TASK-[A-Z]+-\d{3}):([^#]+)/g;

  while ((match = taskRegex.exec(content)) !== null) {
    const taskId = match[1];
    const taskContent = match[2];

    // 提取依赖
    const depMatch = taskContent.match(/\*\*依赖[：:]\*\*\s*([^\n]+)/);
    if (depMatch) {
      const depString = depMatch[1];
      // 提取所有 TASK-XXX-YYY 格式的 ID
      const depIds = (depString.match(/TASK-[A-Z]+-\d{3}/g) || [])
        .filter(id => id !== taskId); // 排除自己

      if (dependencies.has(taskId)) {
        // 合并依赖
        const existingDeps = dependencies.get(taskId);
        dependencies.set(taskId, [...new Set([...existingDeps, ...depIds])]);
      } else {
        dependencies.set(taskId, depIds);
      }
    } else if (!dependencies.has(taskId)) {
      // 如果还没有记录，添加一个空依赖
      dependencies.set(taskId, []);
    }
  }

  // 方法 3: 匹配依赖矩阵格式
  // 格式: | TASK-XXX-YYY | TASK-ZZZ-WWW | FS | ...
  const depMatrixRegex = /\|\s*(TASK-[A-Z]+-\d{3})\s*\|\s*(TASK-[A-Z]+-\d{3})\s*\|/g;

  while ((match = depMatrixRegex.exec(content)) !== null) {
    const dependentTask = match[2]; // 后置任务
    const prerequisiteTask = match[1]; // 前置任务

    // dependentTask 依赖 prerequisiteTask
    if (dependencies.has(dependentTask)) {
      const existingDeps = dependencies.get(dependentTask);
      if (!existingDeps.includes(prerequisiteTask)) {
        dependencies.set(dependentTask, [...existingDeps, prerequisiteTask]);
      }
    } else {
      dependencies.set(dependentTask, [prerequisiteTask]);
    }

    // 确保 prerequisiteTask 也在 map 中（即使它没有依赖）
    if (!dependencies.has(prerequisiteTask)) {
      dependencies.set(prerequisiteTask, []);
    }
  }

  return dependencies;
}

// 收集所有依赖关系
function collectAllDependencies() {
  const allDeps = new Map();

  // 读取主 TASK
  if (fs.existsSync(CONFIG.taskPath)) {
    const deps = parseDependencies(CONFIG.taskPath);
    deps.forEach((value, key) => allDeps.set(key, value));
  }

  // 读取任务依赖矩阵
  if (fs.existsSync(CONFIG.taskDependencyMatrixPath)) {
    const deps = parseDependencies(CONFIG.taskDependencyMatrixPath);
    deps.forEach((value, key) => {
      if (allDeps.has(key)) {
        // 合并依赖
        const existingDeps = allDeps.get(key);
        allDeps.set(key, [...new Set([...existingDeps, ...value])]);
      } else {
        allDeps.set(key, value);
      }
    });
  }

  // 读取模块 TASK
  if (fs.existsSync(CONFIG.taskModulesDir)) {
    const entries = fs.readdirSync(CONFIG.taskModulesDir, { withFileTypes: true });

    entries.forEach(entry => {
      if (entry.isDirectory()) {
        // 扫描模块子目录下的 TASK.md
        const moduleTaskPath = path.join(CONFIG.taskModulesDir, entry.name, 'TASK.md');
        if (fs.existsSync(moduleTaskPath)) {
          const deps = parseDependencies(moduleTaskPath);
          deps.forEach((value, key) => {
            if (allDeps.has(key)) {
              const existingDeps = allDeps.get(key);
              allDeps.set(key, [...new Set([...existingDeps, ...value])]);
            } else {
              allDeps.set(key, value);
            }
          });
        }
      } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md' && entry.name !== 'MODULE-TEMPLATE.md') {
        // 兼容旧格式：直接在 task-modules/ 下的 .md 文件
        const filePath = path.join(CONFIG.taskModulesDir, entry.name);
        const deps = parseDependencies(filePath);
        deps.forEach((value, key) => {
          if (allDeps.has(key)) {
            const existingDeps = allDeps.get(key);
            allDeps.set(key, [...new Set([...existingDeps, ...value])]);
          } else {
            allDeps.set(key, value);
          }
        });
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
  const allTasks = new Set(dependencies.keys());
  const invalidDeps = [];

  dependencies.forEach((deps, taskId) => {
    deps.forEach(depId => {
      if (!allTasks.has(depId)) {
        invalidDeps.push({ taskId, depId });
      }
    });
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
    process.exit(0);
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
      log(`   ${taskId} 依赖的 ${depId} 不存在`, 'yellow');
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

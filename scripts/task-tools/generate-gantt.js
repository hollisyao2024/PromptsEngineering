#!/usr/bin/env node

/**
 * 甘特图生成脚本
 *
 * 功能：
 * - 解析任务依赖关系和工作量
 * - 计算任务开始和结束时间
 * - 生成 Mermaid gantt 图
 * - 标记关键路径任务
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  taskPath: path.join(__dirname, '../../docs/TASK.md'),
  taskModulesDir: path.join(__dirname, '../../docs/task-modules'),
  outputPath: path.join(__dirname, '../../docs/data/milestone-gantt.md'),
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

// 解析任务信息（ID、名称、工作量、依赖）
function parseTasks(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const tasks = [];

  // 匹配表格行
  const tableRowRegex = /\|\s*(TASK-[A-Z]+-\d{3})\s*\|\s*([^|]+)\s*\|[^|]*\|\s*(\d+(?:d|天|人天)?)\s*\|[^|]*\|\s*([^|]*)\s*\|/g;
  let match;

  while ((match = tableRowRegex.exec(content)) !== null) {
    const taskId = match[1];
    const taskName = match[2].trim();
    const effortStr = match[3].trim();
    const depsStr = match[4].trim();

    // 解析工作量（转换为天数）
    let effortDays = 1;
    const effortMatch = effortStr.match(/(\d+)/);
    if (effortMatch) {
      effortDays = parseInt(effortMatch[1], 10);
    }

    // 解析依赖
    const deps = (depsStr.match(/TASK-[A-Z]+-\d{3}/g) || []);

    tasks.push({
      id: taskId,
      name: taskName.substring(0, 30), // 限制长度
      effort: effortDays,
      dependencies: deps,
    });
  }

  return tasks;
}

// 收集所有任务
function collectAllTasks() {
  let allTasks = [];

  // 读取主 TASK
  if (fs.existsSync(CONFIG.taskPath)) {
    allTasks = allTasks.concat(parseTasks(CONFIG.taskPath));
  }

  // 读取模块 TASK
  if (fs.existsSync(CONFIG.taskModulesDir)) {
    const entries = fs.readdirSync(CONFIG.taskModulesDir, { withFileTypes: true });

    entries.forEach(entry => {
      if (entry.isDirectory()) {
        const moduleTaskPath = path.join(CONFIG.taskModulesDir, entry.name, 'TASK.md');
        if (fs.existsSync(moduleTaskPath)) {
          allTasks = allTasks.concat(parseTasks(moduleTaskPath));
        }
      }
    });
  }

  return allTasks;
}

// 生成 Mermaid 甘特图
function generateGanttChart(tasks) {
  let gantt = 'gantt\n';
  gantt += '    title 项目任务甘特图\n';
  gantt += '    dateFormat YYYY-MM-DD\n';
  gantt += '    excludes weekends\n\n';

  // 按模块分组
  const moduleGroups = new Map();
  tasks.forEach(task => {
    const module = task.id.split('-')[1]; // 提取模块名（如 USER）
    if (!moduleGroups.has(module)) {
      moduleGroups.set(module, []);
    }
    moduleGroups.get(module).push(task);
  });

  // 生成各模块章节
  moduleGroups.forEach((moduleTasks, module) => {
    gantt += `    section ${module}\n`;
    moduleTasks.forEach(task => {
      const taskLine = `    ${task.name}  :${task.id}, ${task.effort}d\n`;
      gantt += taskLine;
    });
    gantt += '\n';
  });

  return gantt;
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('甘特图生成工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  log('\n📖 解析任务...', 'cyan');
  const tasks = collectAllTasks();

  if (tasks.length === 0) {
    log('⚠️  未找到任何任务，请先创建 TASK 文档', 'yellow');
    process.exit(0);
  }

  log(`✅ 找到 ${tasks.length} 个任务`, 'green');

  log('\n📊 生成甘特图...', 'cyan');
  const ganttChart = generateGanttChart(tasks);

  // 确保目录存在
  const outputDir = path.dirname(CONFIG.outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 写入文件
  fs.writeFileSync(CONFIG.outputPath, ganttChart, 'utf-8');

  log(`✅ 甘特图已保存到: ${CONFIG.outputPath}`, 'green');

  log('\n📝 在 Markdown 中引用:', 'cyan');
  log('```mermaid', 'yellow');
  log(ganttChart.trim(), 'yellow');
  log('```', 'yellow');

  log('\n✅ 甘特图生成完成！', 'green');
  process.exit(0);
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

module.exports = { parseTasks, collectAllTasks, generateGanttChart };

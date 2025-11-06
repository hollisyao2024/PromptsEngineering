#!/usr/bin/env node

/**
 * Story → Task 映射验证脚本
 *
 * 检查项：
 * - 解析 PRD 中的所有 Story ID
 * - 解析 TASK 中的所有 Task ID
 * - 验证 Story → Task 映射表完整性
 * - 检测孤儿 Story（无 Task 实现）
 * - 检测孤儿 Task（无对应 Story）
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  prdPath: path.join(__dirname, '../../docs/PRD.md'),
  prdModulesDir: path.join(__dirname, '../../docs/prd-modules'),
  taskPath: path.join(__dirname, '../../docs/TASK.md'),
  taskModulesDir: path.join(__dirname, '../../docs/task-modules'),
  storyTaskMappingPath: path.join(__dirname, '../../docs/data/story-task-mapping.md'),
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

// 从文件中提取 Story ID
function extractStoryIds(filePath) {
  if (!fs.existsSync(filePath)) {
    return new Set();
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const storyIds = new Set();

  // 匹配 US-MODULE-NNN 格式
  const matches = content.match(/US-[A-Z]+-\d{3}/g) || [];
  matches.forEach(id => storyIds.add(id));

  return storyIds;
}

// 从文件中提取 Task ID
function extractTaskIds(filePath) {
  if (!fs.existsSync(filePath)) {
    return new Set();
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const taskIds = new Set();

  // 匹配 TASK-MODULE-NNN 格式
  const matches = content.match(/TASK-[A-Z]+-\d{3}/g) || [];
  matches.forEach(id => taskIds.add(id));

  return taskIds;
}

// 收集所有 Story ID
function collectAllStoryIds() {
  const allStories = new Set();

  // 读取主 PRD
  if (fs.existsSync(CONFIG.prdPath)) {
    const stories = extractStoryIds(CONFIG.prdPath);
    stories.forEach(id => allStories.add(id));
  }

  // 读取模块 PRD
  if (fs.existsSync(CONFIG.prdModulesDir)) {
    const entries = fs.readdirSync(CONFIG.prdModulesDir, { withFileTypes: true });

    entries.forEach(entry => {
      if (entry.isDirectory()) {
        // 扫描模块子目录下的 PRD.md
        const modulePrdPath = path.join(CONFIG.prdModulesDir, entry.name, 'PRD.md');
        if (fs.existsSync(modulePrdPath)) {
          const stories = extractStoryIds(modulePrdPath);
          stories.forEach(id => allStories.add(id));
        }
      } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') {
        // 兼容旧格式：直接在 prd-modules/ 下的 .md 文件
        const filePath = path.join(CONFIG.prdModulesDir, entry.name);
        const stories = extractStoryIds(filePath);
        stories.forEach(id => allStories.add(id));
      }
    });
  }

  return allStories;
}

// 收集所有 Task ID
function collectAllTaskIds() {
  const allTasks = new Set();

  // 读取主 TASK
  if (fs.existsSync(CONFIG.taskPath)) {
    const tasks = extractTaskIds(CONFIG.taskPath);
    tasks.forEach(id => allTasks.add(id));
  }

  // 读取模块 TASK
  if (fs.existsSync(CONFIG.taskModulesDir)) {
    const entries = fs.readdirSync(CONFIG.taskModulesDir, { withFileTypes: true });

    entries.forEach(entry => {
      if (entry.isDirectory()) {
        // 扫描模块子目录下的 TASK.md
        const moduleTaskPath = path.join(CONFIG.taskModulesDir, entry.name, 'TASK.md');
        if (fs.existsSync(moduleTaskPath)) {
          const tasks = extractTaskIds(moduleTaskPath);
          tasks.forEach(id => allTasks.add(id));
        }
      } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md' && entry.name !== 'MODULE-TEMPLATE.md') {
        // 兼容旧格式：直接在 task-modules/ 下的 .md 文件
        const filePath = path.join(CONFIG.taskModulesDir, entry.name);
        const tasks = extractTaskIds(filePath);
        tasks.forEach(id => allTasks.add(id));
      }
    });
  }

  return allTasks;
}

// 解析 Story → Task 映射表
function parseStoryTaskMapping() {
  if (!fs.existsSync(CONFIG.storyTaskMappingPath)) {
    return { mapping: new Map(), mappedStories: new Set(), mappedTasks: new Set() };
  }

  const content = fs.readFileSync(CONFIG.storyTaskMappingPath, 'utf-8');
  const mapping = new Map(); // Story ID → [Task IDs]
  const mappedStories = new Set();
  const mappedTasks = new Set();

  // 匹配表格行: | US-XXX-YYY | ... | TASK-XXX-YYY | ...
  const tableRowRegex = /\|\s*(US-[A-Z]+-\d{3})\s*\|[^|]*\|\s*(TASK-[A-Z]+-\d{3})\s*\|/g;
  let match;

  while ((match = tableRowRegex.exec(content)) !== null) {
    const storyId = match[1];
    const taskId = match[2];

    mappedStories.add(storyId);
    mappedTasks.add(taskId);

    if (mapping.has(storyId)) {
      mapping.get(storyId).push(taskId);
    } else {
      mapping.set(storyId, [taskId]);
    }
  }

  return { mapping, mappedStories, mappedTasks };
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('Story → Task 映射验证工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  // 收集 Story ID
  log('\n📖 解析 PRD 中的 Story ID...', 'cyan');
  const allStories = collectAllStoryIds();

  if (allStories.size === 0) {
    log('⚠️  未找到任何用户故事，请先创建 PRD 文档', 'yellow');
    process.exit(0);
  }

  log(`✅ 找到 ${allStories.size} 个用户故事`, 'green');

  // 收集 Task ID
  log('\n📖 解析 TASK 中的 Task ID...', 'cyan');
  const allTasks = collectAllTaskIds();

  if (allTasks.size === 0) {
    log('⚠️  未找到任何任务，请先创建 TASK 文档', 'yellow');
    process.exit(0);
  }

  log(`✅ 找到 ${allTasks.size} 个任务`, 'green');

  // 解析映射表
  log('\n🔍 验证 Story → Task 映射...', 'cyan');

  if (!fs.existsSync(CONFIG.storyTaskMappingPath)) {
    log('❌ Story → Task 映射表不存在', 'red');
    log(`   路径: ${CONFIG.storyTaskMappingPath}`, 'yellow');
    log('\n建议：创建映射表，参考模板：/docs/data/story-task-mapping.md', 'yellow');
    process.exit(1);
  }

  log(`✅ 映射表存在: ${CONFIG.storyTaskMappingPath}`, 'green');

  const { mapping, mappedStories, mappedTasks } = parseStoryTaskMapping();

  log(`📊 映射表记录数: ${mappedStories.size} 个 Story，${mappedTasks.size} 个 Task`, 'cyan');

  // 检测孤儿 Story（无 Task 实现）
  log('\n🔍 检测孤儿 Story（无 Task 实现）...', 'cyan');
  const orphanStories = Array.from(allStories).filter(story => !mappedStories.has(story));

  if (orphanStories.length === 0) {
    log('✅ 所有 Story 都有对应的 Task', 'green');
  } else {
    log(`⚠️  发现 ${orphanStories.length} 个孤儿 Story:`, 'yellow');
    orphanStories.slice(0, 10).forEach(story => {
      log(`   - ${story}`, 'yellow');
    });
    if (orphanStories.length > 10) {
      log(`   ... 还有 ${orphanStories.length - 10} 个`, 'yellow');
    }
  }

  // 检测孤儿 Task（无对应 Story）
  log('\n🔍 检测孤儿 Task（无对应 Story）...', 'cyan');
  const orphanTasks = Array.from(allTasks).filter(task => !mappedTasks.has(task));

  if (orphanTasks.length === 0) {
    log('✅ 所有 Task 都有对应的 Story', 'green');
  } else {
    log(`⚠️  发现 ${orphanTasks.length} 个孤儿 Task:`, 'yellow');
    orphanTasks.slice(0, 10).forEach(task => {
      log(`   - ${task}`, 'yellow');
    });
    if (orphanTasks.length > 10) {
      log(`   ... 还有 ${orphanTasks.length - 10} 个`, 'yellow');
    }
  }

  // 检测映射表中的无效引用
  log('\n🔍 检测映射表中的无效引用...', 'cyan');
  const invalidStories = Array.from(mappedStories).filter(story => !allStories.has(story));
  const invalidTasks = Array.from(mappedTasks).filter(task => !allTasks.has(task));

  if (invalidStories.length === 0 && invalidTasks.length === 0) {
    log('✅ 映射表中所有引用有效', 'green');
  } else {
    if (invalidStories.length > 0) {
      log(`⚠️  映射表引用了 ${invalidStories.length} 个不存在的 Story:`, 'yellow');
      invalidStories.slice(0, 5).forEach(story => {
        log(`   - ${story}`, 'yellow');
      });
    }
    if (invalidTasks.length > 0) {
      log(`⚠️  映射表引用了 ${invalidTasks.length} 个不存在的 Task:`, 'yellow');
      invalidTasks.slice(0, 5).forEach(task => {
        log(`   - ${task}`, 'yellow');
      });
    }
  }

  // 统计
  log('\n📊 统计信息:', 'cyan');
  log(`   PRD 中的 Story: ${allStories.size}`, 'cyan');
  log(`   TASK 中的 Task: ${allTasks.size}`, 'cyan');
  log(`   映射表中的 Story: ${mappedStories.size}`, 'cyan');
  log(`   映射表中的 Task: ${mappedTasks.size}`, 'cyan');
  log(`   孤儿 Story: ${orphanStories.length}`, orphanStories.length > 0 ? 'yellow' : 'green');
  log(`   孤儿 Task: ${orphanTasks.length}`, orphanTasks.length > 0 ? 'yellow' : 'green');

  // 计算覆盖率
  const storyCoverage = allStories.size > 0 ? ((mappedStories.size / allStories.size) * 100).toFixed(1) : 0;
  const taskCoverage = allTasks.size > 0 ? ((mappedTasks.size / allTasks.size) * 100).toFixed(1) : 0;

  log(`   Story 覆盖率: ${storyCoverage}%`, storyCoverage >= 95 ? 'green' : 'yellow');
  log(`   Task 覆盖率: ${taskCoverage}%`, taskCoverage >= 95 ? 'green' : 'yellow');

  // 汇总结果
  log('\n' + '='.repeat(60), 'cyan');
  log('检查结果汇总:', 'cyan');
  log('='.repeat(60), 'cyan');

  if (orphanStories.length === 0 && orphanTasks.length === 0 && invalidStories.length === 0 && invalidTasks.length === 0) {
    log('✅ Story → Task 映射完整，需求追溯健康！', 'green');
    process.exit(0);
  } else {
    if (orphanStories.length > 0 || invalidStories.length > 0 || storyCoverage < 95) {
      log('⚠️  发现问题，建议修正：', 'yellow');
      if (orphanStories.length > 0) {
        log(`   - ${orphanStories.length} 个 Story 缺少 Task 实现`, 'yellow');
      }
      if (invalidStories.length > 0) {
        log(`   - ${invalidStories.length} 个映射引用了不存在的 Story`, 'yellow');
      }
    }
    if (orphanTasks.length > 0 || invalidTasks.length > 0) {
      log('ℹ️  发现孤儿 Task（可能是基础设施任务）：', 'cyan');
      if (orphanTasks.length > 0) {
        log(`   - ${orphanTasks.length} 个 Task 没有对应 Story`, 'cyan');
      }
      if (invalidTasks.length > 0) {
        log(`   - ${invalidTasks.length} 个映射引用了不存在的 Task`, 'yellow');
      }
    }

    log('\n建议：', 'yellow');
    log('1. 为孤儿 Story 补充对应的 Task', 'yellow');
    log('2. 为孤儿 Task 关联对应的 Story（或标记为基础设施任务）', 'yellow');
    log('3. 更新 /docs/data/story-task-mapping.md', 'yellow');

    // 孤儿 Story 是严重问题，孤儿 Task 是警告
    if (orphanStories.length > 0 || invalidStories.length > 0 || invalidTasks.length > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
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

module.exports = {
  extractStoryIds,
  extractTaskIds,
  collectAllStoryIds,
  collectAllTaskIds,
  parseStoryTaskMapping
};

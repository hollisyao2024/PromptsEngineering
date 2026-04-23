#!/usr/bin/env node

/**
 * TASK 完整性检查脚本
 *
 * 检查项：
 * - 主 TASK 必需章节完整性
 * - 模块 TASK 遵循标准结构
 * - Story → Task 映射表已创建
 * - Task ID 格式规范
 * - 任务工作量估算存在
 * - 任务负责人指定
 * - 依赖关系格式规范
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  mainTaskPath: path.join(__dirname, '../../../docs/TASK.md'),
  taskModulesDir: path.join(__dirname, '../../../docs/task-modules'),
  storyTaskMappingPath: path.join(__dirname, '../../../docs/data/story-task-mapping.md'),
  taskDependencyMatrixPath: path.join(__dirname, '../../../docs/data/task-dependency-matrix.md'),
};

// 主 TASK 必需章节
const REQUIRED_SECTIONS = [
  '## 1. 项目概述',
  '## 2. 全局里程碑',
  '## 3. WBS（工作分解结构）',
  '## 4. 依赖关系',
  '## 5. 关键路径',
  '## 6. 资源与时间线',
  '## 7. 风险登记',
  '## 8. Story → Task 映射',
];

// Task ID 格式正则（TASK-MODULE-NNN）
const TASK_ID_PATTERN = /TASK-[A-Z]+-\d{3}/;

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

// 检查文件是否存在
function checkFileExists(filePath, description) {
  if (!fs.existsSync(filePath)) {
    // 特殊处理：主 TASK 不存在时给出友好提示
    if (description === '主 TASK') {
      log(`ℹ️  主 TASK 尚未创建`, 'cyan');
      log(`   提示：TASK.md 为自动生成产物，请使用 TASK 专家执行 \`/task plan\` 生成`, 'cyan');
      log(`   或手动运行：pnpm run task:generate`, 'cyan');
      log(`   参考：AgentRoles/TASK-PLANNING-EXPERT.md §自动生成规范`, 'cyan');
      return false;  // 不作为错误，仅返回 false
    }
    log(`❌ ${description} 不存在: ${filePath}`, 'red');
    return false;
  }
  log(`✅ ${description} 存在`, 'green');
  return true;
}

// 检查主 TASK 章节完整性
function checkMainTaskSections() {
  log('\n📋 检查主 TASK 章节完整性...', 'cyan');

  const taskContent = fs.readFileSync(CONFIG.mainTaskPath, 'utf-8');
  const missingSections = [];

  REQUIRED_SECTIONS.forEach(section => {
    if (!taskContent.includes(section)) {
      missingSections.push(section);
    }
  });

  if (missingSections.length === 0) {
    log('✅ 主 TASK 包含所有必需章节', 'green');
    return true;
  } else {
    log(`❌ 主 TASK 缺少以下章节:`, 'red');
    missingSections.forEach(section => {
      log(`   - ${section}`, 'yellow');
    });
    return false;
  }
}

// 检查 Task ID 格式
function checkTaskIdFormat() {
  log('\n🔍 检查 Task ID 格式规范...', 'cyan');

  const taskContent = fs.readFileSync(CONFIG.mainTaskPath, 'utf-8');
  const taskIdMatches = taskContent.match(/TASK-[A-Z0-9]+-\d+/g) || [];

  const invalidIds = taskIdMatches.filter(id => !TASK_ID_PATTERN.test(id));

  if (invalidIds.length === 0) {
    log(`✅ 所有 Task ID 格式规范（共 ${taskIdMatches.length} 个）`, 'green');
    return true;
  } else {
    log(`❌ 发现不规范的 Task ID:`, 'red');
    invalidIds.forEach(id => {
      log(`   - ${id} (应使用格式: TASK-MODULE-NNN)`, 'yellow');
    });
    return false;
  }
}

// 检查任务工作量估算
function checkTaskEffortEstimation() {
  log('\n🔍 检查任务工作量估算...', 'cyan');

  const taskContent = fs.readFileSync(CONFIG.mainTaskPath, 'utf-8');

  // 查找所有任务章节（包含 Task ID 的行）
  const taskRegex = /(TASK-[A-Z]+-\d{3})([^\n]+)/g;
  const tasksWithoutEffort = [];
  let match;

  while ((match = taskRegex.exec(taskContent)) !== null) {
    const taskId = match[1];
    const taskLine = match[2];

    // 检查是否包含工作量标记（如：3d、5人天、2周等）
    const hasEffort = /\d+\s*(d|天|day|人天|week|周|h|hour|小时)/i.test(taskLine);

    if (!hasEffort) {
      // 提取任务名称
      const taskName = taskLine.trim().replace(/[|:：]+/g, '').trim().substring(0, 30);
      tasksWithoutEffort.push({ id: taskId, name: taskName });
    }
  }

  if (tasksWithoutEffort.length === 0) {
    log('✅ 所有任务都包含工作量估算', 'green');
    return true;
  } else {
    log(`⚠️  发现 ${tasksWithoutEffort.length} 个任务缺少工作量估算:`, 'yellow');
    tasksWithoutEffort.slice(0, 5).forEach(task => {
      log(`   - ${task.id}: ${task.name}`, 'yellow');
    });
    if (tasksWithoutEffort.length > 5) {
      log(`   ... 还有 ${tasksWithoutEffort.length - 5} 个任务`, 'yellow');
    }
    return false;
  }
}

// 检查任务负责人
function checkTaskAssignee() {
  log('\n🔍 检查任务负责人...', 'cyan');

  const taskContent = fs.readFileSync(CONFIG.mainTaskPath, 'utf-8');

  // 查找所有任务行
  const taskRegex = /(TASK-[A-Z]+-\d{3})([^\n]+)/g;
  const tasksWithoutAssignee = [];
  let match;

  while ((match = taskRegex.exec(taskContent)) !== null) {
    const taskId = match[1];
    const taskLine = match[2];

    // 检查是否包含负责人标记（如：@username、负责人：xxx）
    const hasAssignee = /@\w+|负责人[：:]\s*\w+/i.test(taskLine);

    if (!hasAssignee) {
      const taskName = taskLine.trim().replace(/[|:：]+/g, '').trim().substring(0, 30);
      tasksWithoutAssignee.push({ id: taskId, name: taskName });
    }
  }

  if (tasksWithoutAssignee.length === 0) {
    log('✅ 所有任务都已指定负责人', 'green');
    return true;
  } else {
    log(`⚠️  发现 ${tasksWithoutAssignee.length} 个任务未指定负责人:`, 'yellow');
    tasksWithoutAssignee.slice(0, 5).forEach(task => {
      log(`   - ${task.id}: ${task.name}`, 'yellow');
    });
    if (tasksWithoutAssignee.length > 5) {
      log(`   ... 还有 ${tasksWithoutAssignee.length - 5} 个任务`, 'yellow');
    }
    return false;
  }
}

// 检查依赖关系格式
function checkDependencyFormat() {
  log('\n🔍 检查依赖关系格式...', 'cyan');

  const taskContent = fs.readFileSync(CONFIG.mainTaskPath, 'utf-8');

  // 查找依赖关系标记（如：依赖：TASK-xxx、→、Depends on:）
  const dependencyRegex = /(?:依赖[：:]|→|Depends\s+on[：:])\s*(TASK-[A-Z0-9]+-\d+)/gi;
  const dependencies = [];
  let match;

  while ((match = dependencyRegex.exec(taskContent)) !== null) {
    dependencies.push(match[1]);
  }

  // 检查依赖的 Task ID 格式
  const invalidDeps = dependencies.filter(dep => !TASK_ID_PATTERN.test(dep));

  if (invalidDeps.length === 0) {
    log(`✅ 所有依赖关系格式规范（共 ${dependencies.length} 个）`, 'green');
    return true;
  } else {
    log(`❌ 发现不规范的依赖关系:`, 'red');
    invalidDeps.forEach(dep => {
      log(`   - ${dep} (应使用格式: TASK-MODULE-NNN)`, 'yellow');
    });
    return false;
  }
}

// 检查模块 TASK 文件（如果存在）
function checkModuleTaskFiles() {
  log('\n📂 检查模块 TASK 文件...', 'cyan');

  if (!fs.existsSync(CONFIG.taskModulesDir)) {
    log('ℹ️  task-modules 目录不存在，跳过模块检查', 'cyan');
    return true;
  }

  const entries = fs.readdirSync(CONFIG.taskModulesDir, { withFileTypes: true });
  const moduleDirs = entries.filter(entry => entry.isDirectory());

  if (moduleDirs.length === 0) {
    log('ℹ️  未找到模块 TASK 文件，跳过模块检查', 'cyan');
    return true;
  }

  log(`📋 找到 ${moduleDirs.length} 个模块 TASK 文件`, 'cyan');

  let allValid = true;
  moduleDirs.forEach(dir => {
    const filePath = path.join(CONFIG.taskModulesDir, dir.name, 'TASK.md');
    if (!fs.existsSync(filePath)) {
      log(`⚠️  ${dir.name}/TASK.md 不存在`, 'yellow');
      allValid = false;
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    // 检查基本结构
    const hasTaskIdSection = /TASK-[A-Z]+-\d{3}/.test(content);
    const hasWbsSection = /##\s+\d+\.\s+(?:模块\s+)?WBS/i.test(content);

    if (!hasTaskIdSection || !hasWbsSection) {
      log(`⚠️  ${dir.name}/TASK.md: 缺少 Task ID 或 WBS 章节`, 'yellow');
      allValid = false;
    }
  });

  if (allValid) {
    log('✅ 所有模块 TASK 文件结构正常', 'green');
  }

  return allValid;
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('TASK 完整性检查工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  const results = {
    mainTaskExists: checkFileExists(CONFIG.mainTaskPath, '主 TASK'),
    storyTaskMappingExists: checkFileExists(CONFIG.storyTaskMappingPath, 'Story → Task 映射表'),
    taskDependencyMatrixExists: checkFileExists(CONFIG.taskDependencyMatrixPath, '任务依赖矩阵'),
    sectionsComplete: false,
    taskIdValid: false,
    effortEstimation: false,
    assigneeSpecified: false,
    dependencyValid: false,
    moduleFilesValid: false,
  };

  if (results.mainTaskExists) {
    results.sectionsComplete = checkMainTaskSections();
    results.taskIdValid = checkTaskIdFormat();
    results.effortEstimation = checkTaskEffortEstimation();
    results.assigneeSpecified = checkTaskAssignee();
    results.dependencyValid = checkDependencyFormat();
  }

  results.moduleFilesValid = checkModuleTaskFiles();

  // 汇总结果
  log('\n' + '='.repeat(60), 'cyan');
  log('检查结果汇总:', 'cyan');
  log('='.repeat(60), 'cyan');

  const criticalChecks = [
    results.mainTaskExists,
    results.storyTaskMappingExists,
    results.taskDependencyMatrixExists,
    results.sectionsComplete,
    results.taskIdValid,
  ];

  const warningChecks = [
    results.effortEstimation,
    results.assigneeSpecified,
    results.dependencyValid,
    results.moduleFilesValid,
  ];

  const allCriticalPassed = criticalChecks.every(result => result === true);
  const allWarningPassed = warningChecks.every(result => result === true);

  if (allCriticalPassed && allWarningPassed) {
    log('✅ 所有检查通过！TASK 文档质量良好。', 'green');
    process.exit(0);
  } else if (allCriticalPassed) {
    log('⚠️  关键检查通过，但发现一些警告，建议修正。', 'yellow');
    log('\n建议：', 'yellow');
    log('1. 为所有任务添加工作量估算（如：3d、5人天）', 'yellow');
    log('2. 为所有任务指定负责人（使用 @username）', 'yellow');
    log('3. 确保依赖关系格式规范（TASK-MODULE-NNN）', 'yellow');
    process.exit(0);  // 警告不阻塞，返回成功
  } else {
    log('❌ 关键检查未通过，必须修正后才能继续。', 'red');
    log('\n建议：', 'yellow');
    log('1. 补充缺失的文档和章节', 'yellow');
    log('2. 修正 Task ID 格式（应为 TASK-MODULE-NNN）', 'yellow');
    log('3. 创建 Story → Task 映射表和任务依赖矩阵', 'yellow');
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

module.exports = {
  checkFileExists,
  checkMainTaskSections,
  checkTaskIdFormat,
  checkTaskEffortEstimation,
  checkTaskAssignee,
  checkDependencyFormat,
  checkModuleTaskFiles
};

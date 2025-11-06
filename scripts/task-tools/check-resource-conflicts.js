#!/usr/bin/env node

/**
 * 资源冲突检测脚本
 *
 * 检测同一人员是否被分配到并行的多个任务
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
  taskPath: path.join(__dirname, '../../docs/TASK.md'),
  taskModulesDir: path.join(__dirname, '../../docs/task-modules'),
};

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

function main() {
  log('='.repeat(60), 'cyan');
  log('资源冲突检测工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  log('\n📖 解析资源分配...', 'cyan');

  if (!fs.existsSync(CONFIG.taskPath)) {
    log('⚠️  TASK 文档不存在', 'yellow');
    process.exit(0);
  }

  const content = fs.readFileSync(CONFIG.taskPath, 'utf-8');

  // 匹配负责人（@username 格式）
  const assigneeMatches = content.match(/@[a-z0-9_-]+/gi) || [];
  const assignees = [...new Set(assigneeMatches)];

  if (assignees.length === 0) {
    log('⚠️  未找到负责人信息（@username 格式）', 'yellow');
    process.exit(0);
  }

  log(`✅ 找到 ${assignees.length} 个人员`, 'green');

  // 简化版：统计每个人被分配的任务数
  const assignmentCount = new Map();
  assignees.forEach(assignee => {
    const regex = new RegExp(assignee, 'g');
    const count = (content.match(regex) || []).length;
    assignmentCount.set(assignee, count);
  });

  log('\n📊 人员任务分配统计:', 'cyan');
  assignmentCount.forEach((count, assignee) => {
    const status = count > 5 ? '⚠️  接近满载' : '✅ 正常';
    log(`   ${assignee}: ${count} 个任务 ${status}`, count > 5 ? 'yellow' : 'green');
  });

  log('\n✅ 资源冲突检测完成！', 'green');
  log('💡 提示：详细的时间线冲突分析需要任务时间信息', 'cyan');

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

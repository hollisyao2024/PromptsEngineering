#!/usr/bin/env node

/**
 * 任务状态报告生成脚本
 *
 * 生成任务执行状态报告
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
  taskPath: path.join(__dirname, '../../../docs/TASK.md'),
  outputDir: path.join(__dirname, '../../../docs/data'),
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
  log('任务状态报告生成工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  log('\n📖 解析任务状态...', 'cyan');

  if (!fs.existsSync(CONFIG.taskPath)) {
    log('⚠️  TASK 文档不存在', 'yellow');
    process.exit(0);
  }

  const content = fs.readFileSync(CONFIG.taskPath, 'utf-8');

  // 统计任务状态
  const completedMatches = content.match(/✅|已完成|completed/gi) || [];
  const inProgressMatches = content.match(/🔄|进行中|in_progress/gi) || [];
  const pendingMatches = content.match(/📝|待启动|pending/gi) || [];

  const totalTasks = completedMatches.length + inProgressMatches.length + pendingMatches.length;

  if (totalTasks === 0) {
    log('⚠️  未找到任何任务状态标记', 'yellow');
    process.exit(0);
  }

  log('\n📊 整体进度统计:', 'cyan');
  log(`   总任务数: ${totalTasks}`, 'cyan');
  log(`   ✅ 已完成: ${completedMatches.length} (${((completedMatches.length / totalTasks) * 100).toFixed(1)}%)`, 'green');
  log(`   🔄 进行中: ${inProgressMatches.length} (${((inProgressMatches.length / totalTasks) * 100).toFixed(1)}%)`, 'yellow');
  log(`   📝 待启动: ${pendingMatches.length} (${((pendingMatches.length / totalTasks) * 100).toFixed(1)}%)`, 'cyan');

  // 生成报告
  const timestamp = new Date().toISOString().split('T')[0];
  const reportContent = `# 任务状态报告

> 生成时间：${new Date().toISOString()}

## 整体进度

- 总任务数：${totalTasks}
- ✅ 已完成：${completedMatches.length} (${((completedMatches.length / totalTasks) * 100).toFixed(1)}%)
- 🔄 进行中：${inProgressMatches.length} (${((inProgressMatches.length / totalTasks) * 100).toFixed(1)}%)
- 📝 待启动：${pendingMatches.length} (${((pendingMatches.length / totalTasks) * 100).toFixed(1)}%)

## 建议

- 关注进行中的任务，确保按期完成
- 及时启动待启动的任务
- 更新任务状态标记

---

**说明**：此报告基于任务状态标记（✅/🔄/📝）自动生成。
`;

  const outputPath = path.join(CONFIG.outputDir, `task-status-report-${timestamp}.md`);

  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, reportContent, 'utf-8');

  log(`\n✅ 报告已保存到: ${outputPath}`, 'green');
  log('\n✅ 任务状态报告生成完成！', 'green');

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

#!/usr/bin/env node

/**
 * 数据库迁移任务验证脚本
 *
 * 验证 DB 迁移任务是否遵循 Expand → Migrate/Backfill → Contract 流程
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
  taskPath: path.join(__dirname, '../../../docs/TASK.md'),
  taskModulesDir: path.join(__dirname, '../../../docs/task-modules'),
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
  log('数据库迁移任务验证工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  log('\n📖 识别 DB 迁移任务...', 'cyan');

  if (!fs.existsSync(CONFIG.taskPath)) {
    log('⚠️  TASK 文档不存在', 'yellow');
    process.exit(0);
  }

  const content = fs.readFileSync(CONFIG.taskPath, 'utf-8');

  // 匹配 DB 相关任务
  const dbTaskMatches = content.match(/TASK-DB-\d{3}/g) || [];
  const uniqueDbTasks = [...new Set(dbTaskMatches)];

  if (uniqueDbTasks.length === 0) {
    log('ℹ️  未找到 DB 迁移任务（TASK-DB-*）', 'cyan');
    process.exit(0);
  }

  log(`✅ 找到 ${uniqueDbTasks.length} 个数据库迁移任务`, 'green');

  log('\n🔍 验证 Expand → Migrate → Contract 流程...', 'cyan');

  uniqueDbTasks.forEach(taskId => {
    const expandTask = `${taskId}-EXPAND`;
    const migrateTask = `${taskId}-MIGRATE`;
    const contractTask = `${taskId}-CONTRACT`;

    const hasExpand = content.includes(expandTask);
    const hasMigrate = content.includes(migrateTask);
    const hasContract = content.includes(contractTask);

    if (hasExpand && hasMigrate && hasContract) {
      log(`✅ ${taskId}: 三阶段完整`, 'green');
    } else {
      log(`⚠️  ${taskId}: 缺少阶段`, 'yellow');
      if (!hasExpand) log(`   - 缺少 Expand 阶段`, 'yellow');
      if (!hasMigrate) log(`   - 缺少 Migrate 阶段`, 'yellow');
      if (!hasContract) log(`   - 缺少 Contract 阶段`, 'yellow');
    }
  });

  log('\n✅ DB 迁移任务验证完成！', 'green');
  log('💡 建议：确保所有 DB 迁移任务遵循三阶段流程', 'cyan');

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

#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
// 工具脚本,允许使用 any 类型以提高灵活性
/**
 * 清理旧的后台任务
 *
 * 运行频率：每日凌晨 2:30
 * Cron 表达式：`0 2 * * *`
 *
 * 删除条件：
 * - 状态为 completed 或 failed
 * - 完成时间超过 30 天
 *
 * 使用方法：
 * 1. 添加到 crontab: 0 2 * * * cd /path/to/frontend && npx tsx infra/scripts/cron/cleanup-old-jobs.ts
 * 2. 手动执行: npx tsx infra/scripts/cron/cleanup-old-jobs.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const RETENTION_DAYS = 30; // 保留天数

async function cleanupOldJobs() {
  console.log('[Cleanup] 开始清理旧的后台任务...');

  try {
    // 计算截止日期
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    console.log(`[Cleanup] 将删除 ${cutoffDate.toISOString()} 之前完成的任务`);

    // 删除旧任务
    const result = await prisma.backgroundJob.deleteMany({
      where: {
        status: { in: ['completed', 'failed'] },
        completedAt: { lt: cutoffDate },
      },
    });

    console.log(`[Cleanup] 成功删除 ${result.count} 个旧任务`);

    // 统计当前任务数量
    const stats = await prisma.backgroundJob.groupBy({
      by: ['status'],
      _count: true,
    });

    console.log('[Cleanup] 当前任务统计:');
    stats.forEach((stat) => {
      console.log(`  - ${stat.status}: ${stat._count} 个`);
    });
  } catch (error) {
    console.error('[Cleanup] 清理失败:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 主程序入口
(async () => {
  try {
    await cleanupOldJobs();
    console.log('[Cleanup] 执行完成');
  } catch (error) {
    console.error('[Cleanup] 执行失败:', error);
    process.exit(1);
  }
})();

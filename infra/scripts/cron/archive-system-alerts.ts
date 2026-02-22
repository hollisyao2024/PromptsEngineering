#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
// 工具脚本,允许使用 any 类型以提高灵活性
/**
 * Cron 任务：归档 30 天前已解决的系统告警
 *
 * 运行频率：每日凌晨 5:00
 * Crontab: 0 5 * * * cd /path/to/project && npx tsx infra/scripts/cron/archive-system-alerts.ts
 *
 * 业务逻辑：
 * 1. 查找 resolved_at < NOW() - 30 days 且状态为 resolved 的告警
 * 2. 将状态更新为 archived
 * 3. 设置 archived_at 时间戳
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ArchiveResult {
  totalResolved: number;
  archivedCount: number;
  errors: string[];
}

const ARCHIVE_DAYS = 30;

async function archiveSystemAlerts(): Promise<ArchiveResult> {
  const result: ArchiveResult = {
    totalResolved: 0,
    archivedCount: 0,
    errors: [],
  };

  console.log('📦 开始归档系统告警...\n');

  try {
    // 计算截止日期（30 天前）
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - ARCHIVE_DAYS);

    console.log(`📅 归档截止日期: ${cutoffDate.toISOString()}\n`);

    // 统计需要归档的告警数量
    const totalResolved = await prisma.systemAlert.count({
      where: {
        status: 'resolved',
        resolvedAt: {
          lt: cutoffDate,
        },
      },
    });

    result.totalResolved = totalResolved;

    if (totalResolved === 0) {
      console.log('✅ 没有需要归档的告警\n');
      return result;
    }

    console.log(`📋 找到 ${totalResolved} 条需要归档的已解决告警\n`);

    // 执行批量更新
    const updateResult = await prisma.systemAlert.updateMany({
      where: {
        status: 'resolved',
        resolvedAt: {
          lt: cutoffDate,
        },
      },
      data: {
        status: 'archived',
        archivedAt: new Date(),
      },
    });

    result.archivedCount = updateResult.count;

    // 输出摘要
    console.log('========================================');
    console.log('🎯 归档完成');
    console.log(`   待归档数: ${result.totalResolved}`);
    console.log(`   已归档数: ${result.archivedCount}`);
    console.log('========================================\n');

    return result;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ 归档任务执行失败:', error);
    result.errors.push(errorMessage);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 执行归档任务
if (require.main === module) {
  archiveSystemAlerts()
    .then((result) => {
      // 返回状态码（如果有错误则返回 1）
      process.exit(result.errors.length > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { archiveSystemAlerts };

#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
// 工具脚本,允许使用 any 类型以提高灵活性
/**
 * Cron 任务：归档 180 天前的使用日志
 *
 * 运行频率：每日凌晨 3:00
 * Crontab: 0 3 * * * cd /path/to/project && npx tsx infra/scripts/cron/archive-usage-logs.ts
 *
 * 业务逻辑：
 * 1. 查找 created_at < NOW() - 180 days 的日志
 * 2. 导出到 CSV 文件
 * 3. （可选）上传到 OSS 冷存储
 * 4. 删除已归档的日志
 * 5. 执行 VACUUM 回收空间
 *
 * 参考：ADR-021 使用日志表设计
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface ArchiveResult {
  totalLogs: number;
  archivedLogs: number;
  deletedLogs: number;
  archiveFilePath: string | null;
  errors: string[];
}

const RETENTION_DAYS = 180;
const ARCHIVE_DIR = path.join(process.cwd(), 'archives', 'usage_logs');

async function archiveUsageLogs(): Promise<ArchiveResult> {
  const result: ArchiveResult = {
    totalLogs: 0,
    archivedLogs: 0,
    deletedLogs: 0,
    archiveFilePath: null,
    errors: [],
  };

  console.log('📦 开始归档使用日志...\n');

  try {
    // 计算截止日期（180 天前）
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    console.log(`📅 归档截止日期: ${cutoffDate.toISOString()}\n`);

    // 统计需要归档的日志数量
    const totalLogs = await prisma.usageLog.count({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    result.totalLogs = totalLogs;

    if (totalLogs === 0) {
      console.log('✅ 没有需要归档的日志\n');
      return result;
    }

    console.log(`📋 找到 ${totalLogs} 条需要归档的日志\n`);

    // 创建归档目录
    if (!fs.existsSync(ARCHIVE_DIR)) {
      fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    }

    // 生成归档文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const archiveFileName = `usage_logs_${timestamp}.csv`;
    const archiveFilePath = path.join(ARCHIVE_DIR, archiveFileName);

    // 导出日志到 CSV
    console.log(`📝 导出日志到 ${archiveFilePath}...\n`);

    // 分批查询日志（避免内存溢出）
    const BATCH_SIZE = 1000;
    let offset = 0;
    let csvContent =
      'id,user_id,action_type,prompt,style,template_id,character_id,reference_url,image_url,cost_credits,api_provider,api_response,success,error_message,created_at\n';

    while (offset < totalLogs) {
      const logs = await prisma.usageLog.findMany({
        where: {
          createdAt: {
            lt: cutoffDate,
          },
        },
        take: BATCH_SIZE,
        skip: offset,
        orderBy: {
          createdAt: 'asc',
        },
      });

      // 转换为 CSV 格式
      logs.forEach((log) => {
        const row = [
          log.id,
          log.userId,
          log.actionType,
          log.prompt ? `"${log.prompt.replace(/"/g, '""')}"` : '',
          log.style || '',
          log.templateId || '',
          log.characterId || '',
          log.referenceUrl || '',
          log.imageUrl || '',
          log.costCredits,
          log.apiProvider,
          log.apiResponse ? `"${JSON.stringify(log.apiResponse).replace(/"/g, '""')}"` : '',
          log.success,
          log.errorMessage ? `"${log.errorMessage.replace(/"/g, '""')}"` : '',
          log.createdAt.toISOString(),
        ].join(',');

        csvContent += row + '\n';
      });

      offset += logs.length;
      console.log(`   已处理: ${offset}/${totalLogs} (${Math.round((offset / totalLogs) * 100)}%)`);
    }

    // 写入文件
    fs.writeFileSync(archiveFilePath, csvContent, 'utf-8');
    result.archiveFilePath = archiveFilePath;
    result.archivedLogs = totalLogs;

    console.log(`\n✅ 日志已导出到: ${archiveFilePath}`);
    console.log(
      `   文件大小: ${(fs.statSync(archiveFilePath).size / 1024 / 1024).toFixed(2)} MB\n`
    );

    // TODO: 上传到 OSS 冷存储
    // console.log('📤 上传到 OSS...\n');
    // await uploadToOSS(archiveFilePath, `usage_logs/${archiveFileName}`);
    // console.log('✅ 上传完成\n');

    // 删除已归档的日志
    console.log('🗑️  删除已归档的日志...\n');

    const deleteResult = await prisma.usageLog.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    result.deletedLogs = deleteResult.count;

    console.log(`✅ 已删除 ${deleteResult.count} 条日志\n`);

    // 执行 VACUUM（PostgreSQL 特有，回收空间）
    console.log('🧹 回收数据库空间（VACUUM）...\n');

    try {
      await prisma.$executeRawUnsafe('VACUUM ANALYZE usage_logs');
      console.log('✅ VACUUM 完成\n');
    } catch (error: any) {
      console.warn(`⚠️  VACUUM 失败: ${error.message}\n`);
      result.errors.push(`VACUUM error: ${error.message}`);
    }

    // 输出摘要
    console.log('========================================');
    console.log('🎯 归档完成');
    console.log(`   总日志数: ${result.totalLogs}`);
    console.log(`   已导出: ${result.archivedLogs}`);
    console.log(`   已删除: ${result.deletedLogs}`);
    console.log(`   归档文件: ${archiveFileName}`);
    console.log('========================================\n');

    return result;
  } catch (error: any) {
    console.error('❌ 归档任务执行失败:', error);
    result.errors.push(error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 执行归档任务
if (require.main === module) {
  archiveUsageLogs()
    .then((result) => {
      // 返回状态码（如果有错误则返回 1）
      process.exit(result.errors.length > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { archiveUsageLogs };

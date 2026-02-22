#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
// 工具脚本,允许使用 any 类型以提高灵活性
/**
 * Cron 任务：清理过期的账户删除工单并执行账户删除
 *
 * 运行频率：每日凌晨 2:00
 * Crontab: 0 2 * * * cd /path/to/project && npx tsx infra/scripts/cron/cleanup-expired-deletion-tickets.ts
 *
 * 业务逻辑：
 * 1. 查找所有过期的删除工单（expires_at < NOW()）
 * 2. 对每个工单，执行账户物理删除（CASCADE DELETE）
 * 3. 删除工单记录
 * 4. 记录操作日志
 *
 * 参考：ADR-020 账户删除工单
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CleanupResult {
  totalTickets: number;
  deletedAccounts: number;
  errors: Array<{ userId: string; error: string }>;
}

async function cleanupExpiredDeletionTickets(): Promise<CleanupResult> {
  const result: CleanupResult = {
    totalTickets: 0,
    deletedAccounts: 0,
    errors: [],
  };

  console.log('🗑️  开始清理过期的账户删除工单...\n');

  try {
    // 查找所有过期的删除工单
    const expiredTickets = await prisma.accountDeletionTicket.findMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            subscriptionTier: true,
          },
        },
      },
    });

    result.totalTickets = expiredTickets.length;

    if (expiredTickets.length === 0) {
      console.log('✅ 没有过期的删除工单需要处理\n');
      return result;
    }

    console.log(`📋 找到 ${expiredTickets.length} 个过期的删除工单\n`);

    // 处理每个工单
    for (const ticket of expiredTickets) {
      try {
        console.log(`🔹 处理用户: ${ticket.user.email || ticket.userId}`);
        console.log(`   订阅层级: ${ticket.user.subscriptionTier}`);
        console.log(`   过期时间: ${ticket.expiresAt.toISOString()}`);
        console.log(`   删除原因: ${ticket.reason || '未提供'}`);

        // 执行账户删除（CASCADE DELETE 会自动删除关联数据）
        await prisma.users.delete({
          where: {
            id: ticket.userId,
          },
        });

        // 工单会被级联删除，所以不需要单独删除

        console.log(`   ✅ 账户已删除\n`);
        result.deletedAccounts++;
      } catch (error: any) {
        console.error(`   ❌ 删除失败: ${error.message}\n`);
        result.errors.push({
          userId: ticket.userId,
          error: error.message,
        });
      }
    }

    // 输出摘要
    console.log('========================================');
    console.log('🎯 清理完成');
    console.log(`   总工单数: ${result.totalTickets}`);
    console.log(`   删除成功: ${result.deletedAccounts}`);
    console.log(`   删除失败: ${result.errors.length}`);
    console.log('========================================\n');

    // 如果有错误，输出错误详情
    if (result.errors.length > 0) {
      console.log('❌ 错误详情:');
      result.errors.forEach((err) => {
        console.log(`   用户 ${err.userId}: ${err.error}`);
      });
      console.log('');
    }

    return result;
  } catch (error) {
    console.error('❌ 清理任务执行失败:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 执行清理任务
if (require.main === module) {
  cleanupExpiredDeletionTickets()
    .then((result) => {
      // 返回状态码（如果有错误则返回 1）
      process.exit(result.errors.length > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { cleanupExpiredDeletionTickets };

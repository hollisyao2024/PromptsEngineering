#!/usr/bin/env node

/**
 * 邀请奖励分发 Cron Job
 *
 * 定期处理待分发的邀请奖励
 * 建议执行频率：每小时一次
 *
 * Usage: node infra/scripts/cron/process-referral-rewards.js
 */

const { rewardDistributionService } = require('../../../apps/web/src/lib/referral/reward-distribution.service');
const { logger } = require('../../../apps/web/src/utils/logger');

async function main() {
  const startTime = Date.now();

  logger.info('[CronJob] Starting referral rewards processing');

  try {
    // 获取队列统计
    const stats = await rewardDistributionService.getQueueStats();
    if (stats) {
      logger.info('[CronJob] Queue stats', stats);
    }

    // 处理奖励
    const result = await rewardDistributionService.processRewards();

    const duration = Date.now() - startTime;

    logger.info('[CronJob] Rewards processing completed', {
      ...result,
      duration: `${duration}ms`,
    });

    // 退出码：0 = 成功，1 = 有错误但部分成功，2 = 完全失败
    if (result.failed > 0 && result.success === 0) {
      process.exit(2);
    } else if (result.failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    logger.error('[CronJob] Fatal error:', error);
    process.exit(2);
  }
}

main();

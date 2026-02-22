/**
 * Node.js Cron 调度器
 * 用途：在开发环境或容器环境中运行定时任务
 *
 * 运行方式：
 *   node infra/scripts/cron/scheduler.js
 *
 * Docker 部署：
 *   docker-compose -f docker-compose.cron.yml up -d
 *
 * 依赖安装：
 *   npm install node-cron
 */

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { checkCreditConsistency } = require('../check-credit-consistency');
const { cleanupExpiredAccounts } = require('../account-freeze-cleanup');
const { warmupCreditCache } = require('../../src/services/credit-cache.ts');
const {
  expireTimeoutOrders,
  findOrdersExpiringSoon,
} = require('../../src/services/order-lifecycle.ts');
const { sendOrderExpiryReminder } = require('../../src/lib/order-sms.ts');
const { runReconciliation } = require('../../src/services/credit-reconciliation.ts');

// ============================================
// Prisma Client（可选，降级到 console）
// ============================================
let prisma;
try {
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient();
} catch (_e) {
  console.warn('[scheduler] Prisma Client 不可用，执行日志将仅输出到控制台');
}

// ============================================
// 状态文件路径
// ============================================
const STATUS_DIR = path.join(process.cwd(), '.scheduler');
const PID_FILE = path.join(STATUS_DIR, 'scheduler.pid');
const STATUS_FILE = path.join(STATUS_DIR, 'scheduler.status.json');
const TASK_STATES_FILE = path.join(STATUS_DIR, 'task-states.json');
const TRIGGERS_DIR = path.join(STATUS_DIR, 'triggers');

// 确保目录存在（TRIGGERS_DIR 是 STATUS_DIR 子目录，recursive 会一并创建）
fs.mkdirSync(TRIGGERS_DIR, { recursive: true });

// 日志前缀
const log = (task, message) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${task}] ${message}`);
};

// ============================================
// 任务注册表
// ============================================
// Redis 去重 key 存储（内存简单实现，生产环境建议使用 Redis）
const sentReminders = new Set();

const TASK_REGISTRY = [
  {
    key: 'credit-consistency',
    name: '数据一致性检查',
    cronExpression: '0 3 * * *',
    schedule: '每日 03:00',
    handler: async () => {
      const result = await checkCreditConsistency({ fix: true });
      const summary = JSON.stringify(result.summary);
      if (result.summary.usersWithoutCredits > 0 || result.summary.inconsistentUsers > 0) {
        return `发现数据问题已自动修复: ${summary}`;
      }
      return `执行成功: ${summary}`;
    },
  },
  {
    key: 'credit-reconciliation',
    name: '积分对账检查',
    cronExpression: '30 3 * * *',
    schedule: '每日 03:30',
    handler: async () => {
      const result = await runReconciliation();
      const diffs =
        result.stats.missingCharges + result.stats.duplicateCharges + result.stats.amountMismatches;
      if (diffs > 0) {
        return `发现差异: 漏扣费=${result.stats.missingCharges}, 重复扣费=${result.stats.duplicateCharges}, 金额错误=${result.stats.amountMismatches}`;
      }
      return `检查了 ${result.stats.totalTasks} 个任务，未发现差异`;
    },
  },
  {
    key: 'account-cleanup',
    name: '账号冻结清理',
    cronExpression: '0 4 * * *',
    schedule: '每日 04:00',
    handler: async () => {
      const deletedCount = await cleanupExpiredAccounts();
      return `删除了 ${deletedCount} 个过期账号`;
    },
  },
  {
    key: 'health-check',
    name: '健康检查',
    cronExpression: '0 * * * *',
    schedule: '每小时',
    handler: async () => {
      const { PrismaClient } = require('@prisma/client');
      const healthPrisma = new PrismaClient();
      try {
        await healthPrisma.$queryRaw`SELECT 1`;
        const userCount = await healthPrisma.users.count({ where: { deletedAt: null } });
        const creditCount = await healthPrisma.credits.count();
        return `数据库连接正常, 用户数: ${userCount}, 积分记录数: ${creditCount}`;
      } finally {
        await healthPrisma.$disconnect();
      }
    },
  },
  {
    key: 'cache-warmup',
    name: '积分缓存预热',
    cronExpression: '0 */4 * * *',
    schedule: '每 4 小时',
    handler: async () => {
      const startMs = Date.now();
      await warmupCreditCache(1000);
      const duration = ((Date.now() - startMs) / 1000).toFixed(2);
      return `预热成功，耗时 ${duration}s`;
    },
  },
  {
    key: 'order-expire',
    name: '订单过期处理',
    cronExpression: '* * * * *',
    schedule: '每分钟',
    silentWhenEmpty: true,
    handler: async () => {
      const expiredCount = await expireTimeoutOrders();
      if (expiredCount > 0) {
        return `已过期 ${expiredCount} 个订单`;
      }
      return null; // 无操作时静默，不写 DB 日志
    },
  },
  {
    key: 'order-reminder',
    name: '订单过期提醒',
    cronExpression: '* * * * *',
    schedule: '每分钟',
    silentWhenEmpty: true,
    handler: async () => {
      const expiringOrders = await findOrdersExpiringSoon(5);
      let sentCount = 0;
      for (const order of expiringOrders) {
        const reminderKey = `order:reminder:${order.id}`;
        if (sentReminders.has(reminderKey)) continue;
        const phone = order.user?.phone;
        if (!phone) {
          log('order-reminder', `订单 ${order.id} 用户无手机号，跳过短信提醒`);
          continue;
        }
        await sendOrderExpiryReminder(phone, Number(order.amount));
        sentReminders.add(reminderKey);
        sentCount++;
        log(
          'order-reminder',
          `已发送过期提醒: 订单=${order.id}, 手机=${phone.slice(0, 3)}****${phone.slice(-4)}`
        );
        // 30 分钟后清理 key
        setTimeout(() => sentReminders.delete(reminderKey), 30 * 60 * 1000);
      }
      if (sentCount > 0) {
        return `发送了 ${sentCount} 条过期提醒`;
      }
      return null; // 无操作时静默
    },
  },
  {
    key: 'alert-archive',
    name: '系统告警归档',
    cronExpression: '0 5 * * *',
    schedule: '每日 05:00',
    handler: async () => {
      const { archiveSystemAlerts } = require('./archive-system-alerts.ts');
      const result = await archiveSystemAlerts();
      return `归档了 ${result.archivedCount} 条告警`;
    },
  },
  {
    key: 'oss-cleanup-queue',
    name: 'OSS 清理补偿队列',
    cronExpression: '*/10 * * * *',
    schedule: '每 10 分钟',
    silentWhenEmpty: true,
    handler: async () => {
      const {
        runOssCleanupQueueProcessor,
      } = require('../../src/services/oss-cleanup-queue.service.ts');
      const result = await runOssCleanupQueueProcessor(200);
      if (result.scanned === 0) {
        return null;
      }
      return `扫描=${result.scanned}, 成功=${result.completed}, 失败=${result.failed}`;
    },
  },
  {
    key: 'credit-auto-deduct',
    name: '积分自动补扣',
    cronExpression: '*/5 * * * *',
    schedule: '每 5 分钟',
    silentWhenEmpty: true,
    handler: async () => {
      const { runCreditAutoDeduct } = require('../../src/services/credit-auto-deduct.ts');
      const result = await runCreditAutoDeduct(2);
      if (result.totalDeducted > 0 || result.totalFailed > 0) {
        return `扫描=${result.totalScanned}, 补扣=${result.totalDeducted}, 失败=${result.totalFailed}, 跳过=${result.totalSkipped}, 耗时=${result.executionTimeMs}ms`;
      }
      return null; // 无操作时静默
    },
  },
  {
    key: 'oss-orphan-scan',
    name: 'OSS 孤儿文件扫描',
    cronExpression: '0 3 * * *',
    schedule: '每日 03:00',
    silentWhenEmpty: true,
    handler: async () => {
      const {
        runScheduledOrphanScan,
      } = require('../../src/services/oss-orphan-scanner.service.ts');
      const result = await runScheduledOrphanScan();
      if (result.newOrphans === 0 && result.totalAccumulated === 0) {
        return null;
      }
      return `${result.scanType === 'full' ? '全量' : '增量'}扫描: 新增=${result.newOrphans}, 累计=${result.totalAccumulated}, ${result.durationMs}ms`;
    },
  },
];

// ============================================
// 内存状态：每个任务最近一次执行信息
// ============================================
const taskExecutionState = {};

// 存储已注册的 cron 任务引用（用于 getNextRun()）
const scheduledTasks = {};

// ============================================
// 单任务启停：文件通信
// ============================================
function isTaskEnabled(taskKey) {
  try {
    if (!fs.existsSync(TASK_STATES_FILE)) return true;
    const states = JSON.parse(fs.readFileSync(TASK_STATES_FILE, 'utf-8'));
    return states[taskKey] !== false;
  } catch {
    return true;
  }
}

// ============================================
// 执行任务包装器
// ============================================
async function executeTask(taskDef, triggeredBy = 'scheduler') {
  const { key, name, silentWhenEmpty } = taskDef;

  // 检查任务是否启用
  if (triggeredBy === 'scheduler' && !isTaskEnabled(key)) {
    log(key, '任务已禁用，跳过执行');
    return;
  }

  const startTime = Date.now();
  const startTimeIso = new Date().toISOString();
  let logId = null;

  // 立即标记为运行中，并写入心跳（让前端即时感知）
  taskExecutionState[key] = {
    status: 'running',
    startedAt: startTimeIso,
    durationMs: null,
    executedAt: null,
  };
  writeHeartbeat();

  // 创建 DB 日志记录
  if (prisma) {
    try {
      const record = await prisma.cronExecutionLog.create({
        data: {
          taskKey: key,
          taskName: name,
          status: 'running',
          triggeredBy,
        },
      });
      logId = record.id;
    } catch (e) {
      log(key, `创建执行日志失败: ${e.message}`);
    }
  }

  try {
    log(key, `开始执行${name}...`);
    const output = await taskDef.handler();
    const durationMs = Date.now() - startTime;

    // 高频任务优化：handler 返回 null 时不更新 DB（或删除刚创建的记录）
    if (output === null && silentWhenEmpty) {
      if (logId && prisma) {
        try {
          await prisma.cronExecutionLog.delete({ where: { id: logId } });
        } catch {
          /* ignore */
        }
      }
      return;
    }

    const truncatedOutput = output ? String(output).slice(0, 2000) : null;
    log(key, `执行成功: ${truncatedOutput || '(无输出)'} [${durationMs}ms]`);

    // 更新 DB 日志
    if (logId && prisma) {
      try {
        await prisma.cronExecutionLog.update({
          where: { id: logId },
          data: {
            status: 'success',
            completedAt: new Date(),
            durationMs,
            output: truncatedOutput,
          },
        });
      } catch (e) {
        log(key, `更新执行日志失败: ${e.message}`);
      }
    }

    // 更新内存状态
    taskExecutionState[key] = {
      status: 'success',
      startedAt: startTimeIso,
      durationMs,
      executedAt: new Date().toISOString(),
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error.message || String(error);
    log(key, `执行失败: ${errorMsg} [${durationMs}ms]`);

    // 更新 DB 日志
    if (logId && prisma) {
      try {
        await prisma.cronExecutionLog.update({
          where: { id: logId },
          data: {
            status: 'failed',
            completedAt: new Date(),
            durationMs,
            errorMessage: errorMsg.slice(0, 2000),
          },
        });
      } catch (e) {
        log(key, `更新执行日志失败: ${e.message}`);
      }
    }

    // 更新内存状态
    taskExecutionState[key] = {
      status: 'failed',
      startedAt: startTimeIso,
      durationMs,
      executedAt: new Date().toISOString(),
    };
  }
}

// ============================================
// PID 文件和心跳管理
// ============================================
const startTime = new Date();

const writePidFile = () => {
  fs.writeFileSync(PID_FILE, process.pid.toString(), 'utf-8');
  log('scheduler', `PID 文件已写入: ${PID_FILE} (PID: ${process.pid})`);
};

const removePidFile = () => {
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
    log('scheduler', 'PID 文件已删除');
  }
};

const writeHeartbeat = () => {
  const status = {
    pid: process.pid,
    startedAt: startTime.toISOString(),
    lastHeartbeat: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime.getTime()) / 1000),
    tasks: TASK_REGISTRY.map((t) => ({
      key: t.key,
      name: t.name,
      cronExpression: t.cronExpression,
      schedule: t.schedule,
      enabled: isTaskEnabled(t.key),
      lastExecution: taskExecutionState[t.key] || null,
      nextRun: scheduledTasks[t.key]?.getNextRun()?.toISOString() || null,
    })),
  };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), 'utf-8');
};

// 写入 PID 文件
writePidFile();

// 定期写入心跳（每 30 秒）
const heartbeatInterval = setInterval(writeHeartbeat, 30000);
writeHeartbeat(); // 立即写入一次

// ============================================
// 手动触发：轮询 triggers 目录
// ============================================
const triggerPollInterval = setInterval(() => {
  try {
    if (!fs.existsSync(TRIGGERS_DIR)) return;
    const files = fs.readdirSync(TRIGGERS_DIR);
    for (const file of files) {
      const match = file.match(/^trigger-(.+)\.json$/);
      if (!match) continue;
      const taskKey = match[1];
      const taskDef = TASK_REGISTRY.find((t) => t.key === taskKey);
      if (!taskDef) {
        log('scheduler', `未知的触发任务: ${taskKey}`);
      } else {
        log('scheduler', `收到手动触发: ${taskDef.name}`);
        executeTask(taskDef, 'manual');
      }
      // 删除触发文件
      try {
        fs.unlinkSync(path.join(TRIGGERS_DIR, file));
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    log('scheduler', `触发轮询出错: ${e.message}`);
  }
}, 3000);

// ============================================
// 注册所有 Cron 任务
// ============================================
for (const taskDef of TASK_REGISTRY) {
  scheduledTasks[taskDef.key] = cron.schedule(
    taskDef.cronExpression,
    () => executeTask(taskDef, 'scheduler'),
    { scheduled: true, timezone: 'Asia/Shanghai' }
  );
  log('scheduler', `✅ ${taskDef.name}任务已注册（${taskDef.schedule}）`);
}

// ============================================
// 优雅退出
// ============================================
let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  clearInterval(heartbeatInterval);
  clearInterval(triggerPollInterval);
  removePidFile();
  if (fs.existsSync(STATUS_FILE)) {
    fs.unlinkSync(STATUS_FILE);
  }
  if (prisma) {
    prisma.$disconnect().catch(() => {});
  }
};

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log('scheduler', `收到 ${signal} 信号，准备退出...`);
    cleanup();
    process.exit(0);
  });
}

process.on('exit', () => {
  cleanup();
});

// ============================================
// 启动日志
// ============================================
log('scheduler', '========================================');
log('scheduler', 'LinghuiAI Cron Scheduler 已启动');
log('scheduler', '时区: Asia/Shanghai');
log('scheduler', `已注册 ${TASK_REGISTRY.length} 个任务:`);
TASK_REGISTRY.forEach((t, i) => {
  log('scheduler', `  ${i + 1}. ${t.name} - ${t.schedule}`);
});
log('scheduler', '========================================');

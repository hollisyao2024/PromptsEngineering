#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
// 工具脚本,允许使用 any 类型以提高灵活性
/**
 * 清理 OSS 中 IMS 临时文件（icetemp/ 目录）
 *
 * 背景：
 * - 阿里云 IMS（智能媒体服务）在视频合成时会自动在 bucket 中创建 icetemp/ 临时目录
 * - 这些文件包含字幕渲染缓存等中间产物，合成完成后不再需要
 * - 目前仅在 quick-create 重新生成时清理，无定时清理机制，导致文件累积
 *
 * 删除条件：
 * - 路径前缀为 icetemp/
 * - 文件最后修改时间超过 3 天
 *
 * 使用方法：
 * 1. 手动执行（推荐先 dry-run）: npx tsx infra/scripts/cron/cleanup-oss-icetemp.ts --dry-run
 * 2. 执行删除: npx tsx infra/scripts/cron/cleanup-oss-icetemp.ts
 * 3. 添加到 crontab（每天凌晨 4 点）: 0 4 * * * cd /path/to/frontend && npx tsx infra/scripts/cron/cleanup-oss-icetemp.ts
 */

import * as OSS from 'ali-oss';

// 检查是否为 dry-run 模式
const isDryRun = process.argv.includes('--dry-run');

// 超过多少天的文件会被删除
const RETENTION_DAYS = 3;

/**
 * 获取当前应用环境（优先使用 APP_ENVIRONMENT）
 */
function getAppEnvironment(): 'development' | 'staging' | 'production' {
  const env = process.env.APP_ENVIRONMENT;
  if (env === 'development') return 'development';
  if (env === 'staging') return 'staging';
  if (env === 'production') return 'production';
  return 'development';
}

/**
 * 创建 OSS 客户端
 */
function createOSSClient(): OSS {
  const region = process.env.OSS_REGION;
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;

  const appEnv = getAppEnvironment();
  const bucket =
    appEnv === 'production'
      ? process.env.OSS_BUCKET_PROD
      : appEnv === 'staging'
        ? process.env.OSS_BUCKET_STAGING
        : process.env.OSS_BUCKET_DEV;

  const requiredBucketVar =
    appEnv === 'production'
      ? 'OSS_BUCKET_PROD'
      : appEnv === 'staging'
        ? 'OSS_BUCKET_STAGING'
        : 'OSS_BUCKET_DEV';

  if (!region || !accessKeyId || !accessKeySecret || !bucket) {
    throw new Error(
      `OSS 环境变量未完整配置。当前环境: ${appEnv}。` +
        `需要配置: OSS_REGION, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, ${requiredBucketVar}`
    );
  }

  return new OSS({
    region,
    accessKeyId,
    accessKeySecret,
    bucket,
  });
}

/**
 * 格式化文件大小
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 列出 icetemp/ 下超过保留期的文件
 */
async function listExpiredIcetempFiles(
  client: OSS
): Promise<{ name: string; size: number; lastModified: Date }[]> {
  const expiredFiles: { name: string; size: number; lastModified: Date }[] = [];
  let marker: string | undefined;
  const cutoffDate = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  console.log(`[Cleanup] 开始扫描 icetemp/ 目录...`);
  console.log(
    `[Cleanup] 保留期: ${RETENTION_DAYS} 天（删除 ${cutoffDate.toISOString()} 之前的文件）`
  );

  do {
    const result = await client.list({
      prefix: 'icetemp/',
      marker,
      'max-keys': 1000,
    });

    for (const obj of result.objects || []) {
      const lastModified = new Date(obj.lastModified);
      if (lastModified < cutoffDate) {
        expiredFiles.push({
          name: obj.name,
          size: obj.size,
          lastModified,
        });
      }
    }

    marker = result.nextMarker;
  } while (marker);

  return expiredFiles;
}

/**
 * 批量删除文件
 */
async function deleteFiles(client: OSS, files: { name: string; size: number }[]): Promise<void> {
  if (files.length === 0) {
    console.log('[Cleanup] 没有需要删除的文件');
    return;
  }

  console.log(`[Cleanup] 开始删除 ${files.length} 个文件...`);

  const batchSize = 1000;
  let deletedCount = 0;

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const fileNames = batch.map((f) => f.name);

    await client.deleteMulti(fileNames, { quiet: true });

    deletedCount += batch.length;
    console.log(`[Cleanup] 已删除 ${deletedCount}/${files.length} 个文件`);
  }
}

/**
 * 主程序
 */
async function cleanupIcetemp() {
  console.log('[Cleanup] OSS icetemp/ 临时文件清理工具');
  console.log(`[Cleanup] 模式: ${isDryRun ? 'DRY-RUN（仅预览，不删除）' : '执行删除'}`);
  console.log(`[Cleanup] 环境: ${getAppEnvironment()}`);
  console.log('');

  try {
    const client = createOSSClient();

    const expiredFiles = await listExpiredIcetempFiles(client);

    const totalSize = expiredFiles.reduce((sum, file) => sum + file.size, 0);

    console.log('');
    console.log('[Cleanup] 扫描结果:');
    console.log(`  - 过期文件数量: ${expiredFiles.length}`);
    console.log(`  - 占用空间: ${formatSize(totalSize)}`);
    console.log('');

    if (expiredFiles.length === 0) {
      console.log('[Cleanup] 没有需要清理的过期 icetemp 文件');
      return;
    }

    // 显示示例文件（前 10 个）
    console.log('[Cleanup] 示例文件（前 10 个）:');
    expiredFiles.slice(0, 10).forEach((file, index) => {
      console.log(
        `  ${index + 1}. ${file.name} (${formatSize(file.size)}, 修改于 ${file.lastModified.toISOString()})`
      );
    });

    if (expiredFiles.length > 10) {
      console.log(`  ... 还有 ${expiredFiles.length - 10} 个文件`);
    }
    console.log('');

    if (isDryRun) {
      console.log('[Cleanup] DRY-RUN 模式，不会实际删除文件');
      console.log('[Cleanup] 执行删除请运行: npx tsx infra/scripts/cron/cleanup-oss-icetemp.ts');
    } else {
      await deleteFiles(client, expiredFiles);

      console.log('');
      console.log(`[Cleanup] 成功删除 ${expiredFiles.length} 个过期 icetemp 文件`);
      console.log(`[Cleanup] 释放空间: ${formatSize(totalSize)}`);
    }

    console.log('');
    console.log('[Cleanup] 执行完成');
  } catch (error) {
    console.error('[Cleanup] 执行失败:', error);
    throw error;
  }
}

// 主程序入口
(async () => {
  try {
    await cleanupIcetemp();
    process.exit(0);
  } catch (error) {
    console.error('[Cleanup] 执行失败:', error);
    process.exit(1);
  }
})();

#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
// 工具脚本,允许使用 any 类型以提高灵活性
/**
 * 清理 OSS 中的临时路径文件（temp-{timestamp}）
 *
 * 背景：
 * - 之前的代码在调用 /api/upload/convert-url-to-oss 时没有传递 userId 和 characterId
 * - 导致后端生成了 temp-{timestamp} 路径，违反了 ADR-025 的哈希分片策略
 * - 这些临时文件需要清理，避免占用存储空间和造成路径混乱
 *
 * 删除条件：
 * - 路径中包含 /temp-{数字}/
 * - 例如：characters/9d/temp-1763310876524/temp-1763310876524/references/...
 *
 * 使用方法：
 * 1. 手动执行（推荐先 dry-run）: npx tsx infra/scripts/cron/cleanup-oss-temp-paths.ts --dry-run
 * 2. 执行删除: npx tsx infra/scripts/cron/cleanup-oss-temp-paths.ts
 * 3. 添加到 crontab（每周一次）: 0 3 * * 0 cd /path/to/frontend && npx tsx infra/scripts/cron/cleanup-oss-temp-paths.ts
 */

import * as OSS from 'ali-oss';

// 检查是否为 dry-run 模式
const isDryRun = process.argv.includes('--dry-run');

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

  // 根据环境自动选择 Bucket（使用 APP_ENVIRONMENT 区分 staging/production）
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
 * 检查路径是否为临时路径
 */
function isTempPath(path: string): boolean {
  // 匹配 /temp-{数字}/ 模式
  return /\/temp-\d+\//.test(path);
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
 * 列出所有临时路径文件
 */
async function listTempFiles(client: OSS): Promise<{ name: string; size: number }[]> {
  const tempFiles: { name: string; size: number }[] = [];
  let marker: string | undefined;

  console.log('[Cleanup] 开始扫描 OSS 中的临时路径文件...');

  do {
    // 列举文件（分页）
    const result = await client.list({
      prefix: 'characters/', // 只扫描 characters 目录
      marker,
      'max-keys': 1000, // 每页最多 1000 个
    });

    // 筛选临时路径文件
    for (const obj of result.objects || []) {
      if (isTempPath(obj.name)) {
        tempFiles.push({
          name: obj.name,
          size: obj.size,
        });
      }
    }

    marker = result.nextMarker;

    console.log(`[Cleanup] 已扫描 ${tempFiles.length} 个临时文件...`);
  } while (marker);

  return tempFiles;
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

  // OSS deleteMulti 限制每次最多 1000 个
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
async function cleanupOSSTempPaths() {
  console.log('[Cleanup] OSS 临时路径清理工具');
  console.log(`[Cleanup] 模式: ${isDryRun ? 'DRY-RUN（仅预览，不删除）' : '执行删除'}`);
  console.log(`[Cleanup] 环境: ${getAppEnvironment()}`);
  console.log('');

  try {
    // 1. 创建 OSS 客户端
    const client = createOSSClient();

    // 2. 列出所有临时路径文件
    const tempFiles = await listTempFiles(client);

    // 3. 统计信息
    const totalSize = tempFiles.reduce((sum, file) => sum + file.size, 0);

    console.log('');
    console.log('[Cleanup] 扫描结果:');
    console.log(`  - 临时文件数量: ${tempFiles.length}`);
    console.log(`  - 占用空间: ${formatSize(totalSize)}`);
    console.log('');

    if (tempFiles.length === 0) {
      console.log('[Cleanup] 没有需要清理的临时文件');
      return;
    }

    // 4. 显示示例文件（前 10 个）
    console.log('[Cleanup] 示例文件（前 10 个）:');
    tempFiles.slice(0, 10).forEach((file, index) => {
      console.log(`  ${index + 1}. ${file.name} (${formatSize(file.size)})`);
    });

    if (tempFiles.length > 10) {
      console.log(`  ... 还有 ${tempFiles.length - 10} 个文件`);
    }
    console.log('');

    // 5. 执行删除（或 dry-run）
    if (isDryRun) {
      console.log('[Cleanup] DRY-RUN 模式，不会实际删除文件');
      console.log('[Cleanup] 执行删除请运行: npx tsx infra/scripts/cron/cleanup-oss-temp-paths.ts');
    } else {
      console.log('[Cleanup] 确认删除以上文件？（将在 5 秒后开始删除）');
      await new Promise((resolve) => setTimeout(resolve, 5000));

      await deleteFiles(client, tempFiles);

      console.log('');
      console.log(`[Cleanup] 成功删除 ${tempFiles.length} 个临时文件`);
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
    await cleanupOSSTempPaths();
    process.exit(0);
  } catch (error) {
    console.error('[Cleanup] 执行失败:', error);
    process.exit(1);
  }
})();

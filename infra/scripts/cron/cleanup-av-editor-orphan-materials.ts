#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
// 工具脚本,允许使用 any 类型以提高灵活性
/**
 * 清理 AV Editor 中的孤儿素材文件
 *
 * 背景：
 * - 用户上传素材到 OSS 后，如果注册到数据库失败（网络中断等），
 *   会产生 OSS 上有文件但数据库无记录的"孤儿文件"
 * - 这些文件不会被正常删除流程覆盖，需要定期清理
 *
 * 清理逻辑：
 * 1. 扫描 OSS av-editor/ 前缀下所有包含 /materials/ 的文件
 * 2. 对每个文件，查询 avMaterial 表是否存在引用
 * 3. 无引用且创建超过 24 小时 → 删除
 *
 * 使用方法：
 * 1. 预览: npx tsx infra/scripts/cron/cleanup-av-editor-orphan-materials.ts --dry-run
 * 2. 执行: npx tsx infra/scripts/cron/cleanup-av-editor-orphan-materials.ts
 * 3. crontab（每天凌晨 5 点）:
 *    0 5 * * * cd /path/to/frontend && npx tsx infra/scripts/cron/cleanup-av-editor-orphan-materials.ts
 */

import * as OSS from 'ali-oss';
import { PrismaClient } from '@prisma/client';

const isDryRun = process.argv.includes('--dry-run');
const RETENTION_HOURS = 24;

function getAppEnvironment(): 'development' | 'staging' | 'production' {
  const env = process.env.APP_ENVIRONMENT;
  if (env === 'development') return 'development';
  if (env === 'staging') return 'staging';
  if (env === 'production') return 'production';
  return 'development';
}

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

  return new OSS({ region, accessKeyId, accessKeySecret, bucket });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

interface OSSFile {
  name: string;
  size: number;
  lastModified: Date;
}

/**
 * 扫描 OSS 中 av-editor/ 前缀下的 materials 文件
 */
async function listMaterialFiles(client: OSS): Promise<OSSFile[]> {
  const files: OSSFile[] = [];
  let marker: string | undefined;
  const cutoffDate = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);

  console.log(`[Cleanup] 开始扫描 av-editor/ 目录下的 materials 文件...`);
  console.log(
    `[Cleanup] 保留期: ${RETENTION_HOURS} 小时（删除 ${cutoffDate.toISOString()} 之前的文件）`
  );

  do {
    const result = await client.list({
      prefix: 'av-editor/',
      marker,
      'max-keys': 1000,
    });

    for (const obj of result.objects || []) {
      // 只处理 materials/ 子目录下的文件
      if (!obj.name.includes('/materials/')) continue;

      const lastModified = new Date(obj.lastModified);
      if (lastModified < cutoffDate) {
        files.push({ name: obj.name, size: obj.size, lastModified });
      }
    }

    marker = result.nextMarker;
  } while (marker);

  return files;
}

/**
 * 批量检查哪些 OSS 路径在数据库中没有引用
 */
async function findOrphans(prisma: PrismaClient, files: OSSFile[]): Promise<OSSFile[]> {
  if (files.length === 0) return [];

  const orphans: OSSFile[] = [];
  const batchSize = 100;

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const ossPaths = batch.map((f) => f.name);

    // 查询 avMaterial 表中存在的 ossPath
    const referenced = await prisma.avMaterial.findMany({
      where: { ossPath: { in: ossPaths } },
      select: { ossPath: true },
    });
    const referencedPaths = new Set(referenced.map((r) => r.ossPath));

    for (const file of batch) {
      if (!referencedPaths.has(file.name)) {
        orphans.push(file);
      }
    }

    if (i + batchSize < files.length) {
      console.log(
        `[Cleanup] 已检查 ${Math.min(i + batchSize, files.length)}/${files.length} 个文件`
      );
    }
  }

  return orphans;
}

/**
 * 批量删除文件
 */
async function deleteFiles(client: OSS, files: OSSFile[]): Promise<void> {
  if (files.length === 0) return;

  console.log(`[Cleanup] 开始删除 ${files.length} 个孤儿文件...`);

  const batchSize = 1000;
  let deletedCount = 0;

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    await client.deleteMulti(
      batch.map((f) => f.name),
      { quiet: true }
    );
    deletedCount += batch.length;
    console.log(`[Cleanup] 已删除 ${deletedCount}/${files.length} 个文件`);
  }
}

async function main() {
  console.log('[Cleanup] AV Editor 孤儿素材清理工具');
  console.log(`[Cleanup] 模式: ${isDryRun ? 'DRY-RUN（仅预览，不删除）' : '执行删除'}`);
  console.log(`[Cleanup] 环境: ${getAppEnvironment()}`);
  console.log('');

  const client = createOSSClient();
  const prisma = new PrismaClient();

  try {
    // 1. 扫描 OSS
    const materialFiles = await listMaterialFiles(client);
    console.log(`[Cleanup] 扫描到 ${materialFiles.length} 个超过保留期的素材文件`);

    if (materialFiles.length === 0) {
      console.log('[Cleanup] 没有需要检查的文件');
      return;
    }

    // 2. 查找孤儿文件
    console.log('[Cleanup] 正在查询数据库，检查引用...');
    const orphans = await findOrphans(prisma, materialFiles);

    const totalSize = orphans.reduce((sum, f) => sum + f.size, 0);

    console.log('');
    console.log('[Cleanup] 检查结果:');
    console.log(`  - 总扫描文件: ${materialFiles.length}`);
    console.log(`  - 孤儿文件数: ${orphans.length}`);
    console.log(`  - 有引用文件: ${materialFiles.length - orphans.length}`);
    console.log(`  - 孤儿占用空间: ${formatSize(totalSize)}`);
    console.log('');

    if (orphans.length === 0) {
      console.log('[Cleanup] 没有孤儿文件需要清理');
      return;
    }

    // 显示示例
    console.log('[Cleanup] 孤儿文件示例（前 10 个）:');
    orphans.slice(0, 10).forEach((file, index) => {
      console.log(
        `  ${index + 1}. ${file.name} (${formatSize(file.size)}, 修改于 ${file.lastModified.toISOString()})`
      );
    });
    if (orphans.length > 10) {
      console.log(`  ... 还有 ${orphans.length - 10} 个文件`);
    }
    console.log('');

    if (isDryRun) {
      console.log('[Cleanup] DRY-RUN 模式，不会实际删除文件');
      console.log(
        '[Cleanup] 执行删除请运行: npx tsx infra/scripts/cron/cleanup-av-editor-orphan-materials.ts'
      );
    } else {
      await deleteFiles(client, orphans);
      console.log('');
      console.log(`[Cleanup] 成功删除 ${orphans.length} 个孤儿文件`);
      console.log(`[Cleanup] 释放空间: ${formatSize(totalSize)}`);
    }

    console.log('');
    console.log('[Cleanup] 执行完成');
  } finally {
    await prisma.$disconnect();
  }
}

(async () => {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error('[Cleanup] 执行失败:', error);
    process.exit(1);
  }
})();

#!/usr/bin/env tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
// 工具脚本,允许使用 any 类型以提高灵活性
/**
 * 后台任务处理器（Cron 任务）
 *
 * 运行频率：每 10 秒执行一次
 * Cron 表达式：'* /10 * * * * *'
 *
 * 使用方法：
 * 1. 添加到 crontab: '* /10 * * * * *' cd /path/to/frontend && npx tsx infra/scripts/cron/process-background-jobs.ts
 * 2. 手动执行: npx tsx infra/scripts/cron/process-background-jobs.ts
 */

import { PrismaClient } from '@prisma/client';
import {
  serializeCanvasToArtwork,
  deserializeArtworkToCanvas,
} from '../../../apps/web/src/services/canvas-serializer';
import type { ArtworkPanelsData } from '../../../apps/web/src/types/canvas-schemas';

const prisma = new PrismaClient();

const BATCH_SIZE = 5; // 每次处理 5 个任务
const MAX_CONCURRENT_JOBS = 3; // 最大并发任务数

let runningJobsCount = 0;

// ==================== 主函数 ====================

async function processPendingJobs() {
  console.log('[Job Processor] 开始处理待办任务...');

  try {
    // 1. 获取待处理的任务（按优先级和创建时间排序）
    const jobs = await prisma.backgroundJob.findMany({
      where: { status: 'pending' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: BATCH_SIZE,
    });

    console.log(`[Job Processor] 找到 ${jobs.length} 个待处理任务`);

    if (jobs.length === 0) {
      console.log('[Job Processor] 无待处理任务，退出');
      return;
    }

    // 2. 并发处理任务（带并发限制）
    await Promise.allSettled(jobs.map((job) => processJobWithConcurrencyLimit(job.id)));

    console.log('[Job Processor] 任务处理完成');
  } catch (error) {
    console.error('[Job Processor] 处理失败:', error);
    throw error;
  }
}

// ==================== 并发控制 ====================

async function processJobWithConcurrencyLimit(jobId: string) {
  // 等待槽位
  while (runningJobsCount >= MAX_CONCURRENT_JOBS) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  runningJobsCount++;

  try {
    await processJob(jobId);
  } finally {
    runningJobsCount--;
  }
}

// ==================== 任务处理 ====================

async function processJob(jobId: string) {
  console.log(`[Job ${jobId}] 开始处理`);

  try {
    // 1. 标记为 processing
    const job = await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: 'processing',
        startedAt: new Date(),
      },
    });

    // 2. 根据任务类型执行
    let result: any;

    switch (job.type) {
      case 'publish_artwork':
        result = await handlePublishArtwork(job);
        break;

      case 'clone_canvas':
        result = await handleCloneCanvas(job);
        break;

      default:
        throw new Error(`未知任务类型: ${job.type}`);
    }

    // 3. 标记为 completed
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        result,
        progress: 100,
        currentStep: '已完成',
        completedAt: new Date(),
      },
    });

    console.log(`[Job ${jobId}] 处理成功`);
  } catch (error) {
    console.error(`[Job ${jobId}] 处理失败:`, error);

    const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });

    if (!job) {
      console.error(`[Job ${jobId}] 任务不存在，跳过错误处理`);
      return;
    }

    // 重试逻辑
    if (job.retries < job.maxRetries) {
      await prisma.backgroundJob.update({
        where: { id: jobId },
        data: {
          status: 'pending', // 重新放回队列
          retries: job.retries + 1,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      console.log(`[Job ${jobId}] 将在下次执行时重试（${job.retries + 1}/${job.maxRetries}）`);
    } else {
      // 超过最大重试次数，标记为失败
      await prisma.backgroundJob.update({
        where: { id: jobId },
        data: {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          completedAt: new Date(),
        },
      });

      console.log(`[Job ${jobId}] 已超过最大重试次数，标记为失败`);
    }
  }
}

// ==================== 发布作品处理 ====================

async function handlePublishArtwork(job: any) {
  const input = job.input as {
    canvasId: string;
    title?: string;
    titleEn?: string;
    style?: string;
    isPublic?: boolean;
  };

  console.log(`[Job ${job.id}] 开始序列化 Canvas: ${input.canvasId}`);

  // 1. 获取 Canvas
  const canvas = await prisma.canvases.findUnique({
    where: { id: input.canvasId },
    include: {
      panels: {
        include: { textBubbles: true },
        orderBy: { index: 'asc' },
      },
      textBubbles: true,
      user: { select: { languagePreference: true } },
    },
  });

  if (!canvas) {
    throw new Error(`Canvas ${input.canvasId} 不存在`);
  }

  const panelCount = canvas.panels.length;
  console.log(`[Job ${job.id}] Panel 数量: ${panelCount}`);

  // 2. 更新进度
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: {
      totalSteps: Math.max(1, Math.ceil(panelCount / 5)),
      currentStep: `正在序列化 ${panelCount} 个分镜...`,
      progress: 10,
    },
  });

  // 3. 执行序列化
  const panelsData = serializeCanvasToArtwork(
    canvas,
    canvas.user.languagePreference || 'zh-CN',
    input.style || 'anime'
  );

  // 4. 更新进度
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: {
      currentStep: `序列化完成，正在创建 Artwork...`,
      progress: 80,
    },
  });

  // 5. 创建 Artwork
  const artwork = await prisma.artworks.create({
    data: {
      userId: canvas.userId,
      title: input.title || canvas.title,
      titleEn: input.titleEn || null,
      panelsData: panelsData as any,
      metadata: {
        sourceCanvasId: input.canvasId,
        publishedAt: new Date().toISOString(),
        jobId: job.id,
      },
      style: input.style || 'anime',
      isPublic: input.isPublic !== undefined ? input.isPublic : true,
    },
  });

  console.log(`[Job ${job.id}] Artwork 创建成功: ${artwork.id}`);

  return {
    artworkId: artwork.id,
    title: artwork.title,
    panelsCount: panelCount,
  };
}

// ==================== 恢复编辑处理 ====================

async function handleCloneCanvas(job: any) {
  const input = job.input as {
    artworkId: string;
    title?: string;
  };

  console.log(`[Job ${job.id}] 开始反序列化 Artwork: ${input.artworkId}`);

  // 1. 获取 Artwork
  const artwork = await prisma.artworks.findUnique({
    where: { id: input.artworkId },
  });

  if (!artwork) {
    throw new Error(`Artwork ${input.artworkId} 不存在`);
  }

  // 2. 反序列化
  const { metadata, panels, textBubbles } = deserializeArtworkToCanvas(
    artwork.panelsData as unknown as ArtworkPanelsData
  );

  const panelCount = panels.length;
  console.log(`[Job ${job.id}] Panel 数量: ${panelCount}`);

  // 3. 更新进度
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: {
      totalSteps: panelCount + 1,
      currentStep: `正在创建 Canvas...`,
      progress: 10,
    },
  });

  // 4. 创建 Canvas
  const canvas = await prisma.canvases.create({
    data: {
      userId: job.userId,
      title: input.title || `${artwork.title} (副本)`,
      metadata: metadata as any,
    },
  });

  console.log(`[Job ${job.id}] Canvas 创建成功: ${canvas.id}`);

  // 5. 创建 Panels（批量）
  const createdPanels = await Promise.all(
    panels.map(async (panel, index) => {
      // 更新进度（每 5 个更新一次）
      if (index % 5 === 0) {
        await prisma.backgroundJob.update({
          where: { id: job.id },
          data: {
            currentStep: `正在创建第 ${index + 1}/${panelCount} 个分镜...`,
            progress: 10 + Math.floor((index / panelCount) * 70),
          },
        });
      }

      return prisma.canvasPanel.create({
        data: {
          canvasId: canvas.id,
          index: panel.index,
          transform: panel.transform as any,
          imageUrl: panel.imageUrl,
          filters: panel.filters as any,
        },
      });
    })
  );

  console.log(`[Job ${job.id}] 创建了 ${createdPanels.length} 个 Panels`);

  // 6. 创建 TextBubbles（批量）
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: {
      currentStep: `正在创建 ${textBubbles.length} 个文字气泡...`,
      progress: 85,
    },
  });

  const createdBubbles = await Promise.all(
    textBubbles.map((bubble) => {
      const panelId = createdPanels[bubble.panelIndex]?.id;

      if (!panelId) {
        console.warn(`[Job ${job.id}] TextBubble 的 panelIndex ${bubble.panelIndex} 无效，跳过`);
        return Promise.resolve(null);
      }

      return prisma.textBubble.create({
        data: {
          canvasId: canvas.id,
          panelId,
          text: bubble.text,
          style: bubble.style as any,
          transform: bubble.transform as any,
          bubbleType: bubble.bubbleType,
        },
      });
    })
  );

  const validBubblesCount = createdBubbles.filter((b) => b !== null).length;
  console.log(`[Job ${job.id}] 创建了 ${validBubblesCount} 个 TextBubbles`);

  return {
    canvasId: canvas.id,
    title: canvas.title,
    panelsCount: panelCount,
    textBubblesCount: validBubblesCount,
  };
}

// ==================== 主程序入口 ====================

(async () => {
  try {
    await processPendingJobs();
    console.log('[Job Processor] 执行完成');
  } catch (error) {
    console.error('[Job Processor] 执行失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();

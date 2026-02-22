/**
 * 打包 Cron 调度器
 *
 * 将 scheduler.js 及其所有 TypeScript 依赖打包成单个 JS 文件
 * 这样部署时只需同步 scheduler.bundle.js，无需 tsx 运行时和源码
 *
 * 运行方式：
 *   node infra/scripts/cron/build-scheduler.js
 *
 * 输出：
 *   infra/scripts/cron/scheduler.bundle.js
 */

const esbuild = require('esbuild');
const path = require('path');

const srcDir = path.resolve(__dirname, '../../../apps/web/src');
const outFile = path.resolve(__dirname, 'scheduler.bundle.js');

async function build() {
  try {
    const result = await esbuild.build({
      entryPoints: [path.resolve(__dirname, 'scheduler.js')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      outfile: outFile,
      format: 'cjs',
      // 外部依赖（不打包进 bundle）
      // 注意：只有需要原生绑定或特殊运行时的模块才标记为 external
      // node-cron 和 ioredis 是纯 JS，可以安全打包
      external: [
        '@prisma/client', // 有原生绑定，需要在服务器上可用
        '@alicloud/dysmsapi20170525',
        '@alicloud/openapi-client',
      ],
      // 路径别名解析
      alias: {
        '@': srcDir,
      },
      // 启用压缩减少体积
      minify: true,
      sourcemap: false,
      // 处理 __dirname
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      // 日志
      logLevel: 'info',
    });

    console.log('✅ Cron scheduler 打包完成:', outFile);
    console.log('📦 可以用 node scheduler.bundle.js 直接运行');
    return result;
  } catch (error) {
    console.error('❌ 打包失败:', error);
    process.exit(1);
  }
}

build();

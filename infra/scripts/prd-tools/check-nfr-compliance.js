#!/usr/bin/env node

/**
 * NFR 达标检查脚本
 *
 * 检查项：
 * - 解析 NFR 追踪表
 * - 检查达标状态
 * - 生成发布 Gate 报告
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  prdModulesDir: path.join(__dirname, '../../../docs/prd-modules'),
  // 兼容旧路径（如果存在）
  legacyNfrTrackingPath: path.join(__dirname, '../../../docs/data/nfr-tracking.md'),
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// 收集所有模块的 NFR 追踪文件
function collectAllNfrFiles() {
  const nfrFiles = [];

  // 检查旧路径（兼容性）
  if (fs.existsSync(CONFIG.legacyNfrTrackingPath)) {
    nfrFiles.push({
      module: 'legacy',
      path: CONFIG.legacyNfrTrackingPath
    });
  }

  // 扫描模块目录
  if (fs.existsSync(CONFIG.prdModulesDir)) {
    const entries = fs.readdirSync(CONFIG.prdModulesDir, { withFileTypes: true });

    entries.forEach(entry => {
      if (entry.isDirectory()) {
        const nfrPath = path.join(CONFIG.prdModulesDir, entry.name, 'nfr-tracking.md');
        if (fs.existsSync(nfrPath)) {
          nfrFiles.push({
            module: entry.name,
            path: nfrPath
          });
        }
      }
    });
  }

  return nfrFiles;
}

// 解析单个 NFR 追踪表
function parseNfrTrackingFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`NFR 追踪表不存在: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const nfrs = [];

  // 解析表格（Markdown 格式）
  const lines = content.split('\n');
  let inTable = false;

  lines.forEach(line => {
    // 检测表格开始
    if (line.startsWith('| NFR ID |')) {
      inTable = true;
      return;
    }

    // 跳过表头分隔符
    if (line.startsWith('|-----')) {
      return;
    }

    // 解析表格行
    if (inTable && line.startsWith('|') && !line.startsWith('| NFR ID')) {
      const columns = line.split('|').map(col => col.trim()).filter(Boolean);

      if (columns.length >= 10 && columns[0].startsWith('NFR-')) {
        const nfr = {
          id: columns[0],
          type: columns[1],
          description: columns[2],
          relatedStory: columns[3],
          baseline: columns[4],
          target: columns[5],
          current: columns[6],
          verificationMethod: columns[7],
          status: columns[8],
          owner: columns[9],
        };

        nfrs.push(nfr);
      }
    }

    // 表格结束
    if (inTable && line.trim() === '') {
      inTable = false;
    }
  });

  return nfrs;
}

// 解析状态
function parseStatus(statusText) {
  if (statusText.includes('✅') || statusText.includes('达标')) {
    return 'pass';
  } else if (statusText.includes('❌') || statusText.includes('未达标')) {
    return 'fail';
  } else if (statusText.includes('🔄') || statusText.includes('优化中')) {
    return 'inProgress';
  } else if (statusText.includes('⚠️') || statusText.includes('接近阈值')) {
    return 'warning';
  } else if (statusText.includes('📝') || statusText.includes('待验证')) {
    return 'pending';
  }
  return 'unknown';
}

// 统计 NFR 状态
function analyzeNfrStatus(nfrs) {
  const stats = {
    total: nfrs.length,
    pass: 0,
    fail: 0,
    inProgress: 0,
    warning: 0,
    pending: 0,
    unknown: 0,
  };

  const failedNfrs = [];
  const warningNfrs = [];
  const pendingNfrs = [];

  nfrs.forEach(nfr => {
    const status = parseStatus(nfr.status);
    stats[status]++;

    if (status === 'fail') {
      failedNfrs.push(nfr);
    } else if (status === 'warning') {
      warningNfrs.push(nfr);
    } else if (status === 'pending') {
      pendingNfrs.push(nfr);
    }
  });

  return { stats, failedNfrs, warningNfrs, pendingNfrs };
}

// 按类型分组
function groupByType(nfrs) {
  const groups = {};

  nfrs.forEach(nfr => {
    if (!groups[nfr.type]) {
      groups[nfr.type] = [];
    }
    groups[nfr.type].push(nfr);
  });

  return groups;
}

// 生成发布 Gate 报告
function generateReleaseGateReport(analysis) {
  log('\n' + '='.repeat(60), 'cyan');
  log('发布 Gate 检查报告', 'cyan');
  log('='.repeat(60), 'cyan');

  const { stats, failedNfrs, warningNfrs, pendingNfrs } = analysis;

  // 阻塞性问题
  if (failedNfrs.length > 0) {
    log('\n❌ 阻塞性问题（未达标的 NFR）:', 'red');
    failedNfrs.forEach(nfr => {
      log(`   - ${nfr.id}: ${nfr.description}`, 'red');
      log(`     当前值: ${nfr.current} | 目标值: ${nfr.target}`, 'red');
      log(`     关联 Story: ${nfr.relatedStory}`, 'red');
      log(`     负责人: ${nfr.owner}`, 'red');
      log('', 'reset');
    });
  }

  // 警告项
  if (warningNfrs.length > 0) {
    log('\n⚠️  警告项（接近阈值的 NFR）:', 'yellow');
    warningNfrs.forEach(nfr => {
      log(`   - ${nfr.id}: ${nfr.description}`, 'yellow');
      log(`     当前值: ${nfr.current} | 目标值: ${nfr.target}`, 'yellow');
      log('', 'reset');
    });
  }

  // 待验证项
  if (pendingNfrs.length > 0) {
    log('\n📝 待验证项:', 'cyan');
    pendingNfrs.forEach(nfr => {
      log(`   - ${nfr.id}: ${nfr.description}`, 'cyan');
      log(`     验证方式: ${nfr.verificationMethod}`, 'cyan');
      log('', 'reset');
    });
  }

  // 统计摘要
  log('\n📊 统计摘要:', 'cyan');
  log(`   总 NFR 数: ${stats.total}`, 'cyan');
  log(`   ✅ 达标: ${stats.pass} (${((stats.pass / stats.total) * 100).toFixed(1)}%)`, 'green');
  log(`   ❌ 未达标: ${stats.fail} (${((stats.fail / stats.total) * 100).toFixed(1)}%)`, stats.fail > 0 ? 'red' : 'green');
  log(`   🔄 优化中: ${stats.inProgress} (${((stats.inProgress / stats.total) * 100).toFixed(1)}%)`, 'yellow');
  log(`   ⚠️  接近阈值: ${stats.warning} (${((stats.warning / stats.total) * 100).toFixed(1)}%)`, 'yellow');
  log(`   📝 待验证: ${stats.pending} (${((stats.pending / stats.total) * 100).toFixed(1)}%)`, 'cyan');

  // 发布建议
  log('\n🚀 发布建议:', 'cyan');
  if (stats.fail === 0 && stats.pending === 0) {
    log('   ✅ 可以发布！所有 NFR 已达标或在优化中。', 'green');
    return true;
  } else if (stats.fail > 0) {
    log(`   ❌ 阻塞发布！存在 ${stats.fail} 个未达标的 NFR，必须修复后才能发布。`, 'red');
    return false;
  } else if (stats.pending > 0) {
    log(`   ⚠️  建议延后发布！存在 ${stats.pending} 个待验证的 NFR，建议先完成验证。`, 'yellow');
    return false;
  }
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('NFR 达标检查工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  log('\n📖 收集所有 NFR 追踪文件...', 'cyan');
  const nfrFiles = collectAllNfrFiles();

  if (nfrFiles.length === 0) {
    log('⚠️  未找到任何 NFR 追踪文件', 'yellow');
    log('\n建议：', 'yellow');
    log('1. 在模块目录下创建 nfr-tracking.md：/docs/prd-modules/{domain}/nfr-tracking.md', 'yellow');
    log('2. 或使用旧路径（兼容）：/docs/data/nfr-tracking.md', 'yellow');
    process.exit(1);
  }

  log(`✅ 找到 ${nfrFiles.length} 个 NFR 追踪文件`, 'green');
  nfrFiles.forEach(file => {
    log(`   - ${file.module}: ${file.path}`, 'cyan');
  });

  // 解析所有文件
  log('\n📖 解析 NFR 追踪表...', 'cyan');
  const allNfrs = [];
  nfrFiles.forEach(file => {
    try {
      const nfrs = parseNfrTrackingFile(file.path);
      nfrs.forEach(nfr => {
        nfr.module = file.module; // 添加模块标识
        allNfrs.push(nfr);
      });
      log(`   ${file.module}: ${nfrs.length} 个 NFR`, 'cyan');
    } catch (error) {
      log(`   ⚠️  解析 ${file.module} 失败: ${error.message}`, 'yellow');
    }
  });

  const nfrs = allNfrs;
  log(`✅ 总计 ${nfrs.length} 个 NFR`, 'green');

  // 分析状态
  const analysis = analyzeNfrStatus(nfrs);

  // 按类型分组统计
  log('\n📊 按类型分组统计:', 'cyan');
  const groups = groupByType(nfrs);
  Object.entries(groups).forEach(([type, typeNfrs]) => {
    const passCount = typeNfrs.filter(nfr => parseStatus(nfr.status) === 'pass').length;
    const passRate = ((passCount / typeNfrs.length) * 100).toFixed(1);
    log(`   ${type}: ${passCount}/${typeNfrs.length} 达标 (${passRate}%)`, 'cyan');
  });

  // 生成发布 Gate 报告
  const canRelease = generateReleaseGateReport(analysis);

  // 退出码
  if (canRelease) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

// 运行
if (require.main === module) {
  try {
    main();
  } catch (error) {
    log(`\n❌ 执行出错: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

module.exports = { collectAllNfrFiles, parseNfrTrackingFile, analyzeNfrStatus, groupByType };

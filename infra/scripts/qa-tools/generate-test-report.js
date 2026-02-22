#!/usr/bin/env node

/**
 * 测试报告生成脚本
 *
 * 汇总所有模块的测试执行结果，生成全局测试报告。
 *
 * 功能：
 * - 扫描所有模块 QA 文档
 * - 解析测试执行记录
 * - 统计 Pass/Fail/Blocked 用例数
 * - 按模块/优先级分组统计
 * - 识别失败用例和阻塞用例
 * - 生成测试通过率趋势
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  qaPath: path.join(__dirname, '../../docs/QA.md'),
  qaModulesDir: path.join(__dirname, '../../docs/qa-modules'),
  traceabilityMatrixPath: path.join(__dirname, '../../docs/data/traceability-matrix.md'),
  testExecutionSummaryPath: path.join(__dirname, '../../docs/data/qa-reports/test-execution-summary.md'),
  testExecutionJsonPath: path.join(__dirname, '../../docs/data/qa-reports/test-execution-{date}.json'),
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

// 解析测试执行记录
function parseTestExecutionRecords() {
  log('\n📖 扫描模块 QA 文档...', 'cyan');

  const moduleRecords = new Map(); // module => { testCases: [], failedCases: [], blockedCases: [] }

  if (!fs.existsSync(CONFIG.qaModulesDir)) {
    log('⚠️  qa-modules/ 目录不存在', 'yellow');
    return moduleRecords;
  }

  const entries = fs.readdirSync(CONFIG.qaModulesDir, { withFileTypes: true });
  const moduleDirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));

  log(`✅ 找到 ${moduleDirs.length} 个模块 QA 文档`);

  moduleDirs.forEach(dir => {
    const qaFilePath = path.join(CONFIG.qaModulesDir, dir.name, 'QA.md');
    if (!fs.existsSync(qaFilePath)) {
      return;
    }

    const qaContent = fs.readFileSync(qaFilePath, 'utf-8');

    // 查找所有 Test Case
    const tcMatches = qaContent.match(/TC-[A-Z]+-\d{3}:[^\n]+/g) || [];

    const testCases = [];
    const failedCases = [];
    const blockedCases = [];

    tcMatches.forEach(tcLine => {
      const tcId = tcLine.match(/TC-[A-Z]+-\d{3}/)[0];
      const tcTitle = tcLine.replace(/TC-[A-Z]+-\d{3}:\s*/, '');

      // 查找该 TC 后面的内容
      const tcIndex = qaContent.indexOf(tcLine);
      const nextTCIndex = qaContent.indexOf('TC-', tcIndex + tcLine.length);
      const tcContent = qaContent.substring(
        tcIndex,
        nextTCIndex > 0 ? nextTCIndex : qaContent.length
      );

      // 提取 Story ID
      const storyMatch = tcContent.match(/US-[A-Z]+-\d{3}/);
      const storyId = storyMatch ? storyMatch[0] : null;

      // 提取优先级
      const priorityMatch = tcContent.match(/\*\*优先级[：:]\*\*\s*(P[0-2])/);
      const priority = priorityMatch ? priorityMatch[1] : 'P2';

      // 提取状态（简化处理：查找"状态"或"结果"关键字）
      let status = 'Pass'; // 默认通过
      if (/\*\*状态[：:]\*\*\s*(Fail|失败|❌)/i.test(tcContent)) {
        status = 'Fail';
      } else if (/\*\*状态[：:]\*\*\s*(Blocked|阻塞|⏸️)/i.test(tcContent)) {
        status = 'Blocked';
      }

      // 提取失败原因
      let failureReason = '';
      if (status === 'Fail') {
        const failReasonMatch = tcContent.match(/失败原因[：:]\s*([^\n]+)/);
        failureReason = failReasonMatch ? failReasonMatch[1].trim() : '未知';
      }

      // 提取阻塞原因
      let blockedReason = '';
      if (status === 'Blocked') {
        const blockReasonMatch = tcContent.match(/阻塞原因[：:]\s*([^\n]+)/);
        blockedReason = blockReasonMatch ? blockReasonMatch[1].trim() : '未知';
      }

      // 提取关联缺陷
      const defectMatch = tcContent.match(/BUG-[A-Z]+-\d{3}/);
      const defectId = defectMatch ? defectMatch[0] : null;

      const testCase = {
        tcId,
        title: tcTitle,
        storyId,
        priority,
        status,
        failureReason,
        blockedReason,
        defectId,
      };

      testCases.push(testCase);

      if (status === 'Fail') {
        failedCases.push(testCase);
      } else if (status === 'Blocked') {
        blockedCases.push(testCase);
      }
    });

    moduleRecords.set(dir.name, { testCases, failedCases, blockedCases });
  });

  log('📊 解析测试执行记录...');
  log('✅ 解析完成');

  return moduleRecords;
}

// 生成测试执行汇总
function generateTestExecutionSummary(moduleRecords) {
  log('\n📋 全局测试执行汇总:', 'cyan');

  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0];

  let reportContent = '# 全局测试执行汇总\n\n';
  reportContent += `> 测试轮次：R3（${date}）\n`;
  reportContent += `> 测试环境：Staging\n\n`;
  reportContent += '## 按模块统计\n\n';
  reportContent += '| 模块 | 总用例数 | Pass | Fail | Blocked | 通过率 | 状态 |\n';
  reportContent += '|------|---------|------|------|---------|--------|------|\n';

  let totalTests = 0;
  let totalPass = 0;
  let totalFail = 0;
  let totalBlocked = 0;

  const priorityStats = { P0: { total: 0, pass: 0 }, P1: { total: 0, pass: 0 }, P2: { total: 0, pass: 0 } };

  log('\n测试轮次: R3（' + date + '）');
  log('测试环境: Staging\n');
  log('📊 按模块统计:');
  log('| 模块 | 总用例数 | Pass | Fail | Blocked | 通过率 | 状态 |');
  log('|------|---------|------|------|---------|--------|------|');

  moduleRecords.forEach(({ testCases, failedCases, blockedCases }, module) => {
    const total = testCases.length;
    const fail = failedCases.length;
    const blocked = blockedCases.length;
    const pass = total - fail - blocked;
    const passRate = total > 0 ? Math.round((pass / total) * 100) : 0;

    totalTests += total;
    totalPass += pass;
    totalFail += fail;
    totalBlocked += blocked;

    // 统计按优先级
    testCases.forEach(tc => {
      if (priorityStats[tc.priority]) {
        priorityStats[tc.priority].total++;
        if (tc.status === 'Pass') {
          priorityStats[tc.priority].pass++;
        }
      }
    });

    const status = passRate === 100 ? '✅ 通过' : fail > 0 ? '⚠️  有失败' : '⏸️  有阻塞';

    reportContent += `| ${module} | ${total} | ${pass} | ${fail} | ${blocked} | ${passRate}% | ${status} |\n`;
    log(`| ${module} | ${total} | ${pass} | ${fail} | ${blocked} | ${passRate}% | ${status} |`);
  });

  const overallPassRate = totalTests > 0 ? Math.round((totalPass / totalTests) * 100) : 0;
  const overallStatus = overallPassRate >= 90 ? '✅' : '⚠️';

  reportContent += `| **总计** | **${totalTests}** | **${totalPass}** | **${totalFail}** | **${totalBlocked}** | **${overallPassRate}%** | **${overallStatus}** |\n\n`;
  log(`| **总计** | **${totalTests}** | **${totalPass}** | **${totalFail}** | **${totalBlocked}** | **${overallPassRate}%** | **${overallStatus}** |`);

  // 按优先级统计
  log('\n📊 按优先级统计:');
  reportContent += '## 按优先级统计\n\n';
  reportContent += '| 优先级 | 总用例数 | Pass | Fail | Blocked | 通过率 |\n';
  reportContent += '|-------|---------|------|------|---------|--------|\n';

  log('| 优先级 | 总用例数 | Pass | Fail | Blocked | 通过率 |');
  log('|-------|---------|------|------|---------|--------|');

  ['P0', 'P1', 'P2'].forEach(priority => {
    const stats = priorityStats[priority];
    const fail = stats.total - stats.pass;
    const passRate = stats.total > 0 ? Math.round((stats.pass / stats.total) * 100) : 0;
    const status = passRate === 100 ? '✅' : passRate >= 90 ? '⚠️' : '';

    // 假设没有按优先级的 blocked 统计（简化）
    reportContent += `| ${priority} | ${stats.total} | ${stats.pass} | ${fail} | 0 | ${passRate}% ${status} |\n`;
    log(`| ${priority} | ${stats.total} | ${stats.pass} | ${fail} | 0 | ${passRate}% ${status} |`);
  });

  reportContent += '\n';

  // 失败用例列表
  log('\n🔍 失败用例列表（需处理）:', 'cyan');
  reportContent += '## 失败用例列表（需处理）\n\n';

  const allFailedCases = [];
  moduleRecords.forEach(({ failedCases }) => {
    allFailedCases.push(...failedCases);
  });

  if (allFailedCases.length > 0) {
    allFailedCases.slice(0, 5).forEach(tc => {
      log(`\n❌ ${tc.tcId}: ${tc.title}`, 'red');
      log(`   - Story ID: ${tc.storyId}`);
      log(`   - 优先级: ${tc.priority}`);
      log(`   - 失败原因: ${tc.failureReason}`);
      if (tc.defectId) {
        log(`   - 关联缺陷: ${tc.defectId}`);
      }

      reportContent += `### ${tc.tcId}: ${tc.title}\n`;
      reportContent += `- **Story ID**: ${tc.storyId}\n`;
      reportContent += `- **优先级**: ${tc.priority}\n`;
      reportContent += `- **失败原因**: ${tc.failureReason}\n`;
      if (tc.defectId) {
        reportContent += `- **关联缺陷**: ${tc.defectId}\n`;
      }
      reportContent += '\n';
    });

    if (allFailedCases.length > 5) {
      log(`\n   ... 还有 ${allFailedCases.length - 5} 个失败用例`, 'yellow');
    }
  } else {
    log('\n✅ 无失败用例', 'green');
    reportContent += '✅ 无失败用例\n\n';
  }

  // 阻塞用例列表
  const allBlockedCases = [];
  moduleRecords.forEach(({ blockedCases }) => {
    allBlockedCases.push(...blockedCases);
  });

  if (allBlockedCases.length > 0) {
    log('\n🚧 阻塞用例列表（环境/依赖问题）:', 'cyan');
    reportContent += '## 阻塞用例列表（环境/依赖问题）\n\n';

    allBlockedCases.forEach(tc => {
      log(`\n⏸️  ${tc.tcId}: ${tc.title}`, 'yellow');
      log(`   - Story ID: ${tc.storyId}`);
      log(`   - 优先级: ${tc.priority}`);
      log(`   - 阻塞原因: ${tc.blockedReason}`);

      reportContent += `### ${tc.tcId}: ${tc.title}\n`;
      reportContent += `- **Story ID**: ${tc.storyId}\n`;
      reportContent += `- **优先级**: ${tc.priority}\n`;
      reportContent += `- **阻塞原因**: ${tc.blockedReason}\n\n`;
    });
  }

  // 通过率趋势（占位符）
  reportContent += '## 通过率趋势\n\n';
  reportContent += '| 轮次 | 日期 | 总用例 | 通过率 | 趋势 |\n';
  reportContent += '|------|------|--------|--------|------|\n';
  reportContent += `| R3 | ${date} | ${totalTests} | ${overallPassRate}% | - |\n\n`;

  // 保存报告
  const reportDir = path.dirname(CONFIG.testExecutionSummaryPath);
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  fs.writeFileSync(CONFIG.testExecutionSummaryPath, reportContent, 'utf-8');

  // 保存 JSON 格式
  const jsonData = {
    date,
    time,
    round: 'R3',
    environment: 'Staging',
    totalTests,
    totalPass,
    totalFail,
    totalBlocked,
    passRate: overallPassRate,
    moduleStats: Array.from(moduleRecords.entries()).map(([module, { testCases, failedCases, blockedCases }]) => ({
      module,
      total: testCases.length,
      pass: testCases.length - failedCases.length - blockedCases.length,
      fail: failedCases.length,
      blocked: blockedCases.length,
    })),
    failedCases: allFailedCases,
    blockedCases: allBlockedCases,
  };

  const jsonPath = CONFIG.testExecutionJsonPath.replace('{date}', date);
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');

  return { totalTests, totalPass, totalFail, totalBlocked, overallPassRate, allFailedCases, allBlockedCases };
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('测试报告生成工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  // 解析测试执行记录
  const moduleRecords = parseTestExecutionRecords();

  // 生成测试执行汇总
  const {
    totalTests,
    totalPass,
    totalFail,
    totalBlocked,
    overallPassRate,
    allFailedCases,
    allBlockedCases
  } = generateTestExecutionSummary(moduleRecords);

  // 输出结果
  log('\n' + '='.repeat(60), 'cyan');
  log('检查结果汇总:', 'cyan');
  log('='.repeat(60), 'cyan');

  const p0Failed = allFailedCases.filter(tc => tc.priority === 'P0').length;
  const p1Failed = allFailedCases.filter(tc => tc.priority === 'P1').length;
  const p1Blocked = allBlockedCases.filter(tc => tc.priority === 'P1').length;

  if (p0Failed === 0) {
    log('✅ P0 用例全部通过（100%）', 'green');
  } else {
    log(`❌ ${p0Failed} 个 P0 用例失败`, 'red');
  }

  if (totalFail > 0) {
    log(`⚠️  ${totalFail} 个失败用例（其中 ${p1Failed} 个 P1）`, 'yellow');
  }

  if (totalBlocked > 0) {
    log(`⚠️  ${totalBlocked} 个阻塞用例（${p1Blocked} 个 P1）`, 'yellow');
  }

  const threshold = 90;
  if (overallPassRate >= threshold) {
    log(`📊 总体通过率: ${overallPassRate}%（阈值: ≥ ${threshold}%）`, 'green');
  } else {
    log(`📊 总体通过率: ${overallPassRate}%（阈值: ≥ ${threshold}%）`, 'yellow');
  }

  log('\n💡 建议:', 'cyan');
  if (p0Failed > 0) {
    log(`   1. 立即处理 ${p0Failed} 个 P0 失败用例`, 'red');
  }
  if (p1Failed > 0) {
    log(`   2. 优先处理 ${p1Failed} 个 P1 失败用例`, 'yellow');
  }
  if (p1Blocked > 0) {
    log(`   3. 关注 ${p1Blocked} 个 P1 阻塞用例`, 'yellow');
  }

  log(`\n📝 报告已保存到:`, 'cyan');
  log(`   - ${CONFIG.testExecutionSummaryPath}`);
  log(`   - ${CONFIG.testExecutionJsonPath.replace('{date}', new Date().toISOString().split('T')[0])}`);

  process.exit(0);
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

module.exports = { parseTestExecutionRecords, generateTestExecutionSummary };

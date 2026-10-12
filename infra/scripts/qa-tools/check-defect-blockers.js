#!/usr/bin/env node

/**
 * 缺陷阻塞检查脚本
 *
 * 扫描所有模块的缺陷列表，识别 P0/P1 阻塞性缺陷，生成发布门禁报告。
 *
 * 检查项：
 * - 扫描所有模块 QA 的缺陷列表
 * - 按严重级别分类（P0/P1/P2）
 * - 按状态统计（Open/In Progress/Resolved/Closed）
 * - 识别阻塞性缺陷（P0 未关闭）
 * - 检查 NFR 达标情况
 * - 生成发布建议（Go/No-Go）
 */

const fs = require('fs');
const path = require('path');
const { CONFIG, log } = require('./check-defect-blockers-common');
const {
  analyzeDefects,
  moreBlockingStatus,
  parseDefectContent,
  parseDefects,
} = require('./check-defect-blockers-defects');
const { checkNFRCompliance, parseNFRCompliance } = require('./check-defect-blockers-nfr');
const shouldWriteReports = process.env.QA_WRITE_REPORTS === '1';

function determineReleaseDecision(analysisResult, nfrResult) {
  const p0Defects = analysisResult.p0Defects || [];
  const p1Open = analysisResult.p1Open || [];
  const p1InProgress = analysisResult.p1InProgress || [];
  const nonCompliantNFRs = nfrResult.nonCompliantNFRs || [];
  const conditionalNFRs = nfrResult.conditionalNFRs || [];
  const blockingIssues = [];
  const warningIssues = [];

  if (!nfrResult.sourceAvailable) blockingIssues.push(nfrResult.evidenceErrors?.length ? 'NFR 证据文件不可读取或没有可解析数据' : 'NFR 追踪表缺失');
  if (analysisResult.p0ValidationPending?.length) blockingIssues.push(`${analysisResult.p0ValidationPending.length} 个已关闭 P0 仍待验收`);
  if (p0Defects.length > 0) blockingIssues.push(`${p0Defects.length} 个 P0 缺陷未关闭`);
  if (nonCompliantNFRs.length > 0) blockingIssues.push(`${nonCompliantNFRs.length} 项 NFR 未达标`);
  if (conditionalNFRs.length > 0) warningIssues.push(`${conditionalNFRs.length} 项 NFR 条件通过或尚未确认`);
  if (p1Open.length > 0) warningIssues.push(`${p1Open.length} 个 P1 缺陷未修复`);
  if (p1InProgress.length > 0) warningIssues.push(`${p1InProgress.length} 个 P1 缺陷修复中`);

  const gatePass = blockingIssues.length === 0;
  const canRelease = gatePass && conditionalNFRs.length === 0;
  return {
    gatePass,
    canRelease,
    releaseStatus: !gatePass ? 'no-go' : canRelease ? 'go' : 'conditional',
    blockingIssues,
    warningIssues,
  };
}

// 生成发布门禁报告
function generateReleaseGateReport(defects, analysisResult, nfrResult) {
  const decision = determineReleaseDecision(analysisResult, nfrResult);
  const { date, time } = analysisResult;

  log('\n============================================================', 'cyan');
  log('发布门禁检查:', 'cyan');
  log('============================================================', 'cyan');

  let reportContent = `# 发布门禁报告 — v1.x.x\n\n`;
  reportContent += `> 发布版本：v1.x.x\n`;
  reportContent += `> 计划发布时间：${date} 10:00:00\n`;
  reportContent += `> 报告生成时间：${date} ${time}\n\n`;

  log(
    '\n🚨 阻塞性问题（必须解决才能继续门禁）:',
    decision.blockingIssues.length > 0 ? 'red' : 'green'
  );
  reportContent += '## 🚨 阻塞性问题（必须解决才能发布）\n\n';

  if (decision.blockingIssues.length > 0) {
    decision.blockingIssues.forEach(issue => {
      log(`   ❌ ${issue}`, 'red');
      reportContent += `- ❌ ${issue}\n`;
    });
  } else {
    log('   ✅ 无阻塞性问题', 'green');
    reportContent += '✅ 无阻塞性问题\n\n';
  }

  log('\n⚠️  条件与警告项:', decision.warningIssues.length > 0 ? 'yellow' : 'green');
  reportContent += '## ⚠️ 警告项（建议解决，可延后）\n\n';
  if (decision.warningIssues.length === 0) {
    log('   ✅ 无条件项', 'green');
    reportContent += '✅ 无条件项\n\n';
  } else {
    decision.warningIssues.forEach((issue) => {
      log(`   ⚠️ ${issue}`, 'yellow');
      reportContent += `- ⚠️ ${issue}\n`;
    });
    reportContent += '\n';
  }

  log('\n✅ 通过项:', 'green');
  reportContent += '## ✅ 通过项\n\n';
  reportContent += `- ✅ 已解析 ${defects.length} 个唯一缺陷记录\n`;
  reportContent += `- ✅ ${nfrResult.compliantNFRs?.length || 0} 项 NFR 达标\n`;
  reportContent += '- 本地门禁要求：无未关闭或待验收 P0，NFR 来源有效且无未达标项；条件项保留发布限制\n';
  reportContent += '\n';

  log('\n============================================================', 'cyan');
  log('发布建议:', 'cyan');
  log('============================================================', 'cyan');
  reportContent += '## 📋 发布建议\n\n';

  if (decision.releaseStatus === 'go') {
    log('✅ **建议发布**', 'green');
    reportContent += '**当前状态**：✅ **建议发布**\n\n';
    reportContent += '无 P0 阻塞、无未达标或条件 NFR。\n';
  } else if (decision.releaseStatus === 'conditional') {
    log('⚠️ **本地门禁通过，但不建议发布**', 'yellow');
    reportContent += '**当前状态**：⚠️ **Conditional；本地门禁可继续，但不建议发布**\n\n';
    reportContent += '必须先补齐所有条件 NFR 的真实证据，再生成发布建议。\n';
  } else {
    log('❌ **不建议发布**', 'red');
    reportContent += '**当前状态**：❌ **不建议发布**\n\n';
    reportContent += '**阻塞原因**：\n';
    decision.blockingIssues.forEach((issue, index) => {
      log(`   ${index + 1}. ${issue}`, 'red');
      reportContent += `${index + 1}. ${issue}\n`;
    });
  }

  const reportPath = CONFIG.releaseGateReportPath.replace('{date}', date);
  if (shouldWriteReports) {
    const reportDir = path.dirname(CONFIG.releaseGateReportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    fs.writeFileSync(reportPath, reportContent, 'utf-8');
    log(`\n📝 发布门禁报告已保存到:`, 'cyan');
    log(`   ${reportPath}`);
  } else {
    log('\nℹ️ 未写入发布门禁报告（只校验模式，设置 QA_WRITE_REPORTS=1 可写入）', 'yellow');
  }

  return { ...decision, reportPath };
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('缺陷阻塞检查工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  // 解析缺陷列表
  const defects = parseDefects();

  // 统计缺陷
  const analysisResult = analyzeDefects(defects);

  // 检查 NFR 达标情况
  const nfrResult = checkNFRCompliance();

  // 生成发布门禁报告
  const decision = generateReleaseGateReport(defects, analysisResult, nfrResult);

  // 条件 NFR 允许本地 QA 继续，但不会成为发布建议；缺失或未达标证据仍非零退出。
  process.exit(decision.gatePass ? 0 : 1);
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

module.exports = {
  analyzeDefects,
  checkNFRCompliance,
  determineReleaseDecision,
  generateReleaseGateReport,
  moreBlockingStatus,
  parseDefectContent,
  parseDefects,
  parseNFRCompliance,
};

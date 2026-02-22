#!/usr/bin/env node

/**
 * 测试覆盖率分析脚本
 *
 * 基于追溯矩阵，分析需求覆盖率（Story → Test Case 映射完整性）
 *
 * 检查项：
 * - 解析 PRD 中的所有 Story ID
 * - 解析 QA 文档中的所有 Test Case ID
 * - 分析追溯矩阵（Story → AC → Test Case）
 * - 统计需求覆盖率（按模块、按优先级）
 * - 识别未覆盖的 Story（Missing Test Cases）
 * - 识别孤儿测试用例（无对应 Story）
 */

const fs = require('fs');
const path = require('path');
const shouldWriteReports = process.env.QA_WRITE_REPORTS === '1';

// 配置
const CONFIG = {
  prdPath: path.join(__dirname, '../../docs/PRD.md'),
  prdModulesDir: path.join(__dirname, '../../docs/prd-modules'),
  qaPath: path.join(__dirname, '../../docs/QA.md'),
  qaModulesDir: path.join(__dirname, '../../docs/qa-modules'),
  traceabilityMatrixPath: path.join(__dirname, '../../docs/data/traceability-matrix.md'),
  coverageSummaryPath: path.join(__dirname, '../../docs/data/qa-reports/coverage-summary.md'),
};

// Story ID 格式正则（US-MODULE-NNN）
const STORY_ID_PATTERN = /US-[A-Z]+-\d{3}/g;

// Test Case ID 格式正则（TC-MODULE-NNN）
const TC_ID_PATTERN = /TC-[A-Z]+-\d{3}/g;

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

// 解析 PRD 中的 Story ID
function parseStoriesFromPRD() {
  log('\n📖 解析 PRD 中的 Story ID...', 'cyan');

  const stories = new Map(); // story_id => { module, priority, title }

  // 解析主 PRD
  if (fs.existsSync(CONFIG.prdPath)) {
    const prdContent = fs.readFileSync(CONFIG.prdPath, 'utf-8');
    const matches = prdContent.match(STORY_ID_PATTERN) || [];
    matches.forEach(id => {
      if (!stories.has(id)) {
        stories.set(id, { module: 'main', priority: 'P2', title: '' });
      }
    });
  }

  // 解析模块 PRD
  if (fs.existsSync(CONFIG.prdModulesDir)) {
    const entries = fs.readdirSync(CONFIG.prdModulesDir, { withFileTypes: true });
    const moduleDirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));

    moduleDirs.forEach(dir => {
      const prdFilePath = path.join(CONFIG.prdModulesDir, dir.name, 'PRD.md');
      if (fs.existsSync(prdFilePath)) {
        const prdContent = fs.readFileSync(prdFilePath, 'utf-8');

        // 查找所有 Story ID 及其优先级
        const storyMatches = prdContent.match(/US-[A-Z]+-\d{3}:[^\n]+/g) || [];
        storyMatches.forEach(storyLine => {
          const storyId = storyLine.match(/US-[A-Z]+-\d{3}/)[0];
          const title = storyLine.replace(/US-[A-Z]+-\d{3}:\s*/, '');

          // 尝试提取优先级
          const priorityMatch = prdContent.substring(
            prdContent.indexOf(storyLine),
            prdContent.indexOf(storyLine) + 500
          ).match(/\*\*优先级[：:]\*\*\s*(P[0-2])/);

          const priority = priorityMatch ? priorityMatch[1] : 'P2';

          stories.set(storyId, { module: dir.name, priority, title });
        });
      }
    });
  }

  log(`✅ 找到 ${stories.size} 个用户故事`, 'green');
  return stories;
}

// 解析 QA 文档中的 Test Case ID 及其关联的 Story
function parseTestCasesFromQA() {
  log('\n📖 解析 QA 文档中的 Test Case ID...', 'cyan');

  const testCases = new Map(); // tc_id => { story_id, module }
  const testCaseToStory = new Map(); // tc_id => story_id

  // 解析主 QA
  if (fs.existsSync(CONFIG.qaPath)) {
    const qaContent = fs.readFileSync(CONFIG.qaPath, 'utf-8');

    // 查找所有 Test Case
    const tcMatches = qaContent.match(/TC-[A-Z]+-\d{3}:[^\n]+/g) || [];
    tcMatches.forEach(tcLine => {
      const tcId = tcLine.match(/TC-[A-Z]+-\d{3}/)[0];

      // 查找该 TC 后面的内容，提取 Story ID
      const tcIndex = qaContent.indexOf(tcLine);
      const nextTCIndex = qaContent.indexOf('TC-', tcIndex + tcLine.length);
      const tcContent = qaContent.substring(
        tcIndex,
        nextTCIndex > 0 ? nextTCIndex : qaContent.length
      );

      const storyMatch = tcContent.match(/US-[A-Z]+-\d{3}/);
      if (storyMatch) {
        const storyId = storyMatch[0];
        testCases.set(tcId, { story_id: storyId, module: 'main' });
        testCaseToStory.set(tcId, storyId);
      } else {
        testCases.set(tcId, { story_id: null, module: 'main' });
      }
    });
  }

  // 解析模块 QA
  if (fs.existsSync(CONFIG.qaModulesDir)) {
    const entries = fs.readdirSync(CONFIG.qaModulesDir, { withFileTypes: true });
    const moduleDirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));

    moduleDirs.forEach(dir => {
      const qaFilePath = path.join(CONFIG.qaModulesDir, dir.name, 'QA.md');
      if (fs.existsSync(qaFilePath)) {
        const qaContent = fs.readFileSync(qaFilePath, 'utf-8');

        // 查找所有 Test Case
        const tcMatches = qaContent.match(/TC-[A-Z]+-\d{3}:[^\n]+/g) || [];
        tcMatches.forEach(tcLine => {
          const tcId = tcLine.match(/TC-[A-Z]+-\d{3}/)[0];

          // 查找该 TC 后面的内容，提取 Story ID
          const tcIndex = qaContent.indexOf(tcLine);
          const nextTCIndex = qaContent.indexOf('TC-', tcIndex + tcLine.length);
          const tcContent = qaContent.substring(
            tcIndex,
            nextTCIndex > 0 ? nextTCIndex : qaContent.length
          );

          const storyMatch = tcContent.match(/US-[A-Z]+-\d{3}/);
          if (storyMatch) {
            const storyId = storyMatch[0];
            testCases.set(tcId, { story_id: storyId, module: dir.name });
            testCaseToStory.set(tcId, storyId);
          } else {
            testCases.set(tcId, { story_id: null, module: dir.name });
          }
        });
      }
    });
  }

  log(`✅ 找到 ${testCases.size} 个测试用例`, 'green');
  return { testCases, testCaseToStory };
}

// 解析追溯矩阵
function parseTraceabilityMatrix() {
  log('\n📖 解析追溯矩阵...', 'cyan');

  if (!fs.existsSync(CONFIG.traceabilityMatrixPath)) {
    log('⚠️  追溯矩阵不存在，跳过', 'yellow');
    return new Map();
  }

  log(`✅ 追溯矩阵存在: ${CONFIG.traceabilityMatrixPath}`);

  const matrixContent = fs.readFileSync(CONFIG.traceabilityMatrixPath, 'utf-8');
  const storyToTestCases = new Map(); // story_id => [tc_ids]

  // 解析表格行（简化处理）
  const lines = matrixContent.split('\n');
  lines.forEach(line => {
    const storyMatch = line.match(/US-[A-Z]+-\d{3}/);
    const tcMatch = line.match(/TC-[A-Z]+-\d{3}/);

    if (storyMatch && tcMatch) {
      const storyId = storyMatch[0];
      const tcId = tcMatch[0];

      if (!storyToTestCases.has(storyId)) {
        storyToTestCases.set(storyId, []);
      }
      storyToTestCases.get(storyId).push(tcId);
    }
  });

  log(`📊 映射关系数: ${storyToTestCases.size} 个 Story → ${Array.from(storyToTestCases.values()).flat().length} 个 Test Case`);

  return storyToTestCases;
}

// 分析覆盖率
function analyzeCoverage(stories, testCaseToStory, storyToTestCases) {
  log('\n🔍 分析需求覆盖率...', 'cyan');

  const moduleStats = new Map(); // module => { total, covered }
  const priorityStats = new Map(); // priority => { total, covered }
  const uncoveredStories = [];
  const orphanTestCases = [];

  // 按模块和优先级统计
  stories.forEach((info, storyId) => {
    const { module, priority } = info;

    // 模块统计
    if (!moduleStats.has(module)) {
      moduleStats.set(module, { total: 0, covered: 0, uncovered: [] });
    }
    moduleStats.get(module).total++;

    // 优先级统计
    if (!priorityStats.has(priority)) {
      priorityStats.set(priority, { total: 0, covered: 0 });
    }
    priorityStats.get(priority).total++;

    // 检查是否有测试用例覆盖
    const hasCoverage = storyToTestCases.has(storyId) ||
      Array.from(testCaseToStory.values()).includes(storyId);

    if (hasCoverage) {
      moduleStats.get(module).covered++;
      priorityStats.get(priority).covered++;
    } else {
      moduleStats.get(module).uncovered.push(storyId);
      uncoveredStories.push({ storyId, ...info });
    }
  });

  // 检查孤儿测试用例
  testCaseToStory.forEach((storyId, tcId) => {
    if (storyId && !stories.has(storyId)) {
      orphanTestCases.push({ tcId, storyId });
    }
  });

  return { moduleStats, priorityStats, uncoveredStories, orphanTestCases };
}

// 生成覆盖率报告
function generateCoverageReport(stories, moduleStats, priorityStats, uncoveredStories, orphanTestCases) {
  log('\n📊 按模块统计:', 'cyan');

  let reportContent = '# 全局需求覆盖率汇总\n\n';
  reportContent += `> 生成时间：${new Date().toISOString().split('T')[0]} ${new Date().toTimeString().split(' ')[0]}\n`;
  reportContent += `> 数据来源：traceability-matrix.md\n\n`;
  reportContent += '## 按模块统计\n\n';
  reportContent += '| 模块 | 总 Story 数 | 已覆盖 Story | 覆盖率 | 未覆盖 Story |\n';
  reportContent += '|------|-----------|------------|---------|------------|\n';

  let totalStories = 0;
  let totalCovered = 0;

  moduleStats.forEach((stats, module) => {
    const coverage = stats.total > 0 ? Math.round((stats.covered / stats.total) * 100) : 0;
    const status = coverage === 100 ? '✅' : coverage >= 90 ? '⚠️' : '';
    const uncoveredList = stats.uncovered.join(', ') || '-';

    totalStories += stats.total;
    totalCovered += stats.covered;

    reportContent += `| ${module} | ${stats.total} | ${stats.covered} | ${coverage}% ${status} | ${uncoveredList} |\n`;
    log(`| ${module} | ${stats.total} | ${stats.covered} | ${coverage}% ${status} | ${uncoveredList} |`);
  });

  const totalCoverage = totalStories > 0 ? Math.round((totalCovered / totalStories) * 100) : 0;
  reportContent += `| **总计** | **${totalStories}** | **${totalCovered}** | **${totalCoverage}%** | **${totalStories - totalCovered}** |\n\n`;
  log(`| **总计** | **${totalStories}** | **${totalCovered}** | **${totalCoverage}%** | **${totalStories - totalCovered}** |`);

  // 按优先级统计
  log('\n📊 按优先级统计:', 'cyan');
  reportContent += '## 按优先级统计\n\n';
  reportContent += '| 优先级 | 总 Story 数 | 已覆盖 Story | 覆盖率 |\n';
  reportContent += '|-------|-----------|------------|---------|\n';

  ['P0', 'P1', 'P2'].forEach(priority => {
    const stats = priorityStats.get(priority) || { total: 0, covered: 0 };
    const coverage = stats.total > 0 ? Math.round((stats.covered / stats.total) * 100) : 0;
    const status = coverage === 100 ? '✅' : coverage >= 90 ? '⚠️' : '';

    reportContent += `| ${priority} | ${stats.total} | ${stats.covered} | ${coverage}% ${status} |\n`;
    log(`| ${priority} | ${stats.total} | ${stats.covered} | ${coverage}% ${status} |`);
  });

  reportContent += '\n';

  // 未覆盖 Story 列表
  if (uncoveredStories.length > 0) {
    log('\n🔍 未覆盖 Story 列表（需补充测试用例）:', 'cyan');
    reportContent += '## 未覆盖 Story 列表（需补充测试用例）\n\n';

    uncoveredStories.forEach(({ storyId, priority, title }) => {
      log(`❌ ${storyId}（${priority}）：${title}`, 'red');
      reportContent += `- **${storyId}**（${priority}）：${title}\n`;
      reportContent += `  - 建议: 在对应模块 QA 文档添加测试用例\n\n`;
    });
  } else {
    log('\n✅ 所有 Story 都已覆盖！', 'green');
  }

  // 孤儿测试用例
  if (orphanTestCases.length > 0) {
    log('\n🔍 孤儿测试用例（无对应 Story，建议删除或关联）:', 'cyan');
    reportContent += '## 孤儿测试用例（无对应 Story）\n\n';

    orphanTestCases.slice(0, 3).forEach(({ tcId, storyId }) => {
      log(`⚠️  ${tcId}: 引用了不存在的 Story ${storyId}`, 'yellow');
      reportContent += `- **${tcId}**: 引用了不存在的 Story \`${storyId}\`\n`;
      reportContent += `  - 建议: 删除或关联到正确的 Story\n\n`;
    });

    if (orphanTestCases.length > 3) {
      log(`   ... 还有 ${orphanTestCases.length - 3} 个孤儿测试用例`, 'yellow');
    }
  }

  // 可选保存报告（默认仅校验，不落盘）
  if (shouldWriteReports) {
    const reportDir = path.dirname(CONFIG.coverageSummaryPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    fs.writeFileSync(CONFIG.coverageSummaryPath, reportContent, 'utf-8');
  }

  return { totalCoverage, uncoveredStories, orphanTestCases };
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('测试覆盖率分析工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  // 解析 PRD 中的 Story
  const stories = parseStoriesFromPRD();

  // 解析 QA 文档中的 Test Case
  const { testCases, testCaseToStory } = parseTestCasesFromQA();

  // 解析追溯矩阵
  const storyToTestCases = parseTraceabilityMatrix();

  // 分析覆盖率
  const { moduleStats, priorityStats, uncoveredStories, orphanTestCases } = analyzeCoverage(
    stories,
    testCaseToStory,
    storyToTestCases
  );

  // 生成覆盖率报告
  const { totalCoverage, uncoveredStories: uncovered, orphanTestCases: orphans } = generateCoverageReport(
    stories,
    moduleStats,
    priorityStats,
    uncoveredStories,
    orphanTestCases
  );

  // 输出结果
  log('\n' + '='.repeat(60), 'cyan');
  log('检查结果汇总:', 'cyan');
  log('='.repeat(60), 'cyan');

  const threshold = 85;
  if (totalCoverage >= threshold) {
    log(`✅ 总体覆盖率: ${totalCoverage}% (阈值: ≥ ${threshold}%)`, 'green');
  } else {
    log(`⚠️  总体覆盖率: ${totalCoverage}% (阈值: ≥ ${threshold}%)`, 'yellow');
  }

  if (uncovered.length > 0) {
    const p1Count = uncovered.filter(s => s.priority === 'P1').length;
    log(`⚠️  发现 ${uncovered.length} 个未覆盖 Story（其中 ${p1Count} 个 P1）`, 'yellow');
  }

  if (orphans.length > 0) {
    log(`⚠️  发现 ${orphans.length} 个孤儿测试用例`, 'yellow');
  }

  if (shouldWriteReports) {
    log(`\n📝 报告已保存到: ${CONFIG.coverageSummaryPath}`, 'cyan');
  } else {
    log('\nℹ️ 未写入覆盖率报告（只校验模式，设置 QA_WRITE_REPORTS=1 可写入）', 'yellow');
  }

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

module.exports = { parseStoriesFromPRD, parseTestCasesFromQA, analyzeCoverage };

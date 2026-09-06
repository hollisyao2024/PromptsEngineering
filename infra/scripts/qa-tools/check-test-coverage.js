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
const {
  STORY_ID_SOURCE,
  TEST_CASE_ID_SOURCE,
  exactPattern,
  extractIds,
  markdownCells,
} = require('../shared/governance-ids');
const shouldWriteReports = process.env.QA_WRITE_REPORTS === '1';

// 配置
const CONFIG = {
  prdPath: path.join(__dirname, '../../../docs/PRD.md'),
  prdModulesDir: path.join(__dirname, '../../../docs/prd-modules'),
  qaPath: path.join(__dirname, '../../../docs/QA.md'),
  qaModulesDir: path.join(__dirname, '../../../docs/qa-modules'),
  traceabilityMatrixPath: path.join(__dirname, '../../../docs/data/traceability-matrix.md'),
  coverageSummaryPath: path.join(__dirname, '../../../docs/data/qa-reports/coverage-summary.md'),
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

function stripMarkdown(value) {
  return String(value).trim().replace(/^(`|\*\*|__)+|(`|\*\*|__)+$/g, '').trim();
}

function contentStoryDefinitions(content, moduleName) {
  const stories = new Map();
  const exactStory = exactPattern(STORY_ID_SOURCE);
  const headingPattern = new RegExp(
    `^(#{2,6})\\s+(${STORY_ID_SOURCE})(?=[:：\\s])([^\\n]*)`,
  );
  let active = null;

  for (const line of String(content).split(/\r?\n/)) {
    const storyHeading = line.match(headingPattern);
    const heading = line.match(/^(#{1,6})\s+/);
    if (storyHeading) {
      active = {
        id: storyHeading[2],
        level: storyHeading[1].length,
      };
      stories.set(active.id, {
        module: moduleName,
        priority: 'P2',
        title: storyHeading[3].replace(/^\s*[:：]\s*/, '').trim(),
      });
      continue;
    }
    if (heading && active && heading[1].length <= active.level) active = null;
    if (active) {
      const priority = line.match(/\*\*优先级(?:[：:]\*\*|\*\*[：:])\s*(P[0-2])/);
      if (priority) stories.get(active.id).priority = priority[1];
    }

    const cells = markdownCells(line);
    if (cells.length === 0) continue;
    const storyId = stripMarkdown(cells[0]);
    if (!exactStory.test(storyId)) continue;
    const priorityCell = cells.map(stripMarkdown).find((cell) => /^P[0-2]$/.test(cell));
    if (!stories.has(storyId)) {
      stories.set(storyId, {
        module: moduleName,
        priority: priorityCell || 'P2',
        title: '',
      });
    } else if (priorityCell && stories.get(storyId).priority === 'P2') {
      stories.get(storyId).priority = priorityCell;
    }
  }
  return stories;
}

function mergeStoryDefinitions(target, source) {
  for (const [storyId, info] of source) {
    const previous = target.get(storyId);
    if (!previous || (previous.module === 'main' && info.module !== 'main')) {
      target.set(storyId, info);
    }
  }
}

function moduleFiles(directory, filename) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => ({
      module: entry.name,
      filePath: path.join(directory, entry.name, filename),
    }))
    .filter(({ filePath }) => fs.existsSync(filePath));
}

// 解析 PRD 中的 Story ID
function parseStoriesFromPRD(config = CONFIG) {
  log('\n📖 解析 PRD 中的 Story ID...', 'cyan');

  const stories = new Map(); // story_id => { module, priority, title }

  // 解析主 PRD
  if (fs.existsSync(config.prdPath)) {
    const prdContent = fs.readFileSync(config.prdPath, 'utf-8');
    mergeStoryDefinitions(stories, contentStoryDefinitions(prdContent, 'main'));
  }

  // 解析模块 PRD
  for (const entry of moduleFiles(config.prdModulesDir, 'PRD.md')) {
    mergeStoryDefinitions(
      stories,
      contentStoryDefinitions(fs.readFileSync(entry.filePath, 'utf8'), entry.module),
    );
  }

  log(`✅ 找到 ${stories.size} 个用户故事`, 'green');
  return stories;
}

// 解析 QA 文档中的 Test Case ID 及其关联的 Story
function parseTestCasesFromQA(config = CONFIG) {
  log('\n📖 解析 QA 文档中的 Test Case ID...', 'cyan');

  const testCases = new Map(); // tc_id => { story_id, module }
  const testCaseToStory = new Map(); // tc_id => story_id

  const qaFiles = [];
  if (fs.existsSync(config.qaPath)) qaFiles.push({ module: 'main', filePath: config.qaPath });
  qaFiles.push(...moduleFiles(config.qaModulesDir, 'QA.md'));
  for (const { module: moduleName, filePath } of qaFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const cells = markdownCells(line);
      if (cells.length === 0) continue;
      const tcId = extractIds(line, TEST_CASE_ID_SOURCE)[0];
      const storyId = extractIds(line, STORY_ID_SOURCE)[0];
      if (!tcId) continue;
      testCases.set(tcId, { story_id: storyId || null, module: moduleName });
      if (storyId) testCaseToStory.set(tcId, storyId);
    }
  }

  log(`✅ 找到 ${testCases.size} 个测试用例`, 'green');
  return { testCases, testCaseToStory };
}

// 解析追溯矩阵
function parseTraceabilityMatrix(config = CONFIG) {
  log('\n📖 解析追溯矩阵...', 'cyan');

  if (!fs.existsSync(config.traceabilityMatrixPath)) {
    log('⚠️  追溯矩阵不存在，跳过', 'yellow');
    return new Map();
  }

  log(`✅ 追溯矩阵存在: ${config.traceabilityMatrixPath}`);

  const matrixContent = fs.readFileSync(config.traceabilityMatrixPath, 'utf-8');
  const storyToTestCases = new Map(); // story_id => [tc_ids]

  // 解析表格行（简化处理）
  const lines = matrixContent.split('\n');
  lines.forEach(line => {
    const storyIds = extractIds(line, STORY_ID_SOURCE);
    let tcIds = extractIds(line, TEST_CASE_ID_SOURCE);
    if (tcIds.length === 0) {
      tcIds = line.match(/TC-[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d{3}(?:-[A-Z][A-Z0-9]*)*/g) || [];
    }

    if (storyIds.length > 0 && tcIds.length > 0) {
      for (const storyId of storyIds) {
        if (!storyToTestCases.has(storyId)) {
          storyToTestCases.set(storyId, []);
        }
        for (const tcId of tcIds) {
          if (!storyToTestCases.get(storyId).includes(tcId)) {
            storyToTestCases.get(storyId).push(tcId);
          }
        }
      }
    }
  });

  log(`📊 映射关系数: ${storyToTestCases.size} 个 Story → ${Array.from(storyToTestCases.values()).flat().length} 个 Test Case`);

  return storyToTestCases;
}

function coverageExitCode(totalCoverage, threshold) {
  return totalCoverage >= threshold ? 0 : 1;
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

  return coverageExitCode(totalCoverage, threshold)
    || (stories.size === 0 || uncovered.length > 0 || orphans.length > 0 ? 1 : 0);
}

// 运行
if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    log(`\n❌ 执行出错: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

module.exports = {
  analyzeCoverage,
  coverageExitCode,
  parseStoriesFromPRD,
  parseTestCasesFromQA,
  parseTraceabilityMatrix,
};

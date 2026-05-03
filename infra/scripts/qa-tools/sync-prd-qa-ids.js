#!/usr/bin/env node

/**
 * PRD ↔ QA ID 同步验证脚本
 *
 * 验证 QA 文档中引用的 Story ID 是否在 PRD 中存在，
 * 以及 PRD 中的 Story 是否都有对应测试用例。
 *
 * 检查项：
 * - 解析 PRD 中的所有 Story ID
 * - 解析 QA 文档中引用的所有 Story ID
 * - 验证 Story ID 有效性（QA 引用的 Story 是否存在）
 * - 检测孤儿 Story（PRD 有但 QA 未测试）
 * - 检测孤儿测试用例（QA 引用的 Story 不存在）
 * - 检查 AC 覆盖率
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  prdPath: path.join(__dirname, '../../../docs/PRD.md'),
  prdModulesDir: path.join(__dirname, '../../../docs/prd-modules'),
  qaPath: path.join(__dirname, '../../../docs/QA.md'),
  qaModulesDir: path.join(__dirname, '../../../docs/qa-modules'),
  traceabilityMatrixPath: path.join(__dirname, '../../../docs/data/traceability-matrix.md'),
};

// Story ID 格式正则（US-MODULE-NNN）。MODULE 槽位允许字母数字混排
// （如 E2E / V3 / K8S），与 qa-verify.js 已采用的 [A-Z0-9]+ 保持一致。
const STORY_ID_PATTERN = /US-[A-Z0-9]+-\d{3}/g;

// AC ID 格式正则（AC-MODULE-NNN-NN）
const AC_ID_PATTERN = /AC-[A-Z0-9]+-\d{3}-\d{2}/g;

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

// 解析 PRD 中的 Story ID 和 AC
function parseStoriesAndACsFromPRD() {
  log('\n📖 解析 PRD 中的 Story ID...', 'cyan');

  const stories = new Map(); // story_id => { module, priority, acs: [] }

  // 解析主 PRD
  if (fs.existsSync(CONFIG.prdPath)) {
    const prdContent = fs.readFileSync(CONFIG.prdPath, 'utf-8');
    const matches = prdContent.match(STORY_ID_PATTERN) || [];
    matches.forEach(id => {
      if (!stories.has(id)) {
        stories.set(id, { module: 'main', priority: 'P2', acs: [] });
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

        // 查找所有 Story ID 及其优先级。模块 PRD 存在表格行、标题行、
        // traceability 行等多种格式，不能只匹配旧的 `US-XXX-001:`。
        const storyMatches = Array.from(prdContent.matchAll(STORY_ID_PATTERN));
        storyMatches.forEach((storyMatch, index) => {
          const storyId = storyMatch[0];

          // 尝试提取优先级
          const storyIndex = storyMatch.index ?? 0;
          const nextStoryIndex = storyMatches[index + 1]?.index ?? prdContent.length;
          const storyContent = prdContent.substring(
            storyIndex,
            nextStoryIndex
          );

          const priorityMatch = storyContent.match(/\*\*优先级[：:]\*\*\s*(P[0-2])/);
          const priority = priorityMatch ? priorityMatch[1] : 'P2';

          // 提取该 Story 的所有 AC
          const acMatches = storyContent.match(AC_ID_PATTERN) || [];
          const acs = [...new Set(acMatches)]; // 去重

          const previous = stories.get(storyId);
          if (previous) {
            stories.set(storyId, {
              module: previous.module,
              priority: previous.priority !== 'P2' ? previous.priority : priority,
              acs: [...new Set([...previous.acs, ...acs])],
            });
            return;
          }

          stories.set(storyId, { module: dir.name, priority, acs });
        });
      }
    });
  }

  log(`✅ 找到 ${stories.size} 个用户故事`);

  // 统计按模块分布
  const moduleCount = new Map();
  stories.forEach(({ module }) => {
    moduleCount.set(module, (moduleCount.get(module) || 0) + 1);
  });

  moduleCount.forEach((count, module) => {
    log(`   - ${module}: ${count} 个`);
  });

  return stories;
}

// 解析 QA 文档中引用的 Story ID
function parseStoryRefsFromQA() {
  log('\n📖 解析 QA 文档中引用的 Story ID...', 'cyan');

  const storyRefs = new Set();

  // 解析主 QA
  if (fs.existsSync(CONFIG.qaPath)) {
    const qaContent = fs.readFileSync(CONFIG.qaPath, 'utf-8');
    const matches = qaContent.match(STORY_ID_PATTERN) || [];
    matches.forEach(id => storyRefs.add(id));
  }

  // 解析模块 QA
  if (fs.existsSync(CONFIG.qaModulesDir)) {
    const entries = fs.readdirSync(CONFIG.qaModulesDir, { withFileTypes: true });
    const moduleDirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));

    moduleDirs.forEach(dir => {
      const qaFilePath = path.join(CONFIG.qaModulesDir, dir.name, 'QA.md');
      if (fs.existsSync(qaFilePath)) {
        const qaContent = fs.readFileSync(qaFilePath, 'utf-8');
        const matches = qaContent.match(STORY_ID_PATTERN) || [];
        matches.forEach(id => storyRefs.add(id));
      }
    });
  }

  // 解析追溯矩阵
  if (fs.existsSync(CONFIG.traceabilityMatrixPath)) {
    const matrixContent = fs.readFileSync(CONFIG.traceabilityMatrixPath, 'utf-8');
    const matches = matrixContent.match(STORY_ID_PATTERN) || [];
    matches.forEach(id => storyRefs.add(id));
  }

  log(`✅ 找到 ${storyRefs.size} 个被测试的 Story`);

  return storyRefs;
}

// 验证 Story ID 有效性
function validateStoryIds(stories, storyRefs) {
  log('\n🔍 验证 Story ID 有效性...', 'cyan');

  const invalidRefs = [];

  storyRefs.forEach(storyId => {
    if (!stories.has(storyId)) {
      invalidRefs.push(storyId);
    }
  });

  if (invalidRefs.length === 0) {
    log('✅ 所有 QA 文档中引用的 Story ID 都在 PRD 中存在', 'green');
    return true;
  } else {
    log(`❌ 发现 ${invalidRefs.length} 个无效的 Story ID:`, 'red');
    invalidRefs.forEach(id => {
      log(`   - ${id} (PRD 中不存在)`, 'yellow');
    });
    return false;
  }
}

// 检测孤儿 Story（PRD 有但 QA 未测试）
function findOrphanStories(stories, storyRefs) {
  log('\n🔍 检测孤儿 Story（PRD 有但 QA 未测试）...', 'cyan');

  const orphanStories = [];

  stories.forEach((info, storyId) => {
    if (!storyRefs.has(storyId)) {
      orphanStories.push({ storyId, ...info });
    }
  });

  if (orphanStories.length === 0) {
    log('✅ 所有 Story 都有对应的测试用例', 'green');
    return orphanStories;
  }

  log(`⚠️  发现 ${orphanStories.length} 个孤儿 Story:`, 'yellow');

  // 按优先级分组显示
  ['P0', 'P1', 'P2'].forEach(priority => {
    const storiesOfPriority = orphanStories.filter(s => s.priority === priority);
    if (storiesOfPriority.length > 0) {
      log(`\n   ${priority} (${storiesOfPriority.length} 个):`, priority === 'P0' ? 'red' : 'yellow');
      storiesOfPriority.slice(0, 3).forEach(({ storyId, module }) => {
        const prdFile = module === 'main' ? 'PRD.md' : `prd-modules/${module}/PRD.md`;
        log(`   - ${storyId}（${priority}）`);
        log(`     PRD: docs/${prdFile}`);
        log(`     建议: 在 docs/qa-modules/${module}/QA.md 添加测试用例`);
      });
      if (storiesOfPriority.length > 3) {
        log(`     ... 还有 ${storiesOfPriority.length - 3} 个 ${priority} Story`, 'yellow');
      }
    }
  });

  return orphanStories;
}

// 检查 AC 覆盖率
function checkACCoverage(stories) {
  log('\n🔍 检查 AC 覆盖率...', 'cyan');

  log('📊 解析所有 Story 的验收标准（AC）...');

  // 统计所有 AC
  let totalACs = 0;
  stories.forEach(({ acs }) => {
    totalACs += acs.length;
  });

  log(`✅ 找到 ${totalACs} 个验收标准（AC）`);

  // 解析追溯矩阵中的 AC
  let testedACs = new Set();
  if (fs.existsSync(CONFIG.traceabilityMatrixPath)) {
    const matrixContent = fs.readFileSync(CONFIG.traceabilityMatrixPath, 'utf-8');
    const acMatches = matrixContent.match(AC_ID_PATTERN) || [];
    acMatches.forEach(ac => testedACs.add(ac));
  }

  // 按模块统计 AC 覆盖率
  const moduleACStats = new Map();
  const untestedACs = [];

  stories.forEach((info, storyId) => {
    const { module, acs } = info;

    if (!moduleACStats.has(module)) {
      moduleACStats.set(module, { total: 0, tested: 0 });
    }

    acs.forEach(ac => {
      moduleACStats.get(module).total++;

      if (testedACs.has(ac)) {
        moduleACStats.get(module).tested++;
      } else {
        untestedACs.push({ ac, storyId, module });
      }
    });
  });

  // 输出 AC 覆盖率统计
  log('\n📊 AC 覆盖率统计:');
  log('| 模块 | 总 AC 数 | 已测试 AC | 覆盖率 |');
  log('|------|---------|----------|--------|');

  let grandTotalACs = 0;
  let grandTestedACs = 0;

  moduleACStats.forEach((stats, module) => {
    const coverage = stats.total > 0 ? Math.round((stats.tested / stats.total) * 100) : 0;
    const status = coverage === 100 ? '✅' : coverage >= 90 ? '⚠️' : '';
    log(`| ${module} | ${stats.total} | ${stats.tested} | ${coverage}% ${status} |`);

    grandTotalACs += stats.total;
    grandTestedACs += stats.tested;
  });

  const totalCoverage = grandTotalACs > 0 ? Math.round((grandTestedACs / grandTotalACs) * 100) : 0;
  log(`| **总计** | **${grandTotalACs}** | **${grandTestedACs}** | **${totalCoverage}%** |`);

  // 显示未测试的 AC
  if (untestedACs.length > 0) {
    log(`\n⚠️  未测试的 AC（共 ${untestedACs.length} 个）:`, 'yellow');
    untestedACs.slice(0, 7).forEach(({ ac, storyId, module }) => {
      log(`   - ${ac}: 关联 Story ${storyId}（${module}）`);
    });
    if (untestedACs.length > 7) {
      log(`   ... 还有 ${untestedACs.length - 7} 个未测试的 AC`, 'yellow');
    }
  } else {
    log('\n✅ 所有 AC 都已测试！', 'green');
  }

  return { totalCoverage, untestedACs };
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('PRD ↔ QA ID 同步验证工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  // 解析 PRD 中的 Story 和 AC
  const stories = parseStoriesAndACsFromPRD();

  // 解析 QA 文档中引用的 Story
  const storyRefs = parseStoryRefsFromQA();

  // 验证 Story ID 有效性
  const allValid = validateStoryIds(stories, storyRefs);

  // 检测孤儿 Story
  const orphanStories = findOrphanStories(stories, storyRefs);

  // 检查 AC 覆盖率
  const { totalCoverage, untestedACs } = checkACCoverage(stories);

  // 输出结果
  log('\n' + '='.repeat(60), 'cyan');
  log('检查结果汇总:', 'cyan');
  log('='.repeat(60), 'cyan');

  if (!allValid) {
    log('❌ 发现无效的 Story ID 引用', 'red');
  }

  if (orphanStories.length > 0) {
    const p1Count = orphanStories.filter(s => s.priority === 'P1').length;
    log(`⚠️  发现 ${orphanStories.length} 个孤儿 Story（其中 ${p1Count} 个 P1）`, 'yellow');
  } else {
    log('✅ 所有 Story 都有对应的测试用例', 'green');
  }

  if (untestedACs.length > 0) {
    log(`⚠️  发现 ${untestedACs.length} 个未测试的 AC`, 'yellow');
  } else {
    log('✅ 所有 AC 都已测试', 'green');
  }

  log(`\n📊 AC 覆盖率: ${totalCoverage}%`, totalCoverage >= 95 ? 'green' : 'yellow');

  log('\n💡 建议:', 'cyan');
  if (orphanStories.filter(s => s.priority === 'P1').length > 0) {
    log('   1. 优先补充 P1 Story 的测试用例', 'yellow');
  }
  if (untestedACs.length > 0) {
    log('   2. 确保所有 AC 都有对应的测试步骤', 'yellow');
  }
  log('   3. 定期运行此脚本，保持 PRD ↔ QA 同步');

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

module.exports = { parseStoriesAndACsFromPRD, parseStoryRefsFromQA, validateStoryIds };

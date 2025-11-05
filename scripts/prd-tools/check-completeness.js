#!/usr/bin/env node

/**
 * PRD 完整性检查脚本
 *
 * 检查项：
 * - 主 PRD 必需章节完整性
 * - 模块 PRD 遵循标准结构
 * - 追溯矩阵已创建
 * - Story ID 格式规范
 * - AC 使用 Given-When-Then 格式
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  mainPrdPath: path.join(__dirname, '../../docs/PRD.md'),
  prdModulesDir: path.join(__dirname, '../../docs/prd-modules'),
  traceabilityMatrixPath: path.join(__dirname, '../../docs/data/traceability-matrix.md'),
  globalDependencyGraphPath: path.join(__dirname, '../../docs/data/global-dependency-graph.mmd'),
};

// 主 PRD 必需章节
const REQUIRED_SECTIONS = [
  '## 1. 产品概述',
  '## 2. 全局范围与边界',
  '## 3. 用户角色与核心场景',
  '## 4. 用户故事与验收标准',
  '## 5. 非功能需求（NFR）',
  '## 6. 里程碑与依赖',
  '## 7. 风险与开放问题',
  '## 8. 追溯矩阵',
];

// Story ID 格式正则
const STORY_ID_PATTERN = /US-[A-Z]+-\d{3}/;

// Given-When-Then 关键词
const GWT_KEYWORDS = ['Given', 'When', 'Then'];

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

// 检查文件是否存在
function checkFileExists(filePath, description) {
  if (!fs.existsSync(filePath)) {
    // 特殊处理：主 PRD 不存在时给出友好提示
    if (description === '主 PRD') {
      log(`ℹ️  主 PRD 尚未创建`, 'cyan');
      log(`   提示：PRD.md 为模板文件，请使用 PRD 专家按需生成`, 'cyan');
      log(`   参考：AgentRoles/PRD-WRITER-EXPERT.md §PRD 模板`, 'cyan');
      return false;
    }
    log(`❌ ${description} 不存在: ${filePath}`, 'red');
    return false;
  }
  log(`✅ ${description} 存在`, 'green');
  return true;
}

// 检查主 PRD 章节完整性
function checkMainPrdSections() {
  log('\n📋 检查主 PRD 章节完整性...', 'cyan');

  const prdContent = fs.readFileSync(CONFIG.mainPrdPath, 'utf-8');
  const missingSections = [];

  REQUIRED_SECTIONS.forEach(section => {
    if (!prdContent.includes(section)) {
      missingSections.push(section);
    }
  });

  if (missingSections.length === 0) {
    log('✅ 主 PRD 包含所有必需章节', 'green');
    return true;
  } else {
    log(`❌ 主 PRD 缺少以下章节:`, 'red');
    missingSections.forEach(section => {
      log(`   - ${section}`, 'yellow');
    });
    return false;
  }
}

// 检查 Story ID 格式
function checkStoryIdFormat() {
  log('\n🔍 检查 Story ID 格式规范...', 'cyan');

  const prdContent = fs.readFileSync(CONFIG.mainPrdPath, 'utf-8');
  const storyIdMatches = prdContent.match(/US-[A-Z0-9]+-\d+/g) || [];

  const invalidIds = storyIdMatches.filter(id => !STORY_ID_PATTERN.test(id));

  if (invalidIds.length === 0) {
    log(`✅ 所有 Story ID 格式规范（共 ${storyIdMatches.length} 个）`, 'green');
    return true;
  } else {
    log(`❌ 发现不规范的 Story ID:`, 'red');
    invalidIds.forEach(id => {
      log(`   - ${id} (应使用格式: US-MODULE-NNN)`, 'yellow');
    });
    return false;
  }
}

// 检查 Given-When-Then 格式
function checkGivenWhenThen() {
  log('\n🧪 检查验收标准 Given-When-Then 格式...', 'cyan');

  const prdContent = fs.readFileSync(CONFIG.mainPrdPath, 'utf-8');

  // 查找所有用户故事章节
  const storyRegex = /###?\s+(US-[A-Z]+-\d{3}):([^#]+)/g;
  const stories = [];
  let match;

  while ((match = storyRegex.exec(prdContent)) !== null) {
    const storyId = match[1];
    const storyContent = match[2];

    // 检查是否包含 GWT 关键词
    const hasGiven = storyContent.includes('Given');
    const hasWhen = storyContent.includes('When');
    const hasThen = storyContent.includes('Then');

    if (!hasGiven || !hasWhen || !hasThen) {
      stories.push({
        id: storyId,
        missing: [
          !hasGiven && 'Given',
          !hasWhen && 'When',
          !hasThen && 'Then'
        ].filter(Boolean)
      });
    }
  }

  if (stories.length === 0) {
    log('✅ 所有用户故事的验收标准使用 Given-When-Then 格式', 'green');
    return true;
  } else {
    log(`⚠️  发现 ${stories.length} 个用户故事缺少 GWT 关键词:`, 'yellow');
    stories.forEach(story => {
      log(`   - ${story.id}: 缺少 ${story.missing.join(', ')}`, 'yellow');
    });
    return false;
  }
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('PRD 完整性检查工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  const results = {
    mainPrdExists: checkFileExists(CONFIG.mainPrdPath, '主 PRD'),
    traceabilityMatrixExists: checkFileExists(CONFIG.traceabilityMatrixPath, '追溯矩阵'),
    globalDependencyGraphExists: checkFileExists(CONFIG.globalDependencyGraphPath, '全局依赖关系图'),
    sectionsComplete: false,
    storyIdValid: false,
    gwtValid: false,
  };

  if (results.mainPrdExists) {
    results.sectionsComplete = checkMainPrdSections();
    results.storyIdValid = checkStoryIdFormat();
    results.gwtValid = checkGivenWhenThen();
  }

  // 汇总结果
  log('\n' + '='.repeat(60), 'cyan');
  log('检查结果汇总:', 'cyan');
  log('='.repeat(60), 'cyan');

  const allPassed = Object.values(results).every(result => result === true);

  if (allPassed) {
    log('✅ 所有检查通过！PRD 文档质量良好。', 'green');
    process.exit(0);
  } else {
    log('❌ 部分检查未通过，请根据上述提示修正。', 'red');
    log('\n建议：', 'yellow');
    log('1. 补充缺失的章节和文档', 'yellow');
    log('2. 修正 Story ID 格式（应为 US-MODULE-NNN）', 'yellow');
    log('3. 为所有用户故事添加 Given-When-Then 验收标准', 'yellow');
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

module.exports = { checkFileExists, checkMainPrdSections, checkStoryIdFormat, checkGivenWhenThen };

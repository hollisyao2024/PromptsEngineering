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
  mainPrdPath: path.join(__dirname, '../../../docs/PRD.md'),
  prdModulesDir: path.join(__dirname, '../../../docs/prd-modules'),
  moduleListPath: path.join(__dirname, '../../../docs/prd-modules/module-list.md'),
  traceabilityMatrixPath: path.join(__dirname, '../../../docs/data/traceability-matrix.md'),
  globalDependencyGraphPath: path.join(__dirname, '../../../docs/data/global-dependency-graph.md'),
  moduleTemplatePath: path.join(__dirname, '../../../docs/prd-modules/MODULE-TEMPLATE.md'),
};

// 主 PRD 必需章节（与 docs/data/templates/prd/PRD-TEMPLATE-*.md 保持一致）
const MAIN_SECTION_PATTERNS = [
  { label: '## 1.', pattern: /^##\s*1\./m },
  { label: '## 2.', pattern: /^##\s*2\./m },
  { label: '## 3.', pattern: /^##\s*3\./m },
  { label: '## 4.', pattern: /^##\s*4\./m },
  { label: '## 5.', pattern: /^##\s*5\./m },
  { label: '## 6.', pattern: /^##\s*6\./m },
  { label: '## 7.', pattern: /^##\s*7\./m },
  { label: '## 8.', pattern: /^##\s*8\./m },
  { label: '## 9.', pattern: /^##\s*9\./m },
];

const MODULE_SECTION_PATTERNS = [
  { label: '## 1. 模块概述', pattern: /^##\s*1\.\s*模块概述/m },
  { label: '## 2. 范围与约束', pattern: /^##\s*2\.\s*(范围与约束|用户故事)/m },
  { label: '## 3. 用户故事与验收', pattern: /^##\s*3\.\s*(用户故事|模块级非功能需求)/m },
  { label: '## 4. 非功能需求', pattern: /^##\s*4\.\s*(非功能需求|接口与依赖|依赖与接口)/m },
  { label: '## 5. 依赖与风险', pattern: /^##\s*5\.\s*(依赖与风险|数据模型)/m },
  { label: '## 6. 里程碑与 Gate', pattern: /^##\s*6\.\s*(里程碑|风险与约束)/m },
  { label: '## 7. 追溯矩阵与验证', pattern: /^##\s*7\.\s*(追溯矩阵|模块版本与变更记录|附录)/m },
];

// Story ID 格式正则
const MODULE_ID_SOURCE = '[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*';
const STORY_ID_SOURCE = `US-${MODULE_ID_SOURCE}-\\d{3}`;
const STORY_ID_PATTERN = new RegExp(`^${STORY_ID_SOURCE}$`);
const STORY_ID_SEARCH_PATTERN = new RegExp(`${STORY_ID_SOURCE}(?!\\d)`, 'g');

function isValidStoryId(id) {
  return STORY_ID_PATTERN.test(id);
}

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
      log(`   参考：docs/data/templates/prd/PRD-TEMPLATE.md`, 'cyan');
      return false;
    }
    log(`❌ ${description} 不存在: ${filePath}`, 'red');
    return false;
  }
  log(`✅ ${description} 存在`, 'green');
  return true;
}

function getModulePrdPaths() {
  if (!fs.existsSync(CONFIG.prdModulesDir)) return [];
  return fs.readdirSync(CONFIG.prdModulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(CONFIG.prdModulesDir, entry.name, 'PRD.md'))
    .filter((filePath) => fs.existsSync(filePath));
}

// 检查主 PRD 章节完整性
function checkMainPrdSections() {
  log('\n📋 检查主 PRD 章节完整性...', 'cyan');

  const prdContent = fs.readFileSync(CONFIG.mainPrdPath, 'utf-8');
  const missingSections = [];
  log('ℹ️  主 PRD 类型：模块化总纲与索引', 'cyan');

  const requiredPatterns = [...MAIN_SECTION_PATTERNS, {
    label: '模块导航或功能域索引',
    pattern: /^##\s*(?:\d+\.\s*)?(?:文档导航|功能域索引)/m,
  }];

  requiredPatterns.forEach(entry => {
    if (!entry.pattern.test(prdContent)) {
      missingSections.push(entry.label);
    }
  });

  if (missingSections.length === 0) {
    log('✅ 主 PRD 包含所有必需章节', 'green');
    return true;
  }

  log(`❌ 主 PRD 缺少以下章节:`, 'red');
  missingSections.forEach(section => {
    log(`   - ${section}`, 'yellow');
  });
  return false;
}

function checkModuleTemplateReference() {
  return checkFileExists(CONFIG.moduleTemplatePath, '模块 PRD 模板');
}

function checkSingleModuleStructure(moduleName, modulePrdPath) {
  const content = fs.readFileSync(modulePrdPath, 'utf-8');
  const missing = MODULE_SECTION_PATTERNS.filter(entry => !entry.pattern.test(content));

  if (missing.length === 0) {
    log(`✅ ${moduleName} 模块 PRD 含有全部标准章节`, 'green');
    return true;
  }

  log(`⚠️  ${moduleName} 模块 PRD 缺少章节:`, 'yellow');
  missing.forEach(entry => log(`   - ${entry.label}`, 'yellow'));
  log(`   参考：${CONFIG.moduleTemplatePath}`, 'cyan');
  return false;
}

function inspectModuleLayout(modulesDir, moduleListPath) {
  if (!fs.existsSync(modulesDir)) return { valid: false, reason: 'modules directory missing', moduleDirs: [] };
  if (!fs.existsSync(moduleListPath)) return { valid: false, reason: 'module-list.md missing', moduleDirs: [] };
  const moduleDirs = fs.readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(modulesDir, entry.name, 'PRD.md')))
    .map((entry) => entry.name)
    .sort();
  if (moduleDirs.length === 0) return { valid: false, reason: 'no canonical module documents', moduleDirs };
  return { valid: true, reason: '', moduleDirs };
}

function checkModuleStructures() {
  log('\n🏗️  检查模块 PRD 结构（参照 MODULE-TEMPLATE）...', 'cyan');

  const layout = inspectModuleLayout(CONFIG.prdModulesDir, CONFIG.moduleListPath);
  if (!layout.valid) {
    log(`❌ PRD 模块结构无效：${layout.reason}`, 'red');
    return false;
  }

  let allPassing = true;

  layout.moduleDirs.forEach(moduleName => {
    const modulePrdPath = path.join(CONFIG.prdModulesDir, moduleName, 'PRD.md');

    if (!fs.existsSync(modulePrdPath)) {
      log(`⚠️  ${moduleName} 缺少 PRD.md，无法校验章节，建议创建 ${modulePrdPath}`, 'yellow');
      allPassing = false;
      return;
    }

    const passed = checkSingleModuleStructure(moduleName, modulePrdPath);
    if (!passed) {
      allPassing = false;
    }
  });

  return allPassing;
}

// 检查 Story ID 格式
function checkStoryIdFormat() {
  log('\n🔍 检查 Story ID 格式规范...', 'cyan');

  const prdContent = getModulePrdPaths().map((filePath) => fs.readFileSync(filePath, 'utf-8')).join('\n');
  const storyIdMatches = prdContent.match(STORY_ID_SEARCH_PATTERN) || [];

  const invalidIds = storyIdMatches.filter(id => !isValidStoryId(id));

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
function findStoriesMissingGwt(prdContent) {
  const storyHeadingPattern = new RegExp(
    `^#{2,3}\\s+(${STORY_ID_SOURCE}):[^\\n]*(?:\\n|$)`,
    'gm'
  );
  const headings = Array.from(prdContent.matchAll(storyHeadingPattern));

  return headings.flatMap((heading, index) => {
    const storyContentStart = heading.index + heading[0].length;
    const storyContentEnd = headings[index + 1]?.index ?? prdContent.length;
    const storyContent = prdContent.slice(storyContentStart, storyContentEnd);
    const missing = GWT_KEYWORDS.filter((keyword) => !storyContent.includes(keyword));
    return missing.length > 0 ? [{ id: heading[1], missing }] : [];
  });
}

function checkGivenWhenThen() {
  log('\n🧪 检查验收标准 Given-When-Then 格式...', 'cyan');

  const prdContent = getModulePrdPaths().map((filePath) => fs.readFileSync(filePath, 'utf-8')).join('\n');
  const stories = findStoriesMissingGwt(prdContent);

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

  const moduleTemplateExists = checkModuleTemplateReference();

  const results = {
    mainPrdExists: checkFileExists(CONFIG.mainPrdPath, '主 PRD'),
    traceabilityMatrixExists: checkFileExists(CONFIG.traceabilityMatrixPath, '追溯矩阵'),
    globalDependencyGraphExists: checkFileExists(CONFIG.globalDependencyGraphPath, '全局依赖关系图'),
    moduleTemplateExists,
    sectionsComplete: false,
    storyIdValid: false,
    gwtValid: false,
    moduleStructureComplete: false,
  };

  if (results.mainPrdExists) {
    results.sectionsComplete = checkMainPrdSections();
    results.storyIdValid = checkStoryIdFormat();
    results.gwtValid = checkGivenWhenThen();
  }

  results.moduleStructureComplete = checkModuleStructures();

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

module.exports = {
  checkFileExists,
  checkGivenWhenThen,
  checkMainPrdSections,
  checkStoryIdFormat,
  findStoriesMissingGwt,
  isValidStoryId,
  inspectModuleLayout,
};

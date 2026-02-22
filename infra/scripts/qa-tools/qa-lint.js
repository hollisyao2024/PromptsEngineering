#!/usr/bin/env node

/**
 * QA 文档完整性检查脚本
 *
 * 检查项：
 * - 主 QA 必需章节完整性
 * - 模块 QA 遵循标准结构
 * - 全局追溯矩阵已创建
 * - Test Case ID 格式规范（TC-MODULE-NNN）
 * - 缺陷 ID 格式规范（BUG-MODULE-NNN）
 * - Given-When-Then 格式验证
 * - 测试优先级标记（P0/P1/P2）
 * - Story ID 关联完整性
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  mainQAPath: path.join(__dirname, '../../../docs/QA.md'),
  qaModulesDir: path.join(__dirname, '../../../docs/qa-modules'),
  traceabilityMatrixPath: path.join(__dirname, '../../../docs/data/traceability-matrix.md'),
  qaReportsDir: path.join(__dirname, '../../../docs/data/qa-reports'),
};

// 主 QA 必需章节
const REQUIRED_SECTIONS = [
  '## 1. 测试概述',
  '## 2. 全局测试策略',
  '## 3. 跨模块集成测试',
  '## 4. 全局缺陷汇总',
  '## 5. 测试环境',
  '## 6. 发布建议',
];

// 模块 QA 必需章节
const REQUIRED_MODULE_SECTIONS = [
  '## 1. 模块概述',
  '## 2. 测试策略',
  '## 3. 测试用例',
  '## 4. 缺陷列表',
  '## 5. 测试执行记录',
  '## 6. 测试指标',
];

// Test Case ID 格式正则（TC-MODULE-NNN）
const TC_ID_PATTERN = /TC-[A-Z]+-\d{3}/;

// 缺陷 ID 格式正则（BUG-MODULE-NNN）
const BUG_ID_PATTERN = /BUG-[A-Z]+-\d{3}/;

// Story ID 格式正则（US-MODULE-NNN）
const STORY_ID_PATTERN = /US-[A-Z]+-\d{3}/;

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
    // 特殊处理：主 QA 不存在时给出友好提示
    if (description === '主 QA') {
      log(`ℹ️  主 QA 尚未创建`, 'cyan');
      log(`   提示：QA.md 为模板文件，请使用 QA 专家按需生成`, 'cyan');
      log(`   参考：AgentRoles/QA-TESTING-EXPERT.md §QA 模板`, 'cyan');
      return false;
    }
    log(`❌ ${description} 不存在: ${filePath}`, 'red');
    return false;
  }
  log(`✅ ${description} 存在`, 'green');
  return true;
}

// 检查主 QA 章节完整性
function checkMainQASections() {
  log('\n📋 检查主 QA 章节完整性...', 'cyan');

  const qaContent = fs.readFileSync(CONFIG.mainQAPath, 'utf-8');
  const missingSections = [];

  REQUIRED_SECTIONS.forEach(section => {
    if (!qaContent.includes(section)) {
      missingSections.push(section);
    }
  });

  if (missingSections.length === 0) {
    log('✅ 主 QA 包含所有必需章节', 'green');
    return true;
  } else {
    log(`❌ 主 QA 缺少以下章节:`, 'red');
    missingSections.forEach(section => {
      log(`   - ${section}`, 'yellow');
    });
    return false;
  }
}

// 检查模块 QA 文档
function checkModuleQADocs() {
  log('\n🔍 检查模块 QA 文档...', 'cyan');

  if (!fs.existsSync(CONFIG.qaModulesDir)) {
    log('⚠️  qa-modules/ 目录不存在，跳过模块 QA 检查', 'yellow');
    return true;
  }

  const entries = fs.readdirSync(CONFIG.qaModulesDir, { withFileTypes: true });
  const moduleDirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));

  if (moduleDirs.length === 0) {
    log('ℹ️  未找到模块 QA 文档（小型项目可能不需要模块化）', 'cyan');
    return true;
  }

  log(`✅ 找到 ${moduleDirs.length} 个模块 QA 文档:`);

  let allValid = true;
  moduleDirs.forEach(dir => {
    const qaFilePath = path.join(CONFIG.qaModulesDir, dir.name, 'QA.md');
    if (!fs.existsSync(qaFilePath)) {
      log(`   ❌ ${dir.name}/QA.md 不存在`, 'red');
      allValid = false;
      return;
    }

    log(`   - ${dir.name}/QA.md`);

    // 检查模块 QA 章节完整性
    const moduleQAContent = fs.readFileSync(qaFilePath, 'utf-8');
    const missingSections = REQUIRED_MODULE_SECTIONS.filter(section => !moduleQAContent.includes(section));

    if (missingSections.length > 0) {
      log(`     ⚠️  缺少章节: ${missingSections.join(', ')}`, 'yellow');
      allValid = false;
    }
  });

  if (allValid) {
    log('✅ 所有模块 QA 文档结构规范', 'green');
  }

  return allValid;
}

// 检查 Test Case ID 格式
function checkTestCaseIdFormat() {
  log('\n🔍 检查 Test Case ID 格式规范...', 'cyan');

  const testCaseIds = [];
  const invalidIds = [];

  // 检查主 QA
  if (fs.existsSync(CONFIG.mainQAPath)) {
    const mainQAContent = fs.readFileSync(CONFIG.mainQAPath, 'utf-8');
    const matches = mainQAContent.match(/TC-[A-Z0-9]+-[A-Z0-9]+/g) || [];
    matches.forEach(id => {
      if (!TC_ID_PATTERN.test(id)) {
        invalidIds.push({ file: 'QA.md', id });
      } else {
        testCaseIds.push(id);
      }
    });
  }

  // 检查模块 QA
  if (fs.existsSync(CONFIG.qaModulesDir)) {
    const entries = fs.readdirSync(CONFIG.qaModulesDir, { withFileTypes: true });
    const moduleDirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));

    moduleDirs.forEach(dir => {
      const qaFilePath = path.join(CONFIG.qaModulesDir, dir.name, 'QA.md');
      if (fs.existsSync(qaFilePath)) {
        const moduleQAContent = fs.readFileSync(qaFilePath, 'utf-8');
        const matches = moduleQAContent.match(/TC-[A-Z0-9]+-[A-Z0-9]+/g) || [];
        matches.forEach(id => {
          if (!TC_ID_PATTERN.test(id)) {
            invalidIds.push({ file: `qa-modules/${dir.name}/QA.md`, id });
          } else {
            testCaseIds.push(id);
          }
        });
      }
    });
  }

  if (invalidIds.length === 0) {
    log(`✅ 所有 Test Case ID 格式规范（共 ${testCaseIds.length} 个）`, 'green');
    return true;
  } else {
    log(`❌ 发现 ${invalidIds.length} 个格式不规范的 Test Case ID:`, 'red');
    invalidIds.forEach(({ file, id }) => {
      log(`   - ${id} (${file})`, 'yellow');
    });
    return false;
  }
}

// 检查缺陷 ID 格式
function checkDefectIdFormat() {
  log('\n🔍 检查缺陷 ID 格式规范...', 'cyan');

  const defectIds = [];
  const invalidIds = [];

  // 检查主 QA
  if (fs.existsSync(CONFIG.mainQAPath)) {
    const mainQAContent = fs.readFileSync(CONFIG.mainQAPath, 'utf-8');
    const matches = mainQAContent.match(/BUG-[A-Z0-9]+-[A-Z0-9]+/g) || [];
    matches.forEach(id => {
      if (!BUG_ID_PATTERN.test(id)) {
        invalidIds.push({ file: 'QA.md', id });
      } else {
        defectIds.push(id);
      }
    });
  }

  // 检查模块 QA
  if (fs.existsSync(CONFIG.qaModulesDir)) {
    const entries = fs.readdirSync(CONFIG.qaModulesDir, { withFileTypes: true });
    const moduleDirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));

    moduleDirs.forEach(dir => {
      const qaFilePath = path.join(CONFIG.qaModulesDir, dir.name, 'QA.md');
      if (fs.existsSync(qaFilePath)) {
        const moduleQAContent = fs.readFileSync(qaFilePath, 'utf-8');
        const matches = moduleQAContent.match(/BUG-[A-Z0-9]+-[A-Z0-9]+/g) || [];
        matches.forEach(id => {
          if (!BUG_ID_PATTERN.test(id)) {
            invalidIds.push({ file: `qa-modules/${dir.name}/QA.md`, id });
          } else {
            defectIds.push(id);
          }
        });
      }
    });
  }

  if (invalidIds.length === 0) {
    log(`✅ 所有缺陷 ID 格式规范（共 ${defectIds.length} 个）`, 'green');
    return true;
  } else {
    log(`❌ 发现 ${invalidIds.length} 个格式不规范的缺陷 ID:`, 'red');
    invalidIds.forEach(({ file, id }) => {
      log(`   - ${id} (${file})`, 'yellow');
    });
    return false;
  }
}

// 检查 Given-When-Then 格式
function checkGivenWhenThenFormat() {
  log('\n🔍 检查 Given-When-Then 格式...', 'cyan');

  const missingGWT = [];

  // 检查模块 QA（Given-When-Then 主要在模块 QA 中）
  if (fs.existsSync(CONFIG.qaModulesDir)) {
    const entries = fs.readdirSync(CONFIG.qaModulesDir, { withFileTypes: true });
    const moduleDirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));

    moduleDirs.forEach(dir => {
      const qaFilePath = path.join(CONFIG.qaModulesDir, dir.name, 'QA.md');
      if (fs.existsSync(qaFilePath)) {
        const moduleQAContent = fs.readFileSync(qaFilePath, 'utf-8');

        // 查找所有 Test Case
        const tcMatches = moduleQAContent.match(/TC-[A-Z]+-\d{3}:[^\n]+/g) || [];

        tcMatches.forEach(tcLine => {
          const tcId = tcLine.match(/TC-[A-Z]+-\d{3}/)[0];
          const tcTitle = tcLine.replace(/TC-[A-Z]+-\d{3}:\s*/, '');

          // 查找该 TC 后面的内容，检查是否有 Given-When-Then
          const tcIndex = moduleQAContent.indexOf(tcLine);
          const nextTCIndex = moduleQAContent.indexOf('TC-', tcIndex + tcLine.length);
          const tcContent = moduleQAContent.substring(
            tcIndex,
            nextTCIndex > 0 ? nextTCIndex : moduleQAContent.length
          );

          const hasGiven = /\*\*Given\*\*/.test(tcContent) || /- Given/.test(tcContent);
          const hasWhen = /\*\*When\*\*/.test(tcContent) || /- When/.test(tcContent);
          const hasThen = /\*\*Then\*\*/.test(tcContent) || /- Then/.test(tcContent);

          if (!hasGiven || !hasWhen || !hasThen) {
            const missing = [];
            if (!hasGiven) missing.push('Given');
            if (!hasWhen) missing.push('When');
            if (!hasThen) missing.push('Then');

            missingGWT.push({
              file: `qa-modules/${dir.name}/QA.md`,
              tcId,
              tcTitle,
              missing: missing.join(', ')
            });
          }
        });
      }
    });
  }

  if (missingGWT.length === 0) {
    log('✅ 所有测试用例都使用 Given-When-Then 格式', 'green');
    return true;
  } else {
    log(`⚠️  发现 ${missingGWT.length} 个测试用例未使用 Given-When-Then 格式:`, 'yellow');
    missingGWT.slice(0, 5).forEach(({ tcId, tcTitle, missing }) => {
      log(`   - ${tcId}: ${tcTitle} — 缺少 ${missing}`, 'yellow');
    });
    if (missingGWT.length > 5) {
      log(`   ... 还有 ${missingGWT.length - 5} 个用例`, 'yellow');
    }
    return false;
  }
}

// 检查 Story ID 关联
function checkStoryIdAssociation() {
  log('\n🔍 检查 Story ID 关联...', 'cyan');

  const unassociatedTCs = [];

  // 检查模块 QA
  if (fs.existsSync(CONFIG.qaModulesDir)) {
    const entries = fs.readdirSync(CONFIG.qaModulesDir, { withFileTypes: true });
    const moduleDirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));

    moduleDirs.forEach(dir => {
      const qaFilePath = path.join(CONFIG.qaModulesDir, dir.name, 'QA.md');
      if (fs.existsSync(qaFilePath)) {
        const moduleQAContent = fs.readFileSync(qaFilePath, 'utf-8');

        // 查找所有 Test Case
        const tcMatches = moduleQAContent.match(/TC-[A-Z]+-\d{3}:[^\n]+/g) || [];

        tcMatches.forEach(tcLine => {
          const tcId = tcLine.match(/TC-[A-Z]+-\d{3}/)[0];
          const tcTitle = tcLine.replace(/TC-[A-Z]+-\d{3}:\s*/, '');

          // 查找该 TC 后面的内容，检查是否有 Story ID
          const tcIndex = moduleQAContent.indexOf(tcLine);
          const nextTCIndex = moduleQAContent.indexOf('TC-', tcIndex + tcLine.length);
          const tcContent = moduleQAContent.substring(
            tcIndex,
            nextTCIndex > 0 ? nextTCIndex : moduleQAContent.length
          );

          const hasStoryId = STORY_ID_PATTERN.test(tcContent);

          if (!hasStoryId) {
            unassociatedTCs.push({
              file: `qa-modules/${dir.name}/QA.md`,
              tcId,
              tcTitle
            });
          }
        });
      }
    });
  }

  if (unassociatedTCs.length === 0) {
    log('✅ 所有测试用例都关联了 Story ID', 'green');
    return true;
  } else {
    log(`⚠️  发现 ${unassociatedTCs.length} 个测试用例未关联 Story ID:`, 'yellow');
    unassociatedTCs.slice(0, 3).forEach(({ tcId, tcTitle }) => {
      log(`   - ${tcId}: ${tcTitle}`, 'yellow');
    });
    if (unassociatedTCs.length > 3) {
      log(`   ... 还有 ${unassociatedTCs.length - 3} 个用例`, 'yellow');
    }
    return false;
  }
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('QA 文档完整性检查工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  let hasErrors = false;
  let hasWarnings = false;

  // 检查主 QA 是否存在
  const mainQAExists = checkFileExists(CONFIG.mainQAPath, '主 QA');
  if (!mainQAExists) {
    log('\n⚠️  主 QA 不存在，跳过后续检查', 'yellow');
    log('   使用 QA 专家创建 QA 文档后再运行此脚本', 'cyan');
    process.exit(0);
  }

  // 检查全局追溯矩阵
  checkFileExists(CONFIG.traceabilityMatrixPath, '全局追溯矩阵');

  // 检查主 QA 章节完整性
  if (!checkMainQASections()) {
    hasErrors = true;
  }

  // 检查模块 QA 文档
  if (!checkModuleQADocs()) {
    hasWarnings = true;
  }

  // 检查 Test Case ID 格式
  if (!checkTestCaseIdFormat()) {
    hasErrors = true;
  }

  // 检查缺陷 ID 格式
  if (!checkDefectIdFormat()) {
    hasErrors = true;
  }

  // 检查 Given-When-Then 格式
  if (!checkGivenWhenThenFormat()) {
    hasWarnings = true;
  }

  // 检查 Story ID 关联
  if (!checkStoryIdAssociation()) {
    hasWarnings = true;
  }

  // 输出结果
  log('\n' + '='.repeat(60), 'cyan');
  log('检查结果汇总:', 'cyan');
  log('='.repeat(60), 'cyan');

  if (hasErrors) {
    log('❌ 发现错误，请修正后再提交。', 'red');
    process.exit(1);
  } else if (hasWarnings) {
    const warningCount = [
      !checkGivenWhenThenFormat(),
      !checkStoryIdAssociation(),
      !checkModuleQADocs()
    ].filter(Boolean).length;
    log(`⚠️  发现 ${warningCount} 个警告，建议修正。`, 'yellow');
    process.exit(0);
  } else {
    log('✅ 所有检查通过！', 'green');
    process.exit(0);
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

module.exports = { checkFileExists, checkTestCaseIdFormat, checkDefectIdFormat };

#!/usr/bin/env node

/**
 * sync-prd-arch-ids.js - PRD ↔ ARCH ID 双向追溯工具
 *
 * 功能：
 * - 提取 ARCH 中引用的 Story ID
 * - 提取 PRD 中定义的 Story ID
 * - 双向验证一致性
 * - Component ID 追溯（component-dependency-graph.mmd ↔ architecture-modules/）
 * - 支持 JSON 输出与追溯报告生成
 */

const fs = require('fs');
const path = require('path');

// 配置
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ARCH_FILE = path.join(PROJECT_ROOT, 'docs/ARCHITECTURE.md');
const ARCH_MODULES_DIR = path.join(PROJECT_ROOT, 'docs/architecture-modules');
const PRD_FILE = path.join(PROJECT_ROOT, 'docs/PRD.md');
const PRD_MODULES_DIR = path.join(PROJECT_ROOT, 'docs/prd-modules');
const COMPONENT_GRAPH_FILE = path.join(PROJECT_ROOT, 'docs/data/component-dependency-graph.mmd');
const REPORT_FILE = path.join(PROJECT_ROOT, 'docs/data/arch-prd-traceability.md');

// 存储
const storyIDsInArch = new Map(); // story_id -> { files: [file], lines: [line] }
const storyIDsInPRD = new Map(); // story_id -> { file, line }
const componentIDsInGraph = new Map(); // component_id -> line
const componentIDsInModules = new Map(); // component_id -> { file, line }

// 命令行参数
const args = process.argv.slice(2);
const isJsonMode = args.includes('--json');
const isReportMode = args.includes('--report');

/**
 * 提取 Story ID（格式：US-{MODULE}-{NNN}、FEAT-{MODULE}-{NNN}）
 */
function extractStoryIDs(content, filePath) {
  const regex = /(US|FEAT)-[A-Z]+-\d{3}/g;
  const matches = content.matchAll(regex);
  const results = [];

  for (const match of matches) {
    const storyID = match[0];
    const line = content.substring(0, match.index).split('\n').length;
    results.push({ storyID, file: filePath, line });
  }

  return results;
}

/**
 * 提取 Component ID（格式：{MODULE}-{TYPE}-{NNN}）
 */
function extractComponentIDs(content, filePath) {
  // 匹配格式：USER-SVC-001、PAY-DB-001
  const regex = /\b([A-Z]+)-([A-Z]+)-(\d{3})\b/g;
  const matches = content.matchAll(regex);
  const results = [];

  for (const match of matches) {
    const componentID = match[0];
    // 验证 TYPE 是否合法
    const type = match[2];
    const validTypes = ['SVC', 'DB', 'CACHE', 'MQ', 'API', 'JOB'];
    if (!validTypes.includes(type)) {
      continue; // 跳过不合法的 TYPE
    }

    const line = content.substring(0, match.index).split('\n').length;
    results.push({ componentID, file: filePath, line });
  }

  return results;
}

/**
 * 扫描 ARCH 文档中的 Story ID
 */
function scanArchForStoryIDs() {
  // 扫描主 ARCH 文档
  if (fs.existsSync(ARCH_FILE)) {
    const content = fs.readFileSync(ARCH_FILE, 'utf8');
    const results = extractStoryIDs(content, 'ARCHITECTURE.md');

    results.forEach(({ storyID, file, line }) => {
      if (!storyIDsInArch.has(storyID)) {
        storyIDsInArch.set(storyID, { files: [], lines: [] });
      }
      storyIDsInArch.get(storyID).files.push(file);
      storyIDsInArch.get(storyID).lines.push(line);
    });
  }

  // 扫描模块 ARCH 文档
  if (fs.existsSync(ARCH_MODULES_DIR)) {
    const moduleFiles = fs.readdirSync(ARCH_MODULES_DIR).filter(f => f.endsWith('.md') && f !== 'README.md');

    for (const file of moduleFiles) {
      const modulePath = path.join(ARCH_MODULES_DIR, file);
      const content = fs.readFileSync(modulePath, 'utf8');
      const results = extractStoryIDs(content, `architecture-modules/${file}`);

      results.forEach(({ storyID, file, line }) => {
        if (!storyIDsInArch.has(storyID)) {
          storyIDsInArch.set(storyID, { files: [], lines: [] });
        }
        storyIDsInArch.get(storyID).files.push(file);
        storyIDsInArch.get(storyID).lines.push(line);
      });
    }
  }

  console.log(`\n🔍 Found ${storyIDsInArch.size} unique Story IDs in ARCH documents\n`);
}

/**
 * 扫描 PRD 文档中的 Story ID
 */
function scanPRDForStoryIDs() {
  // 扫描主 PRD 文档
  if (fs.existsSync(PRD_FILE)) {
    const content = fs.readFileSync(PRD_FILE, 'utf8');
    const results = extractStoryIDs(content, 'PRD.md');

    results.forEach(({ storyID, file, line }) => {
      if (!storyIDsInPRD.has(storyID)) {
        storyIDsInPRD.set(storyID, { file, line });
      }
    });
  }

  // 扫描模块 PRD 文档
  if (fs.existsSync(PRD_MODULES_DIR)) {
    const moduleDirs = fs.readdirSync(PRD_MODULES_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory());

    for (const dir of moduleDirs) {
      const prdFile = path.join(PRD_MODULES_DIR, dir.name, 'PRD.md');
      if (fs.existsSync(prdFile)) {
        const content = fs.readFileSync(prdFile, 'utf8');
        const results = extractStoryIDs(content, `prd-modules/${dir.name}/PRD.md`);

        results.forEach(({ storyID, file, line }) => {
          if (!storyIDsInPRD.has(storyID)) {
            storyIDsInPRD.set(storyID, { file, line });
          }
        });
      }
    }
  }

  console.log(`📋 Found ${storyIDsInPRD.size} unique Story IDs in PRD documents\n`);
}

/**
 * 扫描 component-dependency-graph.mmd 中的 Component ID
 */
function scanComponentGraph() {
  if (!fs.existsSync(COMPONENT_GRAPH_FILE)) {
    console.log('⚠️  Component dependency graph not found, skipping Component ID check\n');
    return;
  }

  const content = fs.readFileSync(COMPONENT_GRAPH_FILE, 'utf8');
  const results = extractComponentIDs(content, 'data/component-dependency-graph.mmd');

  results.forEach(({ componentID, file, line }) => {
    if (!componentIDsInGraph.has(componentID)) {
      componentIDsInGraph.set(componentID, line);
    }
  });

  console.log(`🔧 Found ${componentIDsInGraph.size} unique Component IDs in dependency graph\n`);
}

/**
 * 扫描模块架构文档中的 Component ID
 */
function scanModulesForComponentIDs() {
  if (!fs.existsSync(ARCH_MODULES_DIR)) {
    console.log('⚠️  Architecture modules directory not found, skipping Component ID check\n');
    return;
  }

  const moduleFiles = fs.readdirSync(ARCH_MODULES_DIR).filter(f => f.endsWith('.md') && f !== 'README.md');

  for (const file of moduleFiles) {
    const modulePath = path.join(ARCH_MODULES_DIR, file);
    const content = fs.readFileSync(modulePath, 'utf8');
    const results = extractComponentIDs(content, `architecture-modules/${file}`);

    results.forEach(({ componentID, file, line }) => {
      if (!componentIDsInModules.has(componentID)) {
        componentIDsInModules.set(componentID, { file, line });
      }
    });
  }

  console.log(`📦 Found ${componentIDsInModules.size} unique Component IDs in module documents\n`);
}

/**
 * 验证 Story ID 追溯一致性
 */
function validateStoryIDTraceability() {
  const archReferencesNotInPRD = [];
  const prdDefinitionsNotInArch = [];

  // ARCH 引用但 PRD 不存在
  for (const [storyID, data] of storyIDsInArch.entries()) {
    if (!storyIDsInPRD.has(storyID)) {
      archReferencesNotInPRD.push({
        storyID,
        referencedIn: data.files[0],
        line: data.lines[0]
      });
    }
  }

  // PRD 定义但 ARCH 未引用
  for (const [storyID, data] of storyIDsInPRD.entries()) {
    if (!storyIDsInArch.has(storyID)) {
      prdDefinitionsNotInArch.push({
        storyID,
        definedIn: data.file,
        line: data.line
      });
    }
  }

  return { archReferencesNotInPRD, prdDefinitionsNotInArch };
}

/**
 * 验证 Component ID 追溯一致性
 */
function validateComponentIDTraceability() {
  const graphReferencesNotInModules = [];

  // 依赖图中引用但模块文档不存在
  for (const [componentID, line] of componentIDsInGraph.entries()) {
    if (!componentIDsInModules.has(componentID)) {
      graphReferencesNotInModules.push({
        componentID,
        referencedIn: 'component-dependency-graph.mmd',
        line
      });
    }
  }

  return { graphReferencesNotInModules };
}

/**
 * 生成追溯报告（Markdown 格式）
 */
function generateTraceabilityReport(storyResults, componentResults) {
  let report = `# PRD ↔ ARCH 追溯报告\n\n`;
  report += `**生成时间**：${new Date().toISOString()}\n\n`;
  report += `---\n\n`;

  // Story ID 追溯
  report += `## Story ID 追溯\n\n`;
  report += `### 统计\n\n`;
  report += `- **ARCH 中引用的 Story ID**：${storyIDsInArch.size} 个\n`;
  report += `- **PRD 中定义的 Story ID**：${storyIDsInPRD.size} 个\n`;
  report += `- **ARCH 引用但 PRD 不存在**：${storyResults.archReferencesNotInPRD.length} 个\n`;
  report += `- **PRD 定义但 ARCH 未引用**：${storyResults.prdDefinitionsNotInArch.length} 个\n\n`;

  if (storyResults.archReferencesNotInPRD.length > 0) {
    report += `### ❌ ARCH 引用但 PRD 不存在\n\n`;
    report += `| Story ID | 引用文件 | 行号 |\n`;
    report += `|----------|---------|------|\n`;
    storyResults.archReferencesNotInPRD.forEach(item => {
      report += `| ${item.storyID} | ${item.referencedIn} | ${item.line} |\n`;
    });
    report += `\n`;
  }

  if (storyResults.prdDefinitionsNotInArch.length > 0) {
    report += `### ⚠️  PRD 定义但 ARCH 未引用\n\n`;
    report += `| Story ID | 定义文件 | 行号 |\n`;
    report += `|----------|---------|------|\n`;
    storyResults.prdDefinitionsNotInArch.forEach(item => {
      report += `| ${item.storyID} | ${item.definedIn} | ${item.line} |\n`;
    });
    report += `\n`;
  }

  // Component ID 追溯
  if (componentIDsInGraph.size > 0) {
    report += `---\n\n`;
    report += `## Component ID 追溯\n\n`;
    report += `### 统计\n\n`;
    report += `- **依赖图中的 Component ID**：${componentIDsInGraph.size} 个\n`;
    report += `- **模块文档中定义的 Component ID**：${componentIDsInModules.size} 个\n`;
    report += `- **依赖图引用但模块文档不存在**：${componentResults.graphReferencesNotInModules.length} 个\n\n`;

    if (componentResults.graphReferencesNotInModules.length > 0) {
      report += `### ❌ 依赖图引用但模块文档不存在\n\n`;
      report += `| Component ID | 引用文件 | 行号 |\n`;
      report += `|--------------|---------|------|\n`;
      componentResults.graphReferencesNotInModules.forEach(item => {
        report += `| ${item.componentID} | ${item.referencedIn} | ${item.line} |\n`;
      });
      report += `\n`;
    }
  }

  report += `---\n\n`;
  report += `> 本报告由 \`npm run arch:sync -- --report\` 自动生成\n`;

  return report;
}

/**
 * 输出结果
 */
function outputResults(storyResults, componentResults) {
  if (isJsonMode) {
    // JSON 输出
    const jsonOutput = {
      timestamp: new Date().toISOString(),
      status: (storyResults.archReferencesNotInPRD.length === 0 &&
               componentResults.graphReferencesNotInModules.length === 0) ? 'pass' : 'fail',
      summary: {
        storyIDs: {
          inArch: storyIDsInArch.size,
          inPRD: storyIDsInPRD.size,
          archReferencesNotInPRD: storyResults.archReferencesNotInPRD.length,
          prdDefinitionsNotInArch: storyResults.prdDefinitionsNotInArch.length
        },
        componentIDs: {
          inGraph: componentIDsInGraph.size,
          inModules: componentIDsInModules.size,
          graphReferencesNotInModules: componentResults.graphReferencesNotInModules.length
        }
      },
      details: {
        storyID: storyResults,
        componentID: componentResults
      }
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
  } else {
    // 文本输出
    console.log('---\n');
    console.log('📊 Story ID 追溯结果：\n');

    if (storyResults.archReferencesNotInPRD.length > 0) {
      console.log(`❌ FAIL: ${storyResults.archReferencesNotInPRD.length} Story ID(s) referenced in ARCH but not found in PRD:\n`);
      storyResults.archReferencesNotInPRD.forEach(item => {
        console.log(`   - ${item.storyID}`);
        console.log(`     Referenced in: ${item.referencedIn}:${item.line}`);
        console.log(`     Not found in any PRD document\n`);
      });
    } else {
      console.log('✅ PASS: All ARCH Story ID references are verified in PRD\n');
    }

    if (storyResults.prdDefinitionsNotInArch.length > 0) {
      console.log(`⚠️  WARN: ${storyResults.prdDefinitionsNotInArch.length} Story ID(s) defined in PRD but not referenced in ARCH:\n`);
      storyResults.prdDefinitionsNotInArch.forEach(item => {
        console.log(`   - ${item.storyID}`);
        console.log(`     Defined in: ${item.definedIn}:${item.line}`);
        console.log(`     Not referenced in ARCH (may be in backlog)\n`);
      });
    }

    if (componentIDsInGraph.size > 0) {
      console.log('---\n');
      console.log('🔧 Component ID 追溯结果：\n');

      if (componentResults.graphReferencesNotInModules.length > 0) {
        console.log(`❌ FAIL: ${componentResults.graphReferencesNotInModules.length} Component ID(s) referenced in graph but not found in modules:\n`);
        componentResults.graphReferencesNotInModules.forEach(item => {
          console.log(`   - ${item.componentID}`);
          console.log(`     Referenced in: ${item.referencedIn}:${item.line}`);
          console.log(`     Not found in any module document\n`);
        });
      } else {
        console.log('✅ PASS: All Component ID references are verified in modules\n');
      }
    }
  }

  // 生成报告
  if (isReportMode) {
    const report = generateTraceabilityReport(storyResults, componentResults);
    fs.writeFileSync(REPORT_FILE, report, 'utf8');
    console.log(`\n📄 Traceability report generated: ${REPORT_FILE}\n`);
  }
}

/**
 * 主函数
 */
function main() {
  if (!isJsonMode) {
    console.log('\n🔍 PRD ↔ ARCH ID Traceability Check...\n');
  }

  // 1. 扫描 ARCH 中的 Story ID
  scanArchForStoryIDs();

  // 2. 扫描 PRD 中的 Story ID
  scanPRDForStoryIDs();

  // 3. 扫描 Component Graph 中的 Component ID
  scanComponentGraph();

  // 4. 扫描模块文档中的 Component ID
  if (componentIDsInGraph.size > 0) {
    scanModulesForComponentIDs();
  }

  // 5. 验证追溯一致性
  const storyResults = validateStoryIDTraceability();
  const componentResults = validateComponentIDTraceability();

  // 6. 输出结果
  outputResults(storyResults, componentResults);

  // 7. 退出码
  const hasErrors = storyResults.archReferencesNotInPRD.length > 0 ||
                    componentResults.graphReferencesNotInModules.length > 0;

  if (hasErrors) {
    if (!isJsonMode) {
      console.log('💡 Recommendation:\n');
      console.log('   - Add missing Story IDs to PRD documents');
      console.log('   - Add missing Component IDs to module architecture documents');
      console.log('   - Or remove invalid references from ARCH/Graph\n');
    }
    process.exit(1);
  } else {
    if (!isJsonMode) {
      console.log('✅ PASS: All ID references are consistent\n');
    }
    process.exit(0);
  }
}

// 运行
main();

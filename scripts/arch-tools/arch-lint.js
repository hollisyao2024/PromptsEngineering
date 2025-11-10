#!/usr/bin/env node

/**
 * arch-lint.js - 架构文档完整性检查工具
 *
 * 功能：
 * - 检查 ARCH.md 是否存在
 * - 验证必需章节（总览、6大视图、技术选型、风险）
 * - 检查 Mermaid 代码块语法
 * - 验证链接有效性（ADR、数据字典、ERD）
 * - 模块化项目额外检查
 */

const fs = require('fs');
const path = require('path');

// 配置
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ARCH_FILE = path.join(PROJECT_ROOT, 'docs/ARCH.md');
const ARCH_MODULES_README = path.join(PROJECT_ROOT, 'docs/arch-modules/README.md');

// 必需章节列表
const REQUIRED_SECTIONS = [
  '总览',
  '架构视图',
  'C4',
  '运行时',
  '数据视图',
  '接口视图',
  '运维视图',
  '安全',
  '技术选型',
  '风险'
];

// 命令行参数
const args = process.argv.slice(2);
const isJsonMode = args.includes('--json');

// 结果统计
let passed = 0;
let failed = 0;
let warnings = 0;
const details = []; // 存储详细结果（用于 JSON 输出）

// 辅助函数：打印结果
function printResult(status, message, check = '') {
  const symbols = { PASS: '✅', FAIL: '❌', WARN: '⚠️' };

  // 收集详细结果
  details.push({
    check: check || message.substring(0, 30),
    status: status.toLowerCase(),
    message
  });

  // 非 JSON 模式下打印
  if (!isJsonMode) {
    console.log(`${symbols[status]} ${status}: ${message}`);
  }

  if (status === 'PASS') passed++;
  if (status === 'FAIL') failed++;
  if (status === 'WARN') warnings++;
}

// 1. 检查文件存在性
function checkFileExists() {
  if (fs.existsSync(ARCH_FILE)) {
    printResult('PASS', 'Architecture document exists', 'file_exists');
    return true;
  } else {
    printResult('FAIL', 'Architecture document not found at: ' + ARCH_FILE, 'file_exists');
    return false;
  }
}

// 2. 验证必需章节
function checkRequiredSections(content) {
  const foundSections = [];
  const missingSections = [];

  for (const section of REQUIRED_SECTIONS) {
    // 使用不区分大小写的正则匹配标题
    const regex = new RegExp(`##.*${section}`, 'i');
    if (regex.test(content)) {
      foundSections.push(section);
    } else {
      missingSections.push(section);
    }
  }

  if (missingSections.length === 0) {
    printResult('PASS', `Required sections found (${foundSections.length}/${REQUIRED_SECTIONS.length})`, 'required_sections');
  } else {
    printResult('FAIL', `Missing sections: ${missingSections.join(', ')}`, 'required_sections');
  }
}

// 3. 检查 Mermaid 语法
function checkMermaidSyntax(content) {
  const mermaidBlocks = content.match(/```mermaid[\s\S]*?```/g) || [];

  if (mermaidBlocks.length === 0) {
    printResult('WARN', 'No Mermaid diagrams found', 'mermaid_syntax');
    return;
  }

  let syntaxErrors = 0;
  for (const block of mermaidBlocks) {
    // 简单的语法检查：确保有基本的 Mermaid 关键字
    const keywords = ['graph', 'sequenceDiagram', 'classDiagram', 'flowchart', 'erDiagram'];
    const hasKeyword = keywords.some(kw => block.includes(kw));

    if (!hasKeyword) {
      syntaxErrors++;
      const preview = block.substring(0, 50).replace(/\n/g, ' ');
      printResult('WARN', `Potential Mermaid syntax issue: ${preview}...`, 'mermaid_syntax');
    }
  }

  if (syntaxErrors === 0) {
    printResult('PASS', `Mermaid syntax check passed (${mermaidBlocks.length} diagrams)`, 'mermaid_syntax');
  }
}

// 4. 验证链接有效性
function checkLinks(content) {
  // 匹配 Markdown 链接：[text](path)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links = [];
  let match;

  while ((match = linkRegex.exec(content)) !== null) {
    links.push({ text: match[1], path: match[2] });
  }

  if (links.length === 0) {
    printResult('WARN', 'No internal links found', 'link_validation');
    return;
  }

  let brokenLinks = 0;
  const checkedPaths = new Set();

  for (const link of links) {
    // 只检查相对路径链接（忽略外部 URL 和锚点）
    if (link.path.startsWith('http') || link.path.startsWith('#')) {
      continue;
    }

    // 移除锚点
    const cleanPath = link.path.split('#')[0];
    if (!cleanPath || checkedPaths.has(cleanPath)) {
      continue;
    }
    checkedPaths.add(cleanPath);

    // 解析相对路径
    const fullPath = path.resolve(path.dirname(ARCH_FILE), cleanPath);

    if (!fs.existsSync(fullPath)) {
      brokenLinks++;
      printResult('WARN', `Broken link detected: ${link.path}`, 'link_validation');
    }
  }

  if (brokenLinks === 0) {
    printResult('PASS', `All links verified (${checkedPaths.size} unique paths)`, 'link_validation');
  }
}

// 5. 模块化项目检查
function checkModularArchitecture(content) {
  // 检测是否为模块化架构（查找功能域索引关键字）
  const isModular = /功能域.*架构.*索引|arch-modules/i.test(content);

  if (!isModular) {
    printResult('PASS', 'Single-file architecture (no modularization needed)', 'modular_architecture');
    return;
  }

  // 模块化项目：检查 README.md
  if (!fs.existsSync(ARCH_MODULES_README)) {
    printResult('FAIL', 'Modular architecture detected but README.md not found: ' + ARCH_MODULES_README, 'modular_architecture');
    return;
  }

  const readmeContent = fs.readFileSync(ARCH_MODULES_README, 'utf8');

  // 检查模块清单表格
  const moduleTableRegex = /\|\s*功能域\s*\|.*\|[\s\S]*?\|\s*[-:]+\s*\|/;
  if (!moduleTableRegex.test(readmeContent)) {
    printResult('FAIL', 'Module inventory table not found in README.md', 'modular_architecture');
    return;
  }

  // 统计模块数量（表格行数 - 表头）
  const tableRows = (readmeContent.match(/^\|[^-]/gm) || []).length - 1;
  if (tableRows > 0) {
    printResult('PASS', `Modular architecture validated (${tableRows} modules registered)`, 'modular_architecture');
  } else {
    printResult('WARN', 'Module inventory table is empty', 'modular_architecture');
  }
}

// 主函数
function main() {
  if (!isJsonMode) {
    console.log('\n🔍 Running Architecture Document Lint...\n');
  }

  // 1. 检查文件存在性
  if (!checkFileExists()) {
    if (isJsonMode) {
      console.log(JSON.stringify({
        status: 'fail',
        summary: { passed: 0, failed: 1, warnings: 0 },
        details: [{ check: 'file_exists', status: 'fail', message: 'Architecture document not found' }],
        timestamp: new Date().toISOString()
      }, null, 2));
    } else {
      console.log('\n❌ Lint failed: Architecture document not found\n');
    }
    process.exit(1);
  }

  // 读取文件内容
  const content = fs.readFileSync(ARCH_FILE, 'utf8');

  // 2. 验证章节
  checkRequiredSections(content);

  // 3. 检查 Mermaid 语法
  checkMermaidSyntax(content);

  // 4. 验证链接
  checkLinks(content);

  // 5. 模块化检查
  checkModularArchitecture(content);

  // 输出结果
  if (isJsonMode) {
    // JSON 输出
    const jsonOutput = {
      status: failed > 0 ? 'fail' : 'pass',
      summary: { passed, failed, warnings },
      details,
      timestamp: new Date().toISOString()
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
  } else {
    // 文本输出
    console.log('\n' + '='.repeat(50));
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⚠️  Warnings: ${warnings}`);
    console.log('='.repeat(50) + '\n');

    if (failed > 0) {
      console.log('❌ Lint failed with errors\n');
    } else if (warnings > 0) {
      console.log('⚠️  Lint passed with warnings\n');
    } else {
      console.log('✅ Lint passed successfully\n');
    }
  }

  // 退出码：有失败项则返回 1
  process.exit(failed > 0 ? 1 : 0);
}

// 运行
main();

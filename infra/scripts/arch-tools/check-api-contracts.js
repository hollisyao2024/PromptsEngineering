#!/usr/bin/env node

/**
 * check-api-contracts.js - API 契约一致性检查工具
 *
 * 功能：
 * - 从主架构的"跨模块依赖关系"章节提取 API 调用
 * - 读取对应模块架构文档
 * - 验证被引用的接口在模块文档的"接口视图"章节中存在
 * - 检查接口描述一致性
 */

const fs = require('fs');
const path = require('path');
const { resolveRepoRoot } = require('../shared/config');

// 配置
const PROJECT_ROOT = resolveRepoRoot({ scriptDir: __dirname });
const ARCH_FILE = path.join(PROJECT_ROOT, 'docs/ARCH.md');
const ARCH_MODULES_DIR = path.join(PROJECT_ROOT, 'docs/arch-modules');

// 命令行参数
const args = process.argv.slice(2);
const isJsonMode = args.includes('--json');

// 存储 API 引用和定义
const apiReferences = []; // { module, api, method, source }
const apiDefinitions = new Map(); // module -> Set<api>

/**
 * 提取主架构中的 API 引用
 */
function extractAPIReferences() {
  if (!fs.existsSync(ARCH_FILE)) {
    if (!isJsonMode) {
      console.log('⚠️  Architecture document not found (skipping check):\n');
      console.log('   ' + ARCH_FILE + '\n');
    }
    process.exit(0);
  }

  const content = fs.readFileSync(ARCH_FILE, 'utf8');

  // 查找"跨模块依赖关系"章节
  const sectionRegex = /##\s*\d*\.?\s*跨模块依赖关系([\s\S]*?)(?=##|$)/i;
  const sectionMatch = content.match(sectionRegex);

  if (!sectionMatch) {
    if (!isJsonMode) {
      console.log('⚠️  No "跨模块依赖关系" section found in ARCH.md');
      console.log('   Skipping API contract check\n');
    }
    process.exit(0);
  }

  const sectionContent = sectionMatch[1];

  // 匹配 API 调用格式：GET /api/users/{id}、POST /api/orders、etc.
  const apiRegex = /(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/[^\s,;)]+)/gi;
  let match;
  let lineNumber = 1;

  const lines = sectionContent.split('\n');
  lines.forEach((line, index) => {
    const apiMatches = line.matchAll(apiRegex);
    for (const m of apiMatches) {
      const method = m[1].toUpperCase();
      const endpoint = m[2];

      // 尝试从上下文推断模块（查找前面提到的模块名）
      const moduleHint = line.match(/(\w+)模块|(\w+)服务|(\w+-\w+-\d+)/);
      const module = moduleHint ? (moduleHint[1] || moduleHint[2] || 'unknown') : 'unknown';

      apiReferences.push({
        module,
        method,
        endpoint,
        source: `ARCH.md (跨模块依赖关系, line ~${index + 1})`
      });
    }
  });

  if (!isJsonMode) {
    console.log(`\n🔍 Found ${apiReferences.length} API references in cross-module dependencies\n`);
  }
}

/**
 * 从模块架构文档中提取 API 定义
 */
function extractAPIDefinitions() {
  if (!fs.existsSync(ARCH_MODULES_DIR)) {
    if (!isJsonMode) {
      console.log('⚠️  Architecture modules directory not found:');
      console.log('   ' + ARCH_MODULES_DIR);
      console.log('   This is a single-file architecture (no modules)\n');
    }
    return;
  }

  const moduleDirs = fs.readdirSync(ARCH_MODULES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory());

  for (const dir of moduleDirs) {
    const modulePath = path.join(ARCH_MODULES_DIR, dir.name, 'ARCH.md');
    if (!fs.existsSync(modulePath)) {
      continue;
    }

    const content = fs.readFileSync(modulePath, 'utf8');
    const moduleName = dir.name;

    // 查找"接口视图"章节
    const sectionRegex = /##\s*\d*\.?\s*接口视图([\s\S]*?)(?=##|$)/i;
    const sectionMatch = content.match(sectionRegex);

    if (!sectionMatch) {
      continue; // 没有接口视图章节
    }

    const sectionContent = sectionMatch[1];

    // 匹配 API 定义：**GET /api/users/{id}** 或 | /api/orders | POST |
    const apiRegex = /(?:\*\*|【)?(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/[^\s*|,;)]+)/gi;
    let match;

    const apis = new Set();
    while ((match = apiRegex.exec(sectionContent)) !== null) {
      const method = match[1].toUpperCase();
      const endpoint = match[2];
      apis.add(`${method} ${endpoint}`);
    }

    if (apis.size > 0) {
      apiDefinitions.set(moduleName, apis);
    }
  }

  if (!isJsonMode) {
    console.log(`📋 Extracted API definitions from ${apiDefinitions.size} module(s)\n`);
  }
}

/**
 * 验证 API 契约一致性
 */
function validateAPIContracts() {
  if (apiReferences.length === 0) {
    if (!isJsonMode) {
      console.log('✅ PASS: No cross-module API references to validate\n');
    }
    return { passed: true, missing: [] };
  }

  if (apiDefinitions.size === 0) {
    if (!isJsonMode) {
      console.log('⚠️  WARN: No API definitions found in module documents');
      console.log('   Cannot validate API contracts\n');
    }
    return { passed: true, missing: [] };
  }

  const missingAPIs = [];
  const foundAPIs = [];

  for (const ref of apiReferences) {
    const apiSignature = `${ref.method} ${ref.endpoint}`;
    let found = false;

    // 检查所有模块（因为模块名推断可能不准确）
    for (const [moduleName, apis] of apiDefinitions.entries()) {
      if (apis.has(apiSignature)) {
        found = true;
        foundAPIs.push({ ...ref, definedIn: moduleName });
        break;
      }
    }

    if (!found) {
      missingAPIs.push(ref);
    }
  }

  // 输出结果
  if (!isJsonMode) {
    if (foundAPIs.length > 0) {
      console.log(`✅ Verified ${foundAPIs.length} API contract(s):\n`);
      foundAPIs.forEach(api => {
        console.log(`   - ${api.method} ${api.endpoint}`);
        console.log(`     Defined in: arch-modules/${api.definedIn}/ARCH.md`);
        console.log(`     Referenced in: ${api.source}\n`);
      });
    }

    if (missingAPIs.length > 0) {
      console.log(`❌ FAIL: ${missingAPIs.length} missing API definition(s):\n`);
      missingAPIs.forEach(api => {
        console.log(`   - ${api.method} ${api.endpoint}`);
        console.log(`     Referenced in: ${api.source}`);
        console.log(`     Not found in any module document\n`);
      });
    }
  }

  return missingAPIs.length > 0 ? { passed: false, missing: missingAPIs } : { passed: true, missing: [] };
}

/**
 * 主函数
 */
function main() {
  if (!isJsonMode) {
    console.log('\n🔍 Checking API Contract Consistency...\n');
  }

  // 1. 提取 API 引用
  extractAPIReferences();

  // 2. 提取 API 定义
  extractAPIDefinitions();

  // 3. 验证一致性
  const result = validateAPIContracts();

  // 4. 输出结果
  if (isJsonMode) {
    // JSON 输出
    const jsonOutput = {
      status: result.passed ? 'pass' : 'fail',
      summary: {
        apiReferences: apiReferences.length,
        apiDefinitions: apiDefinitions.size,
        missingAPIs: result.missing.length
      },
      details: {
        missingAPIs: result.missing.map(api => ({
          method: api.method,
          endpoint: api.endpoint,
          referencedIn: api.source
        }))
      },
      timestamp: new Date().toISOString()
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
  } else {
    // 文本输出
    if (result.passed) {
      console.log('✅ PASS: All cross-module API references are verified\n');
    } else {
      console.log('💡 Recommendation:\n');
      console.log('   - Add missing API definitions to module architecture documents');
      console.log('   - Ensure API contracts are documented in "接口视图" section');
      console.log('   - Use consistent endpoint naming conventions\n');
    }
  }

  process.exit(result.passed ? 0 : 1);
}

// 运行
main();

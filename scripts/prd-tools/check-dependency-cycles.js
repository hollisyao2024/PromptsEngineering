#!/usr/bin/env node

/**
 * 依赖循环检查脚本
 *
 * 检查项：
 * - 解析所有 Story 的依赖关系
 * - 检测循环依赖（A → B → C → A）
 * - 生成依赖关系报告
 */

const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  prdPath: path.join(__dirname, '../../docs/PRD.md'),
  prdModulesDir: path.join(__dirname, '../../docs/prd-modules'),
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

// 解析单个文件的依赖关系
function parseDependencies(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const dependencies = new Map();

  // 匹配 Story 和依赖
  // 格式: ### US-MODULE-NNN: Title
  //      **依赖**：US-XXX-YYY, US-ZZZ-WWW
  const storyRegex = /###?\s+(US-[A-Z]+-\d{3}):([^#]+)/g;
  let match;

  while ((match = storyRegex.exec(content)) !== null) {
    const storyId = match[1];
    const storyContent = match[2];

    // 提取依赖
    const depMatch = storyContent.match(/\*\*依赖[：:]\*\*\s*([^\n]+)/);
    if (depMatch) {
      const depString = depMatch[1];
      // 提取所有 US-XXX-YYY 格式的 ID
      const depIds = (depString.match(/US-[A-Z]+-\d{3}/g) || [])
        .filter(id => id !== storyId); // 排除自己

      dependencies.set(storyId, depIds);
    } else {
      dependencies.set(storyId, []);
    }
  }

  return dependencies;
}

// 收集所有依赖关系
function collectAllDependencies() {
  const allDeps = new Map();

  // 读取主 PRD
  if (fs.existsSync(CONFIG.prdPath)) {
    const deps = parseDependencies(CONFIG.prdPath);
    deps.forEach((value, key) => allDeps.set(key, value));
  }

  // 读取模块 PRD
  if (fs.existsSync(CONFIG.prdModulesDir)) {
    const entries = fs.readdirSync(CONFIG.prdModulesDir, { withFileTypes: true });

    entries.forEach(entry => {
      if (entry.isDirectory()) {
        // 扫描模块子目录下的 PRD.md 和 dependency-graph.md
        const modulePrdPath = path.join(CONFIG.prdModulesDir, entry.name, 'PRD.md');
        if (fs.existsSync(modulePrdPath)) {
          const deps = parseDependencies(modulePrdPath);
          deps.forEach((value, key) => allDeps.set(key, value));
        }

        // 注意：dependency-graph.md 也可能包含依赖信息，但格式不同，这里暂不解析
      } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') {
        // 兼容旧格式：直接在 prd-modules/ 下的 .md 文件
        const filePath = path.join(CONFIG.prdModulesDir, entry.name);
        const deps = parseDependencies(filePath);
        deps.forEach((value, key) => allDeps.set(key, value));
      }
    });
  }

  return allDeps;
}

// 检测循环依赖（DFS）
function detectCycles(dependencies) {
  const visited = new Set();
  const recStack = new Set();
  const cycles = [];

  function dfs(node, path = []) {
    if (recStack.has(node)) {
      // 找到循环
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat(node);
      cycles.push(cycle);
      return;
    }

    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    recStack.add(node);
    path.push(node);

    const deps = dependencies.get(node) || [];
    deps.forEach(dep => {
      if (dependencies.has(dep)) {
        dfs(dep, [...path]);
      }
    });

    recStack.delete(node);
  }

  // 从每个节点开始 DFS
  dependencies.forEach((_, node) => {
    if (!visited.has(node)) {
      dfs(node);
    }
  });

  return cycles;
}

// 检测无效依赖（依赖的 Story 不存在）
function detectInvalidDependencies(dependencies) {
  const allStories = new Set(dependencies.keys());
  const invalidDeps = [];

  dependencies.forEach((deps, storyId) => {
    deps.forEach(depId => {
      if (!allStories.has(depId)) {
        invalidDeps.push({ storyId, depId });
      }
    });
  });

  return invalidDeps;
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('依赖循环检查工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  log('\n📖 解析依赖关系...', 'cyan');
  const dependencies = collectAllDependencies();

  log(`✅ 找到 ${dependencies.size} 个用户故事`, 'green');

  // 统计依赖关系
  const totalDeps = Array.from(dependencies.values())
    .reduce((sum, deps) => sum + deps.length, 0);
  log(`📊 总依赖关系数: ${totalDeps}`, 'cyan');

  // 检测循环依赖
  log('\n🔍 检测循环依赖...', 'cyan');
  const cycles = detectCycles(dependencies);

  if (cycles.length === 0) {
    log('✅ 未发现循环依赖', 'green');
  } else {
    log(`❌ 发现 ${cycles.length} 个循环依赖:`, 'red');
    cycles.forEach((cycle, index) => {
      log(`\n   循环 ${index + 1}:`, 'yellow');
      log(`   ${cycle.join(' → ')}`, 'yellow');
    });
  }

  // 检测无效依赖
  log('\n🔍 检测无效依赖...', 'cyan');
  const invalidDeps = detectInvalidDependencies(dependencies);

  if (invalidDeps.length === 0) {
    log('✅ 所有依赖关系有效', 'green');
  } else {
    log(`⚠️  发现 ${invalidDeps.length} 个无效依赖:`, 'yellow');
    invalidDeps.forEach(({ storyId, depId }) => {
      log(`   ${storyId} 依赖的 ${depId} 不存在`, 'yellow');
    });
  }

  // 汇总结果
  log('\n' + '='.repeat(60), 'cyan');
  log('检查结果汇总:', 'cyan');
  log('='.repeat(60), 'cyan');

  if (cycles.length === 0 && invalidDeps.length === 0) {
    log('✅ 依赖关系健康，无循环依赖和无效依赖！', 'green');
    process.exit(0);
  } else {
    log('❌ 发现问题，请修正：', 'red');
    if (cycles.length > 0) {
      log(`   - ${cycles.length} 个循环依赖`, 'red');
    }
    if (invalidDeps.length > 0) {
      log(`   - ${invalidDeps.length} 个无效依赖`, 'yellow');
    }
    log('\n建议：', 'yellow');
    log('1. 重新设计循环依赖的 Story，消除循环', 'yellow');
    log('2. 删除或修正无效的依赖引用', 'yellow');
    log('3. 更新 /docs/data/global-dependency-graph.md', 'yellow');
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

module.exports = { parseDependencies, collectAllDependencies, detectCycles, detectInvalidDependencies };

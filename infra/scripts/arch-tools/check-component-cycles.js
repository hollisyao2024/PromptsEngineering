#!/usr/bin/env node

/**
 * check-component-cycles.js - 组件循环依赖检查工具
 *
 * 功能：
 * - 解析 component-dependency-graph.md
 * - 提取组件依赖关系
 * - 使用 DFS 算法检测循环依赖
 * - 报告循环路径
 */

const fs = require('fs');
const path = require('path');
const { resolveRepoRoot } = require('../shared/config');

// 配置
const PROJECT_ROOT = resolveRepoRoot({ scriptDir: __dirname });
const COMPONENT_GRAPH_FILE = path.join(PROJECT_ROOT, 'docs/data/component-dependency-graph.md');

// 命令行参数
const args = process.argv.slice(2);
const isJsonMode = args.includes('--json');

// 依赖图（邻接表）
const dependencyGraph = new Map();

/**
 * 解析 Mermaid 依赖图
 */
function parseDependencyGraph() {
  if (!fs.existsSync(COMPONENT_GRAPH_FILE)) {
    console.log('⚠️  Component dependency graph not found:');
    console.log('   ' + COMPONENT_GRAPH_FILE);
    console.log('\n❌ Please generate docs/data/component-dependency-graph.md (e.g. copy /docs/data/templates/arch/COMPONENT-DEPENDENCY-GRAPH-TEMPLATE.md and fill real component IDs/edges) before running this check.\n');
    process.exit(1);
  }

  const content = fs.readFileSync(COMPONENT_GRAPH_FILE, 'utf8');

  const templatePath = path.join(path.dirname(COMPONENT_GRAPH_FILE), 'templates/arch/COMPONENT-DEPENDENCY-GRAPH-TEMPLATE.md');
  if (fs.existsSync(templatePath)) {
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    if (content.trim() === templateContent.trim()) {
      console.log('\n⚠️  Component dependency graph still matches the template skeleton. Please populate actual Component IDs/edges before running the check.\n');
      process.exit(1);
    }
  }

  // 匹配 Mermaid 依赖关系：A --> B 或 A -->|label| B
  // 支持多种箭头格式：-->, --->, -->>, etc.
  const edgeRegex = /(\w+(?:_\w+)*)\s*--+>(?:\|[^|]*\|)?\s*(\w+(?:_\w+)*)/g;
  let match;

  while ((match = edgeRegex.exec(content)) !== null) {
    const from = match[1];
    const to = match[2];

    // 构建邻接表
    if (!dependencyGraph.has(from)) {
      dependencyGraph.set(from, []);
    }
    dependencyGraph.get(from).push(to);
  }

  console.log(`\n🔍 Parsed ${dependencyGraph.size} components with dependencies\n`);
}

/**
 * DFS 检测循环依赖
 * @param {string} node - 当前节点
 * @param {Set} visited - 已访问节点
 * @param {Set} recStack - 递归栈（当前路径）
 * @param {Array} path - 当前路径
 * @returns {Array|null} - 循环路径或 null
 */
function detectCycleDFS(node, visited, recStack, path) {
  visited.add(node);
  recStack.add(node);
  path.push(node);

  const neighbors = dependencyGraph.get(node) || [];
  for (const neighbor of neighbors) {
    if (!visited.has(neighbor)) {
      const cycle = detectCycleDFS(neighbor, visited, recStack, [...path]);
      if (cycle) return cycle;
    } else if (recStack.has(neighbor)) {
      // 找到循环：从 neighbor 到当前 path 末尾
      const cycleStart = path.indexOf(neighbor);
      return [...path.slice(cycleStart), neighbor];
    }
  }

  recStack.delete(node);
  return null;
}

/**
 * 查找所有循环依赖
 */
function findAllCycles() {
  const visited = new Set();
  const cycles = [];

  for (const node of dependencyGraph.keys()) {
    if (!visited.has(node)) {
      const recStack = new Set();
      const cycle = detectCycleDFS(node, visited, recStack, []);
      if (cycle) {
        // 去重：标准化循环路径（从最小节点开始）
        const minIndex = cycle.indexOf(Math.min(...cycle));
        const normalizedCycle = [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)];
        const cycleKey = normalizedCycle.join(' → ');

        // 检查是否已记录此循环
        if (!cycles.some(c => c.key === cycleKey)) {
          cycles.push({ key: cycleKey, path: normalizedCycle });
        }
      }
    }
  }

  return cycles;
}

/**
 * 主函数
 */
function main() {
  if (!isJsonMode) {
    console.log('\n🔍 Checking for Circular Dependencies in Component Graph...\n');
  }

  // 1. 解析依赖图
  parseDependencyGraph();

  if (dependencyGraph.size === 0) {
    if (isJsonMode) {
      console.log(JSON.stringify({
        status: 'pass',
        summary: { components: 0, cycles: 0 },
        details: { message: 'No dependencies found in the graph' },
        timestamp: new Date().toISOString()
      }, null, 2));
    } else {
      console.log('⚠️  No dependencies found in the graph\n');
    }
    process.exit(0);
  }

  // 2. 检测循环依赖
  const cycles = findAllCycles();

  // 3. 输出结果
  if (isJsonMode) {
    // JSON 输出
    const jsonOutput = {
      status: cycles.length === 0 ? 'pass' : 'fail',
      summary: {
        components: dependencyGraph.size,
        cycles: cycles.length
      },
      details: cycles.map((cycle, index) => ({
        cycleNumber: index + 1,
        path: cycle.path
      })),
      timestamp: new Date().toISOString()
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
  } else {
    // 文本输出
    if (cycles.length === 0) {
      console.log('✅ PASS: No circular dependencies found\n');
    } else {
      console.log(`❌ FAIL: ${cycles.length} circular ${cycles.length > 1 ? 'dependencies' : 'dependency'} detected:\n`);
      cycles.forEach((cycle, index) => {
        console.log(`   ${index + 1}. ${cycle.path.join(' → ')}`);
      });
      console.log('\n⚠️  Circular dependencies can cause:\n');
      console.log('   - Deployment order issues');
      console.log('   - Runtime deadlocks');
      console.log('   - Testing complexity');
      console.log('\n💡 Recommendation: Refactor to break the cycle using:');
      console.log('   - Event-driven architecture (async messaging)');
      console.log('   - Dependency inversion (introduce abstraction layer)');
      console.log('   - Module splitting\n');
    }
  }

  process.exit(cycles.length === 0 ? 0 : 1);
}

// 运行
main();

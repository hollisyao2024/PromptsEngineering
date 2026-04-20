#!/usr/bin/env node
/**
 * generate-codemap.js — 自动生成 docs/data/CODEBASE_MAP.md
 *
 * Usage:
 *   pnpm run codemap                    # 全量扫描 (--scope=project)
 *   pnpm run codemap:session            # 仅当前分支改动文件 (--scope=session)
 *
 * 扫描 apps/ 和 packages/ 下的源码文件，提取职责描述与 exports，
 * 输出一行一文件的代码地图，供大模型快速定位代码。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUTPUT = path.join(ROOT, 'docs', 'data', 'CODEBASE_MAP.md');
const SCAN_DIRS = ['apps', 'packages'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const INCLUDE_DIR_PATTERNS = [
  /^apps\/[^/]+\/src\/app\//,
  /^apps\/[^/]+\/src\/lib\//,
  /^apps\/[^/]+\/src\/services\//,
  /^apps\/[^/]+\/src\/instrumentation\.ts$/,
  /^apps\/[^/]+\/src\/proxy\.ts$/,
  /^apps\/[^/]+\/scripts\/qa\//,
  /^packages\/[^/]+\/src\//,
];

// 过滤规则
const SKIP_PATTERNS = [
  /node_modules/,
  /\/__mocks__\//,
  /(^|\/)__tests__(\/|$)/,
  /(^|\/)tests?(\/|$)/,
  /(^|\/)[^/]*test[^/]*$/,
  /\.d\.ts$/,
  /\.test\./,
  /\.spec\./,
  /\.config\./,
  /tsconfig/,
  /dist\//,
  /\.next\//,
  /\.next-deploy\//,
  /standalone\//,
  /\.turbo\//,
  /coverage\//,
  /build\//,
];

// ─── 参数解析 ────────────────────────────────────────────

function parseArgs(argv) {
  let scope = 'project';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--scope' && argv[i + 1]) {
      scope = argv[i + 1];
      i++;
    } else if (arg.startsWith('--scope=')) {
      scope = arg.split('=')[1];
    } else if (arg === '--session') {
      scope = 'session';
    }
  }
  return scope === 'session' ? 'session' : 'project';
}

// ─── 文件收集 ────────────────────────────────────────────

function collectFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(ROOT, fullPath);

    if (SKIP_PATTERNS.some((p) => p.test(relPath))) continue;

    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else if (
      entry.isFile() &&
      EXTENSIONS.has(path.extname(entry.name)) &&
      INCLUDE_DIR_PATTERNS.some((p) => p.test(relPath))
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

function getSessionFiles(exec = execSync) {
  try {
    const output = exec('git diff main...HEAD --name-only', {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    if (!output) {
      console.warn('⚠️  当前分支没有可扫描的差异文件，回退到全量扫描');
      return null;
    }
    return new Set(
      output
        .split('\n')
        .map((f) => path.join(ROOT, f))
        .filter((f) => EXTENSIONS.has(path.extname(f)))
    );
  } catch {
    console.warn('⚠️  无法获取分支差异（可能在 main 分支上），回退到全量扫描');
    return null;
  }
}

// ─── 文件解析 ────────────────────────────────────────────

const EXPORT_RE =
  /^export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/;
const EXPORT_DEFAULT_RE = /^export\s+default\s+/;
const EXPORT_FROM_RE = /^export\s+(?:\*|\{.+\})\s+from\s+['"]/;
const KEY_FILE_NAMES = new Set([
  'page.tsx',
  'layout.tsx',
  'route.ts',
  'index.ts',
  'index.tsx',
  'client.ts',
  'proxy.ts',
  'instrumentation.ts',
]);
const GROUP_CONFIGS = [
  {
    id: 'web-runtime',
    title: 'Web Runtime',
    match: (relPath) =>
      /^apps\/[^/]+\/src\/(instrumentation\.ts|proxy\.ts)$/.test(relPath),
    summary: 'Web 应用运行时入口与全局请求拦截。',
    detailLimit: 4,
  },
  {
    id: 'web-app',
    title: 'Web Pages',
    match: (relPath) =>
      /^apps\/[^/]+\/src\/app\//.test(relPath) &&
      !/\/src\/app\/api\//.test(relPath),
    summary: 'Next.js 页面、布局和前端路由入口。',
    detailLimit: 10,
  },
  {
    id: 'web-api',
    title: 'Web API Routes',
    match: (relPath) => /^apps\/[^/]+\/src\/app\/api\//.test(relPath),
    summary: 'Next.js API 路由入口。',
    detailLimit: 12,
  },
  {
    id: 'web-lib',
    title: 'Web Core Libs',
    match: (relPath) => /^apps\/[^/]+\/src\/lib\//.test(relPath),
    summary: '跨页面复用的核心库、领域工具与基础设施封装。',
    detailLimit: 10,
  },
  {
    id: 'web-services',
    title: 'Web Services',
    match: (relPath) => /^apps\/[^/]+\/src\/services\//.test(relPath),
    summary: '业务服务层与后台流程编排。',
    detailLimit: 10,
  },
  {
    id: 'qa-scripts',
    title: 'QA Scripts',
    match: (relPath) => /^apps\/[^/]+\/scripts\/qa\//.test(relPath),
    summary: '手动验证和专项检查脚本。',
    detailLimit: 6,
  },
  {
    id: 'database',
    title: 'Database Package',
    match: (relPath) => /^packages\/[^/]+\/src\//.test(relPath),
    summary: '数据库访问入口与共享数据层导出。',
    detailLimit: 8,
  },
];

function parseFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  const lines = content.split('\n');

  // 提取描述：前 5 行中的 JSDoc 或单行注释
  let description = '';
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i].trim();
    // 单行 JSDoc: /** description */
    const jsdocMatch = line.match(/^\/\*\*\s*(.+?)\s*\*\/$/);
    if (jsdocMatch) {
      description = jsdocMatch[1];
      break;
    }
    // 多行 JSDoc 第二行: * description
    if (line.startsWith('* ') && i > 0 && lines[i - 1].trim() === '/**') {
      description = line.replace(/^\*\s*/, '').replace(/\s*\*\/$/, '');
      break;
    }
    // 单行注释（但跳过 shebang 和 eslint 指令）
    if (
      line.startsWith('// ') &&
      !line.startsWith('#!/') &&
      !line.startsWith('// eslint') &&
      !line.startsWith('// @ts-')
    ) {
      description = line.replace(/^\/\/\s*/, '');
      break;
    }
  }

  // 提取 exports
  const exports = [];
  let hasDefaultExport = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(EXPORT_RE);
    if (match) {
      exports.push(match[1]);
      continue;
    }
    if (EXPORT_FROM_RE.test(trimmed)) {
      exports.push('re-export');
      continue;
    }
    if (EXPORT_DEFAULT_RE.test(trimmed)) {
      hasDefaultExport = true;
    }
  }

  // 过滤：只收录有 export 的文件
  if (exports.length === 0 && !hasDefaultExport) return null;

  return { description, exports, hasDefaultExport };
}

// ─── 输出生成 ────────────────────────────────────────────

function rankFile(relPath, parsed) {
  const fileName = path.basename(relPath);
  let score = 0;

  if (fileName === 'route.ts') score += 10;
  else if (fileName === 'page.tsx') score += 9;
  else if (fileName === 'layout.tsx') score += 8;
  else if (KEY_FILE_NAMES.has(fileName)) score += 6;
  if (parsed.hasDefaultExport) score += 3;
  if (parsed.description && parsed.description !== '(undocumented)') score += 2;
  if (/\/src\/app\/api\//.test(relPath)) score += 4;
  if (/\/src\/app\/page\.tsx$/.test(relPath)) score += 4;
  if (/\/src\/app\/layout\.tsx$/.test(relPath)) score += 3;
  if (/\/services\//.test(relPath)) score += 2;
  if (/\/lib\//.test(relPath)) score += 1;

  const segments = relPath.split('/');
  score += Math.max(0, 8 - segments.length);

  return score;
}

function getBucketKey(sectionId, relPath) {
  const parts = relPath.split('/');

  if (sectionId === 'web-app') {
    const appIndex = parts.indexOf('app');
    const appParts = parts.slice(appIndex + 1);
    if (appParts.length === 1) return '(root)';
    return appParts[0];
  }

  if (sectionId === 'web-api') {
    const apiIndex = parts.indexOf('api');
    const apiParts = parts.slice(apiIndex + 1);
    return `api/${apiParts[0] || '(root)'}`;
  }

  if (sectionId === 'web-lib') {
    const libIndex = parts.indexOf('lib');
    return `lib/${parts[libIndex + 1] || '(root)'}`;
  }

  if (sectionId === 'web-services') {
    const serviceIndex = parts.indexOf('services');
    return `services/${parts[serviceIndex + 1] || '(root)'}`;
  }

  return relPath;
}

function selectTopEntries(sectionId, entries, detailLimit) {
  const sorted = [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.relPath.localeCompare(b.relPath);
  });

  const selected = [];
  const usedBuckets = new Set();

  for (const entry of sorted) {
    if (selected.length >= detailLimit) break;
    const bucket = getBucketKey(sectionId, entry.relPath);
    if (usedBuckets.has(bucket)) continue;
    usedBuckets.add(bucket);
    selected.push(entry);
  }

  if (selected.length < detailLimit) {
    for (const entry of sorted) {
      if (selected.length >= detailLimit) break;
      if (selected.includes(entry)) continue;
      selected.push(entry);
    }
  }

  return selected;
}

function formatEntry(relPath, parsed) {
  const desc = parsed.description || '(undocumented)';
  const exportList = [...parsed.exports];
  if (parsed.hasDefaultExport) exportList.push('default');
  const exportsPreview =
    exportList.length > 0
      ? ` (exports: ${exportList.slice(0, 4).join(', ')}${
          exportList.length > 4 ? ', ...' : ''
        })`
      : '';
  return `- ${relPath}: ${desc}${exportsPreview}`;
}

function generateMap(files) {
  const sections = GROUP_CONFIGS.map((config) => ({ config, entries: [] }));
  let indexedFileCount = 0;

  for (const filePath of files) {
    const parsed = parseFile(filePath);
    if (!parsed) continue;

    indexedFileCount++;
    const relPath = path.relative(ROOT, filePath);
    const section = sections.find(({ config }) => config.match(relPath));
    if (!section) continue;

    section.entries.push({
      relPath,
      parsed,
      score: rankFile(relPath, parsed),
    });
  }

  const now = new Date().toISOString().replace(/\.\d+Z$/, '');
  const scannedDirs = SCAN_DIRS.filter((d) =>
    fs.existsSync(path.join(ROOT, d))
  ).join(', ');

  let output = `# Codebase Map\n`;
  output += `> Auto-generated by \`pnpm run codemap\`. Do not edit manually.\n`;
  let keyEntryCount = 0;
  for (const { config, entries } of sections) {
    if (entries.length === 0) continue;
    keyEntryCount += Math.min(entries.length, config.detailLimit);
  }

  output += `> Last updated: ${now} | Indexed files: ${indexedFileCount} | Key entries: ${keyEntryCount} | Scanned: ${scannedDirs || '(none)'}\n`;
  output += `> Format: high-level navigation with key entry files only.\n`;

  for (const { config, entries } of sections) {
    if (entries.length === 0) continue;
    const topEntries = selectTopEntries(
      config.id,
      entries,
      config.detailLimit
    );

    output += `\n## ${config.title}\n`;
    output += `- Scope: ${config.summary}\n`;
    output += `- Files: ${entries.length}\n`;
    output += `- Key entries:\n`;
    output += topEntries.map(({ relPath, parsed }) => formatEntry(relPath, parsed)).join('\n');
    output += '\n';
  }

  return { output, indexedFileCount, keyEntryCount };
}

// ─── 主流程 ──────────────────────────────────────────────

function main() {
  const scope = parseArgs(process.argv.slice(2));

  // 收集文件
  let allFiles = [];
  for (const dir of SCAN_DIRS) {
    const fullDir = path.join(ROOT, dir);
    allFiles.push(...collectFiles(fullDir));
  }

  // session 模式：过滤仅当前分支改动文件
  if (scope === 'session') {
    const sessionFiles = getSessionFiles();
    if (sessionFiles) {
      allFiles = allFiles.filter((f) => sessionFiles.has(f));
      if (allFiles.length === 0) {
        console.warn('⚠️  当前分支差异不在高价值源码目录内，回退到全量扫描');
        allFiles = [];
        for (const dir of SCAN_DIRS) {
          const fullDir = path.join(ROOT, dir);
          allFiles.push(...collectFiles(fullDir));
        }
      }
    }
    // sessionFiles 为 null 时回退全量
  }

  // 生成内容
  const { output: content, keyEntryCount } = generateMap(allFiles);

  // 确保输出目录存在
  const outputDir = path.dirname(OUTPUT);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT, content, 'utf8');

  console.log(`✅ Codebase Map 已生成: ${path.relative(ROOT, OUTPUT)} (${keyEntryCount} key entries)`);
}

if (require.main === module) {
  main();
}

module.exports = {
  ROOT,
  OUTPUT,
  SCAN_DIRS,
  EXTENSIONS,
  INCLUDE_DIR_PATTERNS,
  parseArgs,
  collectFiles,
  getSessionFiles,
  parseFile,
  generateMap,
  main,
};

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

// 过滤规则
const SKIP_PATTERNS = [
  /node_modules/,
  /\.d\.ts$/,
  /\.test\./,
  /\.spec\./,
  /\.config\./,
  /tsconfig/,
  /dist\//,
  /\.next\//,
  /\.turbo\//,
  /\.worktrees\//,
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
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

function getSessionFiles() {
  try {
    const output = execSync('git diff main...HEAD --name-only', {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    if (!output) return new Set();
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
    if (EXPORT_DEFAULT_RE.test(trimmed)) {
      hasDefaultExport = true;
    }
  }

  // 过滤：只收录有 export 的文件
  if (exports.length === 0 && !hasDefaultExport) return null;

  return { description, exports, hasDefaultExport };
}

// ─── 输出生成 ────────────────────────────────────────────

function generateMap(files) {
  // 按目录分组
  const groups = new Map();
  let fileCount = 0;

  for (const filePath of files) {
    const parsed = parseFile(filePath);
    if (!parsed) continue;

    fileCount++;
    const dir = path.relative(ROOT, path.dirname(filePath));
    if (!groups.has(dir)) groups.set(dir, []);

    const fileName = path.basename(filePath);
    const desc = parsed.description || '(undocumented)';
    const exportList = [...parsed.exports];
    if (parsed.hasDefaultExport) exportList.push('default');
    const exportsStr =
      exportList.length > 0 ? ` (exports: ${exportList.join(', ')})` : '';

    groups.get(dir).push(`- ${fileName}: ${desc}${exportsStr}`);
  }

  // 排序目录
  const sortedDirs = [...groups.keys()].sort();

  const now = new Date().toISOString().replace(/\.\d+Z$/, '');
  const scannedDirs = SCAN_DIRS.filter((d) =>
    fs.existsSync(path.join(ROOT, d))
  ).join(', ');

  let output = `# Codebase Map\n`;
  output += `> Auto-generated by \`pnpm run codemap\`. Do not edit manually.\n`;
  output += `> Last updated: ${now} | Files: ${fileCount} | Scanned: ${scannedDirs || '(none)'}\n`;

  for (const dir of sortedDirs) {
    output += `\n## ${dir}/\n`;
    // 文件名排序
    const entries = groups.get(dir).sort();
    output += entries.join('\n') + '\n';
  }

  return output;
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
    }
    // sessionFiles 为 null 时回退全量
  }

  // 生成内容
  const content = generateMap(allFiles);

  // 确保输出目录存在
  const outputDir = path.dirname(OUTPUT);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT, content, 'utf8');

  // 统计
  const fileCount = (content.match(/^- /gm) || []).length;
  console.log(`✅ Codebase Map 已生成: ${path.relative(ROOT, OUTPUT)} (${fileCount} files)`);
}

main();

#!/usr/bin/env node
/**
 * generate-codemap.js — 自动生成 docs/data/CODEBASE_MAP.md
 *
 * Usage:
 *   pnpm run codemap                    # 全量扫描 (--scope=project)
 *   pnpm run codemap:session            # 仅当前分支改动文件 (--scope=session)
 *
 * 按配置 codemap.scanDirs / includePatterns / groups 扫描源码文件，提取职责描述与 exports，
 * 输出一行一文件的代码地图，供大模型快速定位代码。默认值见 config.example.json（apps/ + packages/），
 * 其他目录布局在 agent.config.json 的 codemap 节覆盖；数组整组替换，扫描结果为空时输出 CODEMAP_EMPTY 告警。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { DEFAULT_CONFIG, loadConfig, resolveRepoRoot } = require('../shared/config');

const ROOT = resolveRepoRoot({ scriptDir: __dirname });
const OUTPUT = path.join(ROOT, 'docs', 'data', 'CODEBASE_MAP.md');
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
function normalizePathSeparators(filePath) {
  return filePath.replace(/\\/g, '/');
}

// 过滤规则
const SKIP_PATTERNS = [
  /node_modules/,
  /\/__mocks__\//,
  /(^|\/)__tests__(\/|$)/,
  /(^|\/)tests?(\/|$)/,
  // 按分词边界识别测试文件名（foo.test.ts、test-utils.ts、testUtils.ts），不误伤 latest-orders.ts、connection-tester.ts
  /(^|\/)(?:[^/]*[._-])?tests?(?:[._-][^/]*|[A-Z][^/]*)?$/,
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

// ─── 配置解析 ────────────────────────────────────────────

function compilePattern(source, label) {
  if (typeof source !== 'string' || source === '') {
    throw new Error(`${label} 必须是非空正则字符串`);
  }
  try {
    return new RegExp(source);
  } catch (error) {
    throw new Error(`${label} 不是合法正则: ${error.message}`);
  }
}

function resolveGroup(group, index) {
  const label = `codemap.groups[${index}]`;
  for (const key of ['id', 'title', 'summary']) {
    if (typeof group?.[key] !== 'string' || group[key] === '') {
      throw new Error(`${label}.${key} 必须是非空字符串`);
    }
  }
  if (!Number.isInteger(group.detailLimit) || group.detailLimit < 1) {
    throw new Error(`${label}.detailLimit 必须是正整数`);
  }
  const resolved = {
    id: group.id,
    title: group.title,
    summary: group.summary,
    detailLimit: group.detailLimit,
    pattern: compilePattern(group.pattern, `${label}.pattern`),
    bucketPattern: null,
  };
  if (group.bucketPattern !== undefined) {
    resolved.bucketPattern = compilePattern(group.bucketPattern, `${label}.bucketPattern`);
    // 分桶取第一个捕获组；没有捕获组时所有文件落入同一桶，配置必然写错
    if (new RegExp(`${group.bucketPattern}|`).exec('').length < 2) {
      throw new Error(`${label}.bucketPattern 必须包含一个捕获组`);
    }
  }
  return resolved;
}

// 配置错误在写文件前抛出，保留已有地图；tdd sync 对生成失败只告警。
function resolveCodemapOptions(config) {
  const { scanDirs, includePatterns, groups } = config?.codemap || {};
  const isSafeDir = (dir) =>
    typeof dir === 'string' &&
    dir !== '' &&
    !path.isAbsolute(dir) &&
    !normalizePathSeparators(dir).split('/').includes('..');
  if (!Array.isArray(scanDirs) || scanDirs.length === 0 || !scanDirs.every(isSafeDir)) {
    throw new Error('codemap.scanDirs 必须是非空数组，且每项都是仓库内相对路径');
  }
  if (!Array.isArray(includePatterns) || includePatterns.length === 0) {
    throw new Error('codemap.includePatterns 必须是非空数组');
  }
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error('codemap.groups 必须是非空数组');
  }
  return {
    scanDirs,
    includePatterns: includePatterns.map((source, index) =>
      compilePattern(source, `codemap.includePatterns[${index}]`)
    ),
    groups: groups.map(resolveGroup),
  };
}

const DEFAULT_OPTIONS = resolveCodemapOptions(DEFAULT_CONFIG);
const SCAN_DIRS = DEFAULT_OPTIONS.scanDirs;
const INCLUDE_DIR_PATTERNS = DEFAULT_OPTIONS.includePatterns;

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

function collectFiles(dir, options = DEFAULT_OPTIONS, root = ROOT) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = normalizePathSeparators(path.relative(root, fullPath));

    if (SKIP_PATTERNS.some((p) => p.test(relPath))) continue;

    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, options, root));
    } else if (
      entry.isFile() &&
      EXTENSIONS.has(path.extname(entry.name)) &&
      options.includePatterns.some((p) => p.test(relPath))
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

// 分支名只允许 Git 常见字符且不以 - 开头，避免拼进 shell 命令时被解释为参数或元字符。
const SAFE_BASE_BRANCH_RE = /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/;

/**
 * 解析 session 差异的比较基准：优先远端跟踪分支 origin/<base>，本地 base 落后时也不会把
 * 主干已合并的提交误报为本分支改动；没有远端引用（离线、未 fetch）时回退本地 base。
 */
function resolveSessionBaseRef(exec, baseBranch) {
  try {
    exec(`git rev-parse --verify --quiet refs/remotes/origin/${baseBranch}`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return `origin/${baseBranch}`;
  } catch {
    return baseBranch;
  }
}

function getSessionFiles(exec = execSync, options = {}) {
  const baseBranch = options.baseBranch || 'main';
  if (!SAFE_BASE_BRANCH_RE.test(baseBranch)) {
    console.warn(`⚠️  baseBranch 含非法字符（${JSON.stringify(baseBranch)}），回退到全量扫描`);
    return null;
  }
  try {
    const baseRef = resolveSessionBaseRef(exec, baseBranch);
    const output = exec(`git diff ${baseRef}...HEAD --name-only`, {
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
    console.warn(`⚠️  无法获取相对 ${baseBranch} 的分支差异，回退到全量扫描`);
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
  'main.ts',
  'main.tsx',
]);
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

  // 过滤：只收录有 export 的文件；进程入口（main.ts、preload/index.ts 等）通常无 export，但最需要入图
  if (
    exports.length === 0 &&
    !hasDefaultExport &&
    !KEY_FILE_NAMES.has(path.basename(filePath))
  ) {
    return null;
  }

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

// 无 bucketPattern 时每个文件自成一桶，只按分值排序
function getBucketKey(group, relPath) {
  if (!group.bucketPattern) return relPath;
  const match = group.bucketPattern.exec(relPath);
  return match ? match[1] : '(root)';
}

function selectTopEntries(group, entries) {
  const sorted = [...entries].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.relPath.localeCompare(b.relPath);
  });

  const selected = [];
  const usedBuckets = new Set();

  for (const entry of sorted) {
    if (selected.length >= group.detailLimit) break;
    const bucket = getBucketKey(group, entry.relPath);
    if (usedBuckets.has(bucket)) continue;
    usedBuckets.add(bucket);
    selected.push(entry);
  }

  if (selected.length < group.detailLimit) {
    for (const entry of sorted) {
      if (selected.length >= group.detailLimit) break;
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

function generateMap(files, options = DEFAULT_OPTIONS, root = ROOT) {
  const sections = options.groups.map((config) => ({ config, entries: [] }));
  let indexedFileCount = 0;

  for (const filePath of files) {
    const parsed = parseFile(filePath);
    if (!parsed) continue;

    indexedFileCount++;
    const relPath = normalizePathSeparators(path.relative(root, filePath));
    const section = sections.find(({ config }) => config.pattern.test(relPath));
    if (!section) continue;

    section.entries.push({
      relPath,
      parsed,
      score: rankFile(relPath, parsed),
    });
  }

  const now = new Date().toISOString().replace(/\.\d+Z$/, '');
  const scannedDirs = options.scanDirs.filter((d) =>
    fs.existsSync(path.join(root, d))
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
    const topEntries = selectTopEntries(config, entries);

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

// The map always describes the full high-value file set; `--scope=session` only adds the branch's changed
// high-value files as a report line so tdd sync never overwrites docs/data/CODEBASE_MAP.md with a fragment.
function selectFilesForScope({ scope, allFiles, sessionFiles }) {
  const changed = scope === 'session' && sessionFiles
    ? allFiles.filter((file) => sessionFiles.has(file))
    : [];
  return { files: allFiles, changed };
}

// 空地图通常意味着扫描范围与项目布局不符；生成物仍写入，但必须让执行器看见，否则会被当作正常结果。
function emptyMapWarning({ indexedFileCount, scanDirs, root = ROOT }) {
  if (indexedFileCount > 0) return null;
  const missing = scanDirs.filter((dir) => !fs.existsSync(path.join(root, dir)));
  return `CODEMAP_EMPTY=未索引到任何文件；扫描目录: ${scanDirs.join(', ')}；不存在: ${missing.join(', ') || '(无)'}。请在 agent.config.json 配置 codemap.scanDirs / includePatterns / groups`;
}

function main() {
  const scope = parseArgs(process.argv.slice(2));
  const config = loadConfig({ repoRoot: ROOT });
  const options = resolveCodemapOptions(config);

  // 收集文件（始终全量；session 只影响报告）
  const allFiles = [];
  for (const dir of options.scanDirs) {
    const fullDir = path.join(ROOT, dir);
    allFiles.push(...collectFiles(fullDir, options));
  }

  const sessionFiles = scope === 'session' ? getSessionFiles(execSync, { baseBranch: config.baseBranch }) : null;
  const { files, changed } = selectFilesForScope({ scope, allFiles, sessionFiles });

  // 生成内容
  const { output: content, indexedFileCount, keyEntryCount } = generateMap(files, options);

  // 确保输出目录存在
  const outputDir = path.dirname(OUTPUT);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT, content, 'utf8');

  console.log(`✅ Codebase Map 已生成: ${path.relative(ROOT, OUTPUT)} (${keyEntryCount} key entries, ${files.length} files)`);
  const warning = emptyMapWarning({ indexedFileCount, scanDirs: options.scanDirs });
  if (warning) console.warn(warning);
  if (scope === 'session') {
    console.log(`SESSION_CHANGED_FILES=${changed.length}`);
    for (const file of changed) console.log(`  - ${normalizePathSeparators(path.relative(ROOT, file))}`);
  }
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
  SKIP_PATTERNS,
  normalizePathSeparators,
  resolveCodemapOptions,
  emptyMapWarning,
  parseArgs,
  collectFiles,
  getSessionFiles,
  selectFilesForScope,
  parseFile,
  generateMap,
  main,
};

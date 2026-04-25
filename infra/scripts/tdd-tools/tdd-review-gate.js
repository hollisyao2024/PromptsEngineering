#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveRepoRoot } = require('../shared/config');

const repoRoot = resolveRepoRoot({ scriptDir: __dirname });

const GATE_RESULT = {
  SKIPPED:       'skipped',
  REQUIRED:      'required',
  PENDING_MODEL: 'pending-model-review',
};

// ── SKIP 类正则（零歧义场景，无需模型判断）──────────────────────────────
const DOC_FILE_RE        = /(^docs\/|^README(\.[^.]+)?$|\.mdx?$)/i;
const TEST_FILE_RE       = /(^e2e\/|^perf\/|^security\/|(^|\/)(__tests__|tests)(\/|$)|\.(test|spec)\.[^.]+$|\.integration\.test\.[^.]+$|\.consumer\.pact\.test\.[^.]+$|\.provider\.pact\.test\.[^.]+$|\.degradation\.test\.[^.]+$)/i;
const FIXTURE_FILE_RE    = /(^|\/)(fixtures?|mocks?|__snapshots__|snapshots?|demo|examples?)(\/|$)/i;
const DEV_ASSIST_FILE_RE = /(^\.vscode\/|^\.idea\/|(^|\/)\.editorconfig$|(^|\/)\.prettierignore$|(^|\/)\.prettierrc(\..+)?$|(^|\/)\.eslintignore$|(^|\/)\.gitignore$|(^|\/)\.gitattributes$|(^|\/)spellcheck|(^|\/)cspell(\.|$))/i;
const LOCKFILE_RE        = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/i;
const GENERATED_FILE_RE  = /(\.generated\.|\.gen\.|@generated|__generated__|\/generated\/|\/dist\/|\/build\/|\/vendor\/|\.snap$)/i;

// ── 直接 REQUIRED（脚本可确定，无需模型）───────────────────────────────
const HOTFIX_BRANCH_RE   = /(^|\/)(hotfix|rollback|emergency|urgent)(\/|[-_])/i;

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed with exit ${result.status}`);
  }

  return result.stdout;
}

function normalizeFilePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function getCommentPrefixes(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.js', '.jsx', '.ts', '.tsx', '.java', '.c', '.cc', '.cpp', '.cs', '.go', '.rs', '.swift', '.kt'].includes(ext)) {
    return ['//', '/*', '*', '*/'];
  }
  if (['.py', '.sh', '.bash', '.zsh', '.yml', '.yaml', '.toml', '.ini', '.conf', '.rb'].includes(ext)) {
    return ['#'];
  }
  if (['.sql'].includes(ext)) {
    return ['--'];
  }
  return [];
}

function isCommentOnlyDiff(filePath, patchText) {
  const commentPrefixes = getCommentPrefixes(filePath);
  if (!commentPrefixes.length || !patchText) {
    return false;
  }

  const changedLines = patchText
    .split('\n')
    .filter((line) => (line.startsWith('+') || line.startsWith('-'))
      && !line.startsWith('+++')
      && !line.startsWith('---'))
    .map((line) => line.slice(1).trim())
    .filter((line) => line.length > 0);

  if (!changedLines.length) {
    return false;
  }

  return changedLines.every((line) => commentPrefixes.some((prefix) => line.startsWith(prefix)));
}

function buildAreaTag(filePath) {
  const normalized = normalizeFilePath(filePath);
  const parts = normalized.split('/');
  if (parts[0] === 'apps' || parts[0] === 'packages') {
    return parts.slice(0, 3).join('/');
  }
  return parts.slice(0, 2).join('/');
}

function detectSignals(context) {
  const changedFiles = context.changedFiles.map(normalizeFilePath);
  const diffByFile = context.diffByFile || {};
  const businessFiles = [];
  const runtimeAreas = new Set();
  let totalChangedLines = 0;

  const signals = {
    allDocsOnly:      changedFiles.length > 0,
    allTestsOnly:     changedFiles.length > 0,
    allFixturesOnly:  changedFiles.length > 0,
    allDevAssistOnly: changedFiles.length > 0,
    lockfileOnly:     changedFiles.length > 0,
    commentOnly:      changedFiles.length > 0,
    allGeneratedOnly: changedFiles.length > 0,
    hotfixBranch:     HOTFIX_BRANCH_RE.test(context.branchName || ''),
  };

  for (const filePath of changedFiles) {
    const normalized = normalizeFilePath(filePath);
    const numstat    = context.numstatByFile?.[normalized] || { added: 0, removed: 0 };
    const patchText  = diffByFile[normalized] || '';
    const isDoc        = DOC_FILE_RE.test(normalized);
    const isTest       = TEST_FILE_RE.test(normalized);
    const isFixture    = FIXTURE_FILE_RE.test(normalized);
    const isDevAssist  = DEV_ASSIST_FILE_RE.test(normalized);
    const isLockfile   = LOCKFILE_RE.test(normalized);
    const isGenerated  = GENERATED_FILE_RE.test(normalized);
    const isCommentOnly = isCommentOnlyDiff(normalized, patchText);
    const isNonBusiness = isDoc || isTest || isFixture || isDevAssist || isLockfile || isGenerated;

    signals.allDocsOnly      &&= isDoc;
    signals.allTestsOnly     &&= isTest;
    signals.allFixturesOnly  &&= isFixture;
    signals.allDevAssistOnly &&= isDevAssist;
    signals.lockfileOnly     &&= isLockfile;
    signals.commentOnly      &&= isCommentOnly;
    signals.allGeneratedOnly &&= isGenerated;

    if (!isNonBusiness) {
      businessFiles.push(normalized);
      runtimeAreas.add(buildAreaTag(normalized));
      totalChangedLines += Number(numstat.added || 0) + Number(numstat.removed || 0);
    }
  }

  signals.businessFiles    = businessFiles;
  signals.runtimeAreas     = Array.from(runtimeAreas);
  signals.totalChangedLines = totalChangedLines;

  return signals;
}

function isRenamedOnly(baseRef) {
  // 检测是否仅有 rename/move（无内容变更）
  const output = runGit(
    ['diff', '--diff-filter=R', '--name-only', `${baseRef}...HEAD`],
    { capture: true },
  ).trim();
  const renamed = output ? output.split('\n').filter(Boolean) : [];

  const all = runGit(
    ['diff', '--name-only', `${baseRef}...HEAD`],
    { capture: true },
  ).trim();
  const allFiles = all ? all.split('\n').filter(Boolean) : [];

  return renamed.length > 0 && renamed.length === allFiles.length;
}

function classifyChanges(context) {
  const changedFiles = (context.changedFiles || []).map(normalizeFilePath);
  const signals = detectSignals({ ...context, changedFiles });

  // 1. 无变更
  if (!changedFiles.length) {
    return { gateResult: GATE_RESULT.SKIPPED, reason: '未检测到与基线分支的差异', signals };
  }

  // 2. hotfix 分支 → 直接 REQUIRED（脚本唯一直接输出 REQUIRED 的情况）
  if (signals.hotfixBranch) {
    return { gateResult: GATE_RESULT.REQUIRED, reason: '当前分支属于 hotfix/rollback/emergency 类型，按规则必须执行 code review', signals };
  }

  // 3-8. 明确 SKIP 场景
  if (signals.allDocsOnly) {
    return { gateResult: GATE_RESULT.SKIPPED, reason: '仅包含文档回写或 Markdown 文档变更', signals };
  }
  if (signals.allTestsOnly) {
    return { gateResult: GATE_RESULT.SKIPPED, reason: '仅包含测试文件变更，未修改生产代码', signals };
  }
  if (signals.allFixturesOnly) {
    return { gateResult: GATE_RESULT.SKIPPED, reason: '仅包含非运行时资源变更（fixture/mock/截图等）', signals };
  }
  if (signals.allDevAssistOnly) {
    return { gateResult: GATE_RESULT.SKIPPED, reason: '仅包含开发辅助文件改动（编辑器配置/拼写/忽略规则等）', signals };
  }
  if (signals.lockfileOnly) {
    return { gateResult: GATE_RESULT.SKIPPED, reason: '仅检测到锁文件归一化变更，未发现依赖定义文件改动', signals };
  }
  if (signals.commentOnly) {
    return { gateResult: GATE_RESULT.SKIPPED, reason: '仅包含注释改动，未发现运行时代码变化', signals };
  }
  if (signals.allGeneratedOnly) {
    return { gateResult: GATE_RESULT.SKIPPED, reason: '仅包含 generated/dist/vendor/build 产物文件变更', signals };
  }

  // 9. 纯 rename/move（无内容变更）
  if (context.renamedOnly) {
    return { gateResult: GATE_RESULT.SKIPPED, reason: '仅包含文件 rename/move，无实质内容变更', signals };
  }

  // 10. 其余所有情况 → 交由模型语义判断
  return {
    gateResult: GATE_RESULT.PENDING_MODEL,
    reason:     '包含业务代码变更，需模型对照 10 类高风险域做语义判断',
    signals,
  };
}

function resolveBaseRef(baseBranch) {
  if (baseBranch) {
    const remoteCandidate = `origin/${baseBranch}`;
    try {
      runGit(['rev-parse', '--verify', remoteCandidate], { capture: true });
      return remoteCandidate;
    } catch {
      return baseBranch;
    }
  }

  for (const candidate of ['origin/main', 'main', 'origin/master', 'master']) {
    try {
      runGit(['rev-parse', '--verify', candidate], { capture: true });
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error('无法推断基线分支，请使用 --base <branch> 显式指定。');
}

function getChangedFiles(baseRef) {
  const output = runGit(['diff', '--name-only', `${baseRef}...HEAD`], { capture: true }).trim();
  return output ? output.split('\n').map(normalizeFilePath) : [];
}

function getNumstatByFile(baseRef) {
  const output = runGit(['diff', '--numstat', `${baseRef}...HEAD`], { capture: true }).trim();
  const map = {};
  if (!output) return map;

  for (const line of output.split('\n')) {
    const [added, removed, ...fileParts] = line.split('\t');
    const filePath = normalizeFilePath(fileParts.join('\t'));
    map[filePath] = {
      added:   Number(added   === '-' ? 0 : added),
      removed: Number(removed === '-' ? 0 : removed),
    };
  }
  return map;
}

function getDiffByFile(baseRef) {
  const output = runGit(['diff', '--unified=0', `${baseRef}...HEAD`], { capture: true });
  const files = {};
  let currentFile = null;
  let buffer = [];

  for (const line of output.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (currentFile) {
        files[currentFile] = buffer.join('\n');
      }
      buffer = [];
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      currentFile = match ? normalizeFilePath(match[2]) : null;
      continue;
    }
    if (currentFile) {
      buffer.push(line);
    }
  }

  if (currentFile) {
    files[currentFile] = buffer.join('\n');
  }

  return files;
}

function analyzeReviewGate(options = {}) {
  const baseRef      = resolveBaseRef(options.baseBranch);
  const changedFiles = getChangedFiles(baseRef);
  const renamedOnly  = isRenamedOnly(baseRef);
  const result       = classifyChanges({
    branchName:    options.branchName || runGit(['branch', '--show-current'], { capture: true }).trim(),
    changedFiles,
    numstatByFile: getNumstatByFile(baseRef),
    diffByFile:    getDiffByFile(baseRef),
    renamedOnly,
  });

  return { ...result, baseRef, changedFiles };
}

function parseCliArgs(argv) {
  const options = { baseBranch: '', json: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base' && argv[i + 1]) {
      options.baseBranch = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--base=')) {
      options.baseBranch = arg.split('=')[1];
      continue;
    }
    if (arg === '--json') {
      options.json = true;
    }
  }

  return options;
}

function printHumanReadable(result) {
  const labelMap = {
    [GATE_RESULT.SKIPPED]:       'REVIEW_SKIPPED',
    [GATE_RESULT.REQUIRED]:      'REVIEW_REQUIRED',
    [GATE_RESULT.PENDING_MODEL]: 'PENDING_MODEL_REVIEW',
  };

  console.log(`Gate-Result: ${result.gateResult}`);
  console.log(`Reason: ${result.reason}`);
  console.log(`Base-Ref: ${result.baseRef}`);
  console.log(`Changed-Files: ${result.changedFiles.length}`);
  console.log(`Business-Files: ${result.signals.businessFiles.length}`);
  console.log(`Total-Changed-Lines: ${result.signals.totalChangedLines}`);
  if (result.signals.businessFiles.length) {
    console.log(`Business-File-List: ${result.signals.businessFiles.join(', ')}`);
  }
  console.log(`Decision: ${labelMap[result.gateResult]}`);
}

function main() {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const result  = analyzeReviewGate(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    printHumanReadable(result);
  } catch (error) {
    console.error(`\u001b[31m/tdd review-gate 失败: ${error.message}\u001b[0m`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  GATE_RESULT,
  analyzeReviewGate,
  classifyChanges,
  detectSignals,
  isCommentOnlyDiff,
};

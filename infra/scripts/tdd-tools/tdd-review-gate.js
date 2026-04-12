#!/usr/bin/env node
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

const REVIEW_CLASS = {
  REQUIRED: 'required',
  OPTIONAL_SKIPPED: 'optional-skipped',
  SKIPPED: 'skipped',
};

const DOC_FILE_RE = /(^docs\/|^README(\.[^.]+)?$|\.mdx?$)/i;
const TEST_FILE_RE = /(^e2e\/|^perf\/|^security\/|(^|\/)(__tests__|tests)(\/|$)|\.(test|spec)\.[^.]+$|\.integration\.test\.[^.]+$|\.consumer\.pact\.test\.[^.]+$|\.provider\.pact\.test\.[^.]+$|\.degradation\.test\.[^.]+$)/i;
const FIXTURE_FILE_RE = /(^|\/)(fixtures?|mocks?|__snapshots__|snapshots?|demo|examples?)(\/|$)/i;
const DEV_ASSIST_FILE_RE = /(^\.vscode\/|^\.idea\/|(^|\/)\.editorconfig$|(^|\/)\.prettierignore$|(^|\/)\.prettierrc(\..+)?$|(^|\/)\.eslintignore$|(^|\/)\.gitignore$|(^|\/)\.gitattributes$|(^|\/)spellcheck|(^|\/)cspell(\.|$))/i;
const WORKFLOW_AUTOMATION_RE = /^infra\/scripts\/(tdd-tools|qa-tools|task-tools|prd-tools|arch-tools)\//i;
const LOCKFILE_RE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/i;
const PROD_CONFIG_RE = /(^\.github\/workflows\/|^infra\/scripts\/(server|cron)\/|(^|\/)(Dockerfile|docker-compose(\.[^.]+)?\.ya?ml)$|(^|\/)\.env(\.[^.]+)?\.example$|(^|\/)package\.json$|(^|\/)pnpm-workspace\.yaml$|(^|\/)turbo\.json$|(^|\/)tsconfig(\..+)?\.json$|(^|\/)vite\.config\.[^.]+$|(^|\/)next\.config\.[^.]+$|(^|\/)playwright\.config\.[^.]+$)/i;
const DB_RE = /(^|\/)(prisma\/migrations\/|supabase\/migrations\/|schema\.prisma$|migration\.sql$|rollback\.sql$|seed\.[^.]+$|migrations?\/)/i;
const PUBLIC_INTERFACE_RE = /(^packages\/api-client\/|(^|\/)(openapi|contracts?)\/|(^|\/).*\.(types|dto)\.[^.]+$|(^|\/)(events?|messages?|schemas?)\.[^.]+$)/i;
const SECURITY_RE = /(^|\/)(auth|permission|permissions|rbac|acl|security|token|secret|secrets|key|keys|crypto|billing|payment|privacy|risk|oauth)(\/|[-_.])/i;
const HOTFIX_BRANCH_RE = /(^|\/)(hotfix|rollback|emergency|urgent)(\/|[-_])/i;
const COMPLEX_BEHAVIOR_RE = /\b(else if|switch|catch|retry|fallback|circuit|timeout|Promise\.(all|race)|setTimeout|setInterval)\b|(\?\s*[^:]+\s*:)|\b(Open|Half-Open|Closed)\b/;
const ERROR_HANDLING_RE = /\b(throw|Error\(|try\s*\{|catch\s*\(|console\.error|logger\.error|reject\(|res\.status\((4|5)\d\d\))\b/;

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

function getChangedLines(patchText) {
  if (!patchText) {
    return [];
  }

  return patchText
    .split('\n')
    .filter((line) => (line.startsWith('+') || line.startsWith('-'))
      && !line.startsWith('+++')
      && !line.startsWith('---'))
    .map((line) => line.slice(1))
    .filter((line) => line.trim().length > 0);
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
  let prodCodeChangedLines = 0;

  const signals = {
    allDocsOnly: changedFiles.length > 0,
    allTestsOnly: changedFiles.length > 0,
    allFixturesOnly: changedFiles.length > 0,
    allDevAssistOnly: changedFiles.length > 0,
    lockfileOnly: changedFiles.length > 0,
    commentOnly: changedFiles.length > 0,
    touchesProdConfig: false,
    touchesDatabase: false,
    touchesPublicInterface: false,
    touchesSecurityDomain: false,
    touchesWorkflowAutomation: false,
    touchesRiskyBehavior: false,
    hotfixBranch: HOTFIX_BRANCH_RE.test(context.branchName || ''),
    tooManyBusinessFiles: false,
    tooManyProdLines: false,
    crossAreaChange: false,
  };

  for (const filePath of changedFiles) {
    const normalized = normalizeFilePath(filePath);
    const numstat = context.numstatByFile?.[normalized] || { added: 0, removed: 0 };
    const patchText = diffByFile[normalized] || '';
    const isDoc = DOC_FILE_RE.test(normalized);
    const isTest = TEST_FILE_RE.test(normalized);
    const isFixture = FIXTURE_FILE_RE.test(normalized);
    const isDevAssist = DEV_ASSIST_FILE_RE.test(normalized);
    const isLockfile = LOCKFILE_RE.test(normalized);
    const isProdConfig = PROD_CONFIG_RE.test(normalized);
    const isWorkflowAutomation = WORKFLOW_AUTOMATION_RE.test(normalized);
    const isDb = DB_RE.test(normalized);
    const isPublicInterface = PUBLIC_INTERFACE_RE.test(normalized);
    const isSecurity = SECURITY_RE.test(normalized);
    const isCommentOnly = isCommentOnlyDiff(normalized, patchText);
    const businessFile = !(isDoc || isTest || isFixture || isDevAssist || isLockfile);

    signals.allDocsOnly &&= isDoc;
    signals.allTestsOnly &&= isTest;
    signals.allFixturesOnly &&= isFixture;
    signals.allDevAssistOnly &&= isDevAssist;
    signals.lockfileOnly &&= isLockfile;
    signals.commentOnly &&= isCommentOnly;
    signals.touchesProdConfig ||= isProdConfig;
    signals.touchesWorkflowAutomation ||= isWorkflowAutomation;
    signals.touchesDatabase ||= isDb;
    signals.touchesPublicInterface ||= isPublicInterface;
    signals.touchesSecurityDomain ||= isSecurity;

    if (businessFile) {
      businessFiles.push(normalized);
      runtimeAreas.add(buildAreaTag(normalized));
      prodCodeChangedLines += Number(numstat.added || 0) + Number(numstat.removed || 0);
      const changedLinesText = getChangedLines(patchText).join('\n');
      if (COMPLEX_BEHAVIOR_RE.test(changedLinesText) || ERROR_HANDLING_RE.test(changedLinesText)) {
        signals.touchesRiskyBehavior = true;
      }
    }
  }

  signals.businessFiles = businessFiles;
  signals.runtimeAreas = Array.from(runtimeAreas);
  signals.prodCodeChangedLines = prodCodeChangedLines;
  signals.tooManyBusinessFiles = businessFiles.length > 2;
  signals.tooManyProdLines = prodCodeChangedLines > 30;
  signals.crossAreaChange = runtimeAreas.size > 1;

  return signals;
}

function classifyChanges(context) {
  const changedFiles = (context.changedFiles || []).map(normalizeFilePath);
  const signals = detectSignals({
    ...context,
    changedFiles,
  });

  if (!changedFiles.length) {
    return {
      reviewClass: REVIEW_CLASS.SKIPPED,
      reason: '未检测到与基线分支的差异',
      signals,
    };
  }

  if (signals.hotfixBranch) {
    return {
      reviewClass: REVIEW_CLASS.REQUIRED,
      reason: '当前分支属于 hotfix/rollback/emergency 类型，按规则必须执行 code review',
      signals,
    };
  }

  if (signals.allDocsOnly) {
    return {
      reviewClass: REVIEW_CLASS.SKIPPED,
      reason: '仅包含文档回写或 Markdown 文档变更',
      signals,
    };
  }

  if (signals.allTestsOnly) {
    return {
      reviewClass: REVIEW_CLASS.SKIPPED,
      reason: '仅包含测试文件变更，未修改生产代码',
      signals,
    };
  }

  if (signals.allFixturesOnly) {
    return {
      reviewClass: REVIEW_CLASS.SKIPPED,
      reason: '仅包含非运行时资源变更（fixture/mock/截图等）',
      signals,
    };
  }

  if (signals.allDevAssistOnly) {
    return {
      reviewClass: REVIEW_CLASS.SKIPPED,
      reason: '仅包含开发辅助文件改动（编辑器配置/拼写/忽略规则等）',
      signals,
    };
  }

  if (signals.lockfileOnly) {
    return {
      reviewClass: REVIEW_CLASS.SKIPPED,
      reason: '仅检测到锁文件归一化变更，未发现依赖定义文件改动',
      signals,
    };
  }

  if (signals.commentOnly) {
    return {
      reviewClass: REVIEW_CLASS.SKIPPED,
      reason: '仅包含注释改动，未发现运行时代码变化',
      signals,
    };
  }

  const requiredReason = [
    [signals.touchesSecurityDomain, '变更触及认证、权限、支付或其他安全敏感域'],
    [signals.touchesDatabase, '变更涉及数据库 schema、迁移、回填或一致性逻辑'],
    [signals.touchesPublicInterface, '变更涉及公共接口、共享类型或契约定义'],
    [signals.touchesWorkflowAutomation, '变更涉及 TDD/QA/任务/PRD/架构工具链脚本，会影响多模型共享门禁或自动化流程'],
    [signals.touchesProdConfig, '变更涉及会影响生产行为的配置、构建或发布文件'],
    [signals.touchesRiskyBehavior, '变更包含条件分支、错误处理、重试/降级或异步复杂行为'],
    [signals.tooManyBusinessFiles, '业务代码变更超过 2 个文件，已超出低风险豁免阈值'],
    [signals.crossAreaChange, '改动跨越多个模块/层次，存在架构边界或联动风险'],
    [signals.tooManyProdLines, '生产代码变更行数超过 30 行，已超出低风险豁免阈值'],
  ].find(([matched]) => matched);

  if (requiredReason) {
    return {
      reviewClass: REVIEW_CLASS.REQUIRED,
      reason: requiredReason[1],
      signals,
    };
  }

  if (signals.businessFiles.length >= 1
    && signals.businessFiles.length <= 2
    && signals.prodCodeChangedLines <= 30) {
    return {
      reviewClass: REVIEW_CLASS.OPTIONAL_SKIPPED,
      reason: '单一局部低风险改动：业务文件 ≤ 2 且生产代码变更 ≤ 30 行，可在验证通过后跳过 review',
      signals,
    };
  }

  return {
    reviewClass: REVIEW_CLASS.REQUIRED,
    reason: '未命中文档/测试跳过规则，且不满足低风险豁免条件，默认要求 code review',
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
  if (!output) {
    return map;
  }

  for (const line of output.split('\n')) {
    const [added, removed, ...fileParts] = line.split('\t');
    const filePath = normalizeFilePath(fileParts.join('\t'));
    map[filePath] = {
      added: Number(added === '-' ? 0 : added),
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
  const baseRef = resolveBaseRef(options.baseBranch);
  const changedFiles = getChangedFiles(baseRef);
  const result = classifyChanges({
    branchName: options.branchName || runGit(['branch', '--show-current'], { capture: true }).trim(),
    changedFiles,
    numstatByFile: getNumstatByFile(baseRef),
    diffByFile: getDiffByFile(baseRef),
  });

  return {
    ...result,
    baseRef,
    changedFiles,
  };
}

function parseCliArgs(argv) {
  const options = {
    baseBranch: '',
    json: false,
  };

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
    [REVIEW_CLASS.REQUIRED]: 'REVIEW_REQUIRED',
    [REVIEW_CLASS.OPTIONAL_SKIPPED]: 'REVIEW_OPTIONAL',
    [REVIEW_CLASS.SKIPPED]: 'REVIEW_SKIPPED',
  };

  console.log(`Review-Class: ${result.reviewClass}`);
  console.log(`Reason: ${result.reason}`);
  console.log(`Base-Ref: ${result.baseRef}`);
  console.log(`Changed-Files: ${result.changedFiles.length}`);
  console.log(`Business-Files: ${result.signals.businessFiles.length}`);
  console.log(`Prod-Code-Lines: ${result.signals.prodCodeChangedLines}`);
  console.log(`Decision: ${labelMap[result.reviewClass]}`);
}

function main() {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const result = analyzeReviewGate(options);
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
  REVIEW_CLASS,
  analyzeReviewGate,
  classifyChanges,
  detectSignals,
  isCommentOnlyDiff,
};

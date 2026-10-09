#!/usr/bin/env node
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { analyzeReviewGate, GATE_RESULT } = require('./tdd-review-gate');
const {
  assertSessionCanResume,
  getMainRepoRoot,
  writeSession,
} = require('../worktree-tools/worktree-core');
const { loadConfig, resolveRepoRoot } = require('../shared/config');
const {
  buildGitHubGitEnv,
  loadProjectGitHubToken,
  sanitizeGitHubRemoteUrl,
} = require('../shared/github-auth');
const { createGitHubBackend, repoApiPath } = require('../shared/github-api');
const { exitOnHelp } = require('../shared/cli-help');

const repoRoot = resolveRepoRoot({ scriptDir: __dirname });

// ==================== Git 工具 ====================

function runGit(args, options = {}) {
  const cwd = options.cwd || repoRoot;
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: buildGitHubGitEnv({ repoRoot, cwd, args, env: process.env }),
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed with exit ${result.status}`);
  }

  return result.stdout;
}

/**
 * porcelain 每行前两列是 XY 状态码；只去行尾空白，保留首行开头的空格列。
 */
function parseWorkingTreeStatus(output) {
  return String(output || '').split('\n').map((line) => line.trimEnd()).filter(Boolean);
}

function getWorkingTreeStatusLines() {
  return parseWorkingTreeStatus(runGit(['status', '--porcelain'], { capture: true }));
}

function parseCliArgs(argv) {
  let scope = 'session';
  let dryRun = false;
  let baseBranch = '';
  let committedOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--committed-only') {
      committedOnly = true;
      continue;
    }
    if (arg === '--project') {
      scope = 'project';
      continue;
    }
    if (arg === '--scope' && argv[i + 1]) {
      scope = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--scope=')) {
      scope = arg.split('=')[1];
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--base' && argv[i + 1]) {
      baseBranch = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--base=')) {
      baseBranch = arg.split('=')[1];
      continue;
    }
  }

  return {
    scope: scope === 'project' ? 'project' : 'session',
    dryRun,
    baseBranch,
    committedOnly,
  };
}

// ==================== Push ====================

function pushBranch() {
  runGit(['push', 'origin', 'HEAD']);
}

// ==================== PR 自动创建 ====================

/**
 * 执行 gh CLI 命令（使用项目级 GH_TOKEN）
 */
function runGh(args) {
  const result = spawnSync('gh', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    stdio: 'pipe',
  });
  return result;
}

function getCurrentBranch() {
  return runGit(['branch', '--show-current'], { capture: true }).trim();
}

function isMainBranch(branch, baseBranch = 'main') {
  return branch === baseBranch;
}

const BRANCH_TYPE_PREFIXES = {
  feature: 'feat',
  feat: 'feat',
  fix: 'fix',
  hotfix: 'fix',
  bugfix: 'fix',
  docs: 'docs',
  doc: 'docs',
  refactor: 'refactor',
  test: 'test',
  tests: 'test',
  perf: 'perf',
  build: 'build',
  ci: 'ci',
  style: 'style',
  chore: 'chore',
};

function humanizeBranchPart(part) {
  return part
    .replace(/[-_]\d{8}$/, '')
    .replace(/[-_/]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * 从分支名推导 Conventional Commits 主题：
 * - feature/TASK-DOMAIN-NNN-desc → { type: feat, scope: domain, desc, taskId }
 * - <prefix>/desc（feature/fix/docs/refactor/...）→ 对应类型，去掉末尾 8 位日期
 * - 其他 → chore，描述取完整分支名
 */
function parseBranchSubject(branch) {
  const branchName = String(branch || '').trim();
  const taskMatch = branchName.match(/^feature\/(TASK-([A-Z]+)-\d+)(?:[-_](.+))?$/i);
  if (taskMatch) {
    return {
      type: 'feat',
      scope: taskMatch[2].toLowerCase(),
      taskId: taskMatch[1].toUpperCase(),
      desc: taskMatch[3] ? humanizeBranchPart(taskMatch[3]) : '',
    };
  }

  const prefixMatch = branchName.match(/^([A-Za-z]+)\/(.+)$/);
  const type = prefixMatch && BRANCH_TYPE_PREFIXES[prefixMatch[1].toLowerCase()];
  if (type) {
    return { type, scope: '', taskId: '', desc: humanizeBranchPart(prefixMatch[2]) };
  }

  return { type: 'chore', scope: '', taskId: '', desc: humanizeBranchPart(branchName) || 'detached head' };
}

function buildAutoCommitMessage(branch) {
  const subject = parseBranchSubject(branch);
  if (subject.taskId) {
    return `${subject.type}: ${subject.desc || subject.taskId} (${subject.taskId})`;
  }
  return `${subject.type}: ${subject.desc}`;
}

const AUTO_COMMIT_BODY_LIMIT = 20;

function describeStatusLine(line) {
  const code = line.slice(0, 2);
  const file = line.slice(3);
  if (code === '??' || code.includes('A')) return `新增 ${file}`;
  if (code.includes('R')) return `重命名 ${file}`;
  if (code.includes('D')) return `删除 ${file}`;
  return `修改 ${file}`;
}

/**
 * 自动提交正文逐条列出改动文件，供 PR 概要提取要点；超过上限时汇总剩余数量。
 */
function buildAutoCommitBody(statusLines) {
  const shown = statusLines.slice(0, AUTO_COMMIT_BODY_LIMIT).map((line) => `- ${describeStatusLine(line)}`);
  const rest = statusLines.length - shown.length;
  if (rest > 0) shown.push(`- 另有 ${rest} 个文件改动`);
  return shown.join('\n');
}

function autoCommitWorkingTreeIfNeeded(branch, options = {}) {
  if (options.committedOnly) {
    console.log('仅推送已有提交；保留本地索引及未提交内容。');
    return { committed: false, commitMessage: '', changedFiles: 0, retainedWorkingTree: true };
  }
  const statusLines = (options.getWorkingTreeStatusLines || getWorkingTreeStatusLines)();
  if (!statusLines.length) {
    return {
      committed: false,
      commitMessage: '',
      changedFiles: 0,
    };
  }

  const commitMessage = buildAutoCommitMessage(branch);
  if (options.dryRun) {
    console.log('\x1b[33m[DRY RUN] 检测到未提交改动，正式执行时将自动 git add -A 并创建提交。\x1b[0m');
    console.log(`\x1b[33m[DRY RUN] Auto-Commit-Message: ${commitMessage}\x1b[0m`);
    console.log(`\x1b[33m[DRY RUN] Changed-Files-In-Working-Tree: ${statusLines.length}\x1b[0m`);
    return {
      committed: false,
      commitMessage,
      changedFiles: statusLines.length,
    };
  }

  console.log(`\x1b[33m检测到工作区存在 ${statusLines.length} 个未提交改动，开始自动提交到当前分支。\x1b[0m`);
  runGit(['add', '-A']);
  runGit(['commit', '-m', commitMessage, '-m', buildAutoCommitBody(statusLines)]);
  console.log(`\x1b[32m✓ 已自动提交当前工作区改动：${commitMessage}\x1b[0m`);

  return {
    committed: true,
    commitMessage,
    changedFiles: statusLines.length,
  };
}

/**
 * 检查当前分支是否已有 open PR（gh 或 GitHub API）
 */
async function findOpenPullRequest(branch, { backend, runGh: _runGh = runGh }) {
  if (backend.mode === 'api') {
    const head = encodeURIComponent(`${backend.owner}:${branch}`);
    const prs = await backend.apiRequest(
      'GET',
      repoApiPath(backend, `/pulls?head=${head}&state=open&per_page=10`),
      { token: backend.token }
    );
    if (!Array.isArray(prs) || prs.length === 0) return null;
    return {
      number: prs[0].number,
      url: prs[0].html_url || prs[0].url || '',
      title: prs[0].title || '',
      body: prs[0].body || '',
    };
  }

  const args = ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,body,title'];
  const result = _runGh(args);
  if (result.status !== 0) {
    throw new Error(`查询当前分支 PR 失败：${(result.stderr || result.stdout || '').trim()}`);
  }
  const prs = JSON.parse(result.stdout || '[]');
  return prs.length > 0
    ? { number: prs[0].number, url: prs[0].url, title: prs[0].title || '', body: prs[0].body || '' }
    : null;
}

function getReviewSection(reviewDecision) {
  return [
    '### Review Gate',
    `- Gate-Result: ${reviewDecision.gateResult}`,
    `- Reason: ${reviewDecision.reason}`,
    `- Base-Ref: ${reviewDecision.baseRef}`,
  ].join('\n');
}

function mergeReviewSectionIntoBody(body, reviewDecision) {
  const reviewSection = getReviewSection(reviewDecision);
  const reviewSectionRegex = /### Review Gate[\s\S]*?(?=\n+### |\s*$)/;
  if (reviewSectionRegex.test(body)) {
    return body.replace(reviewSectionRegex, reviewSection);
  }
  return `${body.trim()}\n\n${reviewSection}\n`;
}

async function updatePrReviewSection(pr, reviewDecision, { backend, runGh: _runGh = runGh, refreshBody = (body) => body }) {
  const nextBody = mergeReviewSectionIntoBody(refreshBody(pr.body || ''), reviewDecision);
  if (backend.mode === 'api') {
    await backend.apiRequest('PATCH', repoApiPath(backend, `/pulls/${pr.number}`), {
      token: backend.token,
      body: { body: nextBody },
    });
    return;
  }
  const result = _runGh(['pr', 'edit', String(pr.number), '--body', nextBody]);
  if (result.status !== 0) {
    throw new Error(`更新 PR #${pr.number} Review Gate 失败：${(result.stderr || '').trim()}`);
  }
}

function printReviewDecision(reviewDecision) {
  const label = {
    [GATE_RESULT.REQUIRED]:      'REVIEW_REQUIRED',
    [GATE_RESULT.PENDING_MODEL]: 'PENDING_MODEL_REVIEW',
    [GATE_RESULT.SKIPPED]:       'REVIEW_SKIPPED',
  }[reviewDecision.gateResult] || reviewDecision.gateResult;

  console.log(`\u001b[36mGate-Result: ${reviewDecision.gateResult}\u001b[0m`);
  console.log(`\u001b[36mReason: ${reviewDecision.reason}\u001b[0m`);
  console.log(`\u001b[36mDecision: ${label}\u001b[0m`);

  if (reviewDecision.gateResult === GATE_RESULT.REQUIRED) {
    console.log('\u001b[33m下一步：hotfix 分支，执行当前 CLI 对应的 code review 命令，Approved 后才能标记 TDD_DONE。\u001b[0m');
  } else if (reviewDecision.gateResult === GATE_RESULT.PENDING_MODEL) {
    console.log('\u001b[33m下一步：模型语义判断——读取 git diff，对照 10 类高风险域决定 REQUIRED 或 OPTIONAL。\u001b[0m');
  } else {
    console.log('\u001b[33m下一步：明确跳过 code review，仍需保证 lint / typecheck / 定向测试已通过。\u001b[0m');
  }
}

/**
 * 从分支名生成 PR 标题；与自动提交共用 parseBranchSubject，任务分支带 scope。
 */
function buildPrTitle(branch) {
  const subject = parseBranchSubject(branch);
  const type = subject.scope ? `${subject.type}(${subject.scope})` : subject.type;
  return `${type}: ${subject.desc || subject.taskId}`;
}

/**
 * 获取 remote URL 用于生成手动 PR 链接
 */
function getRemoteUrl() {
  try {
    const url = runGit(['remote', 'get-url', 'origin'], { capture: true }).trim();
    return sanitizeGitHubRemoteUrl(url);
  } catch {
    return '';
  }
}

/**
 * Push 后自动创建 PR，失败时降级为输出手动链接
 */
function buildPrCreateArgs({ title, body, branch, baseBranch }) {
  return [
    'pr', 'create',
    '--title', title,
    '--body', body,
    '--head', branch,
    '--base', baseBranch,
  ];
}

const CONVENTIONAL_SUBJECT = /^[a-z]+(\([^)]+\))?!?: \S/;

/**
 * 读取分支相对配置主干的提交（旧到新）；优先比较 origin/<base>，缺失时退回本地 base。
 */
function collectBranchCommits(baseBranch, { runGit: _runGit = runGit } = {}) {
  let baseRef = baseBranch;
  try {
    _runGit(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${baseBranch}`], { capture: true });
    baseRef = `origin/${baseBranch}`;
  } catch {
    // 无远端跟踪引用时使用本地 base
  }
  // 同步配置主干产生的 merge 提交不代表本分支改动，不进入概要、变更内容与标题判定
  const output = _runGit(['log', '--reverse', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', `${baseRef}..HEAD`], { capture: true });
  return String(output || '')
    .split('\x1e')
    .map((record) => record.replace(/^\n+/, ''))
    .filter((record) => record.includes('\x1f'))
    .map((record) => {
      const [sha, subject, body = ''] = record.split('\x1f');
      return { sha: sha.trim(), subject: subject.trim(), body: body.trim() };
    });
}

function commitBullets(commit) {
  return commit.body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\S/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, ''));
}

const AUTO_COMMIT_FILE_LINE = /^(?:(?:新增|修改|删除|重命名) \S.*|另有 \d+ 个文件改动)$/;

/**
 * 工作区自动提交的正文只是改动文件清单（见 buildAutoCommitBody）。
 */
function isFileListCommit(commit) {
  const bullets = commitBullets(commit);
  return bullets.length > 0 && bullets.every((line) => AUTO_COMMIT_FILE_LINE.test(line));
}

/**
 * 分支上还有其他提交时，文件清单式自动提交不参与概要与标题判定；只有自动提交时保留全部。
 */
function describingCommits(commits) {
  const authored = commits.filter((commit) => !isFileListCommit(commit));
  return authored.length ? authored : commits;
}

/**
 * 单个 Conventional 提交时直接作为 PR 标题，否则按分支名推导。
 */
function resolvePrTitle(branch, commits = []) {
  const candidates = describingCommits(commits);
  if (candidates.length === 1 && CONVENTIONAL_SUBJECT.test(candidates[0].subject)) {
    return candidates[0].subject;
  }
  return buildPrTitle(branch);
}

function buildPrSummaryLines(title, commits) {
  const lines = [];
  for (const commit of commits) {
    const bullets = commitBullets(commit);
    lines.push(...(bullets.length ? bullets.map((line) => `- ${line}`) : [`- ${commit.subject}`]));
  }
  const unique = [...new Set(lines)];
  return unique.length ? unique : [`- ${title}`];
}

const AUTO_SUMMARY_START_PREFIX = '<!-- xirang:auto-summary:start';
const AUTO_SUMMARY_START_REGEX = /<!-- xirang:auto-summary:start(?: digest=([0-9a-f]{12}))? -->/;
const AUTO_SUMMARY_END = '<!-- xirang:auto-summary:end -->';

function digestAutoSummary(inner) {
  const normalized = inner.replace(/\r\n/g, '\n').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/**
 * 自动生成的概要与变更内容放在标记内；起始标记记录生成内容摘要，
 * 后续 tdd push 仅在摘要仍匹配（未被人工修改）时刷新标记内文本。
 */
function buildAutoSummaryBlock(title, commits = []) {
  const changes = commits.length
    ? commits.map((commit) => `- ${commit.sha.slice(0, 7)} ${commit.subject}`)
    : ['_见 commit 历史_'];
  const inner = [
    '### 概要',
    ...buildPrSummaryLines(title, describingCommits(commits)),
    '',
    '### 变更内容',
    ...changes,
  ].join('\n');
  return [`${AUTO_SUMMARY_START_PREFIX} digest=${digestAutoSummary(inner)} -->`, inner, AUTO_SUMMARY_END].join('\n');
}

const LEGACY_CHANGE_LINE = /^- ([0-9a-f]{7}) /;

/**
 * 重建早期 tdd push 生成的无标记正文开头，用于判断旧正文是否仍是未被修改的自动内容：
 * - 3.7.13 及更早：概要只有 PR 标题一行，变更内容为 `_见 commit 历史_`；
 * - 3.7.14：概要取提交要点，变更内容列出 sha7 与提交标题（只认仍在当前分支上的提交）。
 */
function buildLegacyAutoSummaryCandidates(body, legacyTitles, commits) {
  const titles = [...new Set(legacyTitles.filter(Boolean))];
  const candidates = titles.map((title) => `### 概要\n- ${title}\n\n### 变更内容\n_见 commit 历史_`);

  const changesMatch = /\n### 变更内容\n((?:- [0-9a-f]{7} [^\n]*(?:\n|$))+)/.exec(body);
  if (changesMatch) {
    const listed = changesMatch[1].split('\n').filter(Boolean).map((line) => LEGACY_CHANGE_LINE.exec(line)[1]);
    const oldCommits = listed.map((sha7) => commits.find((commit) => commit.sha.startsWith(sha7)));
    if (oldCommits.every(Boolean)) {
      const changes = oldCommits.map((commit) => `- ${commit.sha.slice(0, 7)} ${commit.subject}`).join('\n');
      for (const title of titles.length ? titles : ['']) {
        candidates.push(`### 概要\n${buildPrSummaryLines(title, oldCommits).join('\n')}\n\n### 变更内容\n${changes}`);
      }
    }
  }
  return candidates;
}

/**
 * 刷新已有 PR 正文中的自动概要，返回 { status, body }：
 * - refreshed：标记内容未被修改（或旧版无摘要标记），已按当前提交重建；
 * - manual-edit：摘要不匹配，保留人工修改；
 * - upgraded：无标记但与早期版本自动生成的内容逐字一致，升级为带标记的块；
 * - unmarked / no-commits：保持原文。
 */
function refreshAutoSummaryInBody(body, title, commits = [], { legacyTitles = [] } = {}) {
  if (!commits.length) return { status: 'no-commits', body };
  const startMatch = AUTO_SUMMARY_START_REGEX.exec(body);
  const end = startMatch ? body.indexOf(AUTO_SUMMARY_END, startMatch.index) : -1;
  if (startMatch && end !== -1) {
    const innerStart = startMatch.index + startMatch[0].length;
    if (startMatch[1] && startMatch[1] !== digestAutoSummary(body.slice(innerStart, end))) {
      return { status: 'manual-edit', body };
    }
    return {
      status: 'refreshed',
      body: body.slice(0, startMatch.index)
        + buildAutoSummaryBlock(title, commits)
        + body.slice(end + AUTO_SUMMARY_END.length),
    };
  }

  const normalized = body.replace(/\r\n/g, '\n');
  for (const candidate of buildLegacyAutoSummaryCandidates(normalized, legacyTitles, commits)) {
    const rest = normalized.slice(candidate.length);
    if (normalized.startsWith(candidate) && (rest === '' || rest.startsWith('\n'))) {
      return { status: 'upgraded', body: buildAutoSummaryBlock(title, commits) + rest };
    }
  }
  return { status: 'unmarked', body };
}

function buildPrBody(title, reviewDecision, commits = []) {
  return [
    buildAutoSummaryBlock(title, commits),
    '',
    '### 文档回写',
    '- CHANGELOG: 见本次变更；发布行为以项目 release 配置为准',
    '',
    getReviewSection(reviewDecision),
  ].join('\n');
}

/**
 * 确保当前分支存在指向配置主干的 open PR：已存在则同步 Review Gate，否则创建。
 * 优先使用 GH_TOKEN 走 GitHub REST API；任何失败都抛出，由调用方阻断。
 */
async function ensurePullRequest({ branch, baseBranch, reviewDecision, backend, commits = [], runGh: _runGh = runGh }) {
  const existing = await findOpenPullRequest(branch, { backend, runGh: _runGh });
  if (existing) {
    let summaryStatus = 'unmarked';
    await updatePrReviewSection(existing, reviewDecision, {
      backend,
      runGh: _runGh,
      refreshBody: (body) => {
        const refreshed = refreshAutoSummaryInBody(body, resolvePrTitle(branch, commits), commits, {
          legacyTitles: [existing.title, buildPrTitle(branch)],
        });
        summaryStatus = refreshed.status;
        return refreshed.body;
      },
    });
    if (summaryStatus === 'manual-edit') {
      console.log('\x1b[33mPR 自动概要已被人工修改，保留原文不刷新；如需重新生成，删除起始标记中的 digest。\x1b[0m');
    }
    return { status: 'existing', summaryStatus, pr: { number: existing.number, url: existing.url } };
  }

  const title = resolvePrTitle(branch, commits);
  const body = buildPrBody(title, reviewDecision, commits);

  if (backend.mode === 'api') {
    const created = await backend.apiRequest('POST', repoApiPath(backend, '/pulls'), {
      token: backend.token,
      body: { title, body, head: branch, base: baseBranch },
    });
    return { status: 'created', pr: { number: created.number, url: created.html_url || created.url || '' } };
  }

  // --head 显式指定分支，避免 upstream tracking 未设置时 gh 报错
  const result = _runGh(buildPrCreateArgs({ title, body, branch, baseBranch }));
  if (result.status !== 0) {
    throw new Error(`gh pr create 失败：${(result.stderr || result.stdout || '').trim()}`);
  }
  const url = (result.stdout || '').trim().split('\n').pop();
  const numberMatch = url.match(/\/pull\/(\d+)/);
  return { status: 'created', pr: { number: numberMatch ? Number(numberMatch[1]) : null, url } };
}

// ==================== 主流程 ====================

async function main() {
  let branch = '';
  try {
    loadProjectGitHubToken({ repoRoot });
    const cliArgs = parseCliArgs(process.argv.slice(2));
    const scopeLabel = cliArgs.scope === 'project' ? 'project（项目模式）' : 'session（会话模式）';
    branch = getCurrentBranch();
    const mainRoot = getMainRepoRoot(repoRoot);
    const lifecycleConfig = loadConfig({ repoRoot: mainRoot });
    const baseBranch = lifecycleConfig.baseBranch || 'main';
    const reviewBaseBranch = cliArgs.baseBranch || baseBranch;
    console.log(`\x1b[36m/tdd push 作用域：${scopeLabel}。本次仅操作当前分支与对应 PR。\x1b[0m`);
    if (isMainBranch(branch, baseBranch)) {
      throw new Error(`当前位于主干分支 ${branch}，禁止执行 /tdd push。请先切换到 feature/* 或 fix/* 分支。`);
    }
    assertSessionCanResume(lifecycleConfig, mainRoot, branch);

    const autoCommitResult = autoCommitWorkingTreeIfNeeded(branch, {
      dryRun: cliArgs.dryRun,
      committedOnly: cliArgs.committedOnly,
    });
    const reviewDecision = analyzeReviewGate({
      baseBranch: reviewBaseBranch,
      branchName: branch,
    });

    if (cliArgs.dryRun) {
      console.log('\x1b[33m[DRY RUN] /tdd push 预览：\x1b[0m');
      if (autoCommitResult.retainedWorkingTree) {
        console.log('- committed-only：仅推送已有提交，不改变本地索引或文件');
      } else if (!autoCommitResult.changedFiles) {
        console.log('- 工作区干净：不会创建自动提交');
      }
      console.log('- 将执行: push 当前分支 → 创建 PR');
      printReviewDecision(reviewDecision);
      console.log('\x1b[33m[DRY RUN] 未执行任何操作\x1b[0m');
      return;
    }

    // 推送前确定 GitHub 后端：gh 与 GH_TOKEN 都不可用时直接阻断，不留下无 PR 的推送
    const backend = createGitHubBackend({ remoteUrl: getRemoteUrl() });
    if (backend.mode === 'api') {
      console.log('\x1b[36m优先使用项目 GH_TOKEN，通过 GitHub REST API 创建/更新 PR\x1b[0m');
    }

    pushBranch();

    const commits = collectBranchCommits(baseBranch);
    const prResult = await ensurePullRequest({ branch, baseBranch, reviewDecision, backend, commits });
    console.log(`\u001b[32m✓ PR ${prResult.status === 'created' ? '已创建' : '已存在'}：${prResult.pr.url}\u001b[0m`);
    printReviewDecision(reviewDecision);

    writeSession(lifecycleConfig, mainRoot, {
      phase: 'tdd',
      branch,
      worktree: repoRoot,
      status: 'in_progress',
      step: 'pushed',
      pr: prResult.pr.number ? `#${prResult.pr.number}` : prResult.pr.url,
      head: runGit(['rev-parse', 'HEAD'], { capture: true }).trim(),
    });

    console.log(`\u001b[32m/tdd push 完成：代码已推送到远端。\u001b[0m`);
  } catch (error) {
    console.error(`\u001b[31m/tdd push 失败: ${error.message}\u001b[0m`);
    const remoteUrl = getRemoteUrl();
    console.log('STATUS=BLOCKED');
    if (remoteUrl && branch) {
      console.log(`NEXT_ACTION=修复上述原因后重新执行 pnpm agent -- tdd push（幂等），或手动创建 PR：${remoteUrl}/pull/new/${branch}`);
    } else {
      console.log('NEXT_ACTION=修复上述原因后重新执行 pnpm agent -- tdd push');
    }
    process.exit(1);
  }
}

if (require.main === module) {
  exitOnHelp('Usage: pnpm agent -- tdd push [--project | --scope <session|project>] [--committed-only]\n\nCommit pending changes (unless --committed-only), push the branch and create or update its PR.');
  main();
}

module.exports = {
  parseCliArgs,
  autoCommitWorkingTreeIfNeeded,
  buildAutoCommitBody,
  buildAutoCommitMessage,
  buildPrBody,
  buildPrCreateArgs,
  buildPrTitle,
  collectBranchCommits,
  ensurePullRequest,
  parseWorkingTreeStatus,
  refreshAutoSummaryInBody,
  resolvePrTitle,
  main,
};

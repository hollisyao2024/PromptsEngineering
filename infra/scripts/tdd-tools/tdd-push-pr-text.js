/**
 * tdd-push 的提交与 PR 文本构造：分支主题解析、自动提交消息、PR 标题、自动概要块与 Review Gate 段落。
 * 纯文本函数，不调用 git 或 GitHub；由 tdd-push.js 使用并重新导出。
 */
const crypto = require('crypto');
const { isLlmAttributionLine } = require('../shared/llm-attribution');

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

function getReviewSection(reviewDecision) {
  const lines = [
    '### Review Gate',
    `- Gate-Result: ${reviewDecision.gateResult}`,
    `- Reason: ${reviewDecision.reason}`,
    `- Base-Ref: ${reviewDecision.baseRef}`,
  ];
  const review = reviewDecision.modelReview;
  if (review && review.decision) {
    lines.push(`- Model-Review: ${review.decision}（${review.reason || '-'}）`);
  }
  return lines.join('\n');
}

function mergeReviewSectionIntoBody(body, reviewDecision) {
  const reviewSection = getReviewSection(reviewDecision);
  const reviewSectionRegex = /### Review Gate[\s\S]*?(?=\n+### |\s*$)/;
  if (reviewSectionRegex.test(body)) {
    return body.replace(reviewSectionRegex, reviewSection);
  }
  return `${body.trim()}\n\n${reviewSection}\n`;
}

/**
 * 从分支名生成 PR 标题；与自动提交共用 parseBranchSubject，任务分支带 scope。
 */
function buildPrTitle(branch) {
  const subject = parseBranchSubject(branch);
  const type = subject.scope ? `${subject.type}(${subject.scope})` : subject.type;
  return `${type}: ${subject.desc || subject.taskId}`;
}

const CONVENTIONAL_SUBJECT = /^[a-z]+(\([^)]+\))?!?: \S/;

function commitBullets(commit) {
  return commit.body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\S/.test(line) && !isLlmAttributionLine(line))
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

module.exports = {
  buildAutoCommitBody,
  buildAutoCommitMessage,
  buildPrBody,
  buildPrTitle,
  mergeReviewSectionIntoBody,
  refreshAutoSummaryInBody,
  resolvePrTitle,
};

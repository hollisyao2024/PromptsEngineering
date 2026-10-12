// 缺陷列表的解析、合并与统计：扫描模块 QA 文档与 defect-log，按严重级别和状态汇总。

const fs = require('fs');
const path = require('path');
const {
  BUG_ID_SOURCE,
  CONFIG,
  STORY_ID_SOURCE,
  cleanMarkdownCell,
  findHeaderIndex,
  isMarkdownSeparatorRow,
  log,
  markdownTableCells,
} = require('./check-defect-blockers-common');

function normalizeDefectStatus(value) {
  const raw = cleanMarkdownCell(value).replace(/^✅\s*/, '').trim();
  const status = raw.replace(/\s*(?:（[^（）]*）|\([^()]*\))$/u, '').trim();
  if (/^(closed|verified\/closed|已关闭)$/i.test(status)) return 'Closed';
  if (/^(resolved|已解决)$/i.test(status)) return 'Resolved';
  if (/^(in progress|进行中)$/i.test(status)) return 'In Progress';
  if (/^(open|打开|未关闭)$/i.test(status)) return 'Open';
  return 'Open';
}

function closureEvidence(value) {
  const rawStatus = cleanMarkdownCell(value);
  if (normalizeDefectStatus(rawStatus) !== 'Closed' || !/[（(]/u.test(rawStatus)) return {};
  // A qualified closure records implementation progress, not final physical evidence.
  return { rawStatus, validationPending: /代码集成|自动化|TDD|待|未|pending|blocked|exception|partial|not /iu.test(rawStatus) };
}

function parseDefectContent(content, moduleName) {
  const defects = new Map();
  let headers = null;

  for (const line of String(content || '').split(/\r?\n/)) {
    const cells = markdownTableCells(line);
    if (!cells) {
      headers = null;
      continue;
    }
    if (isMarkdownSeparatorRow(cells)) continue;
    const idIndex = findHeaderIndex(cells, ['缺陷 ID', 'Bug ID', 'Defect ID']);
    if (idIndex >= 0) {
      headers = cells;
      continue;
    }
    if (!headers) continue;

    const headerIDIndex = findHeaderIndex(headers, ['缺陷 ID', 'Bug ID', 'Defect ID']);
    const bugMatch = cells[headerIDIndex]?.match(new RegExp(`^${BUG_ID_SOURCE}$`));
    if (!bugMatch) continue;

    const titleIndex = findHeaderIndex(headers, ['标题', '问题', 'Title']);
    const severityIndex = findHeaderIndex(headers, ['严重度', '严重级别', 'Severity']);
    const statusIndex = findHeaderIndex(headers, ['状态', '最终状态', 'Status']);
    const storyIndex = findHeaderIndex(headers, ['影响 Story', 'Story']);
    const assigneeIndex = findHeaderIndex(headers, ['负责人', 'Assignee']);
    const etaIndex = findHeaderIndex(headers, ['预计修复', 'ETA']);
    const impactIndex = findHeaderIndex(headers, ['影响模块', '影响范围', 'Impact']);
    const storyMatch = storyIndex >= 0
      ? cells[storyIndex]?.match(new RegExp(STORY_ID_SOURCE))
      : null;
    defects.set(bugMatch[0], {
      bugId: bugMatch[0],
      title: titleIndex >= 0 ? cleanMarkdownCell(cells[titleIndex]) : '',
      severity: severityIndex >= 0 ? cells[severityIndex]?.match(/P[0-2]/)?.[0] || 'P2' : 'P2',
      status: statusIndex >= 0 ? normalizeDefectStatus(cells[statusIndex]) : 'Open',
      ...closureEvidence(statusIndex >= 0 ? cells[statusIndex] : ''),
      storyId: storyMatch?.[0] || null,
      assignee: assigneeIndex >= 0 && cells[assigneeIndex] ? cleanMarkdownCell(cells[assigneeIndex]) : '未指定',
      eta: etaIndex >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(cells[etaIndex]) ? cells[etaIndex] : '未指定',
      impact: impactIndex >= 0 ? cleanMarkdownCell(cells[impactIndex]) : '',
      module: moduleName,
    });
  }

  const headingPattern = new RegExp(`^#{1,6}\\s+(${BUG_ID_SOURCE})\\s*[:：]\\s*(.+)$`, 'gmu');
  const headings = [...String(content || '').matchAll(headingPattern)];
  headings.forEach((heading, index) => {
    const bugId = heading[1];
    if (defects.has(bugId)) return;
    const sectionEnd = headings[index + 1]?.index ?? String(content || '').length;
    const section = String(content || '').slice(heading.index, sectionEnd);
    const severity = section.match(/\*\*严重(?:级别|程度)(?:\s*\/\s*优先级)?[：:]\*\*\s*(P[0-2])/i)?.[1] || 'P2';
    const rawStatus = section.match(/\*\*状态[：:]\*\*\s*(?:✅\s*)?([^\n]+)/i)?.[1] || 'Open';
    const storyId = section.match(new RegExp(STORY_ID_SOURCE))?.[0] || null;
    const assignee = section.match(/负责人[：:]\*\*?\s*(@[a-z0-9-]+)/i)?.[1] || '未指定';
    const eta = section.match(/预计修复[：:]\*\*?\s*(\d{4}-\d{2}-\d{2})/i)?.[1] || '未指定';
    const impact = section.match(/\*\*影响(?:范围|模块)[：:]\*\*\s*([^\n]+)/i)?.[1] || '';
    defects.set(bugId, {
      bugId,
      title: cleanMarkdownCell(heading[2]),
      severity,
      status: normalizeDefectStatus(rawStatus),
      ...closureEvidence(rawStatus),
      storyId,
      assignee,
      eta,
      impact: cleanMarkdownCell(impact),
      module: moduleName,
    });
  });

  return [...defects.values()];
}

function moreBlockingStatus(left, right) {
  const rank = { Open: 0, 'In Progress': 1, Resolved: 2, Closed: 3 };
  return (rank[left] ?? 0) <= (rank[right] ?? 0) ? left : right;
}

function mergeDefect(existing, incoming) {
  if (!existing) return incoming;
  const severity = Number(existing.severity.slice(1)) <= Number(incoming.severity.slice(1))
    ? existing.severity
    : incoming.severity;
  return {
    ...existing,
    title: existing.title || incoming.title,
    severity,
    status: moreBlockingStatus(existing.status, incoming.status),
    ...(existing.rawStatus || incoming.rawStatus ? { rawStatus: [existing.rawStatus, incoming.rawStatus].filter(Boolean).join("; "), validationPending: Boolean(existing.validationPending || incoming.validationPending) } : {}),
    storyId: existing.storyId || incoming.storyId,
    assignee: existing.assignee !== '未指定' ? existing.assignee : incoming.assignee,
    eta: existing.eta !== '未指定' ? existing.eta : incoming.eta,
    impact: existing.impact || incoming.impact,
  };
}

// 解析缺陷列表
function parseDefects(options = {}) {
  log('\n📖 扫描模块 QA 缺陷列表...', 'cyan');

  const config = { ...CONFIG, ...options };
  const defects = new Map();

  if (!fs.existsSync(config.qaModulesDir)) {
    log('⚠️  qa-modules/ 目录不存在', 'yellow');
    return [];
  }

  const entries = fs.readdirSync(config.qaModulesDir, { withFileTypes: true });
  const moduleDirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));

  log(`✅ 找到 ${moduleDirs.length} 个模块 QA 文档`);

  moduleDirs.forEach(dir => {
    for (const fileName of ['QA.md', 'defect-log.md']) {
      const filePath = path.join(config.qaModulesDir, dir.name, fileName);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const defect of parseDefectContent(content, dir.name)) {
        const key = `${dir.name}:${defect.bugId}`;
        defects.set(key, mergeDefect(defects.get(key), defect));
      }
    }
  });

  log('📊 解析缺陷列表...');
  log('✅ 解析完成');

  return [...defects.values()].sort((left, right) => (
    left.module.localeCompare(right.module) || left.bugId.localeCompare(right.bugId)
  ));
}

// 统计缺陷
function analyzeDefects(defects) {
  log('\n📋 全局缺陷汇总:', 'cyan');

  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0];

  log(`\n更新时间: ${date} ${time}`);

  // 按严重级别和状态统计
  const severityStats = {
    P0: { total: 0, open: 0, inProgress: 0, resolved: 0, closed: 0 },
    P1: { total: 0, open: 0, inProgress: 0, resolved: 0, closed: 0 },
    P2: { total: 0, open: 0, inProgress: 0, resolved: 0, closed: 0 },
  };

  defects.forEach(defect => {
    const { severity, status } = defect;

    if (severityStats[severity]) {
      severityStats[severity].total++;

      if (status === 'Open') severityStats[severity].open++;
      else if (status === 'In Progress') severityStats[severity].inProgress++;
      else if (status === 'Resolved') severityStats[severity].resolved++;
      else if (status === 'Closed') severityStats[severity].closed++;
    }
  });

  // 输出按严重级别统计
  log('\n📊 按严重级别统计:');
  log('| 严重级别 | 总数 | Open | In Progress | Resolved | Closed | 状态 |');
  log('|---------|------|------|------------|---------|--------|------|');

  ['P0', 'P1', 'P2'].forEach(severity => {
    const stats = severityStats[severity];
    const statusEmoji = severity === 'P0' && (stats.open > 0 || stats.inProgress > 0 || stats.resolved > 0 || defects.some(d => d.severity === 'P0' && d.validationPending)) ? '❌ 阻塞' :
      severity === 'P1' && stats.open > 0 ? '⚠️  关注' : '✅ 可控';

    log(`| ${severity}（${severity === 'P0' ? '阻塞发布' : severity === 'P1' ? '严重' : '一般'}） | ${stats.total} | ${stats.open} | ${stats.inProgress} | ${stats.resolved} | ${stats.closed} | ${statusEmoji} |`);
  });

  // P0 缺陷列表
  const p0Defects = defects.filter(d => d.severity === 'P0' && d.status !== 'Closed');
  const p0ValidationPending = defects.filter(d => d.severity === 'P0' && d.status === 'Closed' && d.validationPending);
  for (const defect of p0ValidationPending) log(`⚠️ ${defect.bugId}: 缺陷记录已关闭，但验收未完成：${defect.rawStatus}`, 'yellow');
  if (p0Defects.length > 0) {
    log('\n🚨 P0 缺陷列表（阻塞发布）:', 'red');

    p0Defects.forEach(defect => {
      log(`\n❌ ${defect.bugId}: ${defect.title}`, 'red');
      log(`   - 模块: ${defect.module}`);
      log(`   - 影响 Story: ${defect.storyId}`);
      log(`   - 状态: ${defect.status}`);
      log(`   - 负责人: ${defect.assignee}`);
      log(`   - 预计修复: ${defect.eta}`);
      if (defect.impact) {
        log(`   - 影响范围: ${defect.impact}`);
      }
    });
  } else {
    log('\n无未关闭 P0；另有 ' + p0ValidationPending.length + ' 项已关闭 P0 待验收', p0ValidationPending.length ? 'yellow' : 'green');
  }

  // P1 缺陷列表
  const p1Defects = defects.filter(d => d.severity === 'P1');
  const p1Open = p1Defects.filter(d => d.status === 'Open');
  const p1InProgress = p1Defects.filter(d => d.status === 'In Progress');

  if (p1Open.length > 0 || p1InProgress.length > 0) {
    log('\n⚠️  P1 缺陷列表（需关注）:', 'yellow');

    [...p1Open, ...p1InProgress].slice(0, 5).forEach(defect => {
      log(`\n⚠️  ${defect.bugId}: ${defect.title}（${defect.status}）`, 'yellow');
      log(`   - 模块: ${defect.module}`);
      log(`   - 影响 Story: ${defect.storyId}`);
      log(`   - 负责人: ${defect.assignee}`);
      log(`   - 预计修复: ${defect.eta}`);
    });

    if (p1Open.length + p1InProgress.length > 5) {
      log(`\n   ... 还有 ${p1Open.length + p1InProgress.length - 5} 个 P1 缺陷`, 'yellow');
    }
  }

  // 按模块统计
  log('\n📊 按模块统计:', 'cyan');
  log('| 模块 | P0 | P1 | P2 | 总计 | 状态 |');
  log('|------|----|----|----|----- |------|');

  const moduleStats = new Map();
  defects.forEach(defect => {
    if (!moduleStats.has(defect.module)) {
      moduleStats.set(defect.module, { P0: 0, P1: 0, P2: 0 });
    }
    moduleStats.get(defect.module)[defect.severity]++;
  });

  moduleStats.forEach((stats, module) => {
    const total = stats.P0 + stats.P1 + stats.P2;
    const status = [...p0Defects, ...p0ValidationPending].some(d => d.module === module) ? '❌ 阻塞发布' : '✅ 无阻塞';
    log(`| ${module} | ${stats.P0} | ${stats.P1} | ${stats.P2} | ${total} | ${status} |`);
  });

  return {
    severityStats,
    p0Defects,
    p0ValidationPending,
    p1Defects,
    p1Open,
    p1InProgress,
    moduleStats,
    date,
    time,
  };
}

module.exports = {
  analyzeDefects,
  moreBlockingStatus,
  parseDefectContent,
  parseDefects,
};

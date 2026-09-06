#!/usr/bin/env node

/**
 * 缺陷阻塞检查脚本
 *
 * 扫描所有模块的缺陷列表，识别 P0/P1 阻塞性缺陷，生成发布门禁报告。
 *
 * 检查项：
 * - 扫描所有模块 QA 的缺陷列表
 * - 按严重级别分类（P0/P1/P2）
 * - 按状态统计（Open/In Progress/Resolved/Closed）
 * - 识别阻塞性缺陷（P0 未关闭）
 * - 检查 NFR 达标情况
 * - 生成发布建议（Go/No-Go）
 */

const fs = require('fs');
const path = require('path');
const shouldWriteReports = process.env.QA_WRITE_REPORTS === '1';

// 配置
const CONFIG = {
  qaPath: path.join(__dirname, '../../../docs/QA.md'),
  qaModulesDir: path.join(__dirname, '../../../docs/qa-modules'),
  nfrTrackingPath: path.join(__dirname, '../../../docs/data/nfr-tracking.md'),
  releaseGateReportPath: path.join(__dirname, '../../../docs/data/qa-reports/release-gate-{date}.md'),
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

const MODULE_ID_SOURCE = '[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*';
const BUG_ID_SOURCE = `BUG-${MODULE_ID_SOURCE}-\\d{3}`;
const NFR_ID_SOURCE = `NFR-${MODULE_ID_SOURCE}-\\d{3}`;
const STORY_ID_SOURCE = `US-${MODULE_ID_SOURCE}-\\d{3}`;

function cleanMarkdownCell(value) {
  return String(value || '')
    .trim()
    .replace(/^`+|`+$/g, '')
    .replace(/\*\*/g, '')
    .trim();
}

function markdownTableCells(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('|')) return null;
  const body = trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed.slice(1);
  return body.split('|').map(cleanMarkdownCell);
}

function isMarkdownSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function normalizedHeader(value) {
  return cleanMarkdownCell(value).toLowerCase().replace(/[\s_/-]+/g, '');
}

function findHeaderIndex(headers, candidates) {
  const normalizedCandidates = candidates.map(normalizedHeader);
  return headers.findIndex((header) => normalizedCandidates.includes(normalizedHeader(header)));
}

function normalizeDefectStatus(value) {
  const status = cleanMarkdownCell(value).replace(/^✅\s*/, '').trim();
  if (/^(closed|已关闭)$/i.test(status)) return 'Closed';
  if (/^(resolved|已解决)$/i.test(status)) return 'Resolved';
  if (/^(in progress|进行中)$/i.test(status)) return 'In Progress';
  if (/^(open|打开|未关闭)$/i.test(status)) return 'Open';
  return 'Open';
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

    const titleIndex = findHeaderIndex(headers, ['标题', 'Title']);
    const severityIndex = findHeaderIndex(headers, ['严重度', '严重级别', 'Severity']);
    const statusIndex = findHeaderIndex(headers, ['状态', 'Status']);
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
    storyId: existing.storyId || incoming.storyId,
    assignee: existing.assignee !== '未指定' ? existing.assignee : incoming.assignee,
    eta: existing.eta !== '未指定' ? existing.eta : incoming.eta,
    impact: existing.impact || incoming.impact,
  };
}

// 解析缺陷列表
function parseDefects() {
  log('\n📖 扫描模块 QA 缺陷列表...', 'cyan');

  const defects = new Map();

  if (!fs.existsSync(CONFIG.qaModulesDir)) {
    log('⚠️  qa-modules/ 目录不存在', 'yellow');
    return [];
  }

  const entries = fs.readdirSync(CONFIG.qaModulesDir, { withFileTypes: true });
  const moduleDirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));

  log(`✅ 找到 ${moduleDirs.length} 个模块 QA 文档`);

  moduleDirs.forEach(dir => {
    for (const fileName of ['QA.md', 'defect-log.md']) {
      const filePath = path.join(CONFIG.qaModulesDir, dir.name, fileName);
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
    const statusEmoji = severity === 'P0' && (stats.open > 0 || stats.inProgress > 0) ? '❌ 阻塞' :
      severity === 'P1' && stats.open > 0 ? '⚠️  关注' : '✅ 可控';

    log(`| ${severity}（${severity === 'P0' ? '阻塞发布' : severity === 'P1' ? '严重' : '一般'}） | ${stats.total} | ${stats.open} | ${stats.inProgress} | ${stats.resolved} | ${stats.closed} | ${statusEmoji} |`);
  });

  // P0 缺陷列表
  const p0Defects = defects.filter(d => d.severity === 'P0' && d.status !== 'Closed');
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
    log('\n✅ 无 P0 缺陷', 'green');
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
    const status = stats.P0 > 0 ? '❌ 阻塞发布' : '✅ 无阻塞';
    log(`| ${module} | ${stats.P0} | ${stats.P1} | ${stats.P2} | ${total} | ${status} |`);
  });

  return {
    severityStats,
    p0Defects,
    p1Defects,
    p1Open,
    p1InProgress,
    moduleStats,
    date,
    time,
  };
}

function classifyNFRStatus(status) {
  const normalized = cleanMarkdownCell(status);
  if (/❌|未达标|no-go|failed?/i.test(normalized)) return 'nonCompliant';
  if (/⚠️|🟡|条件|未确认|待执行|规划中|contract_ready|evidence_unavailable/i.test(normalized)) {
    return 'conditional';
  }
  if (/✅|达标|passed?|complete/i.test(normalized)) return 'compliant';
  return 'nonCompliant';
}

function parseNFRCompliance(content) {
  const byID = new Map();
  let headers = null;
  for (const line of String(content || '').split(/\r?\n/)) {
    const cells = markdownTableCells(line);
    if (!cells) {
      headers = null;
      continue;
    }
    if (isMarkdownSeparatorRow(cells)) continue;
    const idIndex = findHeaderIndex(cells, ['NFR ID']);
    if (idIndex >= 0) {
      headers = cells;
      continue;
    }
    if (!headers) continue;

    const headerIDIndex = findHeaderIndex(headers, ['NFR ID']);
    const nfrMatch = cells[headerIDIndex]?.match(new RegExp(`^${NFR_ID_SOURCE}$`));
    if (!nfrMatch) continue;
    const descriptionIndex = findHeaderIndex(headers, ['描述', 'Description']);
    const statusIndex = findHeaderIndex(headers, ['状态', 'Status']);
    const item = {
      nfrId: nfrMatch[0],
      description: descriptionIndex >= 0 ? cleanMarkdownCell(cells[descriptionIndex]) : '未知',
      status: statusIndex >= 0 ? cleanMarkdownCell(cells[statusIndex]) : '',
    };
    const classification = classifyNFRStatus(item.status);
    const current = byID.get(item.nfrId);
    const rank = { compliant: 2, conditional: 1, nonCompliant: 0 };
    if (!current || rank[classification] < rank[current.classification]) {
      byID.set(item.nfrId, { ...item, classification });
    }
  }

  const values = [...byID.values()];
  const compliantNFRs = values.filter((item) => item.classification === 'compliant');
  const conditionalNFRs = values.filter((item) => item.classification === 'conditional');
  const nonCompliantNFRs = values.filter((item) => item.classification === 'nonCompliant');
  return {
    sourceAvailable: true,
    totalCount: values.length,
    compliantCount: compliantNFRs.length,
    compliantNFRs,
    conditionalNFRs,
    nonCompliantNFRs,
  };
}

// 检查 NFR 达标情况
function checkNFRCompliance() {
  log('\n🔍 检查 NFR 达标情况...', 'cyan');

  if (!fs.existsSync(CONFIG.nfrTrackingPath)) {
    log('❌ NFR 追踪表不存在，门禁按 fail-closed 处理', 'red');
    return {
      sourceAvailable: false,
      totalCount: 0,
      compliantCount: 0,
      compliantNFRs: [],
      conditionalNFRs: [],
      nonCompliantNFRs: [],
    };
  }

  log(`📖 读取 NFR 追踪表: ${CONFIG.nfrTrackingPath}`);
  const result = parseNFRCompliance(fs.readFileSync(CONFIG.nfrTrackingPath, 'utf-8'));
  if (result.totalCount === 0) {
    result.sourceAvailable = false;
    log('❌ NFR 追踪表没有可解析的数据行，门禁按 fail-closed 处理', 'red');
    return result;
  }

  log(
    `NFR 汇总：${result.compliantNFRs.length} 达标 / ` +
    `${result.conditionalNFRs.length} 条件通过 / ${result.nonCompliantNFRs.length} 未达标`,
    result.nonCompliantNFRs.length > 0 ? 'red' : result.conditionalNFRs.length > 0 ? 'yellow' : 'green'
  );
  return result;
}

function determineReleaseDecision(analysisResult, nfrResult) {
  const p0Defects = analysisResult.p0Defects || [];
  const p1Open = analysisResult.p1Open || [];
  const p1InProgress = analysisResult.p1InProgress || [];
  const nonCompliantNFRs = nfrResult.nonCompliantNFRs || [];
  const conditionalNFRs = nfrResult.conditionalNFRs || [];
  const blockingIssues = [];
  const warningIssues = [];

  if (!nfrResult.sourceAvailable) blockingIssues.push('NFR 追踪表缺失');
  if (p0Defects.length > 0) blockingIssues.push(`${p0Defects.length} 个 P0 缺陷未关闭`);
  if (nonCompliantNFRs.length > 0) blockingIssues.push(`${nonCompliantNFRs.length} 项 NFR 未达标`);
  if (conditionalNFRs.length > 0) warningIssues.push(`${conditionalNFRs.length} 项 NFR 条件通过或尚未确认`);
  if (p1Open.length > 0) warningIssues.push(`${p1Open.length} 个 P1 缺陷未修复`);
  if (p1InProgress.length > 0) warningIssues.push(`${p1InProgress.length} 个 P1 缺陷修复中`);

  const gatePass = blockingIssues.length === 0;
  const canRelease = gatePass && conditionalNFRs.length === 0;
  return {
    gatePass,
    canRelease,
    releaseStatus: !gatePass ? 'no-go' : canRelease ? 'go' : 'conditional',
    blockingIssues,
    warningIssues,
  };
}

// 生成发布门禁报告
function generateReleaseGateReport(defects, analysisResult, nfrResult) {
  const decision = determineReleaseDecision(analysisResult, nfrResult);
  const { date, time } = analysisResult;

  log('\n============================================================', 'cyan');
  log('发布门禁检查:', 'cyan');
  log('============================================================', 'cyan');

  let reportContent = `# 发布门禁报告 — v1.x.x\n\n`;
  reportContent += `> 发布版本：v1.x.x\n`;
  reportContent += `> 计划发布时间：${date} 10:00:00\n`;
  reportContent += `> 报告生成时间：${date} ${time}\n\n`;

  log(
    '\n🚨 阻塞性问题（必须解决才能继续门禁）:',
    decision.blockingIssues.length > 0 ? 'red' : 'green'
  );
  reportContent += '## 🚨 阻塞性问题（必须解决才能发布）\n\n';

  if (decision.blockingIssues.length > 0) {
    decision.blockingIssues.forEach(issue => {
      log(`   ❌ ${issue}`, 'red');
      reportContent += `- ❌ ${issue}\n`;
    });
  } else {
    log('   ✅ 无阻塞性问题', 'green');
    reportContent += '✅ 无阻塞性问题\n\n';
  }

  log('\n⚠️  条件与警告项:', decision.warningIssues.length > 0 ? 'yellow' : 'green');
  reportContent += '## ⚠️ 警告项（建议解决，可延后）\n\n';
  if (decision.warningIssues.length === 0) {
    log('   ✅ 无条件项', 'green');
    reportContent += '✅ 无条件项\n\n';
  } else {
    decision.warningIssues.forEach((issue) => {
      log(`   ⚠️ ${issue}`, 'yellow');
      reportContent += `- ⚠️ ${issue}\n`;
    });
    reportContent += '\n';
  }

  log('\n✅ 通过项:', 'green');
  reportContent += '## ✅ 通过项\n\n';
  reportContent += `- ✅ 已解析 ${defects.length} 个唯一缺陷记录\n`;
  reportContent += `- ✅ ${nfrResult.compliantNFRs?.length || 0} 项 NFR 达标\n`;
  reportContent += '- ✅ P0 未关闭缺陷为 0 时本地门禁可继续\n';
  reportContent += '\n';

  log('\n============================================================', 'cyan');
  log('发布建议:', 'cyan');
  log('============================================================', 'cyan');
  reportContent += '## 📋 发布建议\n\n';

  if (decision.releaseStatus === 'go') {
    log('✅ **建议发布**', 'green');
    reportContent += '**当前状态**：✅ **建议发布**\n\n';
    reportContent += '无 P0 阻塞、无未达标或条件 NFR。\n';
  } else if (decision.releaseStatus === 'conditional') {
    log('⚠️ **本地门禁通过，但不建议发布**', 'yellow');
    reportContent += '**当前状态**：⚠️ **Conditional；本地门禁可继续，但不建议发布**\n\n';
    reportContent += '必须先补齐所有条件 NFR 的真实证据，再生成发布建议。\n';
  } else {
    log('❌ **不建议发布**', 'red');
    reportContent += '**当前状态**：❌ **不建议发布**\n\n';
    reportContent += '**阻塞原因**：\n';
    decision.blockingIssues.forEach((issue, index) => {
      log(`   ${index + 1}. ${issue}`, 'red');
      reportContent += `${index + 1}. ${issue}\n`;
    });
  }

  const reportPath = CONFIG.releaseGateReportPath.replace('{date}', date);
  if (shouldWriteReports) {
    const reportDir = path.dirname(CONFIG.releaseGateReportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    fs.writeFileSync(reportPath, reportContent, 'utf-8');
    log(`\n📝 发布门禁报告已保存到:`, 'cyan');
    log(`   ${reportPath}`);
  } else {
    log('\nℹ️ 未写入发布门禁报告（只校验模式，设置 QA_WRITE_REPORTS=1 可写入）', 'yellow');
  }

  return { ...decision, reportPath };
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('缺陷阻塞检查工具 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  // 解析缺陷列表
  const defects = parseDefects();

  // 统计缺陷
  const analysisResult = analyzeDefects(defects);

  // 检查 NFR 达标情况
  const nfrResult = checkNFRCompliance();

  // 生成发布门禁报告
  const decision = generateReleaseGateReport(defects, analysisResult, nfrResult);

  // 条件 NFR 允许本地 QA 继续，但不会成为发布建议；缺失或未达标证据仍非零退出。
  process.exit(decision.gatePass ? 0 : 1);
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

module.exports = {
  analyzeDefects,
  checkNFRCompliance,
  determineReleaseDecision,
  generateReleaseGateReport,
  parseDefectContent,
  parseDefects,
  parseNFRCompliance,
};

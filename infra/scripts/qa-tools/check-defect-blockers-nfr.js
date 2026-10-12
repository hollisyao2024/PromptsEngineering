// NFR 达标检查：解析全局与模块级 nfr-tracking.md，按最差状态归并同一 NFR。

const fs = require('fs');
const path = require('path');
const { scanMarkdownDocument } = require('../shared/markdown-document');
const {
  CONFIG,
  NFR_ID_SOURCE,
  cleanMarkdownCell,
  findHeaderIndex,
  isMarkdownSeparatorRow,
  log,
  markdownTableCells,
} = require('./check-defect-blockers-common');

function classifyNFRStatus(status) {
  const normalized = cleanMarkdownCell(status).replace(/(?<![\d.])0(?:\.0+)?%\s+fail(?:ure)?(?:s)?\b/giu, 'zero error rate');
  if (/❌|未达标|不达标|不通过|no-go|\bfail(?:ed|ure)?\b|\bincomplete\b|\bnot (?:passed|complete|compliant)\b/iu.test(normalized)) return 'nonCompliant';
  if (/⚠|🟡|⏳|🔄|⏸|暂缓|条件|部分|未|待|规划|仅|自动化|TDD|代码|没有|不等于|非阻断观察|external gate|pending|blocked|conditional|partial|contract_ready|evidence_unavailable|not_started|not_executed|pass_with_risk|archived|\bopen\b/iu.test(normalized)) return 'conditional';
  if (/✅|达标|通过|\bpass(?:ed)?\b|\bcomplete(?:d)?\b/iu.test(normalized)) return 'compliant';
  return 'nonCompliant';
}

const NFR_HEADERS = ['NFR ID', 'NFR', 'NFR / 指标', '子指标', '指标'];
const STATUS_HEADERS = ['状态', 'Status', '当前状态', '最终状态', '状态 / 残余边界', '结果', '当前结果', '当前结论'];
const NFR_RANK = { compliant: 2, conditional: 1, nonCompliant: 0 };

function summarizeNFRs(values, sourceAvailable = true) {
  const compliantNFRs = values.filter(item => item.classification === 'compliant');
  return { sourceAvailable, totalCount: values.length, compliantCount: compliantNFRs.length,
    compliantNFRs, conditionalNFRs: values.filter(item => item.classification === 'conditional'),
    nonCompliantNFRs: values.filter(item => item.classification === 'nonCompliant') };
}

function parseNFRCompliance(content) {
  const byID = new Map();
  let headers = null;
  for (const [index, line] of scanMarkdownDocument(String(content || '')).lines.entries()) {
    const cells = markdownTableCells(line.visible || '');
    if (!cells) { headers = null; continue; }
    if (isMarkdownSeparatorRow(cells)) continue;
    if (findHeaderIndex(cells, NFR_HEADERS) >= 0 && findHeaderIndex(cells, STATUS_HEADERS) >= 0) { headers = cells; continue; }
    if (!headers) continue;
    const id = cells[findHeaderIndex(headers, NFR_HEADERS)];
    if (!id) continue;
    // Group headings have a label only; a real NFR with missing evidence still blocks.
    if (/(?:类|性)\s+NFR$/u.test(cleanMarkdownCell(id)) && cells.filter(cell => cleanMarkdownCell(cell)).length === 1) continue;
    const descriptionIndex = findHeaderIndex(headers, ['描述', 'Description', '指标', '指标与门槛', '目标值', '目标']);
    const statusIndex = STATUS_HEADERS.map(name => findHeaderIndex(headers, [name])).find(index => index >= 0);
    const status = cells[statusIndex] || '';
    const followUpIndex = findHeaderIndex(headers, ['最终 Gate', '后续 Gate']);
    const followUpGate = followUpIndex >= 0 ? cells[followUpIndex] || '' : '';
    let classification = classifyNFRStatus(status);
    if (classification === 'compliant' && followUpGate && !/^(?:无|none|n\/a|-|—)$/iu.test(followUpGate)) classification = 'conditional';
    const item = { nfrId: id, description: descriptionIndex >= 0 ? cells[descriptionIndex] || id : id,
      status, classification, line: index + 1, ...(followUpGate ? {followUpGate} : {}) };
    const current = byID.get(id);
    if (!current || NFR_RANK[classification] < NFR_RANK[current.classification]) byID.set(id, item);
  }
  return summarizeNFRs([...byID.values()]);
}

// Both legacy global and modular files contribute evidence; neither masks the other.
function checkNFRCompliance(options = {}) {
  const config = { ...CONFIG, ...options };
  const files = [];
  if (fs.existsSync(config.nfrTrackingPath)) files.push(config.nfrTrackingPath);
  if (fs.existsSync(config.qaModulesDir)) {
    for (const dir of fs.readdirSync(config.qaModulesDir, {withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name))) {
      if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
      const file = path.join(config.qaModulesDir, dir.name, 'nfr-tracking.md');
      if (fs.existsSync(file)) files.push(file);
    }
  }
  const byID = new Map();
  const evidenceErrors = [];
  for (const file of files) {
    let result;
    try { result = parseNFRCompliance(fs.readFileSync(file, 'utf8')); }
    catch (error) { evidenceErrors.push({path:file, reason:error.code || 'read failed'}); continue; }
    if (!result.totalCount) evidenceErrors.push({path:file, reason:'no parseable NFR rows'});
    for (const item of [...result.compliantNFRs, ...result.conditionalNFRs, ...result.nonCompliantNFRs]) {
      const key = new RegExp('^' + NFR_ID_SOURCE + '$').test(item.nfrId) ? item.nfrId : file + ':' + item.nfrId;
      const current = byID.get(key);
      const sources = [...(current?.sources || []), {path:file, line:item.line, status:item.status}];
      const worst = !current || NFR_RANK[item.classification] < NFR_RANK[current.classification] ? item : current;
      byID.set(key, {...worst, sources});
    }
  }
  const result = {...summarizeNFRs([...byID.values()], files.length > 0 && evidenceErrors.length === 0), files, evidenceErrors};
  log('NFR 汇总：' + result.totalCount + ' 项，来源 ' + files.length + ' 个文件；' + result.compliantCount + ' 达标 / ' + result.conditionalNFRs.length + ' 条件 / ' + result.nonCompliantNFRs.length + ' 未达标');
  if (!files.length) log('❌ 未找到全局或模块级 NFR 追踪表', 'red');
  for (const error of evidenceErrors) log('❌ ' + error.path + ': ' + error.reason, 'red');
  return result;
}

module.exports = {
  checkNFRCompliance,
  parseNFRCompliance,
};

'use strict';

// 测试设计门禁（qa design context|check|amend）：
// G1 判定 TEST-DESIGN.md 的表结构、出处、覆盖、维度反例与 TC 证明；G2 要求设计行先于源码提交；
// G3 要求改写或删除已有预期时附 amend 变更行。判定只读规格与 qa run 结果，不读实现、不重跑测试。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { amendmentSource, loadDesignSpec, parseDesignDocument, parseSources } = require('./qa-design-spec');
const { DESIGN_FILE_NAME, DESIGN_TABLES, DIMENSIONS, PRIORITIES, QA_MODULES_DIR } = require('./business-spec-schema');
const { compareText, scanMarkdown } = require('./business-spec-markdown');
const { globToRegExp, resolveIntegrityConfig, resolveRange } = require('./qa-integrity');

const CONFIG_KEYS = new Set(['mode', 'requiredPriorities', 'requiredDimensions', 'sourceGlobs', 'contextGlobs']);
const MODES = new Set(['enforce', 'warn']);
const ISOLATIONS = new Set(['subagent', 'commit-order']);
const LINE_LIMIT = 60;
const PENDING_REVIEWER = '待评审';
const DOMAIN_NAME = /^[a-z0-9][a-z0-9-]*$/u;
const DESIGN_PATH = new RegExp(`^${QA_MODULES_DIR}/[^/]+/${DESIGN_FILE_NAME.replace('.', '\\.')}$`, 'u');
// G3 比较的“预期”字段：TC 列与行号不算预期，只改它们不需要 amend。
const FIELDS = Object.freeze({
  rules: ['type', 'statement', 'source', 'priority', 'verification'],
  advs: ['rules', 'dimension', 'scenario', 'expected'],
  bugs: ['symptom', 'rules', 'origin'],
});
const ROW_KINDS = Object.keys(FIELDS);

function configError(message) {
  const error = new Error(message);
  error.code = 'DESIGN_CONFIG_INVALID';
  return error;
}

function stringList(value, key, { allowEmpty = false } = {}) {
  const ok = Array.isArray(value) && (allowEmpty || value.length > 0) && value.every((item) => typeof item === 'string' && item.trim());
  if (!ok) throw configError(`qa.design.${key} must be a ${allowEmpty ? '' : 'non-empty '}list of non-empty strings`);
  return [...value];
}

function resolveDesignConfig(config) {
  const raw = config && config.qa && config.qa.design;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw configError('qa.design must be an object (defaults live in infra/templates/agent/config.example.json)');
  }
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.has(key)) throw configError(`qa.design.${key} is not a recognised key`);
  }
  if (!MODES.has(raw.mode)) throw configError('qa.design.mode must be enforce|warn');
  const requiredPriorities = stringList(raw.requiredPriorities, 'requiredPriorities');
  if (!requiredPriorities.every((item) => PRIORITIES.includes(item))) throw configError(`qa.design.requiredPriorities must use ${PRIORITIES.join('|')}`);
  const requiredDimensions = stringList(raw.requiredDimensions, 'requiredDimensions', { allowEmpty: true });
  if (!requiredDimensions.every((item) => DIMENSIONS.includes(item))) throw configError(`qa.design.requiredDimensions must use ${DIMENSIONS.join('|')}`);
  const sourceGlobs = stringList(raw.sourceGlobs, 'sourceGlobs');
  const contextGlobs = stringList(raw.contextGlobs, 'contextGlobs');
  let integrity;
  try {
    integrity = resolveIntegrityConfig(config);
  } catch (error) {
    throw configError(`qa.integrity 无效（设计门禁用其 testGlobs 排除测试文件）：${error.message}`);
  }
  return {
    mode: raw.mode,
    requiredPriorities,
    requiredDimensions,
    sourceGlobs,
    contextGlobs,
    sourceMatchers: sourceGlobs.map(globToRegExp),
    testMatchers: integrity.testMatchers,
  };
}

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    if (allowFailure) return null;
    const error = new Error(`git ${args.join(' ')} 失败：${String(result.stderr || (result.error && result.error.message) || '').trim()}`);
    error.code = 'DESIGN_GIT_FAILED';
    throw error;
  }
  return result.stdout;
}

const gitLines = (cwd, args) => git(cwd, args).split('\n').map((line) => line.trim()).filter(Boolean);
const matchesAny = (file, matchers) => (matchers || []).some((matcher) => matcher.test(file));
const isSourceFile = (file, design) => matchesAny(file, design.sourceMatchers) && !matchesAny(file, design.testMatchers);

// 出处判定上下文：已知 AC/INV 与源码/测试 matcher；design 缺省时只按 docs 规则判定路径。
function sourceContext(repoRoot, design, invs) {
  const { loadBusinessSpec } = require('./business-spec');
  const business = loadBusinessSpec({ repoRoot });
  return {
    repoRoot,
    business,
    knownAcs: new Set(business.knownAcIds),
    knownInvs: new Set(invs.map((inv) => inv.id)),
    sourceMatchers: design ? design.sourceMatchers : [],
    testMatchers: design ? design.testMatchers : [],
  };
}

// 单个出处项：返回 null 表示合法，否则返回 { code, detail }。
function judgeSourceItem(item, ctx) {
  if (item.kind === 'ac') return ctx.knownAcs.has(item.id) ? null : { code: 'SOURCE_UNKNOWN', detail: `${item.id} 不在 PRD 原子 AC 表中` };
  if (item.kind === 'inv') return ctx.knownInvs.has(item.id) ? null : { code: 'SOURCE_UNKNOWN', detail: `${item.id} 不在 PRD 不变量表中` };
  const invalid = { code: 'SOURCE_INVALID', detail: `出处 ${item.raw} 须为 AC-*、INV-* 或 docs/**.md#锚点` };
  if (item.kind !== 'path') return invalid;
  const file = item.path;
  if (path.isAbsolute(file) || file.includes('\\') || file.split('/').some((part) => part === '..' || part === '.' || part === '')) return invalid;
  if (matchesAny(file, ctx.sourceMatchers) || matchesAny(file, ctx.testMatchers)) {
    return { code: 'SOURCE_CODE', detail: `出处 ${item.raw} 指向源码或测试，预期不得取自实现` };
  }
  if (!file.startsWith('docs/') || !file.endsWith('.md') || !item.anchor) return invalid;
  try {
    if (!fs.lstatSync(path.join(ctx.repoRoot, file)).isFile()) throw new Error('not a file');
  } catch {
    return { code: 'SOURCE_UNKNOWN', detail: `出处文件 ${file} 不存在` };
  }
  return null;
}

// amend 变更行或 --source 的新出处：非推断、非空且每项合法。
function amendmentSourceValid(text, ctx) {
  const parsed = parseSources(text);
  return !parsed.inferred && parsed.items.length > 0 && parsed.items.every((item) => !judgeSourceItem(item, ctx));
}

const changeKey = (change) => [change.date, change.id, change.change, change.reason].join('|');
const fieldsOf = (kind, row) => FIELDS[kind].map((field) => (Array.isArray(row[field]) ? row[field].join(', ') : String(row[field] ?? ''))).join('\u0000');

function rowIndex(docs) {
  const index = new Map();
  for (const doc of docs) {
    for (const kind of ROW_KINDS) for (const row of doc[kind] || []) if (!index.has(row.id)) index.set(row.id, { kind, row, file: doc.file });
  }
  return index;
}

function readBaseDocs(repoRoot, baseSha) {
  const files = gitLines(repoRoot, ['ls-tree', '-r', '--name-only', baseSha, '--', QA_MODULES_DIR]).filter((file) => DESIGN_PATH.test(file));
  return files.map((file) => ({ file, ...parseDesignDocument(git(repoRoot, ['show', `${baseSha}:${file}`]), { file }) }));
}

// G2：本分支新增的设计行须在首个源码提交之前进入提交历史。
function checkOrder({ repoRoot, design, baseSha, headSha, baseIds, headIndex, addedChanges, ctx, blocks, risks }) {
  const commits = gitLines(repoRoot, ['rev-list', '--reverse', '--no-merges', `${baseSha}..${headSha}`]);
  let firstSource = -1;
  const firstSeen = new Map();
  commits.forEach((sha, index) => {
    const files = gitLines(repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', sha]);
    if (firstSource < 0 && files.some((file) => isSourceFile(file, design))) firstSource = index;
    for (const file of files.filter((item) => DESIGN_PATH.test(item))) {
      const content = git(repoRoot, ['show', `${sha}:${file}`], { allowFailure: true });
      if (content === null) continue; // 该提交删除了设计文件
      const parsed = parseDesignDocument(content, { file });
      for (const kind of ROW_KINDS) for (const row of parsed[kind]) if (!firstSeen.has(row.id)) firstSeen.set(row.id, index);
    }
  });
  if (firstSource < 0) return;
  for (const [id] of headIndex) {
    if (baseIds.has(id)) continue;
    const at = firstSeen.has(id) ? firstSeen.get(id) : commits.length; // 尚未提交的行视为最晚
    if (at < firstSource) continue;
    const amended = addedChanges.some((change) => change.id === id && change.change === '新增' && amendmentSourceValid(amendmentSource(change.reason), ctx));
    if (amended) push(risks, 'ADDED_AFTER_SOURCE', id, '设计行在源码提交之后加入，已有新增变更记录');
    else push(blocks, 'ORDER', id, '设计行未早于首个源码提交；先单独提交 TEST-DESIGN.md，或用 qa design amend 登记新增');
  }
}

function push(list, code, subject, detail) {
  list.push({ code: `DESIGN_${code}`, subject: String(subject), detail: String(detail) });
}

function violationSubject(violation) {
  if (violation.code === 'ID_DUPLICATE' && violation.id) return violation.id;
  if (String(violation.code).startsWith('TABLE_')) return violation.file;
  return violation.line ? `${violation.file}:${violation.line}` : violation.file;
}

function evaluateDesign({ repoRoot, design, results, baseSha = null, headSha = null }) {
  const spec = loadDesignSpec({ repoRoot });
  const ctx = sourceContext(repoRoot, design, spec.invs);
  const blocks = [];
  const risks = [];
  const required = new Set(design.requiredPriorities);
  const resultsAvailable = Boolean(results && results.available);
  let proofNeeded = false;

  // TC 证明：缺 TC 阻断；结果不可用时只记一次 RESULTS_UNAVAILABLE；未全部 passed 阻断。
  const proveTcs = (subject, tcs) => {
    if (!tcs || tcs.length === 0) {
      push(blocks, 'TC_MISSING', subject, '必需行缺少 TC');
      return false;
    }
    proofNeeded = true;
    if (!resultsAvailable) return false;
    const failing = tcs.filter((tc) => !(results.tcs && results.tcs[tc] && results.tcs[tc].status === 'passed'));
    if (failing.length === 0) return true;
    const detail = failing.map((tc) => `${tc}=${(results.tcs && results.tcs[tc] && results.tcs[tc].status) || 'missing'}`).join(', ');
    push(blocks, 'TC_UNPROVEN', subject, `qa run 结果未证明通过：${detail}`);
    return false;
  };

  for (const violation of spec.violations) push(blocks, violation.code, violationSubject(violation), violation.message);
  for (const doc of spec.docs) {
    if (doc.header.issues.length > 0) push(risks, 'HEADER_MISSING', doc.file, doc.header.issues.join('；'));
  }

  const ruleIds = new Set();
  const advIds = new Set();
  for (const doc of spec.docs) {
    for (const rule of doc.rules) ruleIds.add(rule.id);
    for (const adv of doc.advs) advIds.add(adv.id);
  }

  // 规则：出处、优先级、TC 证明。
  const coveredSources = new Set();
  const acPriority = new Map(ctx.business.acs.map((ac) => [ac.id, ac.priority]));
  const invPriority = new Map(spec.invs.map((inv) => [inv.id, inv.priority]));
  const requiredRules = [];
  let rulesVerified = 0;
  for (const doc of spec.docs) {
    for (const rule of doc.rules) {
      const parsed = parseSources(rule.source);
      if (parsed.inferred) push(risks, 'SOURCE_INFERRED', rule.id, `推断出处须回流 PRD：${parsed.reason || rule.source}`);
      let sourceRank = Infinity;
      for (const item of parsed.items) {
        const problem = judgeSourceItem(item, ctx);
        if (problem) {
          push(blocks, problem.code, rule.id, problem.detail);
          continue;
        }
        const priority = item.kind === 'ac' ? acPriority.get(item.id) : item.kind === 'inv' ? invPriority.get(item.id) : null;
        if (item.kind === 'ac' || item.kind === 'inv') coveredSources.add(item.id);
        if (priority) sourceRank = Math.min(sourceRank, PRIORITIES.indexOf(priority));
      }
      if (PRIORITIES.indexOf(rule.priority) > sourceRank) {
        push(blocks, 'PRIORITY_LOWER', rule.id, `规则优先级 ${rule.priority} 低于其出处的 ${PRIORITIES[sourceRank]}`);
      }
      if (rule.type === 'undefined') push(risks, 'RULE_UNDEFINED', rule.id, '未定义行为须回流 PRD 明确处置');
      if (!required.has(rule.priority)) continue;
      requiredRules.push(rule);
      if (rule.verification === 'manual') push(risks, 'MANUAL', rule.id, '必需规则为人工验证，不计入 RULES_VERIFIED');
      else if (proveTcs(rule.id, rule.tcs)) rulesVerified += 1;
    }
  }

  // 必需 AC/INV 须被设计覆盖；有必需项却没有设计文档的域整体报 ABSENT。
  const designDomains = new Set(spec.docs.map((doc) => doc.domain));
  const requiredItems = [
    ...ctx.business.acs.filter((ac) => required.has(ac.priority)).map((ac) => ({ id: ac.id, domain: ac.domain })),
    ...spec.invs.filter((inv) => required.has(inv.priority)).map((inv) => ({ id: inv.id, domain: inv.domain })),
  ];
  const absent = [...new Set(requiredItems.filter((item) => !designDomains.has(item.domain)).map((item) => item.domain))].sort(compareText);
  for (const domain of absent) push(blocks, 'ABSENT', domain, `功能域有必需 AC/INV，但缺少 ${QA_MODULES_DIR}/${domain}/${DESIGN_FILE_NAME}`);
  for (const item of requiredItems) {
    if (!absent.includes(item.domain) && !coveredSources.has(item.id)) push(blocks, 'SOURCE_UNCOVERED', item.id, '必需 AC/INV 未被任何规则以合法出处引用');
  }

  // 反例：引用必需规则的非“不适用”行须被证明；必需规则 × 必需维度须有行。
  const requiredRuleIds = new Set(requiredRules.map((rule) => rule.id));
  const advProven = new Map();
  const allAdvs = spec.docs.flatMap((doc) => doc.advs);
  for (const adv of allAdvs) {
    const unknown = adv.rules.filter((id) => !ruleIds.has(id));
    if (unknown.length > 0) push(blocks, 'REFERENCE_UNKNOWN', adv.id, `引用了不存在的规则：${unknown.join(', ')}`);
    if (adv.notApplicable || !adv.rules.some((id) => requiredRuleIds.has(id))) continue;
    advProven.set(adv.id, proveTcs(adv.id, adv.tcs));
  }
  let advCovered = 0;
  for (const rule of requiredRules) {
    const missing = [];
    for (const dimension of design.requiredDimensions) {
      const rows = allAdvs.filter((adv) => adv.dimension === dimension && adv.rules.includes(rule.id));
      if (rows.length === 0) missing.push(dimension);
      else if (rows.some((adv) => adv.notApplicable || advProven.get(adv.id))) advCovered += 1;
    }
    if (missing.length > 0) push(blocks, 'DIMENSION_MISSING', rule.id, `缺少维度反例（或“不适用：理由”）：${missing.join(', ')}`);
  }

  // 缺陷复现：未修复记风险；已修复须有通过的 TC；关联对象须存在。
  for (const bug of spec.docs.flatMap((doc) => doc.bugs)) {
    const unknown = bug.rules.filter((id) => !ruleIds.has(id) && !advIds.has(id));
    if (unknown.length > 0) push(blocks, 'REFERENCE_UNKNOWN', bug.id, `关联了不存在的规则或反例：${unknown.join(', ')}`);
    if (bug.fix === null) push(risks, 'BUG_OPEN', bug.id, '缺陷尚未修复');
    else proveTcs(bug.id, bug.tcs);
  }
  if (proofNeeded && !resultsAvailable) {
    push(blocks, 'RESULTS_UNAVAILABLE', 'qa-run', `qa run 结果不可用（${(results && results.reason) || 'RESULTS_MISSING'}），无法证明 TC 通过`);
  }

  // 变更记录、G2 时序与 G3 预期变更。
  const headChanges = spec.docs.flatMap((doc) => doc.changes);
  for (const change of headChanges) if (change.reviewer === PENDING_REVIEWER) push(risks, 'REVIEW_PENDING', change.id, '变更记录待评审');
  let countedChanges = headChanges;
  if (baseSha && headSha) {
    const baseDocs = readBaseDocs(repoRoot, baseSha);
    const baseIndex = rowIndex(baseDocs);
    const headIndex = rowIndex(spec.docs);
    const baseChanges = baseDocs.flatMap((doc) => doc.changes);
    const baseKeys = new Set(baseChanges.map(changeKey));
    const headKeys = new Set(headChanges.map(changeKey));
    const addedChanges = headChanges.filter((change) => !baseKeys.has(changeKey(change)));
    countedChanges = addedChanges;
    for (const change of baseChanges) {
      if (!headKeys.has(changeKey(change))) push(blocks, 'AMENDMENT_REMOVED', change.id, '已提交的变更记录被删除或改写');
    }
    for (const [id, base] of baseIndex) {
      const head = headIndex.get(id);
      if (!head) {
        if (!addedChanges.some((change) => change.id === id && change.change === '删除')) {
          push(blocks, 'EXPECTATION_CHANGED', id, '设计行被删除，缺少 qa design amend 的删除记录');
        }
      } else if (fieldsOf(base.kind, base.row) !== fieldsOf(head.kind, head.row)) {
        const amended = addedChanges.some((change) => change.id === id && change.change === '修改' && amendmentSourceValid(amendmentSource(change.reason), ctx));
        if (!amended) push(blocks, 'EXPECTATION_CHANGED', id, '已有预期被改写，缺少带合法新出处的 qa design amend 修改记录');
      }
    }
    checkOrder({ repoRoot, design, baseSha, headSha, baseIds: new Set(baseIndex.keys()), headIndex, addedChanges, ctx, blocks, risks });
  }
  const amendments = countedChanges.filter((change) => change.change === '修改' || change.change === '删除').length;

  const isolations = spec.docs.map((doc) => (ISOLATIONS.has(doc.header.isolation) ? doc.header.isolation : 'UNDECLARED'));
  let isolation = 'NONE';
  if (isolations.includes('UNDECLARED')) isolation = 'UNDECLARED';
  else if (isolations.length > 0) isolation = new Set(isolations).size === 1 ? isolations[0] : 'mixed';

  // warn 模式：阻断项降为风险，便于存量项目逐步接入。
  if (design.mode === 'warn') risks.unshift(...blocks.splice(0));
  const status = blocks.length > 0 ? 'BLOCKED' : risks.length > 0 ? 'PASS_WITH_RISK' : 'PASS';
  return {
    status,
    mode: design.mode,
    docs: spec.docs.length,
    isolation,
    metrics: { rulesTotal: requiredRules.length, rulesVerified, advCovered, advTotal: requiredRules.length * design.requiredDimensions.length, amendments },
    blocks,
    risks,
  };
}

const flatten = (text) => String(text).replace(/\s*\r?\n\s*/gu, ' ');

function limitedLines(prefix, items) {
  const lines = items.slice(0, LINE_LIMIT).map((item) => `${prefix}=${item.code}|${item.subject}|${flatten(item.detail)}`);
  if (items.length > LINE_LIMIT) lines.push(`${prefix}_TRUNCATED=${items.length - LINE_LIMIT}`);
  return lines;
}

function designLines(result) {
  const { metrics } = result;
  return [
    `DESIGN_GATE=${result.status} MODE=${result.mode} DOCS=${result.docs}`,
    `RULES_TOTAL=${metrics.rulesTotal}`,
    `RULES_VERIFIED=${metrics.rulesVerified}`,
    `ADV_COVERED=${metrics.advCovered}/${metrics.advTotal}`,
    `DESIGN_AMENDMENTS=${metrics.amendments}`,
    `DESIGN_ISOLATION=${result.isolation}`,
    ...limitedLines('DESIGN_BLOCK', result.blocks),
    ...limitedLines('DESIGN_RISK', result.risks),
  ];
}

const escapeCell = (text) => flatten(text).replace(/\|/gu, '\\|').trim();

// amend：比较工作区与 base 的同一 ID，向变更记录表追加一行；不改动规则/反例/缺陷行本身。
function applyAmendment({ repoRoot, baseSha, id, reason, source = null, reviewer = null, now = new Date(), design = null }) {
  if (!reason || !String(reason).trim()) throw new Error('--reason 不能为空');
  const spec = loadDesignSpec({ repoRoot });
  const head = rowIndex(spec.docs).get(id);
  const base = rowIndex(readBaseDocs(repoRoot, baseSha)).get(id);
  if (!head && !base) throw new Error(`找不到设计行 ${id}`);
  let change = '删除';
  if (head && !base) change = '新增';
  else if (head && base) {
    if (fieldsOf(head.kind, head.row) === fieldsOf(base.kind, base.row)) throw new Error(`${id} 与 base 相比没有变化，无需 amend`);
    change = '修改';
  }
  if (change !== '删除' && !source) throw new Error(`${change}设计行须用 --source 给出新出处（AC-*、INV-* 或 docs/**.md#锚点）`);
  if (source && !amendmentSourceValid(source, sourceContext(repoRoot, design, spec.invs))) {
    throw new Error(`新出处不合法：${source}（须为已知 AC-*、INV-* 或存在的 docs/**.md#锚点，不得指向源码）`);
  }
  const file = (head || base).file;
  const absolute = path.join(repoRoot, file);
  let raw;
  try {
    raw = fs.readFileSync(absolute, 'utf8');
  } catch (error) {
    throw new Error(`无法读取 ${file}：${error.message}`);
  }
  const bom = raw.startsWith('﻿') ? '﻿' : '';
  const body = bom ? raw.slice(1) : raw;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const table = scanMarkdown(body, DESIGN_TABLES).tables.find((item) => item.definition.name === 'changes');
  if (!table) throw new Error(`${file} 缺少变更记录表，无法登记 amend`);
  const reasonCell = source ? `${reason}；新出处：${source}` : reason;
  const row = `| ${now.toISOString().slice(0, 10)} | ${id} | ${change} | ${escapeCell(reasonCell)} | ${escapeCell(reviewer || PENDING_REVIEWER)} |`;
  const lines = body.split(/\r?\n/u);
  lines.splice(table.endIndex + 1, 0, row);
  fs.writeFileSync(absolute, bom + lines.join(eol), 'utf8');
  return { change, file, row };
}

// context：只打包规格文档，排除源码与测试，按路径排序后拼接，sha256 可复现。
function buildContext({ repoRoot, design, domain = null }) {
  if (domain !== null && !DOMAIN_NAME.test(domain)) throw new Error(`功能域名称不合法：${domain}（小写字母、数字与连字符）`);
  const matchers = design.contextGlobs.map((glob) => globToRegExp(glob.split('{domain}').join(domain || '*')));
  const listed = git(repoRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
  const files = [...new Set(listed)]
    .filter((file) => matchesAny(file, matchers) && !matchesAny(file, design.sourceMatchers) && !matchesAny(file, design.testMatchers))
    .filter((file) => {
      try {
        return fs.lstatSync(path.join(repoRoot, file)).isFile();
      } catch {
        return false;
      }
    })
    .sort(compareText);
  if (files.length === 0) {
    const error = new Error(`没有匹配 qa.design.contextGlobs 的规格文件（功能域 ${domain || 'all'}）`);
    error.code = 'DESIGN_CONTEXT_EMPTY';
    throw error;
  }
  const content = files
    .map((file) => {
      const buffer = fs.readFileSync(path.join(repoRoot, file));
      const text = buffer.toString('utf8');
      const digest = crypto.createHash('sha256').update(buffer).digest('hex');
      return `==== FILE: ${file} sha256=${digest} ====\n${text}${text.endsWith('\n') ? '' : '\n'}`;
    })
    .join('');
  return { files, content, sha256: crypto.createHash('sha256').update(content).digest('hex') };
}

const ACTION_OPTIONS = { check: ['base'], context: ['domain'], amend: ['id', 'reason', 'source', 'reviewer', 'base'] };
const USAGE = '用法：qa design check [--base <ref>] | context [--domain <域>] | amend --id <行 ID> --reason <原因> [--source <新出处>] [--reviewer <评审人>] [--base <ref>]';

function parseCliArgs(argv) {
  const [action, ...rest] = argv;
  if (!action || !ACTION_OPTIONS[action]) throw new Error(USAGE);
  const allowed = ACTION_OPTIONS[action];
  const values = Object.fromEntries(allowed.map((key) => [key, null]));
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`不支持的位置参数：${token}`);
    const eq = token.indexOf('=');
    const key = token.slice(2, eq < 0 ? undefined : eq);
    if (!allowed.includes(key)) throw new Error(`qa design ${action} 不支持 --${key}`);
    let value = eq < 0 ? rest[index + 1] : token.slice(eq + 1);
    if (eq < 0) index += 1;
    if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`--${key} 需要一个值`);
    if (values[key] !== null) throw new Error(`--${key} 重复`);
    values[key] = value;
  }
  if (action === 'amend') {
    if (!values.id) throw new Error('amend 需要 --id');
    if (!values.reason) throw new Error('amend 需要 --reason');
  }
  return { action, ...values };
}

function loadResults(config, repoRoot, headSha) {
  const { getMainRepoRoot } = require('../shared/config');
  const { readResults, resultsDirectory } = require('./business-results');
  const read = readResults(resultsDirectory(config, getMainRepoRoot(repoRoot), repoRoot));
  if (!read.ok) return { available: false, reason: read.code };
  if (read.results.head_sha !== headSha) return { available: false, reason: 'RESULTS_STALE_HEAD' };
  return { available: true, tcs: read.results.tcs || {} };
}

// qa verify 与 qa design check 共用的门禁求值：解析配置、读取绑定 HEAD 的 qa run 结果，再判定。
function evaluateDesignGate({ repoRoot, config, baseSha, headSha }) {
  const design = resolveDesignConfig(config);
  return evaluateDesign({ repoRoot, design, results: loadResults(config, repoRoot, headSha), baseSha, headSha });
}

function main(argv) {
  const { ensureContainerDirectories, getMainRepoRoot, loadConfig, resolveRepoRoot } = require('../shared/config');
  const args = parseCliArgs(argv);
  const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
  const config = loadConfig({ repoRoot });
  const design = resolveDesignConfig(config);

  if (args.action === 'context') {
    const mainRoot = getMainRepoRoot(repoRoot);
    ensureContainerDirectories(config, mainRoot, ['tmp']);
    const bundle = buildContext({ repoRoot, design, domain: args.domain });
    const directory = path.join(resolveContainerPathFor(config, mainRoot), 'qa-design-context');
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${args.domain || 'all'}-${bundle.sha256.slice(0, 12)}.md`);
    fs.writeFileSync(file, bundle.content, 'utf8');
    console.log(`DESIGN_CONTEXT_FILE=${file}`);
    console.log(`DESIGN_CONTEXT_SHA256=${bundle.sha256}`);
    console.log(`DESIGN_CONTEXT_FILES=${bundle.files.length}`);
    return {
      status: 'OK',
      summary: `已打包 ${bundle.files.length} 份规格文档`,
      nextAction: `把材料包内联交给 xirang-qa-designer 子代理，并在 TEST-DESIGN.md 头部记录 设计材料包：sha256=${bundle.sha256}`,
    };
  }

  const range = args.action === 'amend' && args.base
    ? { baseSha: git(repoRoot, ['rev-parse', '--verify', `${args.base}^{commit}`]).trim() }
    : resolveRange(repoRoot, config, args.base);

  if (args.action === 'amend') {
    const { row, change } = applyAmendment({ repoRoot, baseSha: range.baseSha, id: args.id, reason: args.reason, source: args.source, reviewer: args.reviewer, design });
    console.log(`DESIGN_AMENDMENT_ROW=${row}`);
    return { status: 'OK', summary: `已为 ${args.id} 登记${change}记录`, nextAction: '由评审人复核变更行后与设计改动一并提交，再重跑 pnpm agent -- qa design check' };
  }

  if (config.template && config.template.role === 'source') {
    console.log('DESIGN_GATE=SKIPPED');
    return { status: 'OK', summary: '模板源不执行测试设计门禁', nextAction: '继续 TDD/QA 流程' };
  }
  const result = evaluateDesignGate({ repoRoot, config, baseSha: range.baseSha, headSha: range.headSha });
  for (const line of designLines(result)) console.log(line);
  if (result.status === 'BLOCKED') {
    return {
      status: 'BLOCKED',
      reason: 'DESIGN_BLOCKED',
      summary: `测试设计门禁阻断 ${result.blocks.length} 项`,
      nextAction: '按 DESIGN_BLOCK 行修复 TEST-DESIGN.md 或补齐通过的 TC；改写已有预期须先执行 pnpm agent -- qa design amend',
    };
  }
  return {
    status: 'OK',
    summary: result.status === 'PASS' ? '测试设计门禁通过' : `测试设计门禁通过，附 ${result.risks.length} 项风险`,
    nextAction: result.status === 'PASS' ? '继续 TDD/QA 流程' : '在交付报告中披露 DESIGN_RISK 行',
  };
}

function resolveContainerPathFor(config, mainRoot) {
  const { resolveContainerPath } = require('../shared/config');
  return resolveContainerPath(config, mainRoot, 'tmp');
}

module.exports = { applyAmendment, buildContext, designLines, evaluateDesign, evaluateDesignGate, main, parseCliArgs, resolveDesignConfig };

if (require.main === module) {
  const { exitOnHelp } = require('../shared/cli-help');
  const { resultBlockLines, resultExitCode } = require('../shared/result-block');
  exitOnHelp([
    'pnpm agent -- qa design <check|context|amend> [options]',
    '  check [--base <ref>]        G1–G3：规则表、出处、覆盖、维度反例、TC 证明、设计先于源码、预期变更须 amend',
    '  context [--domain <域>]     只打包规格文档到容器 tmp，输出 DESIGN_CONTEXT_SHA256',
    '  amend --id <行 ID> --reason <原因> [--source <新出处>] [--reviewer <评审人>] [--base <ref>]',
    '                              为新增/修改/删除的设计行追加变更记录（修改与新增必须 --source）',
  ].join('\n'));
  let outcome;
  try {
    outcome = main(process.argv.slice(2));
  } catch (error) {
    outcome = {
      status: /_GIT_FAILED$/u.test(error.code || '') ? 'FAILED' : 'BLOCKED',
      reason: error.code || 'DESIGN_INVALID_INPUT',
      summary: error.message,
      nextAction: '按 SUMMARY 修正参数、配置或 TEST-DESIGN.md 后重试 pnpm agent -- qa design',
    };
  }
  for (const line of resultBlockLines(outcome)) console.log(line);
  process.exit(resultExitCode(outcome.status));
}

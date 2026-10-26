'use strict';

// 业务测试规格的读取与语法校验：
//   - docs/prd-modules/<domain>/*.md 中的原子 AC 表（唯一的验收来源）；
//   - docs/qa-modules/<domain>/PATHS.md 中的界面/状态/转移/路径模型；
//   - docs/qa-modules/<domain>/TEST-DESIGN.md 登记的 TC（只宽松收集标识，表格校验在 qa-design.js）。
// 全部解析确定性完成，不依赖大模型、随机数或网络；引用与覆盖关系的校验在 qa-paths.js。

const fs = require('node:fs');
const path = require('node:path');
const {
  AC_ID,
  AC_TABLE,
  AC_TABLE_HEADER,
  CRITERIA,
  DESIGN_FILE_NAME,
  PATHS_FILE_NAME,
  PATHS_TABLES,
  PLATFORM_TAG,
  PRD_MODULES_DIR,
  PRIORITIES,
  QA_MODULES_DIR,
  STORY_ID,
  TEST_CASE_ID,
  VERIFICATIONS,
} = require('./business-spec-schema');
const {
  closesFence,
  compareText,
  compareViolations,
  openingFence,
  parseList,
  rowColumnsViolation,
  scanMarkdown,
  splitList,
  splitTableRow,
} = require('./business-spec-markdown');
const { parsePathsDocument } = require('./business-spec-paths');
const { collectDesignTcs } = require('./qa-design-spec');
const { STORY_ID_SOURCE, extractIds } = require('../shared/governance-ids');

// ---------------------------------------------------------------- 原子 AC 表

function validateAcRow(cells, { file, line }) {
  const [id, story, priority, verification, platform, given, when, then, tc] = cells;
  const violations = [];
  const report = (code, message) => violations.push({ code, file, line, message });

  const idValid = AC_ID.test(id);
  if (!idValid) report('AC_ID_INVALID', `AC ID「${id}」须形如 AC-{模块}-NNN-NN`);

  if (!STORY_ID.test(story)) {
    report('STORY_INVALID', `Story「${story}」须形如 US-{模块}-NNN`);
  } else if (idValid && story.slice(3) !== id.slice(3, -3)) {
    report('STORY_MISMATCH', `${id} 须归属 US-${id.slice(3, -3)}，实际为 ${story}`);
  }

  if (!PRIORITIES.includes(priority)) report('PRIORITY_INVALID', `优先级「${priority}」须为 ${PRIORITIES.join('/')} 之一`);
  if (!VERIFICATIONS.includes(verification)) report('VERIFICATION_INVALID', `验证「${verification}」须为 ${VERIFICATIONS.join('/')} 之一`);

  const platforms = parseList(platform, PLATFORM_TAG, { allowBlank: false });
  if (!platforms.ok) {
    report('PLATFORM_INVALID', platforms.blank
      ? '端不能为空；不区分端请写 -'
      : `端「${platforms.invalid.join('、')}」不是合法标签（小写字母开头，如 web、ios；多个用逗号分隔，不区分写 -）`);
  }

  for (const [label, value] of [['Given', given], ['When', when], ['Then', then]]) {
    if (!value) report('FIELD_EMPTY', `${label} 不能为空`);
  }

  const tcs = parseList(tc, TEST_CASE_ID, { allowBlank: false });
  if (!tcs.ok) {
    report('TC_INVALID', tcs.blank
      ? 'TC 不能为空；暂无对应用例请写 -'
      : `TC「${tcs.invalid.join('、')}」须形如 TC-{模块}-NNN（多个用逗号分隔，无则写 -）`);
  }

  const ac = violations.length > 0 ? null : {
    id,
    module: id.slice(3, -7),
    story,
    priority,
    verification,
    platforms: platforms.items,
    given,
    when,
    then,
    tcs: tcs.items,
    file,
    line,
  };
  return { idValid, violations, ac };
}

function parseAcTables(content, { file = '' } = {}) {
  const { tables } = scanMarkdown(content, [AC_TABLE]);
  const acs = [];
  const entries = [];
  const violations = [];
  let rows = 0;
  for (const table of tables) {
    for (const row of table.rows) {
      rows += 1;
      const cells = splitTableRow(row.text);
      if (!cells || cells.length !== AC_TABLE_HEADER.length) {
        violations.push(rowColumnsViolation(cells, AC_TABLE_HEADER.length, { file, line: row.line }));
        continue;
      }
      const result = validateAcRow(cells, { file, line: row.line });
      violations.push(...result.violations);
      if (result.ac) acs.push(result.ac);
      if (result.idValid) entries.push({ id: cells[0], line: row.line, ac: result.ac });
    }
  }
  return { acs, entries, violations, tables: tables.length, rows };
}

// ---------------------------------------------------------------- PRD Story 清单

// Story 的登记处有两种：Story 表中第一格恰为 Story ID 的行（PRD 模板 §2.1），以及以 Story ID 开头的标题
// （如 `## US-FP-023 客户报价` 或 `### US-FP-024：门户`）。依赖列、横幅、正文与 AC 表里出现的 ID 只是引用，
// 不算登记；围栏代码块内的表格与标题一律忽略。
const STORY_HEADING = new RegExp(`^ {0,3}#{1,6}[ \\t]+(${STORY_ID_SOURCE})(?![A-Za-z0-9-])`, 'u');

function storyDefinitions(content) {
  const defined = [];
  let fence = null;
  for (const line of content.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    fence = openingFence(line);
    if (fence) continue;
    const heading = STORY_HEADING.exec(line);
    if (heading) {
      defined.push(heading[1]);
      continue;
    }
    const cells = splitTableRow(line);
    if (cells && STORY_ID.test(cells[0])) defined.push(cells[0]);
  }
  return defined;
}

const storyModule = (story) => story.slice(3, -4);

// 出现次数最多的模块标识；并列取先出现者。
function dominantModule(modules) {
  const counts = new Map();
  for (const module of modules) counts.set(module, (counts.get(module) ?? 0) + 1);
  let best = null;
  for (const [module, count] of counts) {
    if (best === null || count > counts.get(best)) best = module;
  }
  return best;
}

// 模块 PRD 自己拥有的 Story，供 QA 文档生成与 qa verify 的覆盖率分母共用。
// 登记（表格行与标题）在前，只出现在 AC 表 Story 列（合法行）的 Story 依次补在其后，全部去重并保持首次出现顺序。
// 两处都没有时退化为全文中去重后的 Story ID 提及（defined=false），此时无从区分引用与登记。
// moduleId 是本模块的标识：AC 编号里出现最多的模块，无 AC 时取登记里最多的模块，退化时为 null。
// Story ID 按约定带本模块标记（US-{MODULE}-NNN），所以登记里其他模块的 Story（如跨模块依赖表首列）不计入。
function parsePrdStories(content, { file = '' } = {}) {
  const text = content === undefined || content === null ? '' : String(content);
  const definitions = [...new Set(storyDefinitions(text))];
  const { acs } = parseAcTables(text, { file });
  if (definitions.length === 0 && acs.length === 0) {
    return { stories: [...new Set(extractIds(text, STORY_ID_SOURCE))], defined: false, moduleId: null, acs: [] };
  }
  const moduleId = dominantModule(acs.length > 0 ? acs.map((ac) => ac.module) : definitions.map(storyModule));
  const owned = definitions.filter((story) => storyModule(story) === moduleId);
  return { stories: [...new Set([...owned, ...acs.map((ac) => ac.story)])], defined: true, moduleId, acs };
}

// ---------------------------------------------------------------- 仓库级加载

function listEntries(directory, accept) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
  return entries.filter(accept).map((entry) => entry.name).sort(compareText);
}

// Dirent 不跟随符号链接：链接目录与链接文件都不会被读取，规格只来自仓库内的真实文件。
const isDirectory = (entry) => entry.isDirectory();
const isMarkdownFile = (entry) => entry.isFile() && entry.name.endsWith('.md');

function loadBusinessSpec({ repoRoot }) {
  const root = path.resolve(repoRoot);
  const acs = [];
  const modules = [];
  const modulesWithoutTable = [];
  const knownAcIds = [];
  const pathsDocs = [];
  const designTcs = new Set();
  const violations = [];
  const firstDeclared = new Map();
  let acRowCount = 0;

  const prdRoot = path.join(root, PRD_MODULES_DIR);
  for (const domain of listEntries(prdRoot, isDirectory)) {
    const directory = path.join(prdRoot, domain);
    const names = listEntries(directory, isMarkdownFile);
    if (names.length === 0) continue;
    let tables = 0;
    let acCount = 0;
    for (const name of names) {
      const file = `${PRD_MODULES_DIR}/${domain}/${name}`;
      const parsed = parseAcTables(fs.readFileSync(path.join(directory, name), 'utf8'), { file });
      tables += parsed.tables;
      acRowCount += parsed.rows;
      violations.push(...parsed.violations);
      for (const entry of parsed.entries) {
        const first = firstDeclared.get(entry.id);
        if (first) {
          violations.push({
            code: 'AC_ID_DUPLICATE',
            file,
            line: entry.line,
            message: `${entry.id} 重复，首次定义于 ${first.file}:${first.line}`,
          });
          continue;
        }
        firstDeclared.set(entry.id, { file, line: entry.line });
        knownAcIds.push(entry.id);
        if (entry.ac) {
          acs.push({ ...entry.ac, domain });
          acCount += 1;
        }
      }
    }
    if (tables > 0) modules.push({ domain, acCount });
    else modulesWithoutTable.push(domain);
  }

  const qaRoot = path.join(root, QA_MODULES_DIR);
  for (const domain of listEntries(qaRoot, isDirectory)) {
    const directory = path.join(qaRoot, domain);
    // 测试设计的格式错误由 qa design check 报告，此处只收集 TC 标识，供结果聚合识别为已知用例。
    if (listEntries(directory, (entry) => entry.isFile() && entry.name === DESIGN_FILE_NAME).length) {
      for (const tc of collectDesignTcs(fs.readFileSync(path.join(directory, DESIGN_FILE_NAME), 'utf8'))) designTcs.add(tc);
    }
    if (!listEntries(directory, (entry) => entry.isFile() && entry.name === PATHS_FILE_NAME).length) continue;
    const file = `${QA_MODULES_DIR}/${domain}/${PATHS_FILE_NAME}`;
    const { violations: documentViolations, ...doc } = parsePathsDocument(
      fs.readFileSync(path.join(directory, PATHS_FILE_NAME), 'utf8'),
      { file },
    );
    pathsDocs.push({ domain, file, ...doc });
    violations.push(...documentViolations);
  }

  violations.sort(compareViolations);
  return {
    acs,
    modules,
    modulesWithoutTable,
    pathsDocs,
    designTcs: [...designTcs].sort(compareText),
    knownAcIds,
    acRowCount,
    violations,
  };
}

module.exports = {
  AC_TABLE_HEADER,
  CRITERIA,
  PATHS_TABLES,
  PRIORITIES,
  PRD_MODULES_DIR,
  QA_MODULES_DIR,
  VERIFICATIONS,
  compareText,
  compareViolations,
  loadBusinessSpec,
  parseAcTables,
  parsePathsDocument,
  parsePrdStories,
  splitList,
  splitTableRow,
};

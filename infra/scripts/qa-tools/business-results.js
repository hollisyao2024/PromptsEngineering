'use strict';

// 业务测试结果模型：JUnit XML 解析、AC/TC 标识绑定、按端聚合，以及容器 tmp 下
// ac-results.json 与报告副本的读写。解析与聚合是纯函数：不访问网络、不执行或展开报告内容、
// 不依赖时钟与随机数，同样的输入逐字节产生同样的输出，qa verify 才能用报告副本重算并与记录比对。

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const { resolveContainerPath } = require('../shared/config');
const { AC_ID_SOURCE, TEST_CASE_ID_SOURCE, searchPattern } = require('../shared/governance-ids');
const { NO_PLATFORM } = require('./business-config');
const { compareText } = require('./business-spec');
const { worktreeReceiptKey } = require('./qa-verification-state');

const SCHEMA_VERSION = 1;
const RESULTS_FILE = 'ac-results.json';
const RESULTS_DIR_NAME = 'qa-business-results';
const REPORTS_DIR_NAME = 'reports';
const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const MAX_RESULTS_BYTES = 64 * 1024 * 1024;
const MAX_ELEMENT_DEPTH = 128;
const MAX_REPORTED_PROBLEMS = 10;
const CASE_STATUSES = Object.freeze(['passed', 'failed', 'error', 'skipped']);
const SUITE_STATUSES = Object.freeze(['ok', 'exit_nonzero', 'spawn_error', 'timeout', 'report_missing', 'report_invalid']);
const REPORT_BEARING = Object.freeze(['ok', 'exit_nonzero']);

const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const HEX_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const TAG_PATTERN = /^[a-z][a-z0-9-]*$/u;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isTimestamp = (value) => typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));
const show = (value) => JSON.stringify(value) ?? String(value);
const sortedUnique = (items) => [...new Set(items)].sort(compareText);
const sha256Of = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------
// JUnit XML 解析
// ---------------------------------------------------------------------------

// 只实现读取 testcase 结果所需的 XML 子集：不展开实体、不处理 DTD，一律线性扫描。
const XML_NAME = /[\p{L}_:][\p{L}\p{N}_:.\-·]*/uy;
const CHAR_REFERENCE = /&(?:(lt|gt|amp|quot|apos)|#([0-9]+)|#x([0-9a-fA-F]+));/y;
const NAMED_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const DECLARATION_KEYWORDS = new Set(['DOCTYPE', 'ENTITY', 'ELEMENT', 'ATTLIST', 'NOTATION']);
const ENCODING_DECLARATION = /\bencoding\s*=\s*(?:"([^"]*)"|'([^']*)')/iu;
const NON_SPACE = /[^ \t\r\n]/u;
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

class ParseFailure extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

function lineAt(text, index) {
  let line = 1;
  for (let at = text.indexOf('\n'); at !== -1 && at < index; at = text.indexOf('\n', at + 1)) line += 1;
  return line;
}

function isXmlChar(codePoint) {
  return codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd
    || (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
}

// 只还原五个预定义实体与数字字符引用；其余 & 一律拒绝，因此不存在实体展开。
function decodeReferences(raw, base, reject) {
  let amp = raw.indexOf('&');
  if (amp === -1) return raw;
  let output = '';
  let last = 0;
  while (amp !== -1) {
    CHAR_REFERENCE.lastIndex = amp;
    const match = CHAR_REFERENCE.exec(raw);
    if (!match) reject('出现不被支持的实体或裸 &（只允许 &lt; &gt; &amp; &quot; &apos; 与数字字符引用）', base + amp);
    let value;
    if (match[1]) {
      value = NAMED_ENTITIES[match[1]];
    } else {
      const codePoint = match[2] ? Number.parseInt(match[2], 10) : Number.parseInt(match[3], 16);
      if (!isXmlChar(codePoint)) reject(`字符引用 ${match[0]} 不是合法的 XML 字符`, base + amp);
      value = String.fromCodePoint(codePoint);
    }
    output += raw.slice(last, amp) + value;
    last = amp + match[0].length;
    amp = raw.indexOf('&', last);
  }
  return output + raw.slice(last);
}

function toBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return null;
}

function tooLarge(size, limit) {
  return new ParseFailure('too_large', `报告大小 ${size} 字节超过上限 ${limit} 字节`);
}

function decodeReport(input, maxBytes) {
  let text;
  if (typeof input === 'string') {
    const size = Buffer.byteLength(input, 'utf8');
    if (size > maxBytes) throw tooLarge(size, maxBytes);
    text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  } else if (input instanceof Uint8Array) {
    if (input.length > maxBytes) throw tooLarge(input.length, maxBytes);
    try {
      text = STRICT_UTF8.decode(input);
    } catch {
      throw new ParseFailure('encoding', '报告不是合法的 UTF-8 编码');
    }
  } else {
    throw new ParseFailure('malformed', '报告内容必须是字符串或字节序列');
  }
  if (text.includes('\u0000')) {
    throw new ParseFailure('encoding', '报告含有 NUL 字节，不是 UTF-8 文本（可能是 UTF-16 或二进制文件）');
  }
  return text;
}

function finishCase(entry) {
  let status = 'passed';
  if (entry.error) status = 'error';
  else if (entry.failure) status = 'failed';
  else if (entry.skipped) status = 'skipped';
  return { name: entry.name, classname: entry.classname, status };
}

function skipSpace(text, from) {
  let at = from;
  while (at < text.length) {
    const code = text.charCodeAt(at);
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) break;
    at += 1;
  }
  return at;
}

function scanReport(text) {
  const stack = [];
  const cases = [];
  let current = null; // 当前打开的 testcase
  let rootSeen = false;
  let rootClosed = false;
  let started = false; // 已出现过标记；XML 声明只能出现在最前面

  const reject = (message, at) => {
    throw new ParseFailure('malformed', `${message}（第 ${lineAt(text, at)} 行）`);
  };

  const scanInstruction = (at) => {
    const close = text.indexOf('?>', at + 2);
    if (close === -1) reject('处理指令未闭合', at);
    XML_NAME.lastIndex = at + 2;
    const target = XML_NAME.exec(text);
    if (!target) reject('处理指令缺少目标名称', at);
    if (target[0].toLowerCase() === 'xml') {
      if (started) reject('XML 声明必须位于文档开头', at);
      const encoding = ENCODING_DECLARATION.exec(text.slice(at + 2, close));
      const declared = encoding ? (encoding[1] ?? encoding[2]) : null;
      if (declared !== null && declared.toLowerCase() !== 'utf-8') {
        throw new ParseFailure('encoding', `报告声明的编码是 ${declared}，只支持 UTF-8`);
      }
    }
    started = true;
    return close + 2;
  };

  const scanDeclaration = (at) => {
    if (text.startsWith('<!--', at)) {
      const close = text.indexOf('-->', at + 4);
      if (close === -1) reject('注释未闭合', at);
      started = true;
      return close + 3;
    }
    if (text.startsWith('<![CDATA[', at)) {
      if (stack.length === 0) reject('根元素之外出现 CDATA', at);
      const close = text.indexOf(']]>', at + 9);
      if (close === -1) reject('CDATA 未闭合', at);
      return close + 3;
    }
    const keyword = /^<!([A-Za-z]+)/u.exec(text.slice(at, at + 16));
    if (keyword && DECLARATION_KEYWORDS.has(keyword[1].toUpperCase())) {
      throw new ParseFailure('doctype', `报告含有 <!${keyword[1]} 声明（第 ${lineAt(text, at)} 行）；出于安全不接受 DTD 与实体声明`);
    }
    return reject('无法识别的 <! 标记', at);
  };

  const scanEndTag = (at) => {
    XML_NAME.lastIndex = at + 2;
    const name = XML_NAME.exec(text);
    if (!name) reject('闭合标签缺少名称', at);
    const cursor = skipSpace(text, at + 2 + name[0].length);
    if (text[cursor] !== '>') reject('闭合标签格式错误', at);
    if (stack.length === 0 || stack[stack.length - 1] !== name[0]) {
      reject(`闭合标签 </${name[0]}> 与开始标签不匹配`, at);
    }
    stack.pop();
    if (current && stack.length === current.depth) {
      cases.push(finishCase(current));
      current = null;
    }
    if (stack.length === 0) rootClosed = true;
    return cursor + 1;
  };

  const scanStartTag = (at) => {
    if (rootClosed) reject('出现多个根元素', at);
    XML_NAME.lastIndex = at + 1;
    const name = XML_NAME.exec(text);
    if (!name) reject('标签缺少合法名称', at);
    const tag = name[0];
    const seen = new Set();
    let caseName = '';
    let caseClass = '';
    let selfClosing = false;
    let cursor = at + 1 + tag.length;
    for (;;) {
      const next = skipSpace(text, cursor);
      const hadSpace = next > cursor;
      cursor = next;
      const char = text[cursor];
      if (char === '>') {
        cursor += 1;
        break;
      }
      if (char === '/') {
        if (text[cursor + 1] !== '>') reject('自闭合标签格式错误', cursor);
        selfClosing = true;
        cursor += 2;
        break;
      }
      if (char === undefined) reject(`标签 <${tag}> 未闭合`, at);
      if (!hadSpace) reject('属性之间需要空白', cursor);
      XML_NAME.lastIndex = cursor;
      const attribute = XML_NAME.exec(text);
      if (!attribute) reject('属性名不合法', cursor);
      const key = attribute[0];
      cursor = skipSpace(text, cursor + key.length);
      if (text[cursor] !== '=') reject(`属性 ${key} 缺少等号`, cursor);
      cursor = skipSpace(text, cursor + 1);
      const quote = text[cursor];
      if (quote !== '"' && quote !== "'") reject(`属性 ${key} 的值缺少引号`, cursor);
      const close = text.indexOf(quote, cursor + 1);
      if (close === -1) reject(`属性 ${key} 的值缺少结束引号`, cursor);
      const raw = text.slice(cursor + 1, close);
      if (raw.includes('<')) reject(`属性 ${key} 的值不得包含 <`, cursor);
      if (seen.has(key)) reject(`属性 ${key} 重复出现`, cursor);
      seen.add(key);
      const value = decodeReferences(raw, cursor + 1, reject);
      if (tag === 'testcase') {
        if (key === 'name') caseName = value;
        else if (key === 'classname') caseClass = value;
      }
      cursor = close + 1;
    }

    started = true;
    rootSeen = true;
    if (tag === 'testcase') {
      if (current) reject('testcase 不能嵌套', at);
      const entry = { name: caseName, classname: caseClass, depth: stack.length, error: false, failure: false, skipped: false };
      if (selfClosing) cases.push(finishCase(entry));
      else current = entry;
    } else if (current && stack.length === current.depth + 1) {
      // 只有 testcase 的直接子元素才表示结果；嵌套在 system-out 等元素里的同名元素不算。
      if (tag === 'error') current.error = true;
      else if (tag === 'failure') current.failure = true;
      else if (tag === 'skipped') current.skipped = true;
    }
    if (selfClosing) {
      if (stack.length === 0) rootClosed = true;
    } else {
      if (stack.length >= MAX_ELEMENT_DEPTH) reject(`元素嵌套超过 ${MAX_ELEMENT_DEPTH} 层`, at);
      stack.push(tag);
    }
    return cursor;
  };

  let pos = 0;
  while (pos < text.length) {
    const open = text.indexOf('<', pos);
    const stop = open === -1 ? text.length : open;
    if (stop > pos) {
      const chunk = text.slice(pos, stop);
      if (stack.length === 0) {
        if (NON_SPACE.test(chunk)) reject('根元素之外出现文本', pos);
      } else {
        decodeReferences(chunk, pos, reject);
      }
    }
    if (open === -1) break;
    pos = open;
    const kind = text[pos + 1];
    if (kind === '?') pos = scanInstruction(pos);
    else if (kind === '!') pos = scanDeclaration(pos);
    else if (kind === '/') pos = scanEndTag(pos);
    else pos = scanStartTag(pos);
  }

  if (stack.length > 0) reject(`标签 <${stack[stack.length - 1]}> 未闭合`, text.length);
  if (!rootSeen) reject('没有根元素', 0);
  if (cases.length === 0) throw new ParseFailure('no_testcases', '报告中没有任何 testcase');
  return cases;
}

// 返回 { ok:true, cases:[{name,classname,status}] } 或 { ok:false, reason, message }；永不抛出。
// reason：doctype | malformed | encoding | too_large | no_testcases。
function parseJunitReport(input, options = {}) {
  const maxBytes = options && Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_REPORT_BYTES;
  try {
    return { ok: true, cases: scanReport(decodeReport(input, maxBytes)) };
  } catch (error) {
    if (error instanceof ParseFailure) return { ok: false, reason: error.reason, message: error.message };
    return { ok: false, reason: 'malformed', message: `报告无法解析：${error.message}` };
  }
}

// ---------------------------------------------------------------------------
// 标识提取与套件结果评估
// ---------------------------------------------------------------------------

const AC_LABELS = searchPattern(AC_ID_SOURCE);
const TC_LABELS = searchPattern(TEST_CASE_ID_SOURCE);

// 从 name 再从 classname 提取 AC 与 TC 标识，去重并保持首次出现的顺序。
function extractCaseLabels({ name = '', classname = '' } = {}) {
  const collect = (pattern) => {
    const found = [];
    for (const field of [name, classname]) {
      for (const id of String(field ?? '').match(pattern) || []) {
        if (!found.includes(id)) found.push(id);
      }
    }
    return found;
  };
  return { acs: collect(AC_LABELS), tcs: collect(TC_LABELS) };
}

function exitDetail(exitCode, signal) {
  if (signal) return `被信号 ${signal} 终止`;
  if (Number.isInteger(exitCode)) return `退出码 ${exitCode}`;
  return '未取得退出码';
}

// 把一次套件运行的原始观察归为 SUITE_STATUSES 之一。
// 严重度：spawn_error > timeout > report_missing > report_invalid > exit_nonzero > ok。
// 前四种是硬失败，不绑定用例也不留报告记录；exit_nonzero 只是事实，用例照常绑定，由 AC 状态裁决。
// reportProblem 由调用方在读取报告时给出（例如报告不是普通文件、读取失败）：调用方已判定报告不可信，
// 即使同时读到了字节也不再采信，按 report_invalid 记录；它排在 spawn_error 与 timeout 之后。
function evaluateSuiteOutcome({
  spawnError = null,
  timedOut = false,
  exitCode = null,
  signal = null,
  reportBytes = null,
  reportProblem = null,
  timeoutSeconds,
  maxBytes = MAX_REPORT_BYTES,
} = {}) {
  const hard = (status, detail) => ({ status, detail, cases: null, report: null });
  if (spawnError) return hard('spawn_error', `无法启动套件命令：${spawnError.message ?? spawnError}`);
  if (timedOut) return hard('timeout', timeoutSeconds ? `运行超过 ${timeoutSeconds} 秒被终止` : '运行超时被终止');
  if (reportProblem) return hard('report_invalid', `报告无法使用：${reportProblem}`);
  if (reportBytes === null || reportBytes === undefined) return hard('report_missing', '运行结束后没有找到报告文件');

  const bytes = toBytes(reportBytes);
  if (!bytes) return hard('report_invalid', '报告内容类型无效');
  const parsed = parseJunitReport(bytes, { maxBytes });
  if (!parsed.ok) return hard('report_invalid', `报告无法使用（${parsed.reason}）：${parsed.message}`);

  const report = { sha256: sha256Of(bytes), bytes: bytes.length };
  if (exitCode === 0) return { status: 'ok', detail: null, cases: parsed.cases, report };
  return { status: 'exit_nonzero', detail: exitDetail(exitCode, signal), cases: parsed.cases, report };
}

// ---------------------------------------------------------------------------
// AC/TC/路径聚合
// ---------------------------------------------------------------------------

const emptyCounts = () => ({ total: 0, passed: 0, failed: 0, error: 0, skipped: 0 });

function addCase(counts, status) {
  counts.total += 1;
  counts[status] += 1;
}

// 任一失败（含 error）即 failed；否则至少一条通过即 passed；全部跳过为 skipped；没有用例为 missing。
function statusOf(counts) {
  if (counts.failed + counts.error > 0) return 'failed';
  if (counts.passed > 0) return 'passed';
  if (counts.skipped > 0) return 'skipped';
  return 'missing';
}

function sortedObject(entries) {
  const output = {};
  for (const [key, value] of [...entries].sort((left, right) => compareText(left[0], right[0]))) output[key] = value;
  return output;
}

function pathStatus(tcStatuses) {
  if (tcStatuses.includes('failed')) return 'failed';
  if (tcStatuses.length > 0 && tcStatuses.every((status) => status === 'passed')) return 'passed';
  return 'missing';
}

// 单条 AC 是否被证明：qa run 的 AC_OPEN 与 qa verify 的门禁共用，保证两处结论一致。
// record 是结果文件里 acs[id] 的结构。任一失败（含声明范围之外的端）即不通过；
// 未声明端的 AC 看整体状态；声明了端的 AC 要求每个声明的端都通过，没有套件提供的端按 missing 计。
// 无法识别的状态、缺失或畸形的记录一律不通过。
function judgeAc(record) {
  const unproven = (state, reason) => ({ proven: false, state, reason });
  if (!record || typeof record !== 'object' || Array.isArray(record)) return unproven('missing', '没有该 AC 的结果记录');

  const byPlatform = record.by_platform && typeof record.by_platform === 'object' ? record.by_platform : {};
  if (record.status === 'failed' || Object.values(byPlatform).includes('failed')) return unproven('failed', '存在失败用例');

  const declared = Array.isArray(record.platforms) ? record.platforms : [];
  if (declared.length === 0) {
    if (record.status === 'passed') return { proven: true, state: 'passed', reason: null };
    if (record.status === 'skipped') return unproven('skipped', '用例全部被跳过');
    return unproven('missing', '没有任何用例覆盖');
  }

  const bad = declared
    .map((platform) => [platform, byPlatform[platform] ?? 'missing'])
    .filter(([, status]) => status !== 'passed');
  if (bad.length === 0) return { proven: true, state: 'passed', reason: null };
  const onlySkipped = bad.every(([, status]) => status === 'skipped');
  return unproven(onlySkipped ? 'skipped' : 'missing', `声明的端未通过：${bad.map(([platform, status]) => `${platform}: ${status}`).join(', ')}`);
}

// spec 来自 loadBusinessSpec；suites 为 [{ name, platform, cases }]，cases 为 null 表示硬失败套件。
// 用例绑定到它直接引用的 AC，并经 PRD 原子表的 TC 列绑定到列出该 TC 的全部 AC；
// 同一用例对同一 AC 只计一次。所有输出按标识排序，与用例输入顺序无关。
function aggregateResults({ spec, suites } = {}) {
  if (!spec || !Array.isArray(spec.acs)) throw new Error('spec 须为 loadBusinessSpec 的结果');
  if (!Array.isArray(suites)) throw new Error('suites 须为数组');

  const acById = new Map(spec.acs.map((ac) => [ac.id, ac]));
  const knownAcs = new Set([...(spec.knownAcIds || []), ...acById.keys()]);
  const acsOfTc = new Map();
  const knownTcs = new Set();
  for (const ac of spec.acs) {
    for (const tc of ac.tcs) {
      knownTcs.add(tc);
      if (!acsOfTc.has(tc)) acsOfTc.set(tc, []);
      acsOfTc.get(tc).push(ac.id);
    }
  }
  const pathEntries = [];
  for (const doc of spec.pathsDocs || []) {
    for (const entry of doc.paths || []) {
      pathEntries.push(entry);
      for (const tc of entry.tcs) knownTcs.add(tc);
    }
  }

  const tcCounts = new Map();
  const acStats = new Map();
  const unknown = new Set();
  const caseTotals = emptyCounts();
  const suiteSummaries = [];
  let unlabelled = 0;

  for (const suite of suites) {
    const platform = suite.platform || NO_PLATFORM;
    const cases = Array.isArray(suite.cases) ? suite.cases : [];
    let suiteUnlabelled = 0;
    for (const item of cases) {
      if (!CASE_STATUSES.includes(item.status)) throw new Error(`用例 ${show(item.name)} 的状态 ${show(item.status)} 无效`);
      addCase(caseTotals, item.status);
      const labels = extractCaseLabels(item);
      if (labels.acs.length === 0 && labels.tcs.length === 0) {
        suiteUnlabelled += 1;
        continue;
      }
      // 显式标注 AC 的用例只绑定这些 AC；只有未标注 AC 时，才按 TC 展开到列出该 TC 的全部 AC。
      // 否则 "AC-X / TC-1" 失败会连带让仅复用 TC-1 的兄弟 AC 失败。
      const bound = new Set();
      for (const id of labels.acs) {
        if (!knownAcs.has(id)) unknown.add(id);
        else if (acById.has(id)) bound.add(id);
      }
      const explicitAcs = bound.size > 0;
      for (const id of labels.tcs) {
        if (!knownTcs.has(id)) {
          unknown.add(id);
          continue;
        }
        if (!tcCounts.has(id)) tcCounts.set(id, emptyCounts());
        addCase(tcCounts.get(id), item.status);
        if (explicitAcs) continue;
        for (const acId of acsOfTc.get(id) || []) bound.add(acId);
      }
      for (const acId of bound) {
        if (!acStats.has(acId)) acStats.set(acId, { overall: emptyCounts(), platforms: new Map() });
        const stats = acStats.get(acId);
        addCase(stats.overall, item.status);
        if (platform !== NO_PLATFORM) {
          if (!stats.platforms.has(platform)) stats.platforms.set(platform, emptyCounts());
          addCase(stats.platforms.get(platform), item.status);
        }
      }
    }
    unlabelled += suiteUnlabelled;
    suiteSummaries.push({ name: suite.name, cases: cases.length, unlabelled: suiteUnlabelled });
  }

  const tcs = sortedObject([...knownTcs].map((id) => {
    const counts = tcCounts.get(id) || emptyCounts();
    return [id, { status: statusOf(counts), cases: counts }];
  }));

  const acs = sortedObject(spec.acs.map((ac) => {
    const stats = acStats.get(ac.id);
    const declared = sortedUnique(ac.platforms.filter((platform) => platform !== NO_PLATFORM));
    const byPlatform = {};
    for (const platform of sortedUnique([...declared, ...(stats ? stats.platforms.keys() : [])])) {
      byPlatform[platform] = statusOf((stats && stats.platforms.get(platform)) || emptyCounts());
    }
    return [ac.id, {
      priority: ac.priority,
      verification: ac.verification,
      platforms: declared,
      status: statusOf(stats ? stats.overall : emptyCounts()),
      by_platform: byPlatform,
      tcs: sortedUnique(ac.tcs),
    }];
  }));

  const paths = sortedObject(pathEntries.map((entry) => {
    const entryTcs = sortedUnique(entry.tcs);
    return [entry.id, { status: pathStatus(entryTcs.map((tc) => tcs[tc].status)), tcs: entryTcs }];
  }));

  const acStatuses = { passed: 0, failed: 0, skipped: 0, missing: 0 };
  let manual = 0;
  for (const record of Object.values(acs)) {
    acStatuses[record.status] += 1;
    if (record.verification === 'manual') manual += 1;
  }
  const acTotal = Object.keys(acs).length;

  return {
    suites: suiteSummaries,
    tcs,
    acs,
    paths,
    unknown_ids: [...unknown].sort(compareText),
    summary: {
      suites: suites.length,
      cases: caseTotals,
      unlabelled,
      acs: { total: acTotal, ...acStatuses, auto: acTotal - manual, manual },
      paths: { total: Object.keys(paths).length, passed: Object.values(paths).filter((record) => record.status === 'passed').length },
    },
  };
}

// ---------------------------------------------------------------------------
// 结果文档
// ---------------------------------------------------------------------------

function reportCopyPath(name) {
  if (typeof name !== 'string' || !TAG_PATTERN.test(name)) {
    throw new Error(`套件名称 ${show(name)} 不合法，须匹配 [a-z][a-z0-9-]*`);
  }
  return `${REPORTS_DIR_NAME}/${name}.xml`;
}

function resultsDirectory(config, mainRoot, worktreePath) {
  return path.join(resolveContainerPath(config, mainRoot, 'tmp'), RESULTS_DIR_NAME, worktreeReceiptKey(worktreePath));
}

function assertCases(cases, at) {
  if (!Array.isArray(cases)) throw new Error(`${at}.cases 须为数组或 null`);
  cases.forEach((item, index) => {
    const label = `${at}.cases[${index}]`;
    if (!isObject(item)) throw new Error(`${label} 须为对象`);
    if (typeof item.name !== 'string') throw new Error(`${label}.name 须为字符串`);
    if (typeof item.classname !== 'string') throw new Error(`${label}.classname 须为字符串`);
    if (!CASE_STATUSES.includes(item.status)) throw new Error(`${label}.status 须为 ${CASE_STATUSES.join('/')} 之一`);
  });
}

function suiteRecord(suite, index, counts) {
  const at = `suites[${index}]`;
  if (!isObject(suite)) throw new Error(`${at} 须为对象`);
  if (!SUITE_STATUSES.includes(suite.status)) throw new Error(`${at}.status 须为 ${SUITE_STATUSES.join('/')} 之一`);
  const reported = REPORT_BEARING.includes(suite.status);
  if (reported) assertCases(suite.cases, at);
  else if (suite.cases !== null) throw new Error(`${at}.cases 在状态 ${suite.status} 下须为 null`);
  if (reported && !isObject(suite.report)) throw new Error(`${at}.report 在状态 ${suite.status} 下须带报告记录`);
  if (!reported && suite.report !== null) throw new Error(`${at}.report 在状态 ${suite.status} 下须为 null`);
  return {
    name: suite.name,
    platform: suite.platform ?? NO_PLATFORM,
    command: suite.command,
    exit_code: suite.exitCode ?? null,
    status: suite.status,
    detail: suite.detail ?? null,
    duration_ms: Math.round(suite.durationMs),
    cases: counts.cases,
    unlabelled: counts.unlabelled,
    report: reported
      ? { path: suite.report.path, copy: reportCopyPath(suite.name), sha256: suite.report.sha256, bytes: suite.report.bytes }
      : null,
  };
}

// suites 为 qa run 的观察：{ name, platform, command, exitCode, status, durationMs, detail, report:{path,sha256,bytes}|null, cases|null }。
// 缺少或非法的输入直接报错，不写出残缺结果。
function buildResults({ spec, headSha, worktreeClean, configDigest, generatedAt, suites } = {}) {
  if (typeof headSha !== 'string' || !SHA_PATTERN.test(headSha)) throw new Error('headSha 须为完整的小写十六进制提交 SHA');
  if (typeof worktreeClean !== 'boolean') throw new Error('worktreeClean 须为布尔值');
  if (typeof configDigest !== 'string' || !DIGEST_PATTERN.test(configDigest)) throw new Error('configDigest 须形如 sha256:<64 位小写十六进制>');
  if (!isTimestamp(generatedAt)) throw new Error('generatedAt 须为可解析的时间字符串');
  if (!Array.isArray(suites)) throw new Error('suites 须为数组');

  const aggregate = aggregateResults({
    spec,
    suites: suites.map((suite) => ({ name: suite && suite.name, platform: suite && suite.platform, cases: suite ? suite.cases : null })),
  });
  const results = {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    head_sha: headSha,
    worktree_clean: worktreeClean,
    config_digest: configDigest,
    suites: suites.map((suite, index) => suiteRecord(suite, index, aggregate.suites[index])),
    tcs: aggregate.tcs,
    acs: aggregate.acs,
    paths: aggregate.paths,
    unknown_ids: aggregate.unknown_ids,
    summary: aggregate.summary,
  };
  const problems = validateResults(results);
  if (problems.length > 0) throw new Error(`结果输入无效：${problems.slice(0, MAX_REPORTED_PROBLEMS).join('；')}`);
  return results;
}

function validateSuites(suites, problem) {
  if (!Array.isArray(suites)) {
    problem('suites 须为数组');
    return;
  }
  const names = new Map();
  suites.forEach((suite, index) => {
    const at = `suites[${index}]`;
    if (!isObject(suite)) {
      problem(`${at} 须为对象`);
      return;
    }
    const nameValid = typeof suite.name === 'string' && TAG_PATTERN.test(suite.name);
    if (!nameValid) problem(`${at}.name 须匹配 [a-z][a-z0-9-]*`);
    else if (names.has(suite.name)) problem(`${at}.name「${suite.name}」与 suites[${names.get(suite.name)}] 重复`);
    else names.set(suite.name, index);

    if (suite.platform !== NO_PLATFORM && !(typeof suite.platform === 'string' && TAG_PATTERN.test(suite.platform))) {
      problem(`${at}.platform 须为单个端标签或 ${NO_PLATFORM}`);
    }
    if (typeof suite.command !== 'string') problem(`${at}.command 须为字符串`);
    if (suite.exit_code !== null && !Number.isInteger(suite.exit_code)) problem(`${at}.exit_code 须为整数或 null`);
    const statusValid = SUITE_STATUSES.includes(suite.status);
    if (!statusValid) problem(`${at}.status 须为 ${SUITE_STATUSES.join('/')} 之一，实际为 ${show(suite.status)}`);
    if (suite.status === 'ok' && suite.exit_code !== 0) problem(`${at}.exit_code 在状态 ok 下须为 0`);
    if (suite.status === 'exit_nonzero' && suite.exit_code === 0) problem(`${at}.exit_code 在状态 exit_nonzero 下不能为 0`);
    if (suite.detail !== null && typeof suite.detail !== 'string') problem(`${at}.detail 须为字符串或 null`);
    if (!isCount(suite.duration_ms)) problem(`${at}.duration_ms 须为非负整数`);
    if (!isCount(suite.cases)) problem(`${at}.cases 须为非负整数`);
    if (!isCount(suite.unlabelled)) problem(`${at}.unlabelled 须为非负整数`);
    else if (isCount(suite.cases) && suite.unlabelled > suite.cases) problem(`${at}.unlabelled 不能大于 cases`);

    const needsReport = statusValid && REPORT_BEARING.includes(suite.status);
    if (suite.report === null) {
      if (needsReport) problem(`${at}.report 缺失：状态 ${suite.status} 的套件必须带报告记录`);
    } else if (!isObject(suite.report)) {
      problem(`${at}.report 须为对象或 null`);
    } else {
      if (statusValid && !needsReport) problem(`${at}.report 在状态 ${suite.status} 下须为 null`);
      if (typeof suite.report.path !== 'string' || suite.report.path === '') problem(`${at}.report.path 须为非空字符串`);
      const expectedCopy = nameValid ? reportCopyPath(suite.name) : null;
      if (expectedCopy === null || suite.report.copy !== expectedCopy) {
        problem(`${at}.report.copy 须为 ${expectedCopy ?? 'reports/<套件名>.xml'}，实际为 ${show(suite.report.copy)}`);
      }
      if (typeof suite.report.sha256 !== 'string' || !HEX_DIGEST_PATTERN.test(suite.report.sha256)) {
        problem(`${at}.report.sha256 须为 64 位小写十六进制`);
      }
      if (!isCount(suite.report.bytes)) problem(`${at}.report.bytes 须为非负整数`);
    }
  });
}

// 只做结构与取值检查，返回带字段路径的问题列表；与规格是否一致由门禁用报告副本重算比对。
function validateResults(results) {
  if (!isObject(results)) return ['结果须为 JSON 对象'];
  const problems = [];
  const problem = (message) => problems.push(message);
  if (results.schema_version !== SCHEMA_VERSION) problem(`schema_version 须为 ${SCHEMA_VERSION}，实际为 ${show(results.schema_version)}`);
  if (typeof results.head_sha !== 'string' || !SHA_PATTERN.test(results.head_sha)) problem('head_sha 须为完整的小写十六进制提交 SHA');
  if (typeof results.worktree_clean !== 'boolean') problem('worktree_clean 须为布尔值');
  if (typeof results.config_digest !== 'string' || !DIGEST_PATTERN.test(results.config_digest)) {
    problem('config_digest 须形如 sha256:<64 位小写十六进制>');
  }
  if (!isTimestamp(results.generated_at)) problem('generated_at 须为可解析的时间字符串');
  validateSuites(results.suites, problem);
  for (const key of ['tcs', 'acs', 'paths', 'summary']) {
    if (!isObject(results[key])) problem(`${key} 须为对象`);
  }
  if (!Array.isArray(results.unknown_ids) || results.unknown_ids.some((item) => typeof item !== 'string')) {
    problem('unknown_ids 须为字符串数组');
  }
  return problems;
}

// ---------------------------------------------------------------------------
// 结果文件读写
// ---------------------------------------------------------------------------

// 同目录临时文件加 rename：读取方只会看到旧文件或完整的新文件。必须以 fs.renameSync 命名空间形式调用。
function atomicWrite(file, data) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, data, { flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

// rename 不能把文件覆盖到目录上；结果文件或报告副本的位置被换成目录时（门禁会以 REPORT_TAMPERED /
// RESULTS_INVALID 阻断并提示重新运行 qa run），先清掉该目录，让重新运行能够自愈。
// 目标路径恒为本结果目录内由校验过的套件名拼出的精确路径；符号链接与普通文件由 rename 直接替换。
function clearDirectoryAt(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
}

// 先写报告副本，最后才原子写入 ac-results.json；写成功后再尽力清理不再被引用的旧副本。
// results 与 reportCopies 都校验通过才会落盘；写失败不覆盖旧的 ac-results.json，也不留临时文件。
function writeResults({ directory, results, reportCopies = {} } = {}) {
  if (typeof directory !== 'string' || directory === '') throw new Error('directory 须为非空路径');
  const problems = validateResults(results);
  if (problems.length > 0) throw new Error(`拒绝写入无效结果：${problems.slice(0, MAX_REPORTED_PROBLEMS).join('；')}`);
  const copies = Object.keys(reportCopies || {}).sort(compareText).map((name) => {
    const relative = reportCopyPath(name);
    const bytes = toBytes(reportCopies[name]);
    if (!bytes) throw new Error(`套件 ${name} 的报告副本须为字符串或字节序列`);
    return { relative, bytes };
  });

  const reportsDirectory = path.join(directory, REPORTS_DIR_NAME);
  fs.mkdirSync(reportsDirectory, { recursive: true });
  if (!fs.lstatSync(reportsDirectory).isDirectory()) throw new Error(`${REPORTS_DIR_NAME} 不是普通目录，拒绝写入`);
  for (const copy of copies) {
    const destination = path.join(directory, copy.relative);
    clearDirectoryAt(destination);
    atomicWrite(destination, copy.bytes);
  }

  const target = path.join(directory, RESULTS_FILE);
  clearDirectoryAt(target);
  atomicWrite(target, `${JSON.stringify(results, null, 2)}\n`);

  const keep = new Set(copies.map((copy) => path.basename(copy.relative)));
  try {
    for (const entry of fs.readdirSync(reportsDirectory)) {
      if (!keep.has(entry)) fs.rmSync(path.join(reportsDirectory, entry), { recursive: true, force: true });
    }
  } catch {
    // 新结果已经提交，清理陈旧副本只是尽力而为。
  }
  return target;
}

function unusable(code, message) {
  return { ok: false, code, message };
}

// 返回 { ok:true, results, file } 或 { ok:false, code:'RESULTS_MISSING'|'RESULTS_INVALID', message }。
// 残留的临时文件不会被读到；目录与符号链接一律视为不可用。
function readResults(directory) {
  const file = path.join(directory, RESULTS_FILE);
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return unusable('RESULTS_MISSING', `找不到 ${RESULTS_FILE}，请先运行 qa run`);
    return unusable('RESULTS_INVALID', `无法读取 ${RESULTS_FILE}：${error.message}`);
  }
  if (!stat.isFile()) return unusable('RESULTS_INVALID', `${RESULTS_FILE} 不是普通文件（目录或符号链接不被接受）`);
  if (stat.size > MAX_RESULTS_BYTES) return unusable('RESULTS_INVALID', `${RESULTS_FILE} 超过 ${MAX_RESULTS_BYTES} 字节上限`);

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return unusable('RESULTS_INVALID', `${RESULTS_FILE} 不是合法的 JSON：${error.message}`);
  }
  const problems = validateResults(parsed);
  if (problems.length > 0) {
    const more = problems.length > MAX_REPORTED_PROBLEMS ? `（另有 ${problems.length - MAX_REPORTED_PROBLEMS} 项）` : '';
    return unusable('RESULTS_INVALID', `${RESULTS_FILE} 结构无效：${problems.slice(0, MAX_REPORTED_PROBLEMS).join('；')}${more}`);
  }
  return { ok: true, results: parsed, file };
}

module.exports = {
  CASE_STATUSES,
  MAX_REPORT_BYTES,
  RESULTS_DIR_NAME,
  RESULTS_FILE,
  SCHEMA_VERSION,
  SUITE_STATUSES,
  aggregateResults,
  buildResults,
  evaluateSuiteOutcome,
  extractCaseLabels,
  judgeAc,
  parseJunitReport,
  readResults,
  reportCopyPath,
  resultsDirectory,
  validateResults,
  writeResults,
};

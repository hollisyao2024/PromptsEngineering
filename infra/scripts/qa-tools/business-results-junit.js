'use strict';

// 业务测试结果模型之 JUnit XML 解析：只读取 testcase 结果所需的 XML 子集。纯函数：不访问网络、
// 不执行或展开报告内容、不依赖时钟与随机数，同样的输入逐字节产生同样的输出。

const { TextDecoder } = require('node:util');

const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const MAX_ELEMENT_DEPTH = 128;

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

module.exports = {
  MAX_REPORT_BYTES,
  parseJunitReport,
  toBytes,
};

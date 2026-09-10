#!/usr/bin/env node
/**
 * agent-state-utils.js
 * 共享工具：读写 docs/AGENT_STATE.md 的 IN_PROGRESS 区
 * 被 tdd-push.js、generate-qa.js、qa-verify.js、qa-merge.js 引用。
 * 多任务运行态请使用容器层 ../tmp/worktree-sessions/，不要扩展本文件为并行调度源。
 */
const fs = require('fs');

const STATE_FIELDS = ['branch', 'pr', 'step', 'started_at'];

// State documents use plain headings and fields. Keep source offsets/newlines
// while excluding Markdown examples; this is not a general Markdown renderer.
function scanStateDocument(content) {
  const lines = [];
  let fence = null;
  let comment = false;
  let frontMatter = false;
  for (const match of content.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/gu)) {
    if (!match[0]) break;
    const text = match[1];
    const line = { text, newline: match[2], start: match.index, end: match.index + text.length, visible: null };
    lines.push(line);
    if (match.index === 0 && /^\uFEFF?---[ \t]*$/u.test(text)) {
      frontMatter = true;
      continue;
    }
    if (frontMatter) {
      if (/^(?:---|\.\.\.)[ \t]*$/u.test(text)) frontMatter = false;
      continue;
    }
    if (fence) {
      const closing = text.match(/^ {0,3}(`+|~+)[ \t]*$/u);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) fence = null;
      continue;
    }
    // Mask comments instead of removing bytes, so matches retain source offsets.
    let visible = '';
    let offset = 0;
    while (offset < text.length) {
      if (comment) {
        const close = text.indexOf('-->', offset);
        const end = close < 0 ? text.length : close + 3;
        visible += ' '.repeat(end - offset);
        offset = end;
        comment = close < 0;
      } else {
        const open = text.indexOf('<!--', offset);
        if (open < 0) { visible += text.slice(offset); break; }
        visible += text.slice(offset, open);
        offset = open;
        comment = true;
      }
    }
    const opening = visible.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (opening && (opening[1][0] === '~' || !opening[2].includes('`'))) {
      fence = opening[1];
      continue;
    }
    if (!/^(?: {4}|\t)/u.test(text)) line.visible = visible;
  }
  return { lines, unterminated: fence ? 'code fence' : comment ? 'comment' : frontMatter ? 'front matter' : null };
}

function inProgressFields(content) {
  const { lines } = scanStateDocument(content);
  const headings = lines.map((line, index) => {
    const match = line.visible?.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*?)(?:[ \t]+#+[ \t]*)?$/u);
    return match ? { index, level: match[1].length, title: match[2].trim() } : null;
  }).filter(Boolean);
  const sections = headings.filter((heading) => heading.level === 2 && heading.title === 'IN_PROGRESS');
  if (sections.length > 1) throw new Error('Multiple IN_PROGRESS sections; resolve the ambiguous state document first.');
  if (!sections.length) return null;
  const start = sections[0].index;
  const end = headings.find((heading) => heading.index > start)?.index ?? lines.length;
  return lines.slice(start + 1, end).flatMap((line) => {
    const match = line.visible?.match(/^( {0,3}(branch|pr|step|started_at):)[ \t]*(.*)$/u);
    return match ? [{ ...line, prefix: match[1], key: match[2], value: match[3].trim() }] : [];
  });
}

function updateInProgressContent(content, values) {
  const fields = inProgressFields(content);
  if (!fields) return content;
  const updates = Object.fromEntries(STATE_FIELDS.filter((key) => Object.hasOwn(values, key)).map((key) => {
    const value = String(values[key]);
    if (/[\r\n]/u.test(value)) throw new Error(`IN_PROGRESS ${key} must be a single line.`);
    return [key, value];
  }));
  let updated = content;
  for (const field of fields.reverse()) {
    if (!Object.hasOwn(updates, field.key) || field.value === updates[field.key]) continue;
    const commentStart = field.text.indexOf('<!--', field.prefix.length);
    const commentSuffix = commentStart < 0 ? '' : ` ${field.text.slice(commentStart)}`;
    const replacement = `${field.prefix} ${updates[field.key]}${commentSuffix}`;
    updated = updated.slice(0, field.start) + replacement + updated.slice(field.end);
  }
  return updated;
}

/**
 * 解析 IN_PROGRESS 区的字段，返回 { branch, pr, step, started_at }
 * 若区块不存在，返回 null
 */
function parseInProgress(content) {
  const fields = inProgressFields(content);
  if (!fields) return null;
  return Object.fromEntries(STATE_FIELDS.map((key) => [key, fields.find((field) => field.key === key)?.value || '']));
}

/**
 * 将 IN_PROGRESS 区的指定字段写入文件
 * fields: Partial<{ branch, pr, step, started_at }>
 * 区块不存在时静默跳过（不创建）
 */
function writeInProgressFields(agentStatePath, fields) {
  if (!fs.existsSync(agentStatePath)) return;
  const content = fs.readFileSync(agentStatePath, 'utf8');
  const updated = updateInProgressContent(content, fields);
  if (updated !== content) fs.writeFileSync(agentStatePath, updated, 'utf8');
}

/**
 * 清除 IN_PROGRESS 区所有字段值（纯字符串操作，保留 key 行）
 */
function clearInProgressContent(content) {
  return updateInProgressContent(content, Object.fromEntries(STATE_FIELDS.map((key) => [key, ''])));
}

/**
 * 清除 IN_PROGRESS 区所有字段值（文件级操作，保留 key 行）
 */
function clearInProgress(agentStatePath) {
  if (!fs.existsSync(agentStatePath)) return;
  const content = fs.readFileSync(agentStatePath, 'utf8');
  const updated = clearInProgressContent(content);
  if (updated !== content) fs.writeFileSync(agentStatePath, updated, 'utf8');
}

/**
 * 格式化当前时间为 YYYY-MM-DD HH:MM
 */
function nowDatetime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

module.exports = { parseInProgress, writeInProgressFields, clearInProgress, clearInProgressContent, nowDatetime, scanStateDocument };

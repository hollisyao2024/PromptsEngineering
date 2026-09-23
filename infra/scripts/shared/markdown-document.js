'use strict';

// Read-only Markdown scanning for structured tool inputs. Runtime state is
// stored in task/worktree sessions and never written into repository documents.
function scanMarkdownDocument(content) {
  const lines = [];
  let fence = null;
  let comment = false;
  let frontMatter = false;
  for (const match of String(content || '').matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/gu)) {
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
        if (open < 0) {
          visible += text.slice(offset);
          break;
        }
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

module.exports = { scanMarkdownDocument };

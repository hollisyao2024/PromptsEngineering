'use strict';

// Shared readers for the template-surface contract tests: repository paths are
// resolved from the template root so the files work in the source and in projects.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// 契约断言以 LF 书写；core.autocrlf=true 的检出（Windows 常见）把文件换成 CRLF，读入时统一回 LF。
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/gu, '\n');
}

function lineCount(relativePath) {
  return read(relativePath).split(/\r?\n/u).length;
}

function headingBody(text, heading) {
  const lines = text.split(/\r?\n/u);
  const isHeading = (line) => /^#{2,3} /u.test(line);
  const levelOf = (line) => /^#+/u.exec(line)[0].length;
  const start = lines.findIndex((line) => isHeading(line) && line.replace(/^#+ /u, '') === heading);
  assert.notEqual(start, -1, `heading ${heading} exists`);
  const stop = lines.findIndex((line, index) => index > start && isHeading(line) && levelOf(line) <= levelOf(lines[start]));
  return lines.slice(start + 1, stop === -1 ? lines.length : stop).join('\n');
}

function conventionsSection(heading) {
  return headingBody(read('docs/CONVENTIONS.md'), heading);
}

module.exports = {
  ROOT,
  conventionsSection,
  headingBody,
  lineCount,
  read,
};

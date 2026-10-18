#!/usr/bin/env node
'use strict';

// 记录类文档长度门禁（tdd.docSize，默认关闭）。
// 只检查相对配置主干的本次改动，历史内容不追溯：
// 1. CHANGELOG 新增行、部署月度台账 LOG-YYYY-MM.md 新增行的字符上限；
// 2. 部署目录 README.md 改动后的整体字节上限；
// 3. 新建独立部署记录 DEPLOY-*.md 的行数与字节上限。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadConfig, resolveRepoRoot } = require('../shared/config');

const DEFAULTS = {
  changelogFiles: ['CHANGELOG.md', 'docs/adr/CHANGELOG.md'],
  changelogMaxLineChars: 120,
  deploymentsDir: 'docs/data/deployments',
  ledgerMaxLineChars: 240,
  readmeMaxBytes: 8 * 1024,
  recordMaxLines: 60,
  recordMaxBytes: 6 * 1024,
};
const LIMIT_KEYS = ['changelogMaxLineChars', 'ledgerMaxLineChars', 'readmeMaxBytes', 'recordMaxLines', 'recordMaxBytes'];

function isSafeRepoRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  return normalized !== '..' && !normalized.startsWith('../') && normalized !== '.';
}

function toPosix(value) {
  return path.posix.normalize(value.replace(/\\/g, '/')).replace(/\/$/, '');
}

function resolveDocSizeConfig(config = {}) {
  const raw = config.tdd?.docSize;
  if (!raw || raw.enabled !== true) return null;
  const resolved = { ...DEFAULTS, ...raw };
  for (const key of LIMIT_KEYS) {
    if (!Number.isInteger(resolved[key]) || resolved[key] <= 0) {
      throw new Error(`invalid tdd.docSize.${key}: expected a positive integer`);
    }
  }
  if (!Array.isArray(resolved.changelogFiles) || !resolved.changelogFiles.every(isSafeRepoRelative)) {
    throw new Error('invalid tdd.docSize.changelogFiles: expected repo-relative paths');
  }
  if (!isSafeRepoRelative(resolved.deploymentsDir)) {
    throw new Error('invalid tdd.docSize.deploymentsDir: expected a repo-relative path');
  }
  return {
    ...resolved,
    changelogFiles: resolved.changelogFiles.map(toPosix),
    deploymentsDir: toPosix(resolved.deploymentsDir),
  };
}

function buildRules(docSize) {
  const dir = docSize.deploymentsDir;
  const inDir = (p, pattern) => p.startsWith(`${dir}/`) && pattern.test(p.slice(dir.length + 1));
  return [
    { kind: 'changelog', match: (p) => docSize.changelogFiles.includes(p), maxLineChars: docSize.changelogMaxLineChars },
    { kind: 'ledger', match: (p) => inDir(p, /^LOG-\d{4}-\d{2}\.md$/), maxLineChars: docSize.ledgerMaxLineChars },
    { kind: 'readme', match: (p) => p === `${dir}/README.md`, maxBytes: docSize.readmeMaxBytes },
    {
      kind: 'record',
      match: (p) => inDir(p, /^DEPLOY-[^/]+\.md$/),
      newOnly: true,
      maxLines: docSize.recordMaxLines,
      maxBytes: docSize.recordMaxBytes,
    },
  ];
}

function countLines(content) {
  if (!content) return 0;
  const lines = content.split('\n');
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

function checkChanges(changes, docSize) {
  const rules = buildRules(docSize);
  const violations = [];
  for (const change of changes) {
    const rule = rules.find((candidate) => candidate.match(change.path));
    if (!rule || (rule.newOnly && !change.isNew)) continue;
    if (rule.maxLineChars) {
      for (const line of change.addedLines || []) {
        const chars = [...line].length;
        if (chars > rule.maxLineChars) {
          violations.push(`${change.path}|line-chars|${chars}>${rule.maxLineChars}|${[...line].slice(0, 40).join('')}`);
        }
      }
    }
    if (typeof change.content !== 'string') continue;
    const bytes = Buffer.byteLength(change.content, 'utf8');
    if (rule.maxBytes && bytes > rule.maxBytes) {
      violations.push(`${change.path}|bytes|${bytes}>${rule.maxBytes}`);
    }
    const lines = countLines(change.content);
    if (rule.maxLines && lines > rule.maxLines) {
      violations.push(`${change.path}|lines|${lines}>${rule.maxLines}`);
    }
  }
  return violations;
}

function parseAddedLines(diff) {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

function defaultRunGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function resolveBase(cwd, baseBranch, runGit) {
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    try {
      return runGit(['merge-base', 'HEAD', ref], cwd).trim();
    } catch {
      // 尝试下一个候选
    }
  }
  throw new Error(`cannot resolve merge-base with origin/${baseBranch} or ${baseBranch}`);
}

function collectChanges({ cwd, baseBranch, docSize, runGit = defaultRunGit }) {
  const base = resolveBase(cwd, baseBranch, runGit);
  const pathspecs = [...docSize.changelogFiles, `${docSize.deploymentsDir}/`];
  const changes = new Map();
  const nameStatus = runGit(['diff', '--name-status', '--no-renames', base, '--', ...pathspecs], cwd);
  for (const row of nameStatus.split('\n').filter(Boolean)) {
    const [status, file] = row.split('\t');
    if (status === 'D') continue;
    changes.set(file, { path: file, isNew: status === 'A', addedLines: [] });
  }
  const untracked = runGit(['ls-files', '--others', '--exclude-standard', '--', ...pathspecs], cwd);
  for (const file of untracked.split('\n').filter(Boolean)) {
    changes.set(file, { path: file, isNew: true, addedLines: [] });
  }
  for (const change of changes.values()) {
    change.content = fs.readFileSync(path.join(cwd, change.path), 'utf8');
    change.addedLines = change.isNew
      ? change.content.split('\n')
      : parseAddedLines(runGit(['diff', '--unified=0', '--no-color', base, '--', change.path], cwd));
  }
  return [...changes.values()];
}

function main() {
  const repoRoot = resolveRepoRoot({ scriptDir: __dirname });
  const config = loadConfig({ repoRoot });
  let docSize;
  try {
    docSize = resolveDocSizeConfig(config);
  } catch (error) {
    console.error(`STATUS=BLOCKED\nSUMMARY=${error.message}\nNEXT_ACTION=修正 agent.config.json 的 tdd.docSize 后重跑`);
    process.exit(1);
  }
  if (!docSize) {
    console.log('STATUS=SKIPPED\nSUMMARY=tdd.docSize.enabled 未开启');
    return;
  }
  let changes;
  try {
    changes = collectChanges({ cwd: repoRoot, baseBranch: config.baseBranch || 'main', docSize });
  } catch (error) {
    console.error(`STATUS=BLOCKED\nSUMMARY=${error.message}\nNEXT_ACTION=确认配置主干引用存在后重跑`);
    process.exit(1);
  }
  const violations = checkChanges(changes, docSize);
  if (violations.length) {
    console.error('STATUS=BLOCKED');
    for (const violation of violations) console.error(`DOC_SIZE_VIOLATION=${violation}`);
    console.error('NEXT_ACTION=改为一行事实：常规部署只追加月度台账，细节留在 PR、git 历史或容器 tmp 证据');
    process.exit(1);
  }
  console.log(`STATUS=OK\nSUMMARY=记录类文档长度检查通过（${changes.length} 个改动文件）`);
}

if (require.main === module) main();

module.exports = {
  DEFAULTS,
  checkChanges,
  collectChanges,
  parseAddedLines,
  resolveDocSizeConfig,
};

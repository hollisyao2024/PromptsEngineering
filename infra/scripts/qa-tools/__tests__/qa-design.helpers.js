'use strict';

// qa design 测试夹具：在临时目录里拼出 PRD（原子 AC 表 + 不变量表）与 TEST-DESIGN.md，
// 需要提交历史的用例再把同一目录初始化为 git 仓库并逐次提交。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { resolveDesignConfig } = require('../qa-design');

const EXAMPLE_CONFIG = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'templates', 'agent', 'config.example.json'),
  'utf8',
));
const DEFAULT_DESIGN = EXAMPLE_CONFIG.qa.design;
const DEFAULT_INTEGRITY = EXAMPLE_CONFIG.qa.integrity;
const DIMENSIONS = Object.freeze(['auth', 'state', 'boundary', 'concurrency', 'dependency']);
const SHA = 'a'.repeat(64);

function design(overrides = {}) {
  return resolveDesignConfig({ qa: { design: { ...DEFAULT_DESIGN, ...overrides }, integrity: DEFAULT_INTEGRITY } });
}

function table(header, rows) {
  const lines = [`| ${header.join(' | ')} |`, `|${header.map(() => '----').join('|')}|`];
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

// acs: [id, priority, tc]；invs: [id, priority]。
function prdDoc({ acs = [], invs = [] } = {}) {
  const acRows = acs.map(([id, priority, tc = '-']) => [id, `US-${id.slice(3, -3)}`, priority, 'auto', 'web', 'g', 'w', 't', tc]);
  const parts = ['# PRD', '', table(['AC ID', 'Story', '优先级', '验证', '端', 'Given', 'When', 'Then', 'TC'], acRows)];
  if (invs.length > 0) {
    parts.push('', '## 不变量与禁止行为', '', table(
      ['INV ID', '类型', '陈述', '适用 Story', '优先级'],
      invs.map(([id, priority]) => [id, 'invariant', '恒成立的陈述', '*', priority]),
    ));
  }
  return `${parts.join('\n')}\n`;
}

// rules: [id, 类型, 陈述, 出处, 优先级, 验证方式, TC]；advs: [id, 规则, 维度, 场景, 预期, TC]；
// bugs: [id, 现象, 关联规则, 来源, TC, 修复提交]；changes: [日期, 行 ID, 变更, 原因与新出处, 评审人]。
function designDoc({ rules = [], advs = [], bugs = [], changes = [], header = {} } = {}) {
  const fields = {
    设计材料包: `sha256=${SHA}`,
    设计隔离: 'subagent',
    ...header,
  };
  const headerLines = Object.entries(fields)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `**${key}**：${value}`);
  return [
    '# user — 测试设计',
    '',
    ...headerLines,
    '',
    '## 3. 规则表',
    '',
    table(['ID', '类型', '陈述', '出处', '优先级', '验证方式', 'TC'], rules),
    '',
    '## 4. 反例目录',
    '',
    table(['ID', '规则', '维度', '场景', '预期', 'TC'], advs),
    '',
    '## 5. 缺陷复现',
    '',
    table(['ID', '现象', '关联规则', '来源', 'TC', '修复提交'], bugs),
    '',
    '## 6. 变更记录',
    '',
    table(['日期', '行 ID', '变更', '原因与新出处', '评审人'], changes),
    '',
  ].join('\n');
}

// 一条 P0 规则（出处为 P0 AC 与 P0 INV），五个必需维度各有一条反例；TC 编号从 TC-USER-010 起。
function compliantDesign(extra = {}) {
  const advs = DIMENSIONS.map((dimension, index) => (
    [`ADV-USER-00${index + 1}`, 'RUL-USER-001', dimension, `${dimension} 场景`, '返回 2002', `TC-USER-01${index + 1}`]
  ));
  return {
    rules: [['RUL-USER-001', 'rule', '第 5 次失败锁定', 'AC-USER-001-01, INV-USER-001', 'P0', 'example', 'TC-USER-010']],
    advs,
    bugs: [],
    changes: [],
    ...extra,
  };
}

const COMPLIANT_PRD = { acs: [['AC-USER-001-01', 'P0', 'TC-USER-001'], ['AC-USER-001-02', 'P1']], invs: [['INV-USER-001', 'P0']] };

function writeFiles(root, files) {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    if (content === null) {
      fs.rmSync(target, { force: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function makeProject(t, { prd = COMPLIANT_PRD, design: doc = compliantDesign(), files = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-design-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initial = { 'docs/data/dictionary.md': '# 数据字典\n\n## 邮箱\n' };
  if (prd) initial['docs/prd-modules/user/PRD.md'] = prdDoc(prd);
  if (doc) initial['docs/qa-modules/user/TEST-DESIGN.md'] = designDoc(doc);
  writeFiles(root, { ...initial, ...files });
  return root;
}

// 默认把文档里出现的全部 TC 视为已通过；overrides 可改写个别 TC 的状态（null 表示结果中没有）。
function passedResults(ids, overrides = {}) {
  const tcs = {};
  for (const id of ids) tcs[id] = { status: 'passed' };
  for (const [id, status] of Object.entries(overrides)) {
    if (status === null) delete tcs[id];
    else tcs[id] = { status };
  }
  return { available: true, tcs };
}

function allTcs(root) {
  const text = fs.readFileSync(path.join(root, 'docs/qa-modules/user/TEST-DESIGN.md'), 'utf8');
  return [...new Set(text.match(/TC-[A-Z]+-\d{3}/gu) || [])];
}

function git(cwd, args) {
  const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

// 历史夹具：commits 依次为 { files, message }，第一项为 base。返回 base 与 HEAD 的 SHA。
function makeHistory(t, commits) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-design-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  const shas = [];
  for (const [index, commit] of commits.entries()) {
    writeFiles(root, commit.files);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '--allow-empty', '-m', commit.message || `commit ${index}`]);
    shas.push(git(root, ['rev-parse', 'HEAD']));
  }
  return { root, baseSha: shas[0], headSha: shas[shas.length - 1], shas };
}

module.exports = {
  COMPLIANT_PRD,
  DEFAULT_DESIGN,
  DEFAULT_INTEGRITY,
  DIMENSIONS,
  SHA,
  allTcs,
  compliantDesign,
  design,
  designDoc,
  git,
  makeHistory,
  makeProject,
  passedResults,
  prdDoc,
  writeFiles,
};

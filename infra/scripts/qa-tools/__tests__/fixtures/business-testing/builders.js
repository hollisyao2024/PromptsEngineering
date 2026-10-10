'use strict';

// Fixture builders for the business-test-automation tests. Everything here is
// plain data -> text, so each test states its own scenario in a few lines.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const AC_COLUMNS = ['AC ID', 'Story', '优先级', '验证', '端', 'Given', 'When', 'Then', 'TC'];

function mdRow(cells) {
  return `| ${cells.join(' | ')} |`;
}

function mdTable(header, rows) {
  return [mdRow(header), mdRow(header.map(() => '---')), ...rows.map(mdRow)].join('\n');
}

function acRowCells(overrides = {}) {
  const row = {
    id: 'AC-SHOP-001-01',
    story: 'US-SHOP-001',
    priority: 'P0',
    verification: 'auto',
    platform: 'web',
    given: '购物车内有商品',
    when: '点击结算',
    then: '进入支付页',
    tc: 'TC-SHOP-001',
    ...overrides,
  };
  return [row.id, row.story, row.priority, row.verification, row.platform, row.given, row.when, row.then, row.tc];
}

const SHOP_ACS = [
  { id: 'AC-SHOP-001-01', story: 'US-SHOP-001', priority: 'P0', verification: 'auto', platform: 'web', tc: 'TC-SHOP-001' },
  {
    id: 'AC-SHOP-001-02', story: 'US-SHOP-001', priority: 'P0', verification: 'auto', platform: 'web,ios',
    given: '位于支付页', when: '输入有效卡号并确认', then: '显示支付成功', tc: 'TC-SHOP-002',
  },
  {
    id: 'AC-SHOP-001-03', story: 'US-SHOP-001', priority: 'P1', verification: 'auto', platform: '-',
    given: '位于支付页', when: '银行拒绝扣款', then: '提示支付失败并可重试', tc: 'TC-SHOP-003',
  },
  {
    id: 'AC-SHOP-002-01', story: 'US-SHOP-002', priority: 'P0', verification: 'manual', platform: '-',
    given: '用户打开隐私条款', when: '阅读条款页', then: '文案经法务确认', tc: '-',
  },
];

function prdDocument(rows = SHOP_ACS, { intro = '# 购物模块 PRD\n\n### 原子 AC 清单\n', header = AC_COLUMNS } = {}) {
  const cells = rows.map((row) => (Array.isArray(row) ? row : acRowCells(row)));
  return `${intro}\n${mdTable(header, cells)}\n`;
}

const SHOP_PATHS = {
  criterion: 'all-transitions',
  screens: [
    ['SCR-SHOP-001', '购物车', 'web', '商品列表'],
    ['SCR-SHOP-002', '支付页', 'web,ios', '填写卡号'],
  ],
  states: [
    ['STA-SHOP-001', 'SCR-SHOP-001', '购物车有商品', ''],
    ['STA-SHOP-002', 'SCR-SHOP-002', '待支付', ''],
    ['STA-SHOP-003', 'SCR-SHOP-002', '支付成功', ''],
    ['STA-SHOP-004', 'SCR-SHOP-002', '支付失败', ''],
  ],
  transitions: [
    ['TRN-SHOP-001', 'STA-SHOP-001', '点击结算', '购物车非空', 'STA-SHOP-002', 'AC-SHOP-001-01'],
    ['TRN-SHOP-002', 'STA-SHOP-002', '提交有效卡号', '-', 'STA-SHOP-003', 'AC-SHOP-001-02'],
    ['TRN-SHOP-003', 'STA-SHOP-002', '提交被拒绝的卡号', '-', 'STA-SHOP-004', 'AC-SHOP-001-03'],
  ],
  paths: [
    ['PTH-SHOP-001', 'TRN-SHOP-001 → TRN-SHOP-002', 'TC-SHOP-001, TC-SHOP-002', '支付成功主路径'],
    ['PTH-SHOP-002', 'TRN-SHOP-001 → TRN-SHOP-003', 'TC-SHOP-003', '支付失败路径'],
  ],
};

const PATHS_HEADERS = {
  screens: ['ID', '名称', '端', '说明'],
  states: ['ID', '界面', '名称', '说明'],
  transitions: ['ID', '起始状态', '操作', '守卫', '目标状态', '关联 AC'],
  paths: ['ID', '转移序列', '关联 TC', '说明'],
};

const PATHS_HEADINGS = { screens: '界面', states: '状态', transitions: '转移', paths: '路径' };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function shopPaths(mutate) {
  const model = clone(SHOP_PATHS);
  if (mutate) mutate(model);
  return model;
}

function pathsDocument(model = SHOP_PATHS, { omit = [], extra = '' } = {}) {
  const parts = ['# 购物模块路径模型', ''];
  if (model.criterion !== undefined) parts.push(`覆盖准则：${model.criterion}`, '');
  for (const name of ['screens', 'states', 'transitions', 'paths']) {
    if (omit.includes(name)) continue;
    parts.push(`## ${PATHS_HEADINGS[name]}`, '', mdTable(PATHS_HEADERS[name], model[name] || []), '');
  }
  if (extra) parts.push(extra);
  return `${parts.join('\n')}\n`;
}

function lineOf(content, needle, occurrence = 1) {
  const lines = String(content).split('\n');
  let seen = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].includes(needle)) {
      seen += 1;
      if (seen === occurrence) return index + 1;
    }
  }
  throw new Error(`fixture line not found: ${needle}`);
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function junitReport(cases, { suite = 'suite' } = {}) {
  const body = cases.map((item) => {
    const attrs = `name="${xmlEscape(item.name)}" classname="${xmlEscape(item.classname || suite)}" time="0.01"`;
    switch (item.status) {
      case 'failed': return `    <testcase ${attrs}><failure message="boom">stack</failure></testcase>`;
      case 'error': return `    <testcase ${attrs}><error message="crash">trace</error></testcase>`;
      case 'skipped': return `    <testcase ${attrs}><skipped/></testcase>`;
      default: return `    <testcase ${attrs}/>`;
    }
  }).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites>',
    `  <testsuite name="${xmlEscape(suite)}" tests="${cases.length}">`,
    body,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

function runGit(cwd, args) {
  const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function writeFiles(directory, files) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(directory, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function commitAll(repo, message = 'fixture') {
  runGit(repo, ['add', '-A']);
  runGit(repo, ['commit', '--quiet', '--allow-empty', '-m', message]);
  return runGit(repo, ['rev-parse', 'HEAD']).trim();
}

// <root>/repo is the project, <root>/tmp is the sibling container tmp directory
// that resolveContainerPath(config, repo, 'tmp') points at by default.
function createProject(files = {}, { git = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-biz-')));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  writeFiles(repo, files);
  if (git) {
    runGit(repo, ['init', '--quiet', '--initial-branch=main']);
    runGit(repo, ['config', 'user.name', 'Fixture']);
    runGit(repo, ['config', 'user.email', 'fixture@example.invalid']);
    commitAll(repo, 'fixture seed');
  }
  return {
    root,
    repo,
    tmp: path.join(root, 'tmp'),
    write(more) { writeFiles(repo, more); },
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

function shopProject(overrides = {}, options = {}) {
  return createProject({
    'docs/prd-modules/shop/PRD.md': prdDocument(),
    'docs/qa-modules/shop/PATHS.md': pathsDocument(),
    ...overrides,
  }, options);
}

// 以真实 CLI 子进程运行脚本。上限放宽到 5 分钟，以免并行全量回归时冷启动变慢被 spawnSync 误杀；
// 若仍被终止或无法启动，把 signal/error 追加到 stderr，断言消息（stdout + stderr）即可直接看出原因。
const CLI_TIMEOUT_MS = 300000;

// env 是完整子进程环境（默认继承当前进程），调用方可借此删除变量而不会被重新合并回来。
function runNodeScript(script, { cwd, args = [], env = process.env } = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...env, NO_COLOR: '1' },
    timeout: CLI_TIMEOUT_MS,
  });
  if (result.signal || result.error) {
    const reason = result.error ? `${result.error.code || ''} ${result.error.message}`.trim() : '-';
    result.stderr = `${result.stderr || ''}\n[runNodeScript] signal=${result.signal || '-'} error=${reason}`;
  }
  return result;
}

module.exports = {
  AC_COLUMNS,
  PATHS_HEADERS,
  SHOP_ACS,
  SHOP_PATHS,
  acRowCells,
  commitAll,
  createProject,
  junitReport,
  lineOf,
  mdRow,
  mdTable,
  pathsDocument,
  prdDocument,
  runGit,
  runNodeScript,
  shopPaths,
  shopProject,
  writeFiles,
  xmlEscape,
};

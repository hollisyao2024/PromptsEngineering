'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { analyzeSpec, formatPathsReport, formatViolation } = require('../qa-paths');
const {
  createProject,
  lineOf,
  pathsDocument,
  prdDocument,
  runGit,
  shopPaths,
  shopProject,
} = require('./fixtures/business-testing/builders');

const SCRIPT = path.join(__dirname, '..', 'qa-paths.js');
const PRD_FILE = 'docs/prd-modules/shop/PRD.md';
const PATHS_FILE = 'docs/qa-modules/shop/PATHS.md';

const codes = (analysis) => analysis.violations.map((violation) => violation.code);

function analyzeShop(mutate, { prd } = {}) {
  const content = pathsDocument(shopPaths(mutate));
  const files = { [PATHS_FILE]: content };
  if (prd) files[PRD_FILE] = prd;
  const project = shopProject(files);
  try {
    return { analysis: analyzeSpec({ repoRoot: project.repo }), content };
  } finally {
    project.cleanup();
  }
}

function runCli(project, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: project.repo,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

// ---------------------------------------------------------------- 结构

test('合法路径模型解析出界面、状态、转移与路径', () => {
  const { analysis } = analyzeShop();

  assert.equal(analysis.status, 'OK');
  assert.deepEqual(analysis.violations, []);
  const [doc] = analysis.spec.pathsDocs;
  assert.deepEqual(
    [doc.screens.length, doc.states.length, doc.transitions.length, doc.paths.length],
    [2, 4, 3, 2],
  );
  assert.deepEqual(doc.criteria, ['all-transitions']);
});

test('缺少一张表时只报告 PATHS_TABLE_MISSING，不连带引用违规', () => {
  const project = shopProject({ [PATHS_FILE]: pathsDocument(shopPaths(), { omit: ['states'] }) });
  try {
    const analysis = analyzeSpec({ repoRoot: project.repo });

    assert.equal(analysis.status, 'BLOCKED');
    assert.deepEqual(codes(analysis), ['PATHS_TABLE_MISSING']);
  } finally {
    project.cleanup();
  }
});

test('ID 重复被报告并使 STATUS=BLOCKED', () => {
  const { analysis, content } = analyzeShop((model) => { model.transitions[2][0] = 'TRN-SHOP-002'; });

  assert.equal(analysis.status, 'BLOCKED');
  assert.ok(codes(analysis).includes('ID_DUPLICATE'));
  const duplicate = analysis.violations.find((violation) => violation.code === 'ID_DUPLICATE');
  assert.equal(duplicate.file, PATHS_FILE);
  assert.equal(duplicate.line, lineOf(content, 'TRN-SHOP-002', 2));
});

test('没有任何原子 AC 表时 NO_ATOMIC_AC 阻断', () => {
  const project = createProject({ 'docs/prd-modules/shop/PRD.md': '# 旧写法\n\n暂无原子 AC。\n' });
  try {
    const analysis = analyzeSpec({ repoRoot: project.repo });

    assert.equal(analysis.status, 'BLOCKED');
    assert.equal(analysis.noAtomicAc, true);
    assert.deepEqual(codes(analysis), ['NO_ATOMIC_AC']);
  } finally {
    project.cleanup();
  }
});

test('原子 AC 表自身的违规一并出现在 qa paths 结果中', () => {
  const prd = prdDocument([{ priority: 'P9' }]);
  const { analysis } = analyzeShop(undefined, { prd });

  assert.equal(analysis.status, 'BLOCKED');
  assert.ok(codes(analysis).includes('PRIORITY_INVALID'));
});

// ---------------------------------------------------------------- 引用与衔接

// expected 是按“文件、行号”排序后的完整违规代码：根因之外只允许真实的连带违规，
// 引用未定义时不得再冒出 PATH_DISCONNECTED 这类噪声。
const REF_CASES = [
  ['状态引用不存在的界面', (model) => { model.states[0][1] = 'SCR-SHOP-099'; }, 'STA-SHOP-001', 'SCR-SHOP-099', ['REF_UNKNOWN']],
  ['转移起始状态不存在', (model) => { model.transitions[0][1] = 'STA-SHOP-099'; }, 'TRN-SHOP-001', 'STA-SHOP-099', ['REF_UNKNOWN']],
  ['转移目标状态不存在', (model) => { model.transitions[0][4] = 'STA-SHOP-099'; }, 'TRN-SHOP-001', 'STA-SHOP-099', ['REF_UNKNOWN']],
  ['转移关联不存在的 AC', (model) => { model.transitions[0][5] = 'AC-SHOP-099-01'; }, 'TRN-SHOP-001', 'AC-SHOP-099-01', ['AC_UNLINKED', 'REF_UNKNOWN']],
  ['路径引用不存在的转移', (model) => { model.paths[0][1] = 'TRN-SHOP-001 → TRN-SHOP-099'; }, 'PTH-SHOP-001', 'TRN-SHOP-099', ['COVERAGE_GAP', 'REF_UNKNOWN']],
];

for (const [label, mutate, rowNeedle, unknown, expected] of REF_CASES) {
  test(`REF_UNKNOWN ← ${label}`, () => {
    const { analysis, content } = analyzeShop(mutate);

    assert.equal(analysis.status, 'BLOCKED');
    assert.deepEqual(codes(analysis), expected);
    const violation = analysis.violations.find((item) => item.code === 'REF_UNKNOWN');
    assert.equal(violation.file, PATHS_FILE);
    assert.equal(violation.line, lineOf(content, rowNeedle));
    assert.ok(violation.message.includes(unknown));
  });
}

test('违规按文件、行号排序，输出与发现顺序无关', () => {
  const { analysis } = analyzeShop((model) => {
    model.paths.pop();
    model.states[0][1] = 'SCR-SHOP-099';
  });
  const positions = analysis.violations.map((violation) => `${violation.file}:${String(violation.line).padStart(5, '0')}`);

  assert.deepEqual(positions, [...positions].sort());
  assert.deepEqual(codes(analysis), ['REF_UNKNOWN', 'COVERAGE_GAP']);
});

test('多个 PATHS.md 的 AC 引用跨模块查找', () => {
  const cartPrd = prdDocument([{ id: 'AC-CART-001-01', story: 'US-CART-001', tc: 'TC-CART-001' }]);
  const cartPaths = pathsDocument(shopPaths((model) => {
    model.criterion = 'none';
    model.transitions = [['TRN-CART-001', 'STA-CART-001', '合并购物车', '-', 'STA-CART-002', 'AC-SHOP-001-01, AC-CART-001-01']];
    model.screens = [['SCR-CART-001', '购物车', 'web', '']];
    model.states = [['STA-CART-001', 'SCR-CART-001', '多份', ''], ['STA-CART-002', 'SCR-CART-001', '合并后', '']];
    model.paths = [['PTH-CART-001', 'TRN-CART-001', 'TC-CART-001', '合并']];
  }));
  const project = shopProject({
    'docs/prd-modules/cart/PRD.md': cartPrd,
    'docs/qa-modules/cart/PATHS.md': cartPaths,
  });
  try {
    const analysis = analyzeSpec({ repoRoot: project.repo });

    assert.equal(analysis.status, 'OK', JSON.stringify(analysis.violations));
    assert.deepEqual(analysis.spec.modules.map((module) => module.domain), ['cart', 'shop']);
  } finally {
    project.cleanup();
  }
});

test('不同 PATHS.md 重复定义同一标识报告 ID_DUPLICATE，指向首次位置', () => {
  // 复制路径模型到新域却没改标识：按域排序后 cart 为首次，shop 中的 11 个标识都是重复。
  const project = shopProject({
    'docs/prd-modules/cart/PRD.md': prdDocument([{ id: 'AC-CART-001-01', story: 'US-CART-001', tc: 'TC-CART-001' }]),
    'docs/qa-modules/cart/PATHS.md': pathsDocument(shopPaths((model) => { model.criterion = 'none'; })),
  });
  try {
    const analysis = analyzeSpec({ repoRoot: project.repo });

    assert.equal(analysis.status, 'BLOCKED');
    assert.deepEqual([...new Set(codes(analysis))], ['ID_DUPLICATE']);
    assert.equal(analysis.violations.length, 11);
    assert.ok(analysis.violations.every((violation) => violation.file === PATHS_FILE));
    assert.match(analysis.violations[0].message, /docs\/qa-modules\/cart\/PATHS\.md:\d+/u);
  } finally {
    project.cleanup();
  }
});

test('PATH_DISCONNECTED 相邻转移首尾状态不衔接', () => {
  const { analysis, content } = analyzeShop((model) => {
    model.paths[0][1] = 'TRN-SHOP-002 → TRN-SHOP-001';
  });

  assert.equal(analysis.status, 'BLOCKED');
  assert.deepEqual(codes(analysis), ['PATH_DISCONNECTED']);
  assert.equal(analysis.violations[0].line, lineOf(content, 'PTH-SHOP-001'));
});

for (const [label, sequence] of [['减号占位', '-'], ['空单元格', '']]) {
  test(`PATH_EMPTY ← ${label}`, () => {
    const { analysis, content } = analyzeShop((model) => {
      model.criterion = 'none';
      model.paths[1][1] = sequence;
    });

    assert.equal(analysis.status, 'BLOCKED');
    assert.deepEqual(codes(analysis), ['PATH_EMPTY']);
    assert.equal(analysis.violations[0].line, lineOf(content, 'PTH-SHOP-002'));
  });
}

test('CLI 在违规时 STATUS=BLOCKED、非零退出并逐项输出 VIOLATION', () => {
  const content = pathsDocument(shopPaths((model) => { model.transitions[1][1] = 'STA-SHOP-099'; }));
  const project = shopProject({ [PATHS_FILE]: content }, { git: true });
  try {
    const result = runCli(project);

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^STATUS=BLOCKED$/mu);
    assert.match(result.stdout, /^SUMMARY=/mu);
    assert.match(result.stdout, /^NEXT_ACTION=/mu);
    assert.match(result.stdout, new RegExp(`^VIOLATION=REF_UNKNOWN\\|${PATHS_FILE.replace(/[./]/gu, '\\$&')}:${lineOf(content, 'TRN-SHOP-002')}\\|`, 'mu'));
  } finally {
    project.cleanup();
  }
});

// ---------------------------------------------------------------- 覆盖准则

test('all-transitions 下未被路径覆盖的转移报告 COVERAGE_GAP', () => {
  const { analysis, content } = analyzeShop((model) => { model.paths.pop(); });

  assert.equal(analysis.status, 'BLOCKED');
  assert.deepEqual(codes(analysis), ['COVERAGE_GAP']);
  assert.equal(analysis.violations[0].line, lineOf(content, 'TRN-SHOP-003'));
  assert.ok(analysis.violations[0].message.includes('TRN-SHOP-003'));
});

test('all-states 下未被覆盖的状态报告 COVERAGE_GAP', () => {
  const { analysis, content } = analyzeShop((model) => {
    model.criterion = 'all-states';
    model.paths.shift();
  });

  assert.equal(analysis.status, 'BLOCKED');
  assert.deepEqual(codes(analysis), ['COVERAGE_GAP']);
  assert.equal(analysis.violations[0].line, lineOf(content, 'STA-SHOP-003'));
});

test('两种准则组合时分别报告缺口', () => {
  const { analysis } = analyzeShop((model) => {
    model.criterion = 'all-transitions, all-states';
    model.paths.shift();
  });

  assert.deepEqual(codes(analysis), ['COVERAGE_GAP', 'COVERAGE_GAP']);
});

test('覆盖准则为 none 时不检查覆盖缺口与 AC 关联', () => {
  const { analysis } = analyzeShop((model) => {
    model.criterion = 'none';
    model.paths = [];
    model.transitions.forEach((row) => { row[5] = '-'; });
  });

  assert.equal(analysis.status, 'OK');
  assert.deepEqual(analysis.violations, []);
});

test('声明覆盖准则时未被任何转移关联的 P0 自动化 AC 报告 AC_UNLINKED', () => {
  const prd = prdDocument();
  const { analysis } = analyzeShop((model) => { model.transitions[1][5] = '-'; }, { prd });

  assert.equal(analysis.status, 'BLOCKED');
  assert.deepEqual(codes(analysis), ['AC_UNLINKED']);
  assert.equal(analysis.violations[0].file, PRD_FILE);
  assert.equal(analysis.violations[0].line, lineOf(prd, 'AC-SHOP-001-02'));
});

test('P1 与 manual 的 AC 不要求被转移关联', () => {
  const { analysis } = analyzeShop((model) => { model.transitions[2][5] = '-'; });

  assert.equal(analysis.status, 'OK');
  assert.deepEqual(analysis.violations, []);
});

// ---------------------------------------------------------------- 矩阵与输出

const SHOP_MATRIX_LINES = [
  'MODULES=1',
  'AC_TOTAL=4  AC_AUTO=3  AC_MANUAL=1',
  'TRANSITION_TOTAL=3  PATH_TOTAL=2  TC_TOTAL=3',
  'MATRIX_AC=AC-SHOP-001-01|P0|auto|web|TRN-SHOP-001|PTH-SHOP-001,PTH-SHOP-002|TC-SHOP-001',
  'MATRIX_AC=AC-SHOP-001-02|P0|auto|web,ios|TRN-SHOP-002|PTH-SHOP-001|TC-SHOP-002',
  'MATRIX_AC=AC-SHOP-001-03|P1|auto|-|TRN-SHOP-003|PTH-SHOP-002|TC-SHOP-003',
  'MATRIX_AC=AC-SHOP-002-01|P0|manual|-|-|-|-',
  'MATRIX_PATH=PTH-SHOP-001|TRN-SHOP-001,TRN-SHOP-002|TC-SHOP-001,TC-SHOP-002',
  'MATRIX_PATH=PTH-SHOP-002|TRN-SHOP-001,TRN-SHOP-003|TC-SHOP-003',
];

test('合法模型输出 STATUS=OK、计数与覆盖矩阵', () => {
  const { analysis } = analyzeShop();
  const lines = formatPathsReport(analysis);

  assert.equal(lines[0], 'STATUS=OK');
  assert.match(lines[1], /^SUMMARY=\S/u);
  assert.match(lines[2], /^NEXT_ACTION=\S/u);
  assert.deepEqual(lines.slice(3), SHOP_MATRIX_LINES);
});

test('违规时仍输出计数与矩阵，并在其后逐行输出 VIOLATION', () => {
  const { analysis } = analyzeShop((model) => { model.paths.pop(); });
  const lines = formatPathsReport(analysis);

  assert.equal(lines[0], 'STATUS=BLOCKED');
  assert.ok(lines.some((line) => line.startsWith('MATRIX_AC=')));
  const violationLines = lines.filter((line) => line.startsWith('VIOLATION='));
  assert.equal(violationLines.length, 1);
  assert.match(violationLines[0], /^VIOLATION=COVERAGE_GAP\|docs\/qa-modules\/shop\/PATHS\.md:\d+\|/u);
  assert.equal(lines.indexOf(violationLines[0]), lines.length - 1);
});

test('formatViolation 输出带位置的单行 VIOLATION，无行号时只写文件，消息中的换行被压平', () => {
  assert.equal(
    formatViolation({ code: 'REF_UNKNOWN', file: PATHS_FILE, line: 12, message: '引用了不存在的状态' }),
    `VIOLATION=REF_UNKNOWN|${PATHS_FILE}:12|引用了不存在的状态`,
  );
  assert.equal(
    formatViolation({ code: 'NO_ATOMIC_AC', file: 'docs/prd-modules', line: 0, message: '第一行\n  第二行\r\n第三行' }),
    'VIOLATION=NO_ATOMIC_AC|docs/prd-modules|第一行 第二行 第三行',
  );
  const { analysis } = analyzeShop((model) => { model.paths.pop(); });
  assert.deepEqual(
    formatPathsReport(analysis).filter((line) => line.startsWith('VIOLATION=')),
    analysis.violations.map(formatViolation),
  );
});

test('CLI 合法模型 STATUS=OK、退出码 0 且输出与目录创建顺序无关', () => {
  const first = shopProject({}, { git: true });
  const second = createProject({
    [PATHS_FILE]: pathsDocument(),
    [PRD_FILE]: prdDocument(),
  }, { git: true });
  try {
    const one = runCli(first);
    const two = runCli(second);

    assert.equal(one.status, 0, one.stdout + one.stderr);
    assert.equal(two.status, 0, two.stdout + two.stderr);
    assert.equal(one.stdout, two.stdout);
    assert.match(one.stdout, /^STATUS=OK$/mu);
    for (const line of SHOP_MATRIX_LINES) assert.ok(one.stdout.includes(`${line}\n`), line);
  } finally {
    first.cleanup();
    second.cleanup();
  }
});

test('qa paths 只读，不创建 tmp 等目录也不改动工作区', () => {
  const project = shopProject({}, { git: true });
  try {
    const before = runGit(project.repo, ['status', '--porcelain']);
    const result = runCli(project);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(project.tmp), false);
    assert.deepEqual(fs.readdirSync(project.root), ['repo']);
    assert.equal(runGit(project.repo, ['status', '--porcelain']), before);
  } finally {
    project.cleanup();
  }
});

test('CLI 在没有原子 AC 表的仓库 STATUS=BLOCKED 并给出 NO_ATOMIC_AC', () => {
  const project = createProject({ 'README.md': '# 空项目\n' }, { git: true });
  try {
    const result = runCli(project);

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^STATUS=BLOCKED$/mu);
    assert.match(result.stdout, /^VIOLATION=NO_ATOMIC_AC\|/mu);
  } finally {
    project.cleanup();
  }
});

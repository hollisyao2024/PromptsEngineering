'use strict';

// ac-results.json 与报告副本的构建、校验与读写。
// 全部为纯数据或容器 tmp 下的临时目录测试，不启动任何套件。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { DEFAULT_CONFIG } = require('../../shared/config');
const { worktreeReceiptKey } = require('../qa-verification-state');
const {
  buildResults,
  readResults,
  reportCopyPath,
  resultsDirectory,
  validateResults,
  writeResults,
} = require('../business-results');
const { junitReport, xmlEscape } = require('./fixtures/business-testing/builders');
const { DIGEST, HEAD, kase, sha256, web, withShop, withTempDir } = require('./business-results.helpers');

// ---------------------------------------------------------------------------
// 结果文件
// ---------------------------------------------------------------------------

function sampleSuites() {
  return [
    {
      name: 'web-e2e',
      platform: 'web',
      command: 'pnpm exec playwright test',
      exitCode: 0,
      status: 'ok',
      durationMs: 1234,
      detail: null,
      report: { path: 'test-results/junit.xml', sha256: 'c'.repeat(64), bytes: 321 },
      cases: [kase('TC-SHOP-001 a'), kase('TC-SHOP-002 b', 'failed'), kase('无标识')],
    },
    {
      name: 'ios-e2e',
      platform: 'ios',
      command: 'bash run-ios.sh',
      exitCode: null,
      status: 'timeout',
      durationMs: 900000,
      detail: '运行超过 900 秒被终止',
      report: null,
      cases: null,
    },
  ];
}

function sampleResults(spec, overrides = {}) {
  return buildResults({
    spec,
    headSha: HEAD,
    worktreeClean: true,
    configDigest: DIGEST,
    generatedAt: '2026-10-06T00:00:00.000Z',
    suites: sampleSuites(),
    ...overrides,
  });
}

test('结果含 HEAD、生成时间、配置摘要、套件命令退出码与报告哈希、逐 TC 逐 AC 状态、路径状态与汇总', () => withShop(({ spec }) => {
  const results = sampleResults(spec);
  assert.deepEqual(Object.keys(results), [
    'schema_version', 'generated_at', 'head_sha', 'worktree_clean', 'config_digest',
    'suites', 'tcs', 'acs', 'paths', 'unknown_ids', 'summary',
  ]);
  assert.equal(results.schema_version, 1);
  assert.equal(results.generated_at, '2026-10-06T00:00:00.000Z');
  assert.equal(results.head_sha, HEAD);
  assert.equal(results.worktree_clean, true);
  assert.equal(results.config_digest, DIGEST);
  assert.deepEqual(results.suites, [
    {
      name: 'web-e2e',
      platform: 'web',
      command: 'pnpm exec playwright test',
      exit_code: 0,
      status: 'ok',
      detail: null,
      duration_ms: 1234,
      cases: 3,
      unlabelled: 1,
      report: { path: 'test-results/junit.xml', copy: 'reports/web-e2e.xml', sha256: 'c'.repeat(64), bytes: 321 },
    },
    {
      name: 'ios-e2e',
      platform: 'ios',
      command: 'bash run-ios.sh',
      exit_code: null,
      status: 'timeout',
      detail: '运行超过 900 秒被终止',
      duration_ms: 900000,
      cases: 0,
      unlabelled: 0,
      report: null,
    },
  ]);
  assert.equal(results.tcs['TC-SHOP-001'].status, 'passed');
  assert.equal(results.tcs['TC-SHOP-002'].status, 'failed');
  assert.equal(results.acs['AC-SHOP-001-02'].status, 'failed');
  assert.equal(results.paths['PTH-SHOP-001'].status, 'failed');
  assert.equal(results.summary.suites, 2);
  assert.equal(results.summary.cases.total, 3);
  assert.deepEqual(validateResults(results), []);
}));

test('结果不含仓库绝对路径、环境变量值或命令之外的本机信息', () => withShop(({ project, spec }) => {
  process.env.XIRANG_BIZ_SECRET = 'super-secret-value';
  try {
    const text = JSON.stringify(sampleResults(spec));
    assert.equal(text.includes(project.repo), false);
    assert.equal(text.includes(os.tmpdir()), false);
    assert.equal(text.includes('super-secret-value'), false);
  } finally {
    delete process.env.XIRANG_BIZ_SECRET;
  }
}));

test('缺少必填输入时 buildResults 直接报错而不是写出残缺结果', () => withShop(({ spec }) => {
  assert.throws(() => sampleResults(spec, { headSha: 'not-a-sha' }), /headSha/u);
  assert.throws(() => sampleResults(spec, { worktreeClean: 'yes' }), /worktreeClean/u);
  assert.throws(() => sampleResults(spec, { configDigest: 'sha256:short' }), /configDigest/u);
  assert.throws(() => sampleResults(spec, { generatedAt: '' }), /generatedAt/u);
  assert.throws(() => sampleResults(spec, { suites: [{ ...sampleSuites()[0], status: 'weird' }] }), /status/u);
}));

test('同一 HEAD、配置与报告产生相同的 tcs、acs、paths 与 summary（时间与耗时除外）', () => withShop(({ spec }) => {
  const first = sampleResults(spec);
  const slower = sampleSuites().map((suite) => ({ ...suite, durationMs: suite.durationMs + 999 }));
  const second = sampleResults(spec, { generatedAt: '2030-01-01T00:00:00.000Z', suites: slower });
  assert.notEqual(second.generated_at, first.generated_at);
  for (const key of ['tcs', 'acs', 'paths', 'summary', 'unknown_ids']) {
    assert.equal(JSON.stringify(second[key]), JSON.stringify(first[key]), key);
  }
}));

test('结果目录位于容器 tmp 下并按 worktree 键隔离，键与 QA 回执同源', () => withShop(({ project }) => {
  const directory = resultsDirectory(DEFAULT_CONFIG, project.repo, project.repo);
  assert.equal(directory, path.join(project.tmp, 'qa-business-results', worktreeReceiptKey(project.repo)));
  assert.equal(path.relative(project.repo, directory).startsWith('..'), true);
  assert.equal(fs.existsSync(directory), false, 'resultsDirectory 只解析路径，不创建目录');
  const other = resultsDirectory(DEFAULT_CONFIG, project.repo, path.join(project.root, 'another'));
  assert.notEqual(other, directory);
}));

test('先写报告副本，最后才以 rename 原子写入 ac-results.json', () => withShop(({ spec }) => withTempDir((directory) => {
  const calls = [];
  const original = fs.renameSync;
  fs.renameSync = (from, to) => { calls.push(path.relative(directory, to)); return original(from, to); };
  try {
    const results = sampleResults(spec);
    const written = writeResults({ directory, results, reportCopies: { 'web-e2e': Buffer.from(junitReport([{ name: 'TC-SHOP-001 a' }])) } });
    assert.equal(written, path.join(directory, 'ac-results.json'));
  } finally {
    fs.renameSync = original;
  }
  assert.deepEqual(calls, [path.join('reports', 'web-e2e.xml'), 'ac-results.json']);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['ac-results.json', 'reports']);
  assert.deepEqual(fs.readdirSync(path.join(directory, 'reports')), ['web-e2e.xml']);
})));

test('写结果失败时不留下半截文件，也不覆盖旧结果', () => withShop(({ spec }) => withTempDir((directory) => {
  const previous = sampleResults(spec, { generatedAt: '2026-01-01T00:00:00.000Z' });
  writeResults({ directory, results: previous, reportCopies: {} });
  const original = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to.endsWith('ac-results.json')) throw new Error('disk full');
    return original(from, to);
  };
  try {
    assert.throws(() => writeResults({ directory, results: sampleResults(spec), reportCopies: {} }), /disk full/u);
  } finally {
    fs.renameSync = original;
  }
  assert.equal(readResults(directory).results.generated_at, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(fs.readdirSync(directory).sort(), ['ac-results.json', 'reports']);
})));

test('再次写入覆盖旧结果，并清理已不在结果中的旧报告副本', () => withShop(({ spec }) => withTempDir((directory) => {
  const xml = Buffer.from(junitReport([{ name: 'TC-SHOP-001 a' }]));
  writeResults({ directory, results: sampleResults(spec), reportCopies: { 'web-e2e': xml, 'old-suite': xml } });
  assert.deepEqual(fs.readdirSync(path.join(directory, 'reports')).sort(), ['old-suite.xml', 'web-e2e.xml']);

  writeResults({ directory, results: sampleResults(spec, { generatedAt: '2027-02-02T00:00:00.000Z' }), reportCopies: { 'web-e2e': xml } });
  assert.deepEqual(fs.readdirSync(path.join(directory, 'reports')), ['web-e2e.xml']);
  assert.equal(readResults(directory).results.generated_at, '2027-02-02T00:00:00.000Z');
})));

test('副本或结果文件的位置被换成目录后，再次写入能够自愈', () => withShop(({ spec }) => withTempDir((directory) => {
  const xml = Buffer.from(junitReport([{ name: 'TC-SHOP-001 a' }]));
  writeResults({ directory, results: sampleResults(spec), reportCopies: { 'web-e2e': xml } });
  const copy = path.join(directory, reportCopyPath('web-e2e'));
  const resultsFile = path.join(directory, 'ac-results.json');
  for (const target of [copy, resultsFile]) {
    fs.rmSync(target);
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'left-over.txt'), 'x');
  }
  assert.equal(readResults(directory).ok, false);

  writeResults({ directory, results: sampleResults(spec, { generatedAt: '2027-03-03T00:00:00.000Z' }), reportCopies: { 'web-e2e': xml } });
  assert.equal(fs.lstatSync(copy).isFile(), true);
  assert.deepEqual(fs.readFileSync(copy), xml);
  assert.equal(readResults(directory).results.generated_at, '2027-03-03T00:00:00.000Z');
  assert.deepEqual(fs.readdirSync(directory).sort(), ['ac-results.json', 'reports']);
})));

test('报告副本内容与记录的字节一致', () => withShop(({ spec }) => withTempDir((directory) => {
  const xml = Buffer.from(junitReport([{ name: 'TC-SHOP-001 中文' }]));
  writeResults({ directory, results: sampleResults(spec), reportCopies: { 'web-e2e': xml } });
  assert.deepEqual(fs.readFileSync(path.join(directory, reportCopyPath('web-e2e'))), xml);
})));

test('报告副本名称必须是合法套件名，不允许路径穿越', () => withShop(({ spec }) => withTempDir((directory) => {
  for (const name of ['../escape', 'a/b', 'A', '', '.hidden', 'x.xml']) {
    assert.throws(() => reportCopyPath(name), /套件名称/u, name);
    assert.throws(() => writeResults({ directory, results: sampleResults(spec), reportCopies: { [name]: Buffer.from('x') } }), /套件名称/u, name);
  }
  assert.equal(reportCopyPath('web-e2e'), 'reports/web-e2e.xml');
})));

test('读取结果往返一致，并忽略残留的临时文件', () => withShop(({ spec }) => withTempDir((directory) => {
  const results = sampleResults(spec);
  writeResults({ directory, results, reportCopies: {} });
  fs.writeFileSync(path.join(directory, 'ac-results.json.123.456.tmp'), '{ truncated');
  const read = readResults(directory);
  assert.equal(read.ok, true);
  assert.deepEqual(read.results, results);
})));

test('结果缺失、不是 JSON、不是对象都被识别为不可用', () => withTempDir((directory) => {
  const missing = readResults(path.join(directory, 'nowhere'));
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'RESULTS_MISSING');
  assert.match(missing.message, /ac-results\.json/u);

  fs.writeFileSync(path.join(directory, 'ac-results.json'), '{ not json');
  assert.equal(readResults(directory).code, 'RESULTS_INVALID');
  fs.writeFileSync(path.join(directory, 'ac-results.json'), '[]');
  assert.equal(readResults(directory).code, 'RESULTS_INVALID');
  fs.writeFileSync(path.join(directory, 'ac-results.json'), 'null');
  assert.equal(readResults(directory).code, 'RESULTS_INVALID');
  fs.writeFileSync(path.join(directory, 'ac-results.json'), '');
  assert.equal(readResults(directory).code, 'RESULTS_INVALID');
}));

test('结果文件是目录或符号链接时视为不可用', () => withShop(({ spec }) => withTempDir((directory) => {
  fs.mkdirSync(path.join(directory, 'ac-results.json'));
  assert.equal(readResults(directory).ok, false);
  fs.rmSync(path.join(directory, 'ac-results.json'), { recursive: true });

  const elsewhere = path.join(directory, 'elsewhere.json');
  fs.writeFileSync(elsewhere, JSON.stringify(sampleResults(spec)));
  fs.symlinkSync(elsewhere, path.join(directory, 'ac-results.json'));
  const read = readResults(directory);
  assert.equal(read.ok, false);
  assert.equal(read.code, 'RESULTS_INVALID');
})));

const BROKEN = [
  ['schema_version 不是 1', (r) => { r.schema_version = 2; }, /schema_version/u],
  ['缺少 head_sha', (r) => { delete r.head_sha; }, /head_sha/u],
  ['head_sha 不是完整 SHA', (r) => { r.head_sha = 'abc123'; }, /head_sha/u],
  ['worktree_clean 不是布尔', (r) => { r.worktree_clean = 'true'; }, /worktree_clean/u],
  ['config_digest 格式错误', (r) => { r.config_digest = 'md5:abc'; }, /config_digest/u],
  ['generated_at 缺失', (r) => { delete r.generated_at; }, /generated_at/u],
  ['suites 不是数组', (r) => { r.suites = {}; }, /suites/u],
  ['套件缺少 name', (r) => { delete r.suites[0].name; }, /suites\[0\]\.name/u],
  ['套件名称重复', (r) => { r.suites[1].name = r.suites[0].name; }, /重复/u],
  ['套件状态未知', (r) => { r.suites[0].status = 'great'; }, /suites\[0\]\.status/u],
  ['套件 exit_code 不是整数或 null', (r) => { r.suites[0].exit_code = '0'; }, /exit_code/u],
  ['套件 cases 为负数', (r) => { r.suites[0].cases = -1; }, /suites\[0\]\.cases/u],
  ['ok 套件缺少报告记录', (r) => { r.suites[0].report = null; }, /report/u],
  ['报告 copy 路径穿越', (r) => { r.suites[0].report.copy = '../../etc/passwd'; }, /copy/u],
  ['报告 copy 与套件名不符', (r) => { r.suites[0].report.copy = 'reports/other.xml'; }, /copy/u],
  ['报告 sha256 格式错误', (r) => { r.suites[0].report.sha256 = 'sha256:abc'; }, /sha256/u],
  ['报告 bytes 不是非负整数', (r) => { r.suites[0].report.bytes = 1.5; }, /bytes/u],
  ['tcs 是数组', (r) => { r.tcs = []; }, /tcs/u],
  ['acs 缺失', (r) => { delete r.acs; }, /acs/u],
  ['paths 是 null', (r) => { r.paths = null; }, /paths/u],
  ['unknown_ids 含非字符串', (r) => { r.unknown_ids = [1]; }, /unknown_ids/u],
  ['summary 缺失', (r) => { delete r.summary; }, /summary/u],
];

for (const [title, mutate, expected] of BROKEN) {
  test(`结果结构校验拒绝${title}`, () => withShop(({ spec }) => withTempDir((directory) => {
    const results = JSON.parse(JSON.stringify(sampleResults(spec)));
    mutate(results);
    const problems = validateResults(results);
    assert.ok(problems.length > 0, '应报告结构问题');
    assert.match(problems.join('\n'), expected);

    fs.writeFileSync(path.join(directory, 'ac-results.json'), JSON.stringify(results));
    const read = readResults(directory);
    assert.equal(read.ok, false);
    assert.equal(read.code, 'RESULTS_INVALID');
    assert.match(read.message, expected);
  })));
}

test('非对象输入的结构校验不抛出', () => {
  for (const value of [null, undefined, 1, 'x', [], true]) {
    assert.ok(validateResults(value).length > 0);
  }
});

test('xmlEscape 构造的特殊字符套件名称与命令原样往返', () => withShop(({ spec }) => withTempDir((directory) => {
  const command = `node run.js --title "${xmlEscape('<a & b>')}" && echo 中文`;
  const suites = [{ ...sampleSuites()[0], command }];
  const results = sampleResults(spec, { suites });
  writeResults({ directory, results, reportCopies: {} });
  assert.equal(readResults(directory).results.suites[0].command, command);
})));


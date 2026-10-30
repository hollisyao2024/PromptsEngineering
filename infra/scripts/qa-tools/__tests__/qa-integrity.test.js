'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  WAIVABLE_CODES,
  buildWaiver,
  evaluateIntegrity,
  globToRegExp,
  integrityLines,
  parseCliArgs,
  resolveIntegrityConfig,
} = require('../qa-integrity');

const EXAMPLE_CONFIG = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'templates', 'agent', 'config.example.json'),
  'utf8',
));
const DEFAULT_INTEGRITY = EXAMPLE_CONFIG.qa.integrity;

// 被测门禁会扫描本文件自身的 diff：跳过/聚焦写法一律动态拼接，避免本文件新增字面量触发 TEST_SKIP_ADDED / TEST_ONLY_ADDED。
const IT_ONLY = ['it', 'only'].join('.');
const IT_SKIP = ['it', 'skip'].join('.');
const SKIP_OPTION = ['{ ', 'skip', ': true }'].join('');
const PY_SKIP = ['@pytest', 'mark', 'skip'].join('.');
const GO_SKIP = ['t', 'Skip'].join('.');

function integrity(overrides = {}) {
  return resolveIntegrityConfig({ qa: { integrity: { ...DEFAULT_INTEGRITY, ...overrides } } });
}

function git(cwd, args) {
  const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

// 夹具仓库：提交 base 文件，再按 changes 改写（null 表示删除）并提交 head；返回两个提交 SHA。
function makeRepo(t, baseFiles, changes) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-integrity-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Fixture']);
  git(repo, ['config', 'user.email', 'fixture@example.invalid']);
  const write = (files) => {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(repo, file);
      if (content === null) {
        fs.rmSync(target);
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
  };
  write({ 'README.md': '# fixture\n', ...baseFiles });
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  const baseSha = git(repo, ['rev-parse', 'HEAD']);
  write(changes);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'head']);
  return { repo, baseSha, headSha: git(repo, ['rev-parse', 'HEAD']) };
}

function run(t, baseFiles, changes, options = {}) {
  const { repo, baseSha, headSha } = makeRepo(t, baseFiles, changes);
  const result = evaluateIntegrity({
    cwd: repo,
    baseSha,
    headSha,
    integrity: options.integrity || integrity(),
    waiverRecords: options.waiverRecords || [],
  });
  return { repo, baseSha, headSha, result };
}

const codes = (items) => items.map((item) => item.code);
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// 夹具 lock：与 tooling/xirang/engine.js 的写法一致，每条记录的 base 是上游 LF 内容的 sha256。
function lockOf(files) {
  const records = Object.fromEntries(Object.entries(files).map(([file, content]) => [
    file,
    { owner: 'xirang:agent', version: '1', strategy: 'overwrite', base: sha256(content) },
  ]));
  return `${JSON.stringify({ schemaVersion: 1, files: records, packages: {} }, null, 2)}\n`;
}

const JS_BASE = [
  "const test = require('node:test');",
  "const assert = require('node:assert/strict');",
  "test('adds', () => {",
  '  assert.equal(add(1, 2), 3);',
  '  assert.equal(add(0, 0), 0);',
  '});',
  "test('subtracts', () => {",
  '  assert.equal(sub(3, 1), 2);',
  '});',
  '',
].join('\n');

test('resolveIntegrityConfig compiles the example defaults and fails closed on unknown or malformed keys', () => {
  const resolved = integrity();
  assert.equal(resolved.mode, 'enforce');
  for (const group of ['skip', 'only', 'case', 'assert']) {
    assert.ok(resolved.patterns[group].length > 0, `${group} patterns`);
    assert.ok(resolved.patterns[group].every((pattern) => pattern instanceof RegExp));
  }

  assert.throws(() => resolveIntegrityConfig({ qa: {} }), /qa\.integrity/u);
  assert.throws(() => integrity({ extra: true }), /qa\.integrity\.extra/u);
  assert.throws(() => integrity({ mode: 'off' }), /qa\.integrity\.mode/u);
  assert.throws(() => integrity({ testGlobs: [] }), /qa\.integrity\.testGlobs/u);
  assert.throws(
    () => integrity({ patterns: { ...DEFAULT_INTEGRITY.patterns, flaky: ['x'] } }),
    /qa\.integrity\.patterns\.flaky/u,
  );
  assert.throws(
    () => integrity({ patterns: { ...DEFAULT_INTEGRITY.patterns, assert: ['('] } }),
    /qa\.integrity\.patterns\.assert/u,
  );
});

test('globToRegExp matches path segments the way the documented globs read', () => {
  const testFile = globToRegExp('**/*.test.*');
  assert.ok(testFile.test('a.test.js'));
  assert.ok(testFile.test('infra/scripts/__tests__/a.test.ts'));
  assert.ok(!testFile.test('infra/scripts/a.js'));
  const goTest = globToRegExp('**/*_test.go');
  assert.ok(goTest.test('pkg/cart/cart_test.go'));
  assert.ok(!goTest.test('pkg/cart/cart.go'));
  const tests = globToRegExp('tests/**');
  assert.ok(tests.test('tests/a/b.py'));
  assert.ok(!tests.test('src/tests/b.py'));
  const single = globToRegExp('src/*.spec.js');
  assert.ok(single.test('src/a.spec.js'));
  assert.ok(!single.test('src/deep/a.spec.js'));
  assert.ok(globToRegExp('a?.js').test('ab.js'));
  assert.ok(!globToRegExp('a?.js').test('a/.js'));
});

test('an untouched test suite passes and non-test files are not counted', (t) => {
  const { result } = run(t, { 'src/add.test.js': JS_BASE, 'src/add.js': 'module.exports = 1;\n' }, {
    'src/add.js': 'module.exports = 2;\n',
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.files, 0);
  assert.deepEqual(result.blocks, []);
  assert.deepEqual(result.risks, []);
});

test('adding a focused test blocks with TEST_ONLY_ADDED, also in a brand-new file', (t) => {
  const focused = JS_BASE.replace("test('adds'", `${IT_ONLY}('adds'`);
  const { result } = run(t, { 'src/add.test.js': JS_BASE }, {
    'src/add.test.js': focused,
    'src/new.test.js': `${IT_ONLY}('x', () => { assert.ok(true); });\n`,
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.files, 2);
  assert.deepEqual(codes(result.blocks).filter((code) => code === 'TEST_ONLY_ADDED'), ['TEST_ONLY_ADDED', 'TEST_ONLY_ADDED']);
  assert.deepEqual(result.blocks.map((item) => item.path).sort(), ['src/add.test.js', 'src/new.test.js']);
});

test('adding a skipped test blocks with TEST_SKIP_ADDED for JS, node:test options, pytest and Go', (t) => {
  const { result } = run(t, {
    'src/a.test.js': JS_BASE,
    'src/b.test.js': JS_BASE,
    'py/test_cart.py': 'def test_total():\n    assert total([]) == 0\n',
    'pkg/cart_test.go': 'package cart\n\nfunc TestTotal(t *testing.T) {\n\tif Total() != 0 {\n\t\tt.Fatal("total")\n\t}\n}\n',
  }, {
    'src/a.test.js': JS_BASE.replace("test('subtracts'", `${IT_SKIP}('subtracts'`).replace('test(\'adds\', () => {', 'test(\'adds\', () => {'),
    'src/b.test.js': JS_BASE.replace("test('adds', () => {", `test('adds', ${SKIP_OPTION}, () => {`),
    'py/test_cart.py': `${PY_SKIP}\ndef test_total():\n    assert total([]) == 0\n`,
    'pkg/cart_test.go': `package cart\n\nfunc TestTotal(t *testing.T) {\n\t${GO_SKIP}("later")\n\tif Total() != 0 {\n\t\tt.Fatal("total")\n\t}\n}\n`,
  });
  assert.equal(result.status, 'BLOCKED');
  const skipped = result.blocks.filter((item) => item.code === 'TEST_SKIP_ADDED').map((item) => item.path).sort();
  assert.deepEqual(skipped, ['pkg/cart_test.go', 'py/test_cart.py', 'src/a.test.js', 'src/b.test.js']);
});

test('fewer assertions or fewer cases block, and the detail carries the before/after counts', (t) => {
  const fewerAsserts = JS_BASE.replace('  assert.equal(add(0, 0), 0);\n', '');
  const fewerCases = JS_BASE.split("test('subtracts'")[0];
  const { result } = run(t, { 'src/a.test.js': JS_BASE, 'src/b.test.js': JS_BASE }, {
    'src/a.test.js': fewerAsserts,
    'src/b.test.js': fewerCases,
  });
  assert.equal(result.status, 'BLOCKED');
  const byPath = Object.fromEntries(result.blocks.map((item) => [`${item.path}:${item.code}`, item.detail]));
  assert.match(byPath['src/a.test.js:TEST_ASSERTS_DECREASED'], /3 → 2/u);
  assert.match(byPath['src/b.test.js:TEST_CASES_DECREASED'], /2 → 1/u);
  assert.match(byPath['src/b.test.js:TEST_ASSERTS_DECREASED'], /3 → 2/u);
  assert.equal(byPath['src/a.test.js:TEST_CASES_DECREASED'], undefined);
});

test('deleting a test file blocks; renaming it with the same content does not', (t) => {
  const { result } = run(t, { 'src/a.test.js': JS_BASE, 'src/b.test.js': JS_BASE }, {
    'src/a.test.js': null,
    'src/b.test.js': null,
    'test/b.test.js': JS_BASE,
  });
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.blocks.map((item) => `${item.code}|${item.path}`), ['TEST_FILE_DELETED|src/a.test.js']);
  assert.equal(result.files, 2);
});

test('comment lines never count, so commented-out focus or skip markers pass', (t) => {
  const commented = `${JS_BASE}// ${IT_ONLY}('later', () => {});\n/* ${IT_SKIP}('x') */\n# ${PY_SKIP}\n`;
  const { result } = run(t, { 'src/a.test.js': JS_BASE }, { 'src/a.test.js': commented });
  assert.equal(result.status, 'PASS');
  assert.equal(result.files, 1);
});

test('a rewritten expected value is a TEST_EXPECTATION_CHANGED risk, not a block', (t) => {
  const changed = JS_BASE.replace('assert.equal(add(1, 2), 3);', 'assert.equal(add(1, 2), 4);');
  const { result } = run(t, { 'src/a.test.js': JS_BASE }, { 'src/a.test.js': changed });
  assert.equal(result.status, 'PASS_WITH_RISK');
  assert.deepEqual(result.blocks, []);
  assert.deepEqual(result.risks.map((item) => `${item.code}|${item.path}`), ['TEST_EXPECTATION_CHANGED|src/a.test.js']);
  assert.match(result.risks[0].detail, /1/u);
});

test('warn mode reports every block as a risk and never blocks', (t) => {
  const { result } = run(t, { 'src/a.test.js': JS_BASE }, { 'src/a.test.js': null }, {
    integrity: integrity({ mode: 'warn' }),
  });
  assert.equal(result.status, 'PASS_WITH_RISK');
  assert.deepEqual(result.blocks, []);
  assert.deepEqual(codes(result.risks), ['TEST_FILE_DELETED']);
});

test('a waiver bound to the current blob downgrades a decrease to a risk; a stale or non-waivable one does not', (t) => {
  const fewerAsserts = JS_BASE.replace('  assert.equal(add(0, 0), 0);\n', '');
  const { repo, baseSha, headSha } = makeRepo(t, { 'src/a.test.js': JS_BASE, 'src/b.test.js': JS_BASE }, {
    'src/a.test.js': fewerAsserts,
    'src/b.test.js': null,
  });
  const config = integrity();
  const waiverA = buildWaiver({
    cwd: repo, baseSha, headSha, integrity: config,
    path: 'src/a.test.js', code: 'TEST_ASSERTS_DECREASED', reason: '合并为一条 deepEqual',
  });
  assert.match(waiverA.line, /^TEST_INTEGRITY_WAIVER=\{/u);
  assert.equal(waiverA.waiver.blob, git(repo, ['rev-parse', `${headSha}:src/a.test.js`]));
  const waiverB = buildWaiver({
    cwd: repo, baseSha, headSha, integrity: config,
    path: 'src/b.test.js', code: 'TEST_FILE_DELETED', reason: '用例迁入 a.test.js',
  });
  // 被删除的文件绑定 base 侧 blob：删除后不会再变化，换掉的是哪份内容一目了然。
  assert.equal(waiverB.waiver.blob, git(repo, ['rev-parse', `${baseSha}:src/b.test.js`]));

  const waived = evaluateIntegrity({
    cwd: repo, baseSha, headSha, integrity: config,
    waiverRecords: [waiverA.line, waiverB.line, 'unrelated evidence'],
  });
  assert.equal(waived.status, 'PASS_WITH_RISK');
  assert.equal(waived.waivers, 2);
  assert.deepEqual(waived.blocks, []);
  assert.ok(waived.risks.every((item) => /已豁免：/u.test(item.detail)));

  const stale = JSON.stringify({ ...waiverA.waiver, blob: 'f'.repeat(40) });
  const staleResult = evaluateIntegrity({
    cwd: repo, baseSha, headSha, integrity: config,
    waiverRecords: [`TEST_INTEGRITY_WAIVER=${stale}`, waiverB.line],
  });
  assert.equal(staleResult.status, 'BLOCKED');
  assert.equal(staleResult.waivers, 1);
  assert.deepEqual(staleResult.blocks.map((item) => `${item.code}|${item.path}`), ['TEST_ASSERTS_DECREASED|src/a.test.js']);

  const invalid = evaluateIntegrity({
    cwd: repo, baseSha, headSha, integrity: config,
    waiverRecords: [
      `TEST_INTEGRITY_WAIVER=${JSON.stringify({ ...waiverA.waiver, code: 'TEST_ONLY_ADDED' })}`,
      'TEST_INTEGRITY_WAIVER={not json',
    ],
  });
  assert.equal(invalid.status, 'BLOCKED');
  assert.deepEqual(codes(invalid.blocks).filter((code) => code === 'TEST_WAIVER_INVALID').length, 2);
});

test('buildWaiver only accepts a current, waivable finding with a reason', (t) => {
  const { repo, baseSha, headSha } = makeRepo(t, { 'src/a.test.js': JS_BASE }, {
    'src/a.test.js': JS_BASE.replace("test('adds'", `${IT_ONLY}('adds'`),
  });
  const base = { cwd: repo, baseSha, headSha, integrity: integrity() };
  assert.deepEqual([...WAIVABLE_CODES].sort(), ['TEST_ASSERTS_DECREASED', 'TEST_CASES_DECREASED', 'TEST_FILE_DELETED']);
  assert.throws(() => buildWaiver({ ...base, path: 'src/a.test.js', code: 'TEST_ONLY_ADDED', reason: 'x' }), /不可豁免/u);
  assert.throws(() => buildWaiver({ ...base, path: 'src/a.test.js', code: 'TEST_FILE_DELETED', reason: 'x' }), /没有.*TEST_FILE_DELETED/u);
  assert.throws(() => buildWaiver({ ...base, path: 'src/a.test.js', code: 'TEST_CASES_DECREASED', reason: '  ' }), /--reason/u);
});

test('template-synced changes that match the xirang.lock.json baselines on both sides are risks, not blocks', (t) => {
  const fewerAsserts = JS_BASE.replace('  assert.equal(add(0, 0), 0);\n', '');
  const skipped = JS_BASE.replace("test('subtracts'", `${IT_SKIP}('subtracts'`);
  const focused = `${IT_ONLY}('x', () => {\n  assert.ok(true);\n});\n`;
  const rewritten = JS_BASE.replace('assert.equal(add(1, 2), 3);', 'assert.equal(add(1, 2), 4);');
  const baseTests = { 'a.test.js': JS_BASE, 'b.test.js': JS_BASE, 'c.test.js': JS_BASE, 'e.test.js': JS_BASE };
  const { result } = run(t, { ...baseTests, 'xirang.lock.json': lockOf(baseTests) }, {
    'a.test.js': fewerAsserts,
    'b.test.js': null,
    'c.test.js': skipped,
    // CRLF 检出的上游文件：lock 记录 LF 内容的摘要，判定须按 engine.js 的 verifiedText 规则归一。
    'd.test.js': focused.replace(/\n/gu, '\r\n'),
    'e.test.js': rewritten,
    'xirang.lock.json': lockOf({ 'a.test.js': fewerAsserts, 'c.test.js': skipped, 'd.test.js': focused, 'e.test.js': rewritten }),
  });
  assert.equal(result.status, 'PASS_WITH_RISK');
  assert.deepEqual(result.blocks, []);
  assert.equal(result.templateSynced, 5);
  assert.deepEqual(result.risks.map((item) => `${item.code}|${item.path}`).sort(), [
    'TEST_ASSERTS_DECREASED|a.test.js',
    'TEST_EXPECTATION_CHANGED|e.test.js',
    'TEST_FILE_DELETED|b.test.js',
    'TEST_ONLY_ADDED|d.test.js',
    'TEST_SKIP_ADDED|c.test.js',
  ]);
  assert.ok(result.risks.every((item) => /模板同步/u.test(item.detail)), '每条风险都标注来自模板同步');
  assert.equal(integrityLines(result)[0], 'TEST_INTEGRITY=PASS_WITH_RISK FILES=5 WAIVERS=0 TEMPLATE_SYNCED=5');
});

test('a template-owned test edited locally on either side, or deleted while still locked, keeps blocking', (t) => {
  const fewerAsserts = JS_BASE.replace('  assert.equal(add(0, 0), 0);\n', '');
  const localExtra = `${JS_BASE}test('local', () => {\n  assert.ok(true);\n});\n`;
  const baseTests = { 'head-edit.test.js': JS_BASE, 'base-edit.test.js': JS_BASE, 'gone.test.js': JS_BASE };
  const { result } = run(t, {
    ...baseTests,
    // base 侧已有本地追加的用例，lock 仍记录上游原文：这次同步会丢掉本地用例，不能当成纯上游变化。
    'base-edit.test.js': localExtra,
    'xirang.lock.json': lockOf(baseTests),
  }, {
    // HEAD 内容与 lock 记录的上游基线不一致：断言是本地删的。
    'head-edit.test.js': fewerAsserts,
    'base-edit.test.js': fewerAsserts,
    // 文件被删但 HEAD lock 仍登记它：不是模板 remove，而是本地删除。
    'gone.test.js': null,
    'xirang.lock.json': lockOf({ ...baseTests, 'base-edit.test.js': fewerAsserts }),
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.templateSynced, 0);
  assert.deepEqual(result.blocks.map((item) => `${item.code}|${item.path}`).sort(), [
    'TEST_ASSERTS_DECREASED|base-edit.test.js',
    'TEST_ASSERTS_DECREASED|head-edit.test.js',
    'TEST_CASES_DECREASED|base-edit.test.js',
    'TEST_FILE_DELETED|gone.test.js',
  ]);
  assert.equal(integrityLines(result)[0], 'TEST_INTEGRITY=BLOCKED FILES=3 WAIVERS=0');
});

test('a missing, malformed or wrong-schema lock leaves the original verdict unchanged', (t) => {
  const fewerAsserts = JS_BASE.replace('  assert.equal(add(0, 0), 0);\n', '');
  const goodBase = lockOf({ 'a.test.js': JS_BASE });
  const goodHead = lockOf({ 'a.test.js': fewerAsserts });
  const wrongSchema = JSON.stringify({ schemaVersion: 2, files: JSON.parse(goodHead).files, packages: {} });
  const badDigest = JSON.stringify({ schemaVersion: 1, files: { 'a.test.js': { owner: 'xirang:agent', strategy: 'overwrite', base: 'nothex' } }, packages: {} });
  for (const [label, baseLock, headLock] of [
    ['no lock', undefined, undefined],
    ['head lock missing', goodBase, undefined],
    ['base lock missing', undefined, goodHead],
    ['malformed head lock', goodBase, '{not json'],
    ['wrong schema', goodBase, wrongSchema],
    ['invalid digest', goodBase, badDigest],
  ]) {
    const base = { 'a.test.js': JS_BASE, ...(baseLock ? { 'xirang.lock.json': baseLock } : {}) };
    const head = { 'a.test.js': fewerAsserts, ...(headLock ? { 'xirang.lock.json': headLock } : {}) };
    const { result } = run(t, base, head);
    assert.equal(result.status, 'BLOCKED', label);
    assert.equal(result.templateSynced, 0, label);
    assert.deepEqual(codes(result.blocks), ['TEST_ASSERTS_DECREASED'], label);
  }
});

test('buildWaiver refuses a template-synced finding because it is already a risk', (t) => {
  const { repo, baseSha, headSha } = makeRepo(t, { 'a.test.js': JS_BASE, 'xirang.lock.json': lockOf({ 'a.test.js': JS_BASE }) }, {
    'a.test.js': null,
    'xirang.lock.json': lockOf({}),
  });
  assert.throws(() => buildWaiver({
    cwd: repo, baseSha, headSha, integrity: integrity(),
    path: 'a.test.js', code: 'TEST_FILE_DELETED', reason: '上游删除',
  }), /模板同步.*无需豁免/u);
});

test('integrityLines prints the summary first, then blocks, then risks', () => {
  const lines = integrityLines({
    status: 'BLOCKED',
    files: 2,
    waivers: 1,
    blocks: [{ code: 'TEST_ONLY_ADDED', path: 'a.test.js', detail: '新增 1 处' }],
    risks: [{ code: 'TEST_EXPECTATION_CHANGED', path: 'b.test.js', detail: '1 行断言被改写' }],
  });
  assert.deepEqual(lines, [
    'TEST_INTEGRITY=BLOCKED FILES=2 WAIVERS=1',
    'TEST_INTEGRITY_BLOCK=TEST_ONLY_ADDED|a.test.js|新增 1 处',
    'TEST_INTEGRITY_RISK=TEST_EXPECTATION_CHANGED|b.test.js|1 行断言被改写',
  ]);
});

test('parseCliArgs accepts check and waive and rejects anything else', () => {
  assert.deepEqual(parseCliArgs(['check']), { action: 'check', base: null });
  assert.deepEqual(parseCliArgs(['check', '--base', 'abc']), { action: 'check', base: 'abc' });
  assert.deepEqual(
    parseCliArgs(['waive', '--path', 'a.test.js', '--code=TEST_FILE_DELETED', '--reason', '迁移']),
    { action: 'waive', base: null, path: 'a.test.js', code: 'TEST_FILE_DELETED', reason: '迁移' },
  );
  assert.throws(() => parseCliArgs([]), /check\|waive/u);
  assert.throws(() => parseCliArgs(['verify']), /check\|waive/u);
  assert.throws(() => parseCliArgs(['check', '--force']), /--force/u);
  assert.throws(() => parseCliArgs(['waive', '--path', 'a']), /--code/u);
});

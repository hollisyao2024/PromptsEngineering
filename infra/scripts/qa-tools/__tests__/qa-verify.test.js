'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  captureQaVerificationIdentity,
  createPnpmRunInvocation,
  describeQaVerifyOutcome,
  resolveProjectChecks,
  resolveTargetsFromQaPlanState,
  validateQaFile,
} = require('../qa-verify');
const { resultBlockLines } = require('../../shared/result-block');

// qa verify ends with the parsable STATUS/REASON/SUMMARY/NEXT_ACTION block (docs/CONVENTIONS.md §7) instead of a bare
// "❌ 执行失败" line: known gate failures are BLOCKED with a stable reason code, tool failures are FAILED.
test('qa verify maps known errors to BLOCKED reason codes and unknown errors to FAILED', () => {
  const stale = new Error('origin/main (aaa) is not an ancestor of origin/fix (bbb); synchronize the feature branch and rerun QA.');
  stale.code = 'STALE_QA_BASE';
  const staleOutcome = describeQaVerifyOutcome({ error: stale });
  assert.equal(staleOutcome.status, 'BLOCKED');
  assert.equal(staleOutcome.reason, 'STALE_QA_BASE');
  assert.match(staleOutcome.summary, /not an ancestor/);
  assert.match(staleOutcome.nextAction, /merge/i);
  assert.deepEqual(resultBlockLines(staleOutcome).slice(0, 2), ['STATUS=BLOCKED', 'REASON=STALE_QA_BASE']);

  const fetch = new Error('git fetch failed after 2 attempts: unable to access origin');
  fetch.code = 'QA_FETCH_FAILED';
  assert.equal(describeQaVerifyOutcome({ error: fetch }).status, 'FAILED');
  assert.equal(describeQaVerifyOutcome({ error: fetch }).reason, 'QA_FETCH_FAILED');

  for (const code of ['HEAD_NOT_PUSHED', 'QA_BRANCH_REQUIRED', 'TEST_SCOPE_EVIDENCE']) {
    const error = new Error(`gate ${code}`);
    error.code = code;
    const outcome = describeQaVerifyOutcome({ error });
    assert.equal(outcome.status, 'BLOCKED', code);
    assert.equal(outcome.reason, code);
    assert.match(outcome.summary, new RegExp(`gate ${code}`));
  }

  const unknown = describeQaVerifyOutcome({ error: new TypeError('x is not a function') });
  assert.equal(unknown.status, 'FAILED');
  assert.equal(unknown.reason, 'UNEXPECTED_ERROR');
  assert.match(unknown.summary, /x is not a function/);
});

test('qa verify reports verdict and business gate blocks with their own reason codes and OK with the receipt', () => {
  const noGo = describeQaVerifyOutcome({ exitCode: 1, failureReason: 'QA_VERDICT_NO_GO' });
  assert.equal(noGo.status, 'BLOCKED');
  assert.equal(noGo.reason, 'QA_VERDICT_NO_GO');
  const business = describeQaVerifyOutcome({ exitCode: 1, failureReason: 'BUSINESS_GATE_BLOCKED' });
  assert.equal(business.reason, 'BUSINESS_GATE_BLOCKED');
  const ok = describeQaVerifyOutcome({ exitCode: 0, receipt: { head_sha: 'b'.repeat(40), base_sha: 'a'.repeat(40) }, receiptPath: '/tmp/receipt.json' });
  assert.equal(ok.status, 'OK');
  assert.equal(ok.reason, undefined);
  assert.match(ok.summary, /b{40}/);
  assert.match(ok.nextAction, /qa merge/);
});

test('qa verify identity errors carry stable reason codes', () => {
  const onBase = (args) => (args.join(' ') === 'branch --show-current' ? 'stable\n' : '');
  assert.throws(() => captureQaVerificationIdentity({ config: { baseBranch: 'stable' }, runGit: onBase }), (error) => (
    error.code === 'QA_BRANCH_REQUIRED' && /feature branch/.test(error.message)
  ));
  const detached = (args) => (args.join(' ') === 'branch --show-current' ? '\n' : '');
  assert.throws(() => captureQaVerificationIdentity({ config: { baseBranch: 'stable' }, runGit: detached }), (error) => (
    error.code === 'QA_BRANCH_REQUIRED'
  ));
});
const { AC_COLUMNS, acRowCells, mdTable } = require('./fixtures/business-testing/builders');

test('qa verify captures the configured remote base and exact remote feature head', () => {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const calls = [];
  const fakeRunGit = (args) => {
    calls.push(args);
    const key = args.join(' ');
    if (key === 'branch --show-current') return 'fix/verified\n';
    if (key === 'rev-parse --verify refs/remotes/origin/stable^{commit}') return `${A}\n`;
    if (key === 'rev-parse --verify refs/remotes/origin/fix/verified^{commit}') return `${B}\n`;
    if (key === 'rev-parse --verify HEAD^{commit}') return `${B}\n`;
    return '';
  };

  const receipt = captureQaVerificationIdentity({
    config: { baseBranch: 'stable' },
    runGit: fakeRunGit,
    verifiedAt: '2026-09-05T00:00:00.000Z',
  });

  assert.equal(receipt.base_branch, 'stable');
  assert.equal(receipt.branch, 'fix/verified');
  assert.equal(receipt.base_sha, A);
  assert.equal(receipt.head_sha, B);
  assert.deepEqual(calls[1], [
    'fetch', '--prune', 'origin',
    '+refs/heads/stable:refs/remotes/origin/stable',
    '+refs/heads/fix/verified:refs/remotes/origin/fix/verified',
  ]);
  assert.deepEqual(calls.at(-1), ['merge-base', '--is-ancestor', A, B]);
});

// A transient network failure on the single fetch gets exactly one bounded retry; the second failure propagates.
function flakyFetchGit({ fetchFailures }) {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const calls = [];
  let fetches = 0;
  const runGit = (args) => {
    calls.push(args);
    const key = args.join(' ');
    if (key === 'branch --show-current') return 'fix/verified\n';
    if (args[0] === 'fetch') {
      fetches += 1;
      if (fetches <= fetchFailures) throw new Error(`git ${key} failed (128): fatal: unable to access origin`);
      return '';
    }
    if (key === 'rev-parse --verify refs/remotes/origin/stable^{commit}') return `${A}\n`;
    if (key === 'rev-parse --verify refs/remotes/origin/fix/verified^{commit}') return `${B}\n`;
    if (key === 'rev-parse --verify HEAD^{commit}') return `${B}\n`;
    return '';
  };
  return { runGit, calls, fetchCount: () => calls.filter((args) => args[0] === 'fetch').length, A, B };
}

test('qa verify retries a failed fetch once and signs the receipt when the retry succeeds', () => {
  const git = flakyFetchGit({ fetchFailures: 1 });
  const receipt = captureQaVerificationIdentity({ config: { baseBranch: 'stable' }, runGit: git.runGit });
  assert.equal(receipt.base_sha, git.A);
  assert.equal(receipt.head_sha, git.B);
  assert.equal(git.fetchCount(), 2);
  assert.deepEqual(git.calls.at(-1), ['merge-base', '--is-ancestor', git.A, git.B]);
});

test('qa verify gives up after the second fetch failure without a third attempt', () => {
  const git = flakyFetchGit({ fetchFailures: 2 });
  assert.throws(() => captureQaVerificationIdentity({ config: { baseBranch: 'stable' }, runGit: git.runGit }), (error) => (
    error.code === 'QA_FETCH_FAILED' && /after 2 attempts/.test(error.message) && /unable to access origin/.test(error.message)
  ));
  assert.equal(git.fetchCount(), 2);
  assert.ok(!git.calls.some((args) => args[0] === 'rev-parse'));
});

test('qa verify rejects a local HEAD that differs from the pushed feature branch', () => {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const C = 'c'.repeat(40);
  const fakeRunGit = (args) => {
    const key = args.join(' ');
    if (key === 'branch --show-current') return 'fix/verified\n';
    if (key.includes('refs/remotes/origin/stable')) return `${A}\n`;
    if (key.includes('refs/remotes/origin/fix/verified')) return `${B}\n`;
    if (key === 'rev-parse --verify HEAD^{commit}') return `${C}\n`;
    return '';
  };

  assert.throws(() => captureQaVerificationIdentity({
    config: { baseBranch: 'stable' },
    runGit: fakeRunGit,
  }), (error) => error.code === 'HEAD_NOT_PUSHED' && /local HEAD.*origin\/fix\/verified/i.test(error.message));
});

const repoRoot = path.resolve(__dirname, '../../../..');

test('project verification appends configured required checks without allowing base checks to be downgraded', () => {
  const checks = resolveProjectChecks({
    qa: {
      projectChecks: [
        { name: 'qa:lint', required: false },
        { name: 'governance:v03:check', required: true },
      ],
    },
  });

  assert.deepEqual(checks, [
    { name: 'qa:lint', required: true },
    { name: 'qa:sync-prd-qa-ids', required: true },
    { name: 'qa:coverage-report', required: false },
    { name: 'qa:check-defect-blockers', required: true },
    { name: 'governance:v03:check', required: true },
  ]);
});

test('project verification rejects malformed configured checks', () => {
  assert.throws(
    () => resolveProjectChecks({ qa: { projectChecks: [{ name: 'pnpm run unsafe command', required: true }] } }),
    /invalid qa\.projectChecks entry/i
  );
});

test('project verification invokes pnpm through hidden Node on Windows instead of relying on PATH', () => {
  const invocation = createPnpmRunInvocation('qa:lint', {
    platform: 'win32',
    env: { Path: 'C:\\Windows\\System32' },
    pnpmBin: 'C:\\tools\\pnpm.mjs',
  });

  assert.equal(invocation.bin, process.execPath);
  assert.deepEqual(invocation.args, ['C:\\tools\\pnpm.mjs', 'run', 'qa:lint']);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(invocation.options.shell, undefined);
});

test('validateQaFile accepts module IDs that contain digits and multiple segments', (t) => {
  const moduleDir = `digit-id-fixture-${process.pid}`;
  const prdDir = path.join(repoRoot, 'docs', 'prd-modules', moduleDir);
  const qaDir = path.join(repoRoot, 'docs', 'qa-modules', moduleDir);
  const qaRelPath = path.posix.join('docs/qa-modules', moduleDir, 'QA.md');

  fs.mkdirSync(prdDir, { recursive: true });
  fs.mkdirSync(qaDir, { recursive: true });
  t.after(() => {
    fs.rmSync(prdDir, { recursive: true, force: true });
    fs.rmSync(qaDir, { recursive: true, force: true });
  });

  fs.writeFileSync(
    path.join(prdDir, 'PRD.md'),
    ['# PRD', '', '## Stories', '- US-E2E-001: nightly coverage', '- US-MODEL-CONFIG-001: routing config'].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(qaDir, 'QA.md'),
    ['# QA', '', '## Coverage', '- US-E2E-001 -> TC-E2E-001', '- US-MODEL-CONFIG-001 -> TC-MODEL-CONFIG-001'].join('\n'),
    'utf8'
  );

  const result = validateQaFile(qaRelPath);

  assert.equal(result.errors.length, 0);
  assert.equal(result.stats.storyCount, 2);
  assert.equal(result.stats.testCaseCount, 2);
  assert.equal(result.stats.validStoryRefCount, 2);
  assert.equal(result.stats.storyCoverage, 100);
});

test('validateQaFile accepts cross-module Story references without inflating local coverage', (t) => {
  const fixtureId = `${process.pid}-${Date.now()}`;
  const moduleDir = `cross-module-source-${fixtureId}`;
  const siblingModuleDir = `cross-module-target-${fixtureId}`;
  const prdDir = path.join(repoRoot, 'docs', 'prd-modules', moduleDir);
  const siblingPrdDir = path.join(repoRoot, 'docs', 'prd-modules', siblingModuleDir);
  const qaDir = path.join(repoRoot, 'docs', 'qa-modules', moduleDir);
  const qaRelPath = path.posix.join('docs/qa-modules', moduleDir, 'QA.md');

  fs.mkdirSync(prdDir, { recursive: true });
  fs.mkdirSync(siblingPrdDir, { recursive: true });
  fs.mkdirSync(qaDir, { recursive: true });
  t.after(() => {
    fs.rmSync(prdDir, { recursive: true, force: true });
    fs.rmSync(siblingPrdDir, { recursive: true, force: true });
    fs.rmSync(qaDir, { recursive: true, force: true });
  });

  fs.writeFileSync(
    path.join(prdDir, 'PRD.md'),
    ['# PRD', '', '## Stories', '- US-SOURCE-001: local story', '- US-SOURCE-002: uncovered local story'].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(siblingPrdDir, 'PRD.md'),
    ['# PRD', '', '## Stories', '- US-TARGET-001: cross-module dependency'].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(qaDir, 'QA.md'),
    ['# QA', '', '## Coverage', '- US-SOURCE-001 -> TC-SOURCE-001', '- US-TARGET-001 -> TC-TARGET-001'].join('\n'),
    'utf8'
  );

  const result = validateQaFile(qaRelPath);

  assert.equal(result.errors.length, 0);
  assert.equal(result.stats.storyCount, 2);
  assert.equal(result.stats.validStoryRefCount, 1);
  assert.equal(result.stats.storyCoverage, 50);
});

test('validateQaFile measures coverage against the Stories the module PRD defines, not the ones it only mentions', (t) => {
  const moduleDir = `story-table-fixture-${process.pid}`;
  const prdDir = path.join(repoRoot, 'docs', 'prd-modules', moduleDir);
  const qaDir = path.join(repoRoot, 'docs', 'qa-modules', moduleDir);
  const qaFile = path.join(qaDir, 'QA.md');
  const qaRelPath = path.posix.join('docs/qa-modules', moduleDir, 'QA.md');

  fs.mkdirSync(prdDir, { recursive: true });
  fs.mkdirSync(qaDir, { recursive: true });
  t.after(() => {
    fs.rmSync(prdDir, { recursive: true, force: true });
    fs.rmSync(qaDir, { recursive: true, force: true });
  });

  // US-USER-001 appears in a banner and in a dependency cell, but this module does not own it.
  const prd = [
    '# 订单模块 PRD',
    '',
    '> 登录态由 US-USER-001 提供（见用户模块 PRD）。',
    '',
    '## 用户故事',
    '',
    mdTable(
      ['Story ID', '用户故事', '优先级', '依赖', '预估工时'],
      [
        ['US-STBL-001', '作为用户，我要下单', 'P0', '依赖 US-USER-001', '2d'],
        ['US-STBL-002', '作为用户，我要查看订单', 'P1', '-', '1d'],
      ]
    ),
    '',
    '### 原子 AC 清单',
    '',
    mdTable(AC_COLUMNS, [
      acRowCells({ id: 'AC-STBL-001-01', story: 'US-STBL-001', tc: 'TC-STBL-001' }),
      acRowCells({ id: 'AC-STBL-002-01', story: 'US-STBL-002', priority: 'P1', tc: 'TC-STBL-002' }),
    ]),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(prdDir, 'PRD.md'), prd, 'utf8');

  fs.writeFileSync(
    qaFile,
    ['# QA', '', '## Coverage', '- US-STBL-001 -> TC-STBL-001', '- US-STBL-002 -> TC-STBL-002'].join('\n'),
    'utf8'
  );
  const full = validateQaFile(qaRelPath);

  assert.deepEqual(full.errors, []);
  assert.equal(full.stats.storyCount, 2);
  assert.equal(full.stats.validStoryRefCount, 2);
  assert.equal(full.stats.storyCoverage, 100, 'a Story the module only mentions must not enlarge the denominator');

  fs.writeFileSync(
    qaFile,
    ['# QA', '', '## Coverage', '- US-STBL-001 -> TC-STBL-001'].join('\n'),
    'utf8'
  );
  const partial = validateQaFile(qaRelPath);

  assert.deepEqual(partial.errors, []);
  assert.equal(partial.stats.validStoryRefCount, 1);
  assert.equal(partial.stats.storyCoverage, 50, 'one of the two defined Stories is covered');
});

test('QA verification reads only the selected worktree session state file', (t) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-session-isolation-'));
  const currentStatePath = path.join(fixtureDir, 'current-worktree.json');
  const foreignStatePath = path.join(fixtureDir, 'foreign-worktree.json');
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));

  fs.writeFileSync(currentStatePath, JSON.stringify({
    scope: 'session',
    modules: ['current-module'],
    touchedFiles: ['docs/qa-modules/current-module/QA.md'],
  }), 'utf8');
  fs.writeFileSync(foreignStatePath, JSON.stringify({
    scope: 'session',
    modules: ['foreign-module'],
    touchedFiles: ['docs/qa-modules/foreign-module/QA.md'],
  }), 'utf8');

  const result = resolveTargetsFromQaPlanState(currentStatePath);

  assert.deepEqual(result.modules, ['current-module']);
  assert.deepEqual(result.files, ['docs/qa-modules/current-module/QA.md']);
  assert.match(result.source, /current-worktree\.json/);
  assert.doesNotMatch(result.source, /foreign-worktree\.json/);
});

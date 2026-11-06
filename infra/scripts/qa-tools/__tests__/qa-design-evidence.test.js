'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseCliArgs, evaluateDesign } = require('../qa-design');
const { makeProject, compliantDesign, design, passedResults, allTcs, makeHistory, designDoc, prdDoc, COMPLIANT_PRD, git } = require('./qa-design.helpers');

// E1–E5: expected outcomes come from QA-DESIGN-EVIDENCE.md and user AC2.
test('E1 CLI exposes strict per-subject evidence attestation', () => {
  const args = parseCliArgs(['attest', '--kind', 'manual', '--id', 'RUL-USER-001', '--outcome', 'skipped', '--reviewer', 'QA', '--environment', 'macOS', '--reason', 'not executed', '--evidence', '/tmp/proof']);
  assert.equal(args.kind, 'manual');
  assert.equal(args.outcome, 'skipped');
  assert.throws(() => parseCliArgs(['attest', '--kind', 'manual']), /需要/u);
});

function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-attestation-')));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const evidence = path.join(directory, 'source.txt');
  fs.writeFileSync(evidence, 'Observed actual result in declared environment.\n');
  return {
    directory: path.join(directory, 'receipts'), evidence,
    binding: { head: 'a'.repeat(40), worktree: '/fixture/worktree', context: 'b'.repeat(64), config: 'c'.repeat(64) },
    kind: 'manual', id: 'RUL-USER-001', change: null, outcome: 'passed', reviewer: 'QA', environment: 'fixture host', reason: 'verified',
  };
}

test('E3/E4 copied evidence, current bindings and latest outcome are mandatory', (t) => {
  const { appendReceipt, readReceipts } = require('../qa-design-evidence');
  const input = fixture(t);
  appendReceipt(input);
  const read = () => readReceipts(input.directory, input.binding);
  assert.equal(read().manual['RUL-USER-001'], 'passed');
  appendReceipt({ ...input, outcome: 'skipped' });
  assert.equal(read().manual['RUL-USER-001'], 'skipped');
  appendReceipt({ ...input, outcome: 'failed' });
  assert.equal(read().manual['RUL-USER-001'], 'failed');
  assert.ok(readReceipts(input.directory, { ...input.binding, head: 'd'.repeat(40) }).issues.length);
  const copy = fs.readdirSync(input.directory).find((file) => file.endsWith('.evidence'));
  fs.writeFileSync(path.join(input.directory, copy), 'tampered');
  assert.ok(read().issues.length);
  assert.deepEqual(read().manual, {});
});

test('E4 malformed records and evidence links fail closed', (t) => {
  const { appendReceipt, readReceipts } = require('../qa-design-evidence');
  const input = fixture(t);
  appendReceipt(input);
  fs.writeFileSync(path.join(input.directory, '000000000002.json'), '{broken');
  assert.ok(readReceipts(input.directory, input.binding).issues.length);
  assert.deepEqual(readReceipts(input.directory, input.binding).manual, {});
  const link = path.join(path.dirname(input.evidence), 'link');
  fs.symlinkSync(input.evidence, link);
  assert.throws(() => appendReceipt({ ...input, evidence: link }), /普通文件/u);
});

test('E2–E4 review receipts require current configuration, context and worktree', (t) => {
  const { appendReceipt, readReceipts } = require('../qa-design-evidence');
  const input = { ...fixture(t), kind: 'review', change: 'e'.repeat(64) };
  appendReceipt(input);
  assert.equal(readReceipts(input.directory, input.binding).reviews[input.change], 'passed');
  for (const binding of [
    { ...input.binding, config: 'f'.repeat(64) },
    { ...input.binding, context: 'f'.repeat(64) },
    { ...input.binding, worktree: '/different/worktree' },
  ]) {
    const stale = readReceipts(input.directory, binding);
    assert.deepEqual(stale.reviews, {});
    assert.ok(stale.issues.length);
  }
  appendReceipt({ ...input, outcome: 'failed' });
  assert.equal(readReceipts(input.directory, input.binding).reviews[input.change], 'failed');
  const recordFile = path.join(input.directory, '000000000002.json');
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  record.unrecognised = true;
  fs.writeFileSync(recordFile, JSON.stringify(record));
  const invalid = readReceipts(input.directory, input.binding);
  assert.ok(invalid.issues.length);
  assert.deepEqual(invalid.reviews, {});
});

test('E4 modifying the last receipt outcome cannot turn failure into pass', (t) => {
  const { appendReceipt, readReceipts } = require('../qa-design-evidence');
  const input = { ...fixture(t), outcome: 'failed' };
  const file = appendReceipt(input);
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.outcome = 'passed';
  fs.writeFileSync(file, `${JSON.stringify(record)}\n`);
  const result = readReceipts(input.directory, input.binding);
  assert.ok(result.issues.length);
  assert.deepEqual(result.manual, {});
});

test('E5 manual proof does not prove other adversaries or bypass source gates', (t) => {
  const doc = compliantDesign();
  doc.rules[0][5] = 'manual';
  const root = makeProject(t, { design: doc });
  const evaluate = (evidence) => evaluateDesign({ repoRoot: root, design: design({ mode: 'enforce' }), results: passedResults(allTcs(root)), evidence });
  assert.ok(evaluate(null).risks.some((risk) => risk.code === 'DESIGN_MANUAL'));
  const result = evaluate({ manual: { 'RUL-USER-001': 'passed' }, reviews: {}, issues: [] });
  assert.equal(result.metrics.rulesVerified, 1);
  assert.equal(result.risks.some((risk) => risk.code === 'DESIGN_MANUAL'), false);
  const skipped = evaluate({ manual: { 'RUL-USER-001': 'skipped' }, reviews: {}, issues: [] });
  assert.equal(skipped.metrics.rulesVerified, 0);
  assert.ok(skipped.risks.some((risk) => risk.code === 'DESIGN_MANUAL'));
  const unproven = evaluateDesign({ repoRoot: root, design: design({ mode: 'enforce' }), results: passedResults(allTcs(root), { 'TC-USER-011': 'failed' }),
    evidence: { manual: { 'RUL-USER-001': 'passed' }, reviews: {}, issues: [] } });
  assert.ok(unproven.blocks.some((item) => item.code === 'DESIGN_TC_UNPROVEN' && item.subject === 'ADV-USER-001'));
});

test('E2 exact historical review is append-only and cannot approve a different change', (t) => {
  const { changeDigest } = require('../qa-design-evidence');
  const { loadDesignSpec } = require('../qa-design-spec');
  const doc = compliantDesign({ changes: [['2026-11-06', 'RUL-USER-001', '修改', 'new requirement；新出处：AC-USER-001-01', '待评审']] });
  const root = makeProject(t, { design: doc });
  const change = loadDesignSpec({ repoRoot: root }).docs[0].changes[0];
  const evaluate = (reviews) => evaluateDesign({ repoRoot: root, design: design({ mode: 'enforce' }), results: passedResults(allTcs(root)), evidence: { manual: {}, reviews, issues: [] } });
  assert.ok(evaluate({ ['0'.repeat(64)]: 'passed' }).risks.some((item) => item.code === 'DESIGN_REVIEW_PENDING'));
  assert.equal(evaluate({ [changeDigest(change)]: 'passed' }).risks.some((item) => item.code === 'DESIGN_REVIEW_PENDING'), false);
  assert.ok(evaluate({ [changeDigest(change)]: 'skipped' }).risks.some((item) => item.code === 'DESIGN_REVIEW_PENDING'));
  const original = designDoc(doc);
  const history = makeHistory(t, [
    { files: { 'docs/prd-modules/user/PRD.md': prdDoc(COMPLIANT_PRD), 'docs/qa-modules/user/TEST-DESIGN.md': original } },
    { files: { 'docs/qa-modules/user/TEST-DESIGN.md': original.replace('待评审', 'QA') } },
  ]);
  const rewritten = evaluateDesign({ repoRoot: history.root, design: design({ mode: 'enforce' }), results: passedResults(allTcs(root)), baseSha: history.baseSha, headSha: history.headSha });
  assert.ok(rewritten.blocks.some((item) => item.code === 'DESIGN_REVIEW_HISTORY_CHANGED'));
});

test('E5 automatic adversaries cannot substitute manual receipts for failed TCs', (t) => {
  const root = makeProject(t);
  const result = evaluateDesign({ repoRoot: root, design: design({ mode: 'enforce' }), results: passedResults(allTcs(root), { 'TC-USER-011': 'failed' }),
    evidence: { manual: { 'ADV-USER-001': 'passed' }, reviews: {}, issues: [] } });
  assert.ok(result.blocks.some((item) => item.code === 'DESIGN_TC_UNPROVEN' && item.subject === 'ADV-USER-001'));
});

test('E1–E5 real CLI binds clean HEAD and rejects automatic subjects and unknown changes', (t) => {
  const input = fixture(t);
  const doc = compliantDesign();
  doc.rules[0][5] = 'manual';
  const history = makeHistory(t, [{ files: {
    'docs/prd-modules/user/PRD.md': prdDoc(COMPLIANT_PRD),
    'docs/qa-modules/user/TEST-DESIGN.md': designDoc(doc),
    'agent.config.json': JSON.stringify({ containerDirs: { tmp: input.directory, worktrees: path.join(path.dirname(input.directory), 'worktrees') } }),
  } }]);
  const cli = path.resolve(__dirname, '..', 'qa-design.js');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: history.root, encoding: 'utf8' });
  const args = ['attest', '--kind', 'manual', '--id', 'RUL-USER-001', '--outcome', 'skipped', '--reviewer', 'QA', '--environment', 'fixture', '--reason', 'not run', '--evidence', input.evidence];
  const recorded = run(...args);
  assert.equal(recorded.status, 0, recorded.stdout + recorded.stderr);
  assert.match(recorded.stdout, /DESIGN_EVIDENCE_RECEIPT=/u);
  const skipped = run('check', '--base', 'HEAD');
  assert.equal(skipped.status, 0, skipped.stdout + skipped.stderr);
  assert.match(skipped.stdout, /RULES_VERIFIED=0/u);
  const passed = run(...args.map((arg) => arg === 'skipped' ? 'passed' : arg));
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  const verified = run('check', '--base', 'HEAD');
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  assert.match(verified.stdout, /RULES_VERIFIED=1/u);
  git(history.root, ['commit', '--allow-empty', '-m', 'new delivery head']);
  const stale = run('check', '--base', 'HEAD');
  assert.match(stale.stdout, /RULES_VERIFIED=0/u);
  assert.match(stale.stdout, /DESIGN_EVIDENCE_INVALID/u);
  const unknown = run(...args.map((arg) => arg === 'RUL-USER-001' ? 'RUL-UNKNOWN-999' : arg));
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stdout, /仅允许人工/u);
  const review = run('attest', '--kind', 'review', '--id', 'RUL-USER-001', '--change', '0'.repeat(64), '--outcome', 'passed', '--reviewer', 'QA', '--environment', 'fixture', '--reason', 'review', '--evidence', input.evidence);
  assert.notEqual(review.status, 0);
  assert.match(review.stdout, /找不到匹配摘要/u);
  fs.writeFileSync(path.join(history.root, 'dirty.txt'), 'uncommitted');
  const dirty = run(...args);
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stdout, /干净工作区/u);
});

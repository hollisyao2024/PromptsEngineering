'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkMergeEvidence, resolveMergeEvidenceConfig } = require('../merge-evidence');
const { runPreMergeChecks } = require('../qa-merge');

const defect = (status = 'Open', title = 'historical') => `| Bug ID | Title | Severity | Status |\n| --- | --- | --- | --- |\n| BUG-TEST-001 | ${title} | P0 | ${status} |\n`;
const nfr = (status = '❌ 未达标') => `| NFR ID | 指标 | 状态 |\n| --- | --- | --- |\n| NFR-TEST-001 | latency | ${status} |\n`;
function fixture(t, options = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-evidence-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = args => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  git(['init']); git(['config','user.name','Fixture']); git(['config','user.email','fixture@example.invalid']);
  const write = (file, content) => { const target = path.join(cwd, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
  const dir = options.qaModulesDir || 'docs/qa-modules';
  const metric = options.nfrTrackingFile || 'docs/data/nfr-tracking.md';
  write(`${dir}/test/defect-log.md`, defect()); write(metric, nfr());
  const commit = () => { git(['add','.']); git(['commit','--allow-empty','-qm','fixture']); return git(['rev-parse','HEAD']); };
  const baseSha = commit();
  return { cwd, git, write, commit, baseSha, defectFile: `${dir}/test/defect-log.md`, metric,
    check: () => checkMergeEvidence({ cwd, baseSha, headSha: commit(), config: options }) };
}
test('TC041 strict default and invalid config fail closed', () => {
  assert.equal(resolveMergeEvidenceConfig().mode, 'strict');
  for (const config of [{mode:'allow'}, {mdoe:'fixed-commit'}, {qaModulesDir:'../docs'}, {qaModulesDir:':(glob)**'}, {nfrTrackingFile:'C:/temp.md'}, {qaModulesDir:'docs\\qa'}]) {
    assert.throws(() => resolveMergeEvidenceConfig(config));
  }
  const checkers = { parseDefects: () => [], analyzeDefects: () => ({p0Defects:[{bugId:'BUG-TEST-001'}],p1Open:[]}), checkNFRCompliance: () => ({sourceAvailable:true,nonCompliantNFRs:[],conditionalNFRs:[]}) };
  assert.equal(runPreMergeChecks({checkers}), false);
  assert.equal(runPreMergeChecks({checkers,scope:'project',config:{qa:{mergeEvidence:{mode:'fixed-commit'}}}}), false);
});
test('TC042 unchanged blockers integrate while release remains blocked', t => {
  const f = fixture(t); const result = f.check();
  assert.equal(result.gatePass,true); assert.equal(result.globalDecision.gatePass,false); assert.equal(result.retained.length,2);
  assert.equal(runPreMergeChecks({scope:'session',cwd:f.cwd,baseSha:f.baseSha,headSha:f.git(['rev-parse','HEAD']),config:{qa:{mergeEvidence:{mode:'fixed-commit'}}}}),true);
});
test('TC044 unrelated text and records do not change fingerprints', t => {
  const f=fixture(t); f.write(f.defectFile, '# new paragraph\n'+defect()+'| BUG-TEST-002 | unrelated | P2 | Closed |\n');
  f.write(f.metric, '# new paragraph\n'+nfr()+'| NFR-TEST-002 | throughput | ✅ 达标 |\n');
  assert.equal(f.check().gatePass,true);
});
test('TC044 changed blocker is blocked', t => {
  const f=fixture(t); f.write(f.defectFile,defect('In Progress')); assert.equal(f.check().gatePass,false);
});
test('TC042 new blocker is blocked', t => {
  const f=fixture(t); f.write(f.defectFile,defect()+'| BUG-TEST-002 | new | P0 | Open |\n'); assert.equal(f.check().gatePass,false);
});
test('TC043 removal without closure is blocked', t => {
  const f=fixture(t); f.write(f.defectFile,'# no records\n'); assert.match(f.check().blockers.join('\n'),/removed without closure/);
});
test('TC043 removed evidence file is blocked', t => {
  const f=fixture(t); fs.unlinkSync(path.join(f.cwd,f.defectFile)); assert.match(f.check().blockers.join('\n'),/Evidence removed/);
});
test('TC043 explicit closure succeeds and qualified closure stays blocked', t => {
  const f=fixture(t); f.write(f.defectFile,defect('Closed（待验证）')); assert.equal(f.check().gatePass,false);
  f.write(f.defectFile,defect('Closed')); f.write(f.metric,nfr('✅ 达标')); const result=f.check(); assert.equal(result.gatePass,true); assert.equal(result.globalDecision.gatePass,true);
});
test('TC043 no parseable NFR is rejected', t => {
  const f=fixture(t); f.write(f.metric,'# missing metrics\n'); assert.throws(f.check,/parseable NFR/);
});
test('TC042 duplicate sources aggregate worst classification', t => {
  const f=fixture(t); f.write('docs/qa-modules/other/nfr-tracking.md',nfr('✅ 达标')); assert.equal(f.check().globalDecision.gatePass,false);
});
test('TC042 configured paths and immutable blobs', t => {
  const f=fixture(t,{qaModulesDir:'quality/modules',nfrTrackingFile:'quality/metrics.md'}); const headSha=f.commit();
  f.write(f.defectFile,defect('Closed')); f.write(f.metric,nfr('✅ 达标'));
  const result=checkMergeEvidence({cwd:f.cwd,baseSha:f.baseSha,headSha,config:{qaModulesDir:'quality/modules',nfrTrackingFile:'quality/metrics.md'}});
  assert.equal(result.globalDecision.gatePass,false); assert.equal(result.gatePass,true);
  assert.throws(() => checkMergeEvidence({cwd:f.cwd,baseSha:'HEAD',headSha}));
});
const defectRow = (severity, status) => `| Bug ID | Title | Severity | Status |\n| --- | --- | --- | --- |\n| BUG-TEST-001 | historical | ${severity} | ${status} |\n`;
test('TC043 downgraded blocker without closure is blocked', t => {
  const f=fixture(t); f.write(f.defectFile,defectRow('P2','Open')); f.write(f.metric,nfr('✅ 达标'));
  assert.match(f.check().blockers.join('\n'),/BUG-TEST-001.*downgraded without closure|downgraded without closure.*BUG-TEST-001/);
});
test('TC043 NFR moved to conditional is not closure', t => {
  const f=fixture(t); f.write(f.defectFile,defect('Closed')); f.write(f.metric,nfr('⚠️ 条件通过'));
  assert.match(f.check().blockers.join('\n'),/downgraded without closure: NFR-TEST-001/);
});
test('TC043 downgraded and explicitly closed defect passes', t => {
  const f=fixture(t); f.write(f.defectFile,defectRow('P2','Closed')); f.write(f.metric,nfr('✅ 达标'));
  assert.equal(f.check().gatePass,true);
});
test('TC042 P1 release warnings follow strict status buckets', t => {
  const f=fixture(t); f.write(f.defectFile,defect()+'| BUG-TEST-002 | p1 | P1 | In Progress |\n');
  const warnings=f.check().globalDecision.warningIssues.join('\n');
  assert.match(warnings,/1 个 P1 缺陷修复中/); assert.doesNotMatch(warnings,/P1 缺陷未修复/);
});
test('TC041 strict mode reads configured evidence paths', t => {
  const f=fixture(t,{qaModulesDir:'quality/modules',nfrTrackingFile:'quality/metrics.md'});
  const config={qa:{mergeEvidence:{qaModulesDir:'quality/modules',nfrTrackingFile:'quality/metrics.md'}}};
  assert.equal(runPreMergeChecks({scope:'project',cwd:f.cwd,config}),false);
  f.write(f.defectFile,defect('Closed')); f.write(f.metric,nfr('✅ 达标'));
  assert.equal(runPreMergeChecks({scope:'project',cwd:f.cwd,config}),true);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const checker = require('../check-defect-blockers');
const { runPreMergeChecks } = require('../qa-merge');
const table = (status, id = 'NFR-TEST-001') => `| NFR | 指标 | 状态 |\n|---|---|---|\n| ${id} | evidence | ${status} |\n`;

test('annotated Closed is not Open, but partial closure remains a release blocker', () => {
  const content = '| 缺陷 ID | 问题 | 严重度 | 状态 |\n|---|---|---|---|\n| BUG-TEST-001 | sample | P0 | Closed（代码集成；真机待验） |';
  const [defect] = checker.parseDefectContent(content, 'test');
  assert.equal(defect.status, 'Closed');
  assert.equal(defect.title, 'sample');
  assert.equal(defect.validationPending, true);
  assert.equal(defect.rawStatus, 'Closed（代码集成；真机待验）');
  const analysis = checker.analyzeDefects([defect]);
  assert.equal(analysis.p0Defects.length, 0);
  assert.equal(analysis.p0ValidationPending.length, 1);
  assert.equal(checker.determineReleaseDecision(analysis, {sourceAvailable:true}).gatePass, false);
});

test('unknown Closed-like strings never normalize to a closed defect', () => {
  for (const status of ['Closed-ish', 'not Closed', 'Closed（unfinished', 'Closed（ok） trailing']) {
    const [d] = checker.parseDefectContent(`| Bug ID | Status | Severity |\n|---|---|---|\n| BUG-TEST-001 | ${status} | P0 |`, 'test');
    assert.equal(d.status, 'Open');
  }
});

test('NFR aliases, named metrics, limitations and follow-up gates remain visible', () => {
  assert.equal(checker.parseNFRCompliance(table('Pass')).compliantCount, 1);
  assert.equal(checker.parseNFRCompliance(table('External Gate')).conditionalNFRs.length, 1);
  for (const state of ['不通过', '不达标', 'not compliant']) {
    assert.equal(checker.parseNFRCompliance(table(state)).nonCompliantNFRs.length, 1, state);
  }
  for (const state of ['部分达标', '自动化达标；目标待重验', 'PASS；生产负载未验', 'incomplete', 'not passed']) {
    assert.equal(checker.parseNFRCompliance(table(state)).compliantCount, 0, state);
  }
  const named = '| 指标类别 | 子指标 | 状态 | 后续 Gate |\n|---|---|---|---|\n| 安全 | 本地重锁 | PASS | 真机复验 |';
  const result = checker.parseNFRCompliance(named);
  assert.equal(result.totalCount, 1);
  assert.equal(result.conditionalNFRs.length, 1);
  assert.equal(result.conditionalNFRs[0].followUpGate, '真机复验');
});

test('module NFR evidence is read even without a global file; conflicts fail closed', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-evidence-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const modules = path.join(dir, 'qa-modules');
  fs.mkdirSync(path.join(modules, 'one'), {recursive:true});
  fs.writeFileSync(path.join(modules, 'one/nfr-tracking.md'), table('PASS'));
  const options = {qaModulesDir:modules,nfrTrackingPath:path.join(dir,'global.md')};
  let result = checker.checkNFRCompliance(options);
  assert.equal(result.sourceAvailable, true);
  assert.equal(result.totalCount, 1);
  assert.equal(result.compliantNFRs[0].sources.length, 1);
  fs.writeFileSync(options.nfrTrackingPath, table('❌ Failed'));
  result = checker.checkNFRCompliance(options);
  assert.equal(result.nonCompliantNFRs.length, 1);
  assert.equal(result.nonCompliantNFRs[0].sources.length, 2);
  fs.mkdirSync(path.join(modules,'empty'));
  fs.writeFileSync(path.join(modules,'empty/nfr-tracking.md'),'# No evidence');
  assert.equal(checker.checkNFRCompliance(options).sourceAvailable, false);
});

test('merge gate uses the same missing-evidence and conditional semantics as CLI', () => {
  const fake = {parseDefects:()=>[],analyzeDefects:()=>({p0Defects:[]}),checkNFRCompliance:()=>({sourceAvailable:false})};
  assert.equal(runPreMergeChecks({checkers:fake}), false);
  fake.checkNFRCompliance=()=>({sourceAvailable:true,conditionalNFRs:[{nfrId:'NFR-TEST-001'}]});
  assert.equal(runPreMergeChecks({checkers:fake}), true);
});

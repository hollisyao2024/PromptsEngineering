'use strict';

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { moreBlockingStatus, parseDefectContent, parseNFRCompliance, determineReleaseDecision } = require('./check-defect-blockers');
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const rank = { compliant: 2, conditional: 1, nonCompliant: 0 };
const digest = value => createHash('sha256').update(value).digest('hex');
// Only an explicit closure resolves a blocker; a severity or classification downgrade does not.
const isClosed = record => record.classification ? record.classification === 'compliant' : !record.open && !record.validationPending;

function resolveMergeEvidenceConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid qa.mergeEvidence configuration');
  if (Object.keys(input).some(key => !['mode', 'qaModulesDir', 'nfrTrackingFile'].includes(key))) throw new Error('Unknown qa.mergeEvidence configuration field');
  const config = { mode: 'strict', qaModulesDir: 'docs/qa-modules', nfrTrackingFile: 'docs/data/nfr-tracking.md', ...input };
  if (!['strict', 'fixed-commit'].includes(config.mode)) throw new Error('Invalid qa.mergeEvidence.mode');
  for (const key of ['qaModulesDir', 'nfrTrackingFile']) {
    const value = config[key];
    if (typeof value !== 'string' || !value || !/^[A-Za-z0-9_.\/-]+$/u.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Invalid repository-relative evidence path: ' + key);
    }
  }
  return config;
}

function readSnapshot(cwd, sha, options = {}) {
  if (!SHA.test(sha || '')) throw new Error('Merge evidence requires full fixed SHA values');
  const config = resolveMergeEvidenceConfig(options);
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const prefix = config.qaModulesDir + '/';
  const files = git(['ls-tree', '-r', '--name-only', '-z', sha, '--', config.qaModulesDir, config.nfrTrackingFile])
    .split('\0').filter(file => file === config.nfrTrackingFile || (file.startsWith(prefix) && /^[^/]+\/(?:QA|defect-log|nfr-tracking)\.md$/u.test(file.slice(prefix.length)))).sort();
  if (!files.length) throw new Error('Missing QA/NFR evidence in fixed commit');
  const defects = new Map();
  const metrics = new Map();
  let nfrFiles = 0;
  for (const file of files) {
    // Read immutable blobs; a source fingerprint represents one record, never the whole file.
    const content = git(['show', sha + ':' + file]);
    if (file === config.nfrTrackingFile || file.endsWith('/nfr-tracking.md')) {
      nfrFiles++;
      const parsed = parseNFRCompliance(content);
      if (!parsed.totalCount) throw new Error('No parseable NFR evidence: ' + file);
      for (const item of [...parsed.compliantNFRs, ...parsed.conditionalNFRs, ...parsed.nonCompliantNFRs]) {
        const { line, ...semantic } = item;
        const source = { file, hash: digest(JSON.stringify(semantic)) };
        const key = /^NFR-[A-Z0-9-]+$/u.test(item.nfrId) ? item.nfrId : file + ':' + item.nfrId;
        const current = metrics.get(key);
        const worst = !current || rank[item.classification] < rank[current.classification] ? semantic : current;
        metrics.set(key, { ...worst, key, sources: [...(current?.sources || []), source] });
      }
    } else {
      const moduleName = file.slice(prefix.length).split('/')[0];
      for (const item of parseDefectContent(content, moduleName)) {
        const source = { file, hash: digest(JSON.stringify(item)) };
        const key = moduleName + ':' + item.bugId;
        const current = defects.get(key);
        defects.set(key, {
          key, bugId: item.bugId,
          severity: current && current.severity < item.severity ? current.severity : item.severity,
          status: current ? moreBlockingStatus(current.status, item.status) : item.status,
          open: Boolean(current?.open || item.status !== 'Closed'),
          validationPending: Boolean(current?.validationPending || item.validationPending),
          sources: [...(current?.sources || []), source],
        });
      }
    }
  }
  if (!nfrFiles) throw new Error('Missing NFR evidence in fixed commit');
  const allDefects = [...defects.values()];
  const allMetrics = [...metrics.values()];
  const p0Defects = allDefects.filter(d => d.severity === 'P0' && d.open);
  const p0ValidationPending = allDefects.filter(d => d.severity === 'P0' && !d.open && d.validationPending);
  const nonCompliantNFRs = allMetrics.filter(n => n.classification === 'nonCompliant');
  const conditionalNFRs = allMetrics.filter(n => n.classification === 'conditional');
  const globalDecision = determineReleaseDecision({
    p0Defects, p0ValidationPending,
    p1Open: allDefects.filter(d => d.severity === 'P1' && d.status === 'Open'),
    p1InProgress: allDefects.filter(d => d.severity === 'P1' && d.status === 'In Progress'),
  }, { sourceAvailable: true, nonCompliantNFRs, conditionalNFRs });
  const records = new Map([...allDefects, ...allMetrics].map(item => [item.key, item]));
  const blockers = new Map([...p0Defects, ...p0ValidationPending, ...nonCompliantNFRs].map(item => [item.key, digest(JSON.stringify(item))]));
  return { files, records, blockers, globalDecision };
}

function checkMergeEvidence({ cwd, baseSha, headSha, config = {} }) {
  const base = readSnapshot(cwd, baseSha, config);
  const head = readSnapshot(cwd, headSha, config);
  const blockers = base.files.filter(file => !head.files.includes(file)).map(file => 'Evidence removed: ' + file);
  for (const key of base.blockers.keys()) {
    if (!head.records.has(key)) blockers.push('Blocking record removed without closure: ' + key);
    else if (!head.blockers.has(key) && !isClosed(head.records.get(key))) blockers.push('Blocking record downgraded without closure: ' + key);
  }
  const retained = [];
  for (const [key, fingerprint] of head.blockers) {
    if (base.blockers.get(key) === fingerprint) retained.push(key);
    else blockers.push('New or changed blocking evidence: ' + key);
  }
  return { gatePass: blockers.length === 0, blockers, retained, globalDecision: head.globalDecision };
}
module.exports = { checkMergeEvidence, readSnapshot, resolveMergeEvidenceConfig };

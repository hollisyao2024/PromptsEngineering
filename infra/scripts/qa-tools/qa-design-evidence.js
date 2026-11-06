'use strict';

// Append-only receipt chain. Hashes detect drift; they do not authenticate a human observation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BYTES = 16 * 1024 * 1024;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const changeDigest = (change) => sha256(JSON.stringify([change.date, change.id, change.change, change.reason, change.reviewer]));
const subjectKey = (record) => `${record.kind}:${record.id}:${record.change || ''}`;
const bindingValid = (binding) => binding && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(binding.head)
  && typeof binding.worktree === 'string' && path.isAbsolute(binding.worktree)
  && /^[a-f0-9]{64}$/u.test(binding.context) && /^[a-f0-9]{64}$/u.test(binding.config)
  && Object.keys(binding).sort().join(',') === 'config,context,head,worktree';

function regularBytes(file, limit = MAX_BYTES) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.size > limit) throw new Error('证据必须为非空、大小受限的普通文件');
  // O_NOFOLLOW closes the final-component link race where supported.
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const bytes = fs.readFileSync(fd);
    if (!bytes.length || bytes.length > limit) throw new Error('证据文件大小非法');
    return bytes;
  } finally { fs.closeSync(fd); }
}

function checkDirectory(directory, create = false) {
  // Reject links in every existing path component, including a dangling final link.
  let current = path.resolve(directory);
  let exists = true;
  for (;;) {
    let info;
    try { info = fs.lstatSync(current); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      exists = false;
    }
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('回执目录不可为链接或文件');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!exists && create) fs.mkdirSync(directory, { recursive: true });
  if (!exists && !create) return false;
  return true;
}

function loadChain(directory) {
  if (!checkDirectory(directory)) return [];
  const entries = fs.readdirSync(directory);
  const names = entries.filter((name) => name.endsWith('.json')).sort();
  const checksums = entries.filter((name) => name.endsWith('.sha256')).sort();
  if (JSON.stringify(checksums) !== JSON.stringify(names.map((name) => `${name}.sha256`))) throw new Error('回执或摘要文件缺失');
  const chain = [];
  let previous = null;
  for (const [index, name] of names.entries()) {
    if (name !== `${String(index + 1).padStart(12, '0')}.json`) throw new Error('回执序号缺失或非法');
    const bytes = regularBytes(path.join(directory, name), 64 * 1024);
    const checksum = regularBytes(path.join(directory, `${name}.sha256`), 128).toString('utf8');
    if (checksum !== `${sha256(bytes)}\n`) throw new Error('回执摘要不一致');
    const record = JSON.parse(bytes);
    const keys = 'binding,change,environment,evidence,id,kind,outcome,previous,reason,reviewer,sequence,version';
    if (Object.keys(record).sort().join(',') !== keys || record.version !== 1 || record.sequence !== index + 1 || record.previous !== previous
      || !bindingValid(record.binding) || !['manual', 'review'].includes(record.kind)
      || !/^(RUL|ADV|BUG)-[A-Z0-9-]+$/u.test(record.id) || !['passed', 'failed', 'skipped'].includes(record.outcome)
      || ![record.reviewer, record.environment, record.reason].every((value) => typeof value === 'string' && value.trim() && value.length <= 4000)
      || record.reviewer.trim() === '待评审'
      || (record.kind === 'review' ? !/^[a-f0-9]{64}$/u.test(record.change) : record.change !== null)
      || !record.evidence || Object.keys(record.evidence).sort().join(',') !== 'file,sha256'
      || !/^[a-f0-9-]+\.evidence$/u.test(record.evidence.file)
      || !/^[a-f0-9]{64}$/u.test(record.evidence.sha256)) throw new Error('回执结构或历史链非法');
    const evidence = regularBytes(path.join(directory, record.evidence.file));
    if (sha256(evidence) !== record.evidence.sha256) throw new Error('证据摘要不一致');
    previous = sha256(bytes);
    chain.push({ record, digest: previous });
  }
  return chain;
}

function appendReceipt({ directory, binding, evidence, kind, id, change = null, outcome, reviewer, environment, reason }) {
  if (!bindingValid(binding) || !['manual', 'review'].includes(kind) || !/^(RUL|ADV|BUG)-[A-Z0-9-]+$/u.test(id)
    || !['passed', 'failed', 'skipped'].includes(outcome)
    || ![reviewer, environment, reason].every((value) => typeof value === 'string' && value.trim() && value.length <= 4000)
    || reviewer.trim() === '待评审' || (kind === 'review' ? !/^[a-f0-9]{64}$/u.test(change) : change !== null)) throw new Error('回执参数非法');
  const bytes = regularBytes(evidence);
  checkDirectory(directory, true);
  const chain = loadChain(directory);
  const sequence = chain.length + 1;
  const evidenceName = `${crypto.randomUUID()}.evidence`;
  const record = { version: 1, sequence, previous: chain.at(-1)?.digest || null, binding, kind, id, change, outcome, reviewer, environment, reason,
    evidence: { file: evidenceName, sha256: sha256(bytes) } };
  fs.writeFileSync(path.join(directory, evidenceName), bytes, { flag: 'wx', mode: 0o600 });
  const target = path.join(directory, `${String(sequence).padStart(12, '0')}.json`);
  // Exclusive create makes competing writers fail instead of overwriting history.
  const content = `${JSON.stringify(record)}\n`;
  fs.writeFileSync(target, content, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(`${target}.sha256`, `${sha256(content)}\n`, { flag: 'wx', mode: 0o600 });
  return target;
}

function readReceipts(directory, binding) {
  const empty = () => ({ manual: {}, reviews: {}, issues: [] });
  try {
    const result = empty();
    const latest = new Map(loadChain(directory).map(({ record }) => [subjectKey(record), record]));
    for (const record of latest.values()) {
      if (JSON.stringify(record.binding) !== JSON.stringify(binding)) {
        result.issues.push(`STALE:${record.id}`);
        continue;
      }
      if (record.kind === 'manual') result.manual[record.id] = record.outcome;
      else result.reviews[record.change] = record.outcome;
    }
    return result;
  } catch (error) {
    return { ...empty(), issues: [`INVALID:${error.message}`] };
  }
}

module.exports = { appendReceipt, changeDigest, readReceipts, sha256 };

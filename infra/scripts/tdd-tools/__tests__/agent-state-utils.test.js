'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseInProgress,
  writeInProgressFields,
  clearInProgress,
  clearInProgressContent,
} = require('../agent-state-utils');

function fixture(t, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-state-doc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'AGENT_STATE.md');
  if (content !== undefined) fs.writeFileSync(file, content);
  return file;
}

for (const eol of ['\n', '\r\n']) {
  test(`empty legacy fields never consume the next line (${JSON.stringify(eol)})`, () => {
    const before = ['## IN_PROGRESS', 'branch:', 'pr: 42', 'step: qa', 'started_at:', ''].join(eol);
    const after = ['## IN_PROGRESS', 'branch:', 'pr: ', 'step: ', 'started_at:', ''].join(eol);
    assert.deepEqual(parseInProgress(before), { branch: '', pr: '42', step: 'qa', started_at: '' });
    assert.equal(clearInProgressContent(before), after);
    assert.equal(clearInProgressContent(after), after);
  });
}

test('legacy read/write/clear preserve fields before and after the exact section', (t) => {
  const prefix = '# State\n\n## Metadata\nbranch: release-channel\npr: 99\n\n';
  const suffix = '\n## Later\nbranch: docs\npr: 100\nstep: keep\nstarted_at: keep\n';
  const section = '## IN_PROGRESS\nbranch: feature/current\npr: 42\nstep: qa\nstarted_at: yesterday\n';
  const file = fixture(t, prefix + section + suffix);
  assert.deepEqual(parseInProgress(prefix + section + suffix), { branch: 'feature/current', pr: '42', step: 'qa', started_at: 'yesterday' });
  writeInProgressFields(file, { branch: 'codex/next', pr: '43' });
  assert.equal(fs.readFileSync(file, 'utf8'), prefix + section.replace('feature/current', 'codex/next').replace('42', '43') + suffix);
  clearInProgress(file);
  assert.equal(fs.readFileSync(file, 'utf8'), prefix + '## IN_PROGRESS\nbranch: \npr: \nstep: \nstarted_at: \n' + suffix);
});

test('fields in a later subsection cannot supply missing legacy values', () => {
  const content = '## IN_PROGRESS\nbranch: feature/current\n\n### Notes\npr: 200\nstep: keep\n';
  assert.deepEqual(parseInProgress(content), { branch: 'feature/current', pr: '', step: '', started_at: '' });
  assert.equal(clearInProgressContent(content), content.replace('branch: feature/current', 'branch: '));
});

test('code fences, comments and indented examples cannot declare a legacy section', (t) => {
  const examples = '```md\n## IN_PROGRESS\nbranch: fenced\n```\n\n~~~md\n## IN_PROGRESS\nbranch: tilde\n~~~\n\n<!--\n## IN_PROGRESS\nbranch: commented\n-->\n\n    ## IN_PROGRESS\n    branch: indented\n';
  const file = fixture(t, examples);
  const writes = t.mock.method(fs, 'writeFileSync');
  assert.equal(parseInProgress(examples), null);
  writeInProgressFields(file, { branch: 'codex/new' });
  clearInProgress(file);
  assert.equal(writes.mock.callCount(), 0);
  assert.equal(fs.readFileSync(file, 'utf8'), examples);
});

test('fenced examples inside a legacy section are retained', (t) => {
  const examples = '````md\nbranch: example\n```\npr: 99\n````\n\n';
  const before = '## IN_PROGRESS\n' + examples + 'branch: feature/real\npr: 42\n';
  assert.deepEqual(parseInProgress(before), { branch: 'feature/real', pr: '42', step: '', started_at: '' });
  const file = fixture(t, before);
  writeInProgressFields(file, { pr: '43' });
  clearInProgress(file);
  assert.equal(fs.readFileSync(file, 'utf8'), '## IN_PROGRESS\n' + examples + 'branch: \npr: \n');
});

test('legacy file updates preserve CRLF, literal replacement characters and EOF', (t) => {
  const before = '## IN_PROGRESS\r\nbranch: old\r\npr: 42';
  const file = fixture(t, before);
  writeInProgressFields(file, { branch: 'codex/$&-$$' });
  const updated = '## IN_PROGRESS\r\nbranch: codex/$&-$$\r\npr: 42';
  assert.equal(fs.readFileSync(file, 'utf8'), updated);
  const writes = t.mock.method(fs, 'writeFileSync');
  writeInProgressFields(file, { branch: 'codex/$&-$$' });
  assert.equal(writes.mock.callCount(), 0);
  clearInProgress(file);
  clearInProgress(file);
  assert.equal(writes.mock.callCount(), 1);
});

test('missing files and documents without a legacy section remain untouched', (t) => {
  const file = fixture(t);
  writeInProgressFields(file, { branch: 'codex/new' });
  clearInProgress(file);
  assert.equal(fs.existsSync(file), false);
  const content = 'branch: project-metadata\n## IN_PROGRESS_EXAMPLE\npr: 42\n';
  fs.writeFileSync(file, content);
  assert.equal(parseInProgress(content), null);
  clearInProgress(file);
  assert.equal(fs.readFileSync(file, 'utf8'), content);
});

test('ambiguous legacy sections and multiline field updates fail before file changes', (t) => {
  const ambiguous = '## IN_PROGRESS\nbranch: first\n\n## IN_PROGRESS\nbranch: second\n';
  const file = fixture(t, ambiguous);
  assert.throws(() => clearInProgress(file), /multiple IN_PROGRESS/i);
  assert.equal(fs.readFileSync(file, 'utf8'), ambiguous);
  const valid = '## IN_PROGRESS\nbranch: first\n';
  fs.writeFileSync(file, valid);
  assert.throws(() => writeInProgressFields(file, { branch: 'first\npr: injected' }), /single line/i);
  assert.equal(fs.readFileSync(file, 'utf8'), valid);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTemplate } = require('../../../../tooling/xirang/template');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xirang-next-action-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), target = path.join(root, 'project');
  const put = (base, file, text) => { fs.mkdirSync(path.dirname(path.join(base, file)), { recursive: true }); fs.writeFileSync(path.join(base, file), text); };
  put(source, 'infra/templates/agent/template.manifest.json', `${JSON.stringify({ template: { id: 'xirang' }, templateVersion: '1', rules: [{ path: 'owned', strategy: 'overwrite' }] }, null, 2)}\n`);
  put(source, 'owned/a.txt', 'upstream\n');
  fs.mkdirSync(target);
  return { source, target, putTarget: (file, text) => put(target, file, text) };
}

// Runs the command the way an operator does and keeps only what it prints.
function run(f, args = {}) {
  const lines = [], log = console.log, exitCode = process.exitCode;
  console.log = (...parts) => lines.push(parts.join(' '));
  try { runTemplate(args, f.source, f.target); } finally { console.log = log; process.exitCode = exitCode; }
  const text = lines.join('\n');
  return { status: /^STATUS=(.+)$/mu.exec(text)?.[1], next: /^NEXT_ACTION=(.+)$/mu.exec(text)?.[1] };
}

test('NEXT_ACTION follows the plan state: apply, converge, then nothing left to do', t => {
  const f = fixture(t);

  const planned = run(f);
  assert.equal(planned.status, 'DRY_RUN');
  assert.match(planned.next, /--write/u);
  assert.doesNotMatch(planned.next, /conflict|adopt|baseline/iu);

  const applied = run(f, { write: true });
  assert.equal(applied.status, 'UPDATED');
  assert.match(applied.next, /convergence/iu);
  assert.doesNotMatch(applied.next, /conflict|adopt|baseline/iu);

  const settled = run(f);
  assert.equal(settled.status, 'DRY_RUN');
  assert.match(settled.next, /no changes/iu);
  assert.doesNotMatch(settled.next, /--write|conflict|adopt|baseline/iu);
});

test('NEXT_ACTION on a blocked plan points at adopt or a reviewed legacy baseline', t => {
  const f = fixture(t);
  f.putTarget('owned/a.txt', 'local divergence\n');
  const blocked = run(f);
  assert.equal(blocked.status, 'BLOCKED');
  assert.match(blocked.next, /adopt/iu);
  assert.match(blocked.next, /legacy baseline/iu);
  assert.doesNotMatch(blocked.next, /--write/u);
});

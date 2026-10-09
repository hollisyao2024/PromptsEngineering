'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runArchitectureCheck } = require('../architecture-check');

function fixture(t, files = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'xirang-arch-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

const failingChecker = (failures, warnings = []) => `module.exports = { checkProject: () => (${JSON.stringify({
  status: failures.length ? 'FAILED' : 'OK', failures, warnings,
})}) };\n`;

// The architecture gate is shared by tdd sync and qa verify. Its errors carry a stable code so both callers can
// print STATUS=BLOCKED / REASON=<code> / NEXT_ACTION instead of an UNEXPECTED_ERROR stack.
test('architecture check skips projects without architecture.config.json', (t) => {
  const root = fixture(t);
  assert.deepEqual(runArchitectureCheck(root), { status: 'SKIPPED', reason: 'project has not selected architecture' });
});

test('architecture check reports a missing architecture package with code ARCHITECTURE_PACKAGE_MISSING', (t) => {
  const root = fixture(t, { 'architecture.config.json': '{}\n' });
  assert.throws(() => runArchitectureCheck(root), (error) => {
    assert.equal(error.code, 'ARCHITECTURE_PACKAGE_MISSING');
    assert.match(error.message, /architecture package is missing/);
    assert.match(error.nextAction, /template sync --include architecture/);
    return true;
  });
});

test('architecture check reports failing checks with code ARCHITECTURE_CHECK_FAILED and keeps warnings advisory', (t) => {
  const root = fixture(t, {
    'architecture.config.json': '{}\n',
    'architecture/checks/project-check.js': failingChecker(
      [{ name: 'shadcn-ui', reason: 'components.json missing' }],
      [{ name: 'design-md', code: 'DESIGN_MD_DRIFT', reason: 'radius differs\nfrom styles.css' }],
    ),
  });
  const warnings = [];
  assert.throws(() => runArchitectureCheck(root, { warn: (line) => warnings.push(line) }), (error) => {
    assert.equal(error.code, 'ARCHITECTURE_CHECK_FAILED');
    assert.match(error.message, /Architecture check failed: shadcn-ui: components\.json missing/);
    assert.match(error.nextAction, /architecture check/);
    return true;
  });
  assert.deepEqual(warnings, ['ARCHITECTURE_WARNING=design-md|DESIGN_MD_DRIFT|radius differs from styles.css']);

  const ok = fixture(t, { 'architecture.config.json': '{}\n', 'architecture/checks/project-check.js': failingChecker([]) });
  assert.equal(runArchitectureCheck(ok).status, 'OK');
});

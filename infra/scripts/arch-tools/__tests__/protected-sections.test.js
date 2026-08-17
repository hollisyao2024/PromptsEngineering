'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  replaceGeneratedContentPreservingProtectedSections,
} = require('../protected-sections');

const start = '<!-- PHASE16-PROTECTED-START -->';
const end = '<!-- PHASE16-PROTECTED-END -->';

test('generated reports preserve existing named protected blocks', () => {
  const existing = `# Report\n\n${start}\nmanual evidence\n${end}\n\nold generated\n`;
  const generated = `# Report\n\n${start}\nplaceholder\n${end}\n\nnew generated\n`;

  const output = replaceGeneratedContentPreservingProtectedSections(existing, generated);

  assert.match(output, /manual evidence/);
  assert.doesNotMatch(output, /placeholder/);
  assert.match(output, /new generated/);
});

test('protected blocks are injected after the heading when generated output has no placeholder', () => {
  const existing = `# Report\n\n${start}\nmanual evidence\n${end}\n`;
  const generated = '# Report\n\nnew generated\n';

  const output = replaceGeneratedContentPreservingProtectedSections(existing, generated);

  assert.equal(output.indexOf(start) > output.indexOf('# Report'), true);
  assert.equal(output.indexOf(start) < output.indexOf('new generated'), true);
});

test('protected section replacement fails closed on malformed markers or unprotected required content', () => {
  assert.throws(
    () => replaceGeneratedContentPreservingProtectedSections(
      '# Report\n\n<!-- PHASE16-PROTECTED-END -->\n',
      '# Report\n',
    ),
    /END without START/i
  );
  assert.throws(
    () => replaceGeneratedContentPreservingProtectedSections(
      '# Report\n\nPhase 16 evidence without markers\n',
      '# Report\n',
      { requiredContentPattern: /Phase 16/ },
    ),
    /no protected section markers/i
  );
});

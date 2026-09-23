'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(repoRoot, relativePath));

test('AGENT_STATE is removed from the template and runtime writers stay absent', () => {
  assert.equal(exists('docs/AGENT_STATE.md'), false);
  assert.equal(exists('docs/data/templates/core/AGENT_STATE-TEMPLATE.md'), false);
  assert.equal(exists('infra/scripts/tdd-tools/agent-state-utils.js'), false);
  assert.equal(exists('infra/scripts/shared/agent-state-doc.js'), false);
});

test('template-owned docs and tools do not route milestone state through AGENT_STATE', () => {
  const paths = [
    'AGENTS.md',
    'docs/CONVENTIONS.md',
    'AgentRoles/PRD-WRITER-EXPERT.md',
    'AgentRoles/ARCHITECTURE-WRITER-EXPERT.md',
    'AgentRoles/TASK-PLANNING-EXPERT.md',
    'AgentRoles/TDD-PROGRAMMING-EXPERT.md',
    'AgentRoles/QA-TESTING-EXPERT.md',
    'AgentRoles/DEVOPS-ENGINEERING-EXPERT.md',
    'AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md',
    'AgentRoles/Handbooks/DEVOPS-ENGINEERING-EXPERT.playbook.md',
    'infra/scripts/tdd-tools/tdd-push.js',
    'infra/scripts/qa-tools/generate-qa.js',
    'infra/scripts/qa-tools/qa-verify.js',
    'infra/scripts/qa-tools/qa-merge.js',
    'infra/scripts/task-tools/generate-task.js',
    'infra/scripts/task-tools/README.md',
  ];
  for (const relativePath of paths) {
    assert.doesNotMatch(
      read(relativePath),
      /AGENT_STATE|agent-state-utils|writeInProgressFields|clearInProgress(?:Content)?|## IN_PROGRESS/u,
      `${relativePath} still references removed runtime state`,
    );
  }
});

test('shared Markdown parser is read-only and independent of removed state', () => {
  assert.equal(exists('infra/scripts/shared/markdown-document.js'), true);
  const parser = read('infra/scripts/shared/markdown-document.js');
  assert.match(parser, /scanMarkdownDocument/u);
  assert.doesNotMatch(parser, /writeFile|appendFile|AGENT_STATE/u);
});

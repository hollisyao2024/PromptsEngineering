'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  applyRule,
  deepMerge,
  isPlainObject,
  mergeJson,
  removePath,
} = require('../template-apply-engine');

const { mkTmpDir, writeJson } = require('./template-apply-engine.helpers');

test('isPlainObject detects plain objects only', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject('s'), false);
  assert.equal(isPlainObject(0), false);
  assert.equal(isPlainObject(undefined), false);
});

test('deepMerge fills missing keys and records added paths', () => {
  const target = { projectName: 'my-app', commands: { lint: 'eslint' } };
  const source = { projectName: 'template', commands: { lint: 'pnpm lint', test: 'pnpm test' }, baseBranch: 'main' };
  const { merged, addedKeys, conflicts } = deepMerge(target, source);
  assert.equal(merged.projectName, 'my-app', 'target scalar preserved');
  assert.equal(merged.commands.lint, 'eslint', 'nested target scalar preserved');
  assert.equal(merged.commands.test, 'pnpm test', 'nested missing key filled');
  assert.equal(merged.baseBranch, 'main', 'top-level missing key filled');
  assert.deepEqual(addedKeys.sort(), ['baseBranch', 'commands.test'].sort());
  assert.deepEqual(conflicts, []);
});

test('deepMerge keeps target arrays intact (project-priority)', () => {
  const target = { allowList: ['a'], emptyList: [], nested: { items: [1, 2] } };
  const source = { allowList: ['b', 'c'], emptyList: [99], nested: { items: [9] } };
  const { merged, addedKeys, conflicts } = deepMerge(target, source);
  assert.deepEqual(merged.allowList, ['a']);
  assert.deepEqual(merged.emptyList, []);
  assert.deepEqual(merged.nested.items, [1, 2]);
  assert.deepEqual(addedKeys, []);
  assert.deepEqual(conflicts, []);
});

test('deepMerge records type conflicts (object vs non-object)', () => {
  const target = { devops: 'disabled' };
  const source = { devops: { commands: {} } };
  const { merged, addedKeys, conflicts } = deepMerge(target, source);
  assert.equal(merged.devops, 'disabled');
  assert.deepEqual(addedKeys, []);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].path, 'devops');
});

test('deepMerge does not delete keys absent in source', () => {
  const target = { custom: 'mine', shared: 1 };
  const source = { shared: 2 };
  const { merged } = deepMerge(target, source);
  assert.equal(merged.custom, 'mine');
  assert.equal(merged.shared, 1);
});

test('mergeJson initializes target when missing', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: 'agent.config.json', source: 'infra/templates/config.example.json', strategy: 'merge-json' };
  writeJson(path.join(sourceRoot, rule.source), { projectName: 'tpl', commands: {} });

  const dryRun = mergeJson(sourceRoot, targetRoot, rule, false);
  assert.equal(dryRun[0].status, 'initialized');
  assert.equal(fs.existsSync(path.join(targetRoot, rule.path)), false, 'dry-run does not create');

  const writeRun = mergeJson(sourceRoot, targetRoot, rule, true);
  assert.equal(writeRun[0].status, 'initialized');
  const written = JSON.parse(fs.readFileSync(path.join(targetRoot, rule.path), 'utf8'));
  assert.equal(written.projectName, 'tpl');
});

test('mergeJson reports unchanged when target already contains all keys', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: 'agent.config.json', source: 'cfg.json', strategy: 'merge-json' };
  writeJson(path.join(sourceRoot, rule.source), { projectName: 'tpl', commands: { lint: 'x' } });
  writeJson(path.join(targetRoot, rule.path), { projectName: 'mine', commands: { lint: 'mylint' }, extra: true });

  const result = mergeJson(sourceRoot, targetRoot, rule, true);
  assert.equal(result[0].status, 'unchanged');
  assert.deepEqual(result[0].added, []);
  // Target file untouched
  const after = JSON.parse(fs.readFileSync(path.join(targetRoot, rule.path), 'utf8'));
  assert.equal(after.extra, true);
  assert.equal(after.commands.lint, 'mylint');
});

test('mergeJson merges and writes only when write=true', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: 'agent.config.json', source: 'cfg.json', strategy: 'merge-json' };
  writeJson(path.join(sourceRoot, rule.source), {
    projectName: 'tpl',
    devops: { commands: { envCheck: { staging: '' } } },
  });
  writeJson(path.join(targetRoot, rule.path), { projectName: 'mine', devops: { commands: {} } });

  const dryRun = mergeJson(sourceRoot, targetRoot, rule, false);
  assert.equal(dryRun[0].status, 'merged');
  assert.deepEqual(dryRun[0].added.sort(), ['devops.commands.envCheck'].sort());
  // Dry-run preserves original file content
  const before = JSON.parse(fs.readFileSync(path.join(targetRoot, rule.path), 'utf8'));
  assert.equal(before.devops.commands.envCheck, undefined);

  const writeRun = mergeJson(sourceRoot, targetRoot, rule, true);
  assert.equal(writeRun[0].status, 'merged');
  const after = JSON.parse(fs.readFileSync(path.join(targetRoot, rule.path), 'utf8'));
  assert.equal(after.projectName, 'mine');
  assert.equal(after.devops.commands.envCheck.staging, '');

  const raw = fs.readFileSync(path.join(targetRoot, rule.path), 'utf8');
  assert.ok(raw.endsWith('\n'), 'trailing newline preserved');
  assert.ok(raw.includes('  '), 'two-space indent used');
});

test('mergeJson blocks on missing source', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: 'agent.config.json', source: 'missing.json', strategy: 'merge-json' };
  writeJson(path.join(targetRoot, rule.path), {});
  const result = mergeJson(sourceRoot, targetRoot, rule, true);
  assert.equal(result[0].status, 'blocked');
  assert.match(result[0].reason, /source missing/);
});

test('mergeJson blocks on invalid target JSON without overwriting it', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: 'agent.config.json', source: 'cfg.json', strategy: 'merge-json' };
  writeJson(path.join(sourceRoot, rule.source), { ok: true });
  fs.mkdirSync(path.join(targetRoot, path.dirname(rule.path)), { recursive: true });
  fs.writeFileSync(path.join(targetRoot, rule.path), '{ not-json');
  const result = mergeJson(sourceRoot, targetRoot, rule, true);
  assert.equal(result[0].status, 'blocked');
  assert.match(result[0].reason, /target invalid json/);
  // File is left as-is
  assert.equal(fs.readFileSync(path.join(targetRoot, rule.path), 'utf8'), '{ not-json');
});

test('applyRule dispatches merge-json strategy end-to-end', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: 'agent.config.json', source: 'cfg.json', strategy: 'merge-json' };
  writeJson(path.join(sourceRoot, rule.source), {
    projectName: 'tpl',
    worktree: { sessionDir: '../tmp/worktree-sessions' },
  });
  writeJson(path.join(targetRoot, rule.path), { projectName: 'my-app', worktree: {} });

  const result = applyRule(sourceRoot, targetRoot, rule, true, new Set());
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'merged');
  assert.deepEqual(result[0].added, ['worktree.sessionDir']);
  const after = JSON.parse(fs.readFileSync(path.join(targetRoot, rule.path), 'utf8'));
  assert.equal(after.projectName, 'my-app');
  assert.equal(after.worktree.sessionDir, '../tmp/worktree-sessions');
});

test('mergeJson preserves Claude-settings arrays and nested env scalars', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: '.claude/settings.json', strategy: 'merge-json' };
  writeJson(path.join(sourceRoot, rule.path), {
    permissions: {
      additionalDirectories: ['/tmp', '../tmp/'],
      allow: ['Bash(git status:*)', 'Bash(pnpm test*)', 'Edit(apps/**)'],
    },
    env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '64000' },
    hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo source' }] }] },
    cleanupPeriodDays: 30,
  });
  writeJson(path.join(targetRoot, rule.path), {
    permissions: {
      additionalDirectories: ['/tmp', '../tmp/', '../my-extra/'],
      allow: ['Bash(git status:*)', 'Edit(my-project/**)'],
    },
    env: { CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000' },
    hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo project-custom' }] }] },
  });

  const result = mergeJson(sourceRoot, targetRoot, rule, true);
  assert.equal(result[0].status, 'merged');
  assert.deepEqual(result[0].added, ['cleanupPeriodDays']);
  const after = JSON.parse(fs.readFileSync(path.join(targetRoot, rule.path), 'utf8'));
  // Project's custom additionalDirectories preserved (template's shorter list NOT merged in)
  assert.deepEqual(after.permissions.additionalDirectories, ['/tmp', '../tmp/', '../my-extra/']);
  // Project's allow[] preserved verbatim — template's extra entries NOT auto-added
  assert.deepEqual(after.permissions.allow, ['Bash(git status:*)', 'Edit(my-project/**)']);
  // Project's env scalar preserved
  assert.equal(after.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '32000');
  // Project's hooks SessionStart array preserved (object-containing array, target wins)
  assert.equal(after.hooks.SessionStart[0].hooks[0].command, 'echo project-custom');
  // Top-level missing key filled from source
  assert.equal(after.cleanupPeriodDays, 30);
});

test('applyRule still routes other strategies normally (regression)', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: 'agent.config.json', source: 'cfg.json', strategy: 'init-if-missing' };
  writeJson(path.join(sourceRoot, rule.source), { projectName: 'tpl' });

  const first = applyRule(sourceRoot, targetRoot, rule, true, new Set());
  assert.equal(first[0].status, 'initialized');
  const second = applyRule(sourceRoot, targetRoot, rule, true, new Set());
  assert.equal(second[0].status, 'skipped');
  assert.match(second[0].reason, /target exists/);
});

test('removePath reports and removes only the manifest target file', () => {
  const targetRoot = mkTmpDir('remove-target');
  const legacyPath = 'docs/data/templates/prd/PRD-TEMPLATE-SMALL.md';
  const absoluteLegacyPath = path.join(targetRoot, legacyPath);
  fs.mkdirSync(path.dirname(absoluteLegacyPath), { recursive: true });
  fs.writeFileSync(absoluteLegacyPath, 'legacy');

  const dryRun = removePath(targetRoot, { path: legacyPath, strategy: 'remove' }, false);
  assert.equal(dryRun[0].status, 'removed');
  assert.equal(fs.existsSync(absoluteLegacyPath), true, 'dry-run preserves target');

  const writeRun = applyRule('', targetRoot, { path: legacyPath, strategy: 'remove' }, true, new Set());
  assert.equal(writeRun[0].status, 'removed');
  assert.equal(fs.existsSync(absoluteLegacyPath), false);

  const missingRun = removePath(targetRoot, { path: legacyPath, strategy: 'remove' }, true);
  assert.equal(missingRun[0].status, 'unchanged');
  assert.match(missingRun[0].reason, /target missing/);
});

test('removePath rejects traversal and directory removal', () => {
  const targetRoot = mkTmpDir('remove-guard');
  const traversal = removePath(targetRoot, { path: '../outside.md', strategy: 'remove' }, true);
  assert.equal(traversal[0].status, 'blocked');
  assert.match(traversal[0].reason, /escapes target root/);

  fs.mkdirSync(path.join(targetRoot, 'legacy-dir'));
  const directory = removePath(targetRoot, { path: 'legacy-dir', strategy: 'remove' }, true);
  assert.equal(directory[0].status, 'blocked');
  assert.match(directory[0].reason, /directory removal/);
});

test('append-block replaces a CRLF marker block without leaving a blank line at EOF', () => {
  const sourceRoot = mkTmpDir('append-crlf-src');
  const targetRoot = mkTmpDir('append-crlf-tgt');
  const rule = {
    path: '.envrc',
    source: 'envrc.agent.append',
    strategy: 'append-block',
    marker: 'agent-template:envrc',
  };
  fs.writeFileSync(path.join(sourceRoot, rule.source), 'new value\n');
  fs.writeFileSync(
    path.join(targetRoot, rule.path),
    '# >>> agent-template:envrc\r\nold value\r\n# <<< agent-template:envrc\r\n',
  );

  const result = applyRule(sourceRoot, targetRoot, rule, true, new Set());

  assert.equal(result[0].status, 'updated');
  assert.equal(
    fs.readFileSync(path.join(targetRoot, rule.path), 'utf8'),
    '# >>> agent-template:envrc\nnew value\n# <<< agent-template:envrc\n',
  );
});

test('append-block preserves one separator after a CRLF marker block with following content', () => {
  const sourceRoot = mkTmpDir('append-crlf-content-src');
  const targetRoot = mkTmpDir('append-crlf-content-tgt');
  const rule = {
    path: '.gitignore',
    source: 'gitignore.agent.append',
    strategy: 'append-block',
    marker: 'agent-template:gitignore',
  };
  fs.writeFileSync(path.join(sourceRoot, rule.source), 'new-entry\n');
  fs.writeFileSync(
    path.join(targetRoot, rule.path),
    '# >>> agent-template:gitignore\r\nold-entry\r\n# <<< agent-template:gitignore\r\n\r\nproject-entry\r\n',
  );

  applyRule(sourceRoot, targetRoot, rule, true, new Set());

  assert.equal(
    fs.readFileSync(path.join(targetRoot, rule.path), 'utf8'),
    '# >>> agent-template:gitignore\nnew-entry\n# <<< agent-template:gitignore\n\r\nproject-entry\r\n',
  );
});

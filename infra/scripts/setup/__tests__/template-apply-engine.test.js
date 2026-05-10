'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  applyRule,
  deepMerge,
  isPlainObject,
  mergeJson,
} = require('../template-apply-engine');

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `merge-json-${prefix}-`));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

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

const {
  appendTopLevelKeys,
  mergeJsonc,
  stripJsonComments,
} = require('../template-apply-engine');

test('stripJsonComments removes line comments but preserves newlines', () => {
  const input = '{\n  "a": 1, // trailing\n  "b": 2 // last\n}\n';
  const out = stripJsonComments(input);
  assert.equal(out, '{\n  "a": 1, \n  "b": 2 \n}\n');
  assert.deepEqual(JSON.parse(out), { a: 1, b: 2 });
});

test('stripJsonComments removes block comments but keeps embedded newlines', () => {
  const input = '{\n  /* multi\n     line */ "a": 1\n}';
  const out = stripJsonComments(input);
  assert.deepEqual(JSON.parse(out), { a: 1 });
  assert.ok(out.includes('\n'), 'newline retained for line counting');
});

test('stripJsonComments leaves comment-like sequences inside strings alone', () => {
  const input = '{ "x": "// not a comment", "y": "/* still safe */", "z": "back\\\\slash" }';
  const out = stripJsonComments(input);
  const parsed = JSON.parse(out);
  assert.equal(parsed.x, '// not a comment');
  assert.equal(parsed.y, '/* still safe */');
  assert.equal(parsed.z, 'back\\slash');
});

test('stripJsonComments handles escaped quotes inside strings', () => {
  const input = '{ "x": "she said \\"hi\\"", "y": 1 // tail\n}';
  const out = stripJsonComments(input);
  const parsed = JSON.parse(out);
  assert.equal(parsed.x, 'she said "hi"');
  assert.equal(parsed.y, 1);
});

test('mergeJsonc initializes target when missing', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: '.gemini/settings.json', strategy: 'merge-jsonc' };
  fs.mkdirSync(path.join(sourceRoot, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, rule.path), '{\n  // notice\n  "a": 1\n}\n');
  const result = mergeJsonc(sourceRoot, targetRoot, rule, true);
  assert.equal(result[0].status, 'initialized');
  assert.equal(fs.readFileSync(path.join(targetRoot, rule.path), 'utf8'), '{\n  // notice\n  "a": 1\n}\n');
});

test('mergeJsonc reports unchanged when target already covers source', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: '.gemini/settings.json', strategy: 'merge-jsonc' };
  fs.mkdirSync(path.join(sourceRoot, '.gemini'), { recursive: true });
  fs.mkdirSync(path.join(targetRoot, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, rule.path), '{ "a": 1, "b": 2 }');
  const targetOriginal = '{\n  // mine\n  "a": 9,\n  "b": 9,\n  "extra": true\n}\n';
  fs.writeFileSync(path.join(targetRoot, rule.path), targetOriginal);
  const result = mergeJsonc(sourceRoot, targetRoot, rule, true);
  assert.equal(result[0].status, 'unchanged');
  assert.equal(fs.readFileSync(path.join(targetRoot, rule.path), 'utf8'), targetOriginal);
});

test('mergeJsonc appends top-level missing keys and preserves target comments', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: '.gemini/settings.json', strategy: 'merge-jsonc' };
  fs.mkdirSync(path.join(sourceRoot, '.gemini'), { recursive: true });
  fs.mkdirSync(path.join(targetRoot, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, rule.path), '{\n  "a": 1,\n  "newKey": "fromTemplate",\n  "alsoNew": { "deep": true }\n}');
  const targetOriginal = '{\n  // important note\n  "a": 9 // keep\n}\n';
  fs.writeFileSync(path.join(targetRoot, rule.path), targetOriginal);
  const result = mergeJsonc(sourceRoot, targetRoot, rule, true);
  assert.equal(result[0].status, 'merged');
  assert.deepEqual(result[0].added.sort(), ['alsoNew', 'newKey'].sort());
  assert.deepEqual(result[0].manualSync, []);
  const after = fs.readFileSync(path.join(targetRoot, rule.path), 'utf8');
  assert.ok(after.includes('// important note'), 'comment preserved');
  assert.ok(after.includes('// keep'), 'inline comment preserved');
  // The merged result should still parse as JSONC
  const parsed = JSON.parse(stripJsonComments(after));
  assert.equal(parsed.a, 9);
  assert.equal(parsed.newKey, 'fromTemplate');
  assert.deepEqual(parsed.alsoNew, { deep: true });
});

test('mergeJsonc only reports nested-key gaps, never writes them to disk', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: '.gemini/settings.json', strategy: 'merge-jsonc' };
  fs.mkdirSync(path.join(sourceRoot, '.gemini'), { recursive: true });
  fs.mkdirSync(path.join(targetRoot, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, rule.path), '{\n  "permissions": { "allow": [], "newSubKey": "x" }\n}');
  const targetOriginal = '{\n  // settings\n  "permissions": { "allow": ["mine"] }\n}\n';
  fs.writeFileSync(path.join(targetRoot, rule.path), targetOriginal);
  const result = mergeJsonc(sourceRoot, targetRoot, rule, true);
  assert.equal(result[0].status, 'merged');
  assert.deepEqual(result[0].added, []);
  assert.deepEqual(result[0].manualSync, ['permissions.newSubKey']);
  // File was NOT modified — nested gaps are reported only
  assert.equal(fs.readFileSync(path.join(targetRoot, rule.path), 'utf8'), targetOriginal);
});

test('mergeJsonc records type conflicts at the same time as top-level appends', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: '.gemini/settings.json', strategy: 'merge-jsonc' };
  fs.mkdirSync(path.join(sourceRoot, '.gemini'), { recursive: true });
  fs.mkdirSync(path.join(targetRoot, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, rule.path), '{ "feature": { "enabled": true }, "newScalar": 0 }');
  fs.writeFileSync(path.join(targetRoot, rule.path), '{ "feature": "off" }');
  const result = mergeJsonc(sourceRoot, targetRoot, rule, true);
  assert.equal(result[0].status, 'merged');
  assert.deepEqual(result[0].added, ['newScalar']);
  assert.equal(result[0].conflicts.length, 1);
  assert.match(result[0].conflicts[0], /^feature:/);
});

test('mergeJsonc preserves target arrays under merge-jsonc strategy', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: '.gemini/settings.json', strategy: 'merge-jsonc' };
  fs.mkdirSync(path.join(sourceRoot, '.gemini'), { recursive: true });
  fs.mkdirSync(path.join(targetRoot, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, rule.path), '{ "list": ["a", "b", "c"] }');
  fs.writeFileSync(path.join(targetRoot, rule.path), '{ "list": ["x"] }');
  const result = mergeJsonc(sourceRoot, targetRoot, rule, true);
  assert.equal(result[0].status, 'unchanged');
});

test('mergeJsonc blocks on invalid JSONC syntax in either side', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: '.gemini/settings.json', strategy: 'merge-jsonc' };
  fs.mkdirSync(path.join(sourceRoot, '.gemini'), { recursive: true });
  fs.mkdirSync(path.join(targetRoot, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, rule.path), '{ "a": 1 }');
  fs.writeFileSync(path.join(targetRoot, rule.path), '{ broken-json');
  const result = mergeJsonc(sourceRoot, targetRoot, rule, true);
  assert.equal(result[0].status, 'blocked');
  assert.match(result[0].reason, /target invalid jsonc/);
});

test('appendTopLevelKeys handles empty target object correctly', () => {
  const text = '{\n}\n';
  const out = appendTopLevelKeys(text, { newKey: 42 }, ['newKey']);
  assert.equal(JSON.parse(stripJsonComments(out)).newKey, 42);
});

test('appendTopLevelKeys returns null when no closing brace', () => {
  assert.equal(appendTopLevelKeys('// just a comment\n', { x: 1 }, ['x']), null);
});

test('mergeJsonc treats keys-with-dots as top-level (e.g. "bash.autoExecute")', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: '.gemini/settings.json', strategy: 'merge-jsonc' };
  fs.mkdirSync(path.join(sourceRoot, '.gemini'), { recursive: true });
  fs.mkdirSync(path.join(targetRoot, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, rule.path), '{\n  "file.autoSave": true,\n  "bash.autoExecute": false,\n  "mcp.autoConnect": true\n}');
  fs.writeFileSync(path.join(targetRoot, rule.path), '{\n  // mine\n  "file.autoSave": false\n}\n');
  const result = mergeJsonc(sourceRoot, targetRoot, rule, true);
  assert.equal(result[0].status, 'merged');
  // Both new keys are top-level (key names contain literal dots, not nesting)
  assert.deepEqual(result[0].added.sort(), ['bash.autoExecute', 'mcp.autoConnect'].sort());
  assert.deepEqual(result[0].manualSync, []);
  const after = fs.readFileSync(path.join(targetRoot, rule.path), 'utf8');
  assert.ok(after.includes('// mine'), 'comment preserved');
  const parsed = JSON.parse(stripJsonComments(after));
  assert.equal(parsed['file.autoSave'], false);
  assert.equal(parsed['bash.autoExecute'], false);
  assert.equal(parsed['mcp.autoConnect'], true);
});

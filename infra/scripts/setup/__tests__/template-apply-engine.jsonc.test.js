'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mkTmpDir } = require('./template-apply-engine.helpers');

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

const { findRootClosingBrace } = require('../template-apply-engine');

test('findRootClosingBrace ignores } inside line comments', () => {
  const text = '{\n  "x": 1\n}\n// note about }\n';
  const idx = findRootClosingBrace(text);
  assert.equal(text[idx], '}');
  assert.equal(idx, text.indexOf('}'), 'returns the real outer closing brace, not the one in the comment');
});

test('findRootClosingBrace ignores } inside block comments', () => {
  const text = '{\n  "x": 1\n}\n/* trailer with } */\n';
  const idx = findRootClosingBrace(text);
  assert.equal(text[idx], '}');
  assert.equal(idx, text.indexOf('}'));
});

test('findRootClosingBrace ignores } inside string values', () => {
  const text = '{ "x": "value with } inside" }';
  const idx = findRootClosingBrace(text);
  assert.equal(text[idx], '}');
  // The real closing is the LAST `}` at file end (after the string)
  assert.equal(idx, text.length - 1);
});

test('mergeJsonc handles target with trailing line comment containing }', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: '.gemini/settings.json', strategy: 'merge-jsonc' };
  fs.mkdirSync(path.join(sourceRoot, '.gemini'), { recursive: true });
  fs.mkdirSync(path.join(targetRoot, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, rule.path), '{ "a": 1, "b": 2 }');
  // Target has a trailing line comment that contains a `}` character
  fs.writeFileSync(path.join(targetRoot, rule.path), '{\n  "a": 1\n}\n// override example: { "x": 1 }\n');
  const result = mergeJsonc(sourceRoot, targetRoot, rule, true);
  assert.equal(result[0].status, 'merged');
  assert.deepEqual(result[0].added, ['b']);
  const after = fs.readFileSync(path.join(targetRoot, rule.path), 'utf8');
  // Resulting file must still be valid JSONC
  const parsed = JSON.parse(stripJsonComments(after));
  assert.equal(parsed.a, 1);
  assert.equal(parsed.b, 2);
  // Trailing comment must be retained verbatim
  assert.ok(after.includes('// override example: { "x": 1 }'), 'trailing comment preserved');
});

test('mergeJsonc handles target with trailing block comment containing }', () => {
  const sourceRoot = mkTmpDir('src');
  const targetRoot = mkTmpDir('tgt');
  const rule = { path: '.gemini/settings.json', strategy: 'merge-jsonc' };
  fs.mkdirSync(path.join(sourceRoot, '.gemini'), { recursive: true });
  fs.mkdirSync(path.join(targetRoot, '.gemini'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, rule.path), '{ "a": 1, "newKey": true }');
  fs.writeFileSync(path.join(targetRoot, rule.path), '{\n  "a": 1\n}\n/* footer note with } and {} braces */\n');
  const result = mergeJsonc(sourceRoot, targetRoot, rule, true);
  assert.equal(result[0].status, 'merged');
  assert.deepEqual(result[0].added, ['newKey']);
  const after = fs.readFileSync(path.join(targetRoot, rule.path), 'utf8');
  const parsed = JSON.parse(stripJsonComments(after));
  assert.equal(parsed.a, 1);
  assert.equal(parsed.newKey, true);
  assert.ok(after.includes('/* footer note with } and {} braces */'), 'trailing block comment preserved');
});

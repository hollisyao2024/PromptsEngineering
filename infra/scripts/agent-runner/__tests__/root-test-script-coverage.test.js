'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

// 本文件随 infra/scripts/agent-runner 分发到实际项目，但根 scripts.test 的覆盖约束只属于息壤源：
// 实际项目没有这个脚本（或有自己的测试脚本），因此仅在 template.role=source 时强制，其余带原因跳过。
function isTemplateSource() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'agent.config.json'), 'utf8'));
    return Boolean(config.template && config.template.role === 'source');
  } catch {
    return false;
  }
}
const TEMPLATE_SOURCE_ONLY = isTemplateSource() ? false : '仅息壤源强制根 scripts.test 覆盖全部单测，实际项目跳过';

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

test('root test script covers every tracked unit test under infra/scripts and architecture/__tests__', { skip: TEMPLATE_SOURCE_ONLY }, () => {
  const { scripts = {} } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(typeof scripts.test, 'string', 'template source package.json must define scripts.test');
  const patterns = scripts.test.split(/\s+/).filter((part) => part.includes('*')).map(globToRegExp);
  const tracked = execFileSync('git', ['ls-files', 'infra/scripts', 'architecture/__tests__'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((file) => /\/__tests__\/[^/]+\.test\.(?:js|mjs)$/.test(file));
  assert.ok(tracked.length > 0);
  const uncovered = tracked.filter((file) => !patterns.some((pattern) => pattern.test(file)));
  assert.deepEqual(uncovered, []);
});

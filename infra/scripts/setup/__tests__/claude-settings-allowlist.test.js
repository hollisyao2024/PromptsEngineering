'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude/settings.json'), 'utf8'));

// Claude Code 前缀规则：`Bash(<prefix>:*)` 按词边界匹配，`Bash(<cmd>)` 精确匹配。
function bashRules() {
  return settings.permissions.allow
    .map((rule) => /^Bash\((.*)\)$/u.exec(rule))
    .filter(Boolean)
    .map((match) => match[1]);
}

function isAllowed(command) {
  return bashRules().some((rule) => {
    if (rule.endsWith(':*')) {
      const prefix = rule.slice(0, -2);
      return command === prefix || command.startsWith(`${prefix} `);
    }
    if (rule.endsWith('*')) return command.startsWith(rule.slice(0, -1));
    return command === rule;
  });
}

test('team allowlist lets the stable agent lifecycle commands run without prompts', () => {
  for (const command of [
    'pnpm agent -- task start --task demo --phase tdd',
    'pnpm agent -- task checkpoint --task demo --step S1 --status done',
    'pnpm agent -- task resume --auto',
    'pnpm agent -- task context --task demo',
    'pnpm agent -- task extend --task demo --reason x',
    'pnpm agent -- task transition --task demo --phase qa',
    'pnpm agent -- task finish --task demo',
    'pnpm agent -- task paths',
    'pnpm agent -- worktree new --phase=tdd --task demo',
    'pnpm agent -- worktree list',
    'pnpm agent -- worktree resume --task demo',
    'pnpm agent -- tdd sync',
    'pnpm agent -- qa plan',
    'pnpm agent -- qa verify',
  ]) {
    assert.ok(isAllowed(command), `should be allowed: ${command}`);
  }
});

test('team allowlist keeps remote, merge-chaining, install, deploy, arbitrary-exec and destructive agent commands behind a prompt', () => {
  for (const command of [
    'pnpm agent -- tdd push',
    'pnpm agent -- qa merge',
    // finish/tdd finish 按 guard 的 NEXT_COMMANDS 自动串联 push 与 merge；bootstrap 执行项目配置的依赖安装命令
    'pnpm agent -- finish',
    'pnpm agent -- tdd finish',
    'pnpm agent -- worktree bootstrap',
    'pnpm agent -- task exec --task demo --name t -- git push origin main',
    'pnpm agent -- task cancel --task demo --force',
    'pnpm agent -- test --file a.test.js -- pnpm exec vitest run',
    'pnpm agent -- ship prod',
    'pnpm agent -- private ship prod',
    'pnpm agent -- build prod',
    'pnpm agent -- template sync',
    'pnpm agent -- template update ../other',
    'pnpm agent -- template backfill ../src',
  ]) {
    assert.ok(!isAllowed(command), `should still require confirmation: ${command}`);
  }
});

test('team allowlist stays valid JSON with unique entries', () => {
  const allow = settings.permissions.allow;
  assert.equal(new Set(allow).size, allow.length, 'allow entries must be unique');
});

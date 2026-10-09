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

test('team allowlist does not wildcard-allow project test scripts, which are not the default regression', () => {
  // `pnpm test*` / `pnpm run test*` 是原始前缀通配：既放行项目自有的聚合测试脚本（常为全量，
  // 与「不把全量测试当默认回归」相悖），也会匹配 `pnpm testing` 之类无关命令；需要免确认时在 settings.local.json 追加。
  for (const command of [
    'pnpm test',
    'pnpm test:e2e',
    'pnpm test --coverage',
    'pnpm testing',
    'pnpm run test',
    'pnpm run test:unit',
    'pnpm run testall',
  ]) {
    assert.ok(!isAllowed(command), `should still require confirmation: ${command}`);
  }
  assert.deepEqual(
    bashRules().filter((rule) => /^pnpm (?:run )?test/u.test(rule)),
    [],
    'no pnpm test wildcard rule remains in the team allowlist',
  );
});

test('team allowlist no longer carries legacy pnpm rules that match no script of this template', () => {
  // 这 7 条在模板源 package.json 中没有任何可匹配的脚本：`build`、`clean`、`dev` 从未存在；
  // `priority:*`、`persona:*`、`goal:*` 对应的脚本已随 PRD 工具链精简在 dbf60fd 移除，且 `:*` 按词边界只匹配
  // 无冒号后缀的 `pnpm run priority`。下游项目自带 `build`、`clean` 脚本时，需要免确认就在 settings.local.json 追加。
  for (const rule of [
    'Bash(pnpm build*)',
    'Bash(pnpm run build*)',
    'Bash(pnpm run clean*)',
    'Bash(pnpm dev)',
    'Bash(pnpm run priority:*)',
    'Bash(pnpm run persona:*)',
    'Bash(pnpm run goal:*)',
  ]) {
    assert.ok(!settings.permissions.allow.includes(rule), `dead rule should be removed: ${rule}`);
  }
  for (const command of [
    'pnpm build',
    'pnpm build:app:mac',
    'pnpm run build',
    'pnpm run build:dev',
    'pnpm run clean',
    'pnpm run priority',
    'pnpm run persona',
    'pnpm run goal',
  ]) {
    assert.ok(!isAllowed(command), `should require confirmation: ${command}`);
  }
  // `Bash(pnpm dev)` 是 `Bash(pnpm dev:*)` 的子集（后者按词边界同样匹配裸 `pnpm dev`），删除不改变放行结果。
  assert.ok(isAllowed('pnpm dev'), 'bare pnpm dev stays allowed through Bash(pnpm dev:*)');
});

test('team allowlist keeps the other legacy pnpm rules and the dev ship aliases untouched', () => {
  // merge-json 允许实际项目追加规则；这里只检查模板保留的规则没有被删除。
  const rules = bashRules();
  for (const rule of [
      'pnpm lint*',
      'pnpm run lint*',
      'pnpm type-check*',
      'pnpm run type-check*',
      'pnpm run codemap*',
      'pnpm run precommit*',
      'pnpm run dev*',
      'pnpm dev:*',
      'pnpm run prd:*',
      'pnpm run arch:*',
      'pnpm run nfr:*',
      'pnpm run task:*',
      'pnpm run tdd:*',
      'pnpm run qa:*',
      'pnpm ship:dev',
      'pnpm run ship:dev',
      'pnpm run ship:dev:quick',
    ]) {
    assert.ok(rules.includes(rule), `retained template rule is missing: ${rule}`);
  }
});

test('team allowlist stays valid JSON with unique entries', () => {
  const allow = settings.permissions.allow;
  assert.equal(new Set(allow).size, allow.length, 'allow entries must be unique');
});

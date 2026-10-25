'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, conventionsSection, read } = require('./template-surface.helpers');

test('agents github section leaves the rules carried by conventions sections 5 and 9 there and keeps its own unique rules', () => {
  const agents = read('AGENTS.md');
  const start = agents.indexOf('\n## GitHub 与安全');
  const end = agents.indexOf('\n## ', start + 1);
  assert.ok(start >= 0 && end > start, 'agents github section');
  const section = agents.slice(start, end);
  const receipts = conventionsSection('5. Worktree 生命周期');
  const policy = conventionsSection('9. GitHub、命名与安全');

  // 旧 AGENTS 子句 → 仍在 CONVENTIONS 的承接原文：删除与保留在同一处断言，避免只删不留。
  const dedupedIntoConventions = [
    [/远端 Git\/GitHub 操作只能走/u, policy, ['GitHub token 变量统一为 `GH_TOKEN`。', '远端 Git/GitHub 命令必须由 `infra/scripts/shared/github-auth-run.js` 或上层脚本执行。']],
    [/是阶段职责，不是电脑或账号身份/u, policy, ['专家名称表示当前阶段职责，不绑定电脑、hostname、机器角色或专用 QA 账号；所有已获仓库权限的协作者可以执行任意阶段、合并 PR 或普通更新配置主干。']],
    [/原子写入绑定 base、branch/u, receipts, [
      '`qa verify` 通过后在本机原子保存绑定配置主干、功能分支、`BASE_SHA` 和 `HEAD_SHA` 的回执',
      '合并前重新 fetch，并把回执与 PR base/head refs、远端引用逐项复验',
      '任何 SHA 漂移、冲突或非快进拒绝都必须停止并要求重新 QA，不得自动 rebase 已验证分支或覆盖远端历史',
    ]],
    [/配置主干禁止 force push 和删除/u, policy, ['配置主干禁止 force push 和删除；跨电脑合并不使用分布式锁，以远端 SHA 复验和普通 push 的非快进拒绝实现乐观并发。']],
    [/主干并发更新失败时不得覆盖远端历史/u, receipts, ['不得自动 rebase 已验证分支或覆盖远端历史']],
    [/不创建、修改、触发或依赖 GitHub CI/u, policy, ['TDD、QA 与合并门禁完全在本地执行，不创建、修改、触发或依赖 GitHub CI、required checks 或 `.github/workflows`；工作流目录始终由实际项目自行维护。']],
  ];
  for (const [removed, carrier, kept] of dedupedIntoConventions) {
    assert.doesNotMatch(agents, removed);
    for (const needle of kept) {
      assert.ok(carrier.includes(needle), `conventions keeps ${needle}`);
    }
  }

  // AGENTS 自有规则保留：CONVENTIONS 无正文的「只用 `.env.local`」排他令牌来源声明（§9 只写落点与解析顺序）与裸执行清单、PR base 绑定、expected SHA 租约、删除与状态保护、记录边界，外加一条指针。
  for (const kept of [
    '- GitHub 鉴权封装与 `GH_TOKEN`、阶段不绑定电脑或账号、QA 回执复验、配置主干禁止 force push 与删除、本地门禁不依赖 GitHub CI 的规则见 `docs/CONVENTIONS.md` §5、§9。',
    '- GitHub 访问只用 `.env.local` 的 `GH_TOKEN`；不得裸执行 `git fetch/pull/push/ls-remote`、`gh`。',
    '- `tdd push` 必须显式以 `config.baseBranch` 为 PR base。',
    '- 功能分支只有在精确 expected SHA 的 `--force-with-lease` 保护下才可清理。',
    '- 删除前解析并复核精确目标；失败、阻塞、等待确认和恢复态不得清理任务/worktree 状态。',
    '- 不记录或提交密钥、凭据、个人信息和大段原始日志。',
  ]) {
    assert.ok(section.includes(kept), kept);
  }
});

test('agents leaves project ownership and scan details to conventions while keeping its own one-line rules', () => {
  const agents = read('AGENTS.md');
  const conventions = read('docs/CONVENTIONS.md');
  const ownership = conventionsSection('3. 模板所有权');
  const scan = conventions.slice(conventions.indexOf('\n## 10. 全仓扫描'));
  assert.ok(scan.startsWith('\n## 10. 全仓扫描'), 'conventions scan section');
  const scanStart = agents.indexOf('\n## 全仓扫描');
  const agentsScan = agents.slice(scanStart, agents.indexOf('\n## ', scanStart + 1));
  assert.ok(scanStart >= 0 && agentsScan.includes('Discovery'), 'agents scan section');

  // 旧 AGENTS 子句 → 仍在承接处的原文：删除与保留在同一处断言，避免只删不留。
  assert.doesNotMatch(agents, /业务源码、真实项目文档和部署实现属于项目/u);
  assert.ok(agents.includes('`RULES.md` 由实际项目维护；首次应用与更新仅在缺失时从模板骨架初始化，已有文件保持不变'));
  for (const carried of [
    '`RULES.md`、真实项目文档、源码、业务部署脚本和已有 `agent.config.json` 均属于项目；`RULES.md` 仅在缺失时初始化，已有内容（包括空文件）不改写',
    '- `init-if-missing`：仅初始化，已有项目文件不覆盖。',
    '- `project-owned`：模板永不写入。',
  ]) {
    assert.ok(ownership.includes(carried), carried);
  }

  for (const removed of [/scan-manifests/u, /scanned_count/u, /matched = modified/u]) {
    assert.doesNotMatch(agentsScan, removed);
  }
  assert.ok(agentsScan.includes('跨目录且完整性影响正确性时，Discovery 与 Editing 必须分离，细则见 `docs/CONVENTIONS.md` §全仓扫描。'));
  for (const carried of [
    '候选 manifest 写入容器 `tmp/scan-manifests/`，包含范围、排除项和全部候选',
    'scanned_count\nmatched_count\nmodified_count\nskipped_count',
    '并满足 `matched_count = modified_count + skipped_count`。范围变化时创建新 manifest，不得静默缩小。',
  ]) {
    assert.ok(scan.includes(carried), carried);
  }
});

test('conventions leaves task-input, checkpoint, default-type, alias and context-budget sentences to agents', () => {
  const agents = read('AGENTS.md');
  const conventions = read('docs/CONVENTIONS.md');
  const tasks = conventionsSection('6. 长任务状态文件');
  const commands = conventionsSection('7. 命令面');

  // 旧 CONVENTIONS 子句 → 仍在 AGENTS 的承接原文：删除与保留在同一处断言，避免只删不留。
  const dedupedIntoAgents = [
    [/mutation 必须显式提供可观察验收/u, ['- mutation 任务在创建或恢复修改 worktree 前必须有显式验收；只读诊断、研究和运维可按现有目标继续。']],
    [/同一次 checkpoint 可更新步骤和验收项/u, ['- 一个 checkpoint 可同时完成步骤和验收项，并记录简短证据、退出码、路径或哈希。']],
    [/新任务安全默认 `type=mutation`/u, ['- 新任务默认 `type=mutation` 并执行 completion guard；能证明不会修改 tracked 文件时才显式使用 `diagnose|research|operation`。']],
    [/旧 aliases 在已有项目中保留兼容/u, ['已有项目中的旧 package aliases 作为兼容入口保留；新模板不继续扩张别名集合。']],
    [/上下文预算、阶段交接与失败恢复协议/u, ['\n## 上下文预算与阶段交接\n', '\n## 长任务断点续跑\n']],
  ];
  for (const [removed, kept] of dedupedIntoAgents) {
    assert.doesNotMatch(conventions, removed);
    for (const needle of kept) {
      assert.ok(agents.includes(needle), `agents keeps ${needle}`);
    }
  }

  // 同句中不重复的规则原样保留；§6 内两处「长任务断点续跑」指针留在各自规则所在处，是被删末行中失败恢复半句的承接位置。
  for (const [section, kept] of [
    [tasks, '是否需要任务状态统一遵循 `AGENTS.md`“长任务断点续跑”：'],
    [tasks, '记录不可用时按 `AGENTS.md`“长任务断点续跑”的失败恢复规则对话留痕'],
    [tasks, '任务输入的补齐、假设和最小提问规则以 `AGENTS.md` 的“任务输入门禁”为准。'],
    [tasks, 'pnpm agent -- task start --task <id> --phase <phase> --type mutation --desc "<目标>" --acceptance "<可观察验收>" --step "<步骤>"'],
    [tasks, '- schema v1 状态在读取时升级为 v2，保留既有步骤、证据与生命周期状态。'],
    [commands, '新项目只推荐统一入口：'],
    [commands, '命令必须输出可解析的 `STATUS`、`SUMMARY`、`NEXT_ACTION`，失败时退出码非零。'],
  ]) {
    assert.ok(section.includes(kept), kept);
  }
});

test('conventions section 7 keeps the lean shortcut routing table and leaves the shortcut specification to the ops expert', () => {
  const expert = read('AgentRoles/OPS-ENGINEERING-EXPERT.md');
  const section = conventionsSection('7. 命令面');
  assert.ok(section.includes('\n### 客户端与服务端快捷命令\n'), 'conventions keeps the shortcut registry the pointers name');

  // 常驻加载的精简路由表：每个运维快捷命令只在 §7 登记一次稳定入口，专家不重复同一行；
  // 无环境参数的 ci/env 行在专家命令表中复现，仅为携带兼容 package alias 列。
  const aliasRows = new Set(['/ci run', '/ci status', '/env check <env>', '/env status']);
  for (const [shortcut, entry] of [
    ['/restart', 'pnpm agent -- dev restart'],
    ['/private restart', 'pnpm agent -- private restart'],
    ['/dev app <platform>', 'pnpm agent -- dev app <platform>'],
    ['/private dev app <platform>', 'pnpm agent -- private dev app <platform>'],
    ['/build app <platform>', 'pnpm agent -- build app <platform>'],
    ['/private build app <platform>', 'pnpm agent -- private build app <platform>'],
    ['/build <env>', 'pnpm agent -- build <env>'],
    ['/private build <env>', 'pnpm agent -- private build <env>'],
    ['/ship <env>', 'pnpm agent -- ship <env>'],
    ['/private ship <env>', 'pnpm agent -- private ship <env>'],
    ['/cd <env>', 'pnpm agent -- cd <env>'],
    ['/ci run', 'pnpm agent -- ci run'],
    ['/ci status', 'pnpm agent -- ci status'],
    ['/env check <env>', 'pnpm agent -- env check <env>'],
    ['/env status', 'pnpm agent -- env status'],
  ]) {
    const row = `| \`${shortcut}\` | \`${entry}\` |`;
    assert.ok(section.includes(row), `conventions routes ${shortcut}`);
    if (aliasRows.has(shortcut)) continue;
    assert.ok(!expert.includes(row), `expert does not duplicate the ${shortcut} routing row`);
  }

  // fail-closed 底线常驻 §7；细节（平台矩阵、配置结构、参数透传、部署防回退）迁入 OPS 专家与手册。
  for (const carried of [
    '显式 profile、平台或环境缺少命令时必须 `STATUS=BLOCKED`，禁止跨 profile、平台或环境回退。',
    '客户端开发、发行构建、服务端产物构建与真实部署是四种不同副作用边界，验收证据不得互相替代。',
    '`AgentRoles/OPS-ENGINEERING-EXPERT.md` §快捷命令规格',
  ]) {
    assert.ok(section.includes(carried), carried);
  }
  for (const moved of [/客户端平台完整矩阵/u, /^### 部署防回退与跨电脑租约/mu, /`ops\.commands\.build` \/ `ops\.commands\.ship`/u, /refs\/xirang\/deploy-lock\/<scope>/u]) {
    assert.doesNotMatch(section, moved);
  }
  for (const owned of [
    '## 快捷命令规格',
    '客户端平台完整矩阵',
    '- 服务端构建与部署：`ops.commands.build` / `ops.commands.ship` / `ops.commands.cd`',
    '`{source_args}`',
    '`{dry_run_arg}`',
    '`/private start|restart|stop|status|logs`；禁止写成 `/restart private`',
    'devServer.commands.<action>.<profile>',
    '开发启动、发行构建和真实部署的验收证据不得互相替代',
  ]) {
    assert.ok(expert.includes(owned), owned);
  }

  // 专家自有命令表：具体环境行全部走 pnpm agent 稳定入口，旧 package alias 只作兼容列。
  for (const kept of [
    '| `/ship dev` | `pnpm agent -- ship dev` | `pnpm ship:dev` |',
    '| `/ship staging` | `pnpm agent -- ship staging` | `pnpm ship:staging` |',
    '| `/ship prod` | `pnpm agent -- ship production` | `pnpm ship:prod` |',
    '| `/cd staging` | `pnpm agent -- cd staging` | `pnpm cd:staging` |',
    '| `/cd prod` | `pnpm agent -- cd production` | `pnpm cd:prod` |',
    '| `/ci run` | `pnpm agent -- ci run` | `pnpm ci:run` |',
    '| `/ci status` | `pnpm agent -- ci status` | `pnpm ci:status` |',
    '| `/env check <env>` | `pnpm agent -- env check <env>` | `pnpm env:check -- --env=<env>` |',
    '| `/env status` | `pnpm agent -- env status` | `pnpm env:status` |',
  ]) {
    assert.ok(expert.includes(kept), kept);
  }
  assert.doesNotMatch(expert, /node infra\/scripts\/ops-tools\/ops-run\.js --action=(?:cd|ci|env)/u);
});

test('ops handbook owns the rollback guard detail and keeps its own profile and script rules', () => {
  const handbook = read('AgentRoles/Handbooks/OPS-ENGINEERING-EXPERT.playbook.md');
  const registry = '`docs/CONVENTIONS.md` §客户端与服务端快捷命令';

  for (const removed of [
    /private profile 的用户快捷语法为/u,
    /`\/dev app <platform>` 与 `\/private dev app <platform>` 读取/u,
    /`\/build app <platform>` 与 `\/private build app <platform>` 读取/u,
    /^\| `\/private restart` \|/mu,
    /^\| `\/dev app <platform>` \|/mu,
    /^\| `\/build app <platform>` \|/mu,
    /^\| `\/build <env>` \|/mu,
  ]) {
    assert.doesNotMatch(handbook, removed);
  }
  assert.equal(handbook.split(registry).length - 1, 2, 'handbook names the conventions shortcut registry where its rows used to be');

  for (const kept of [
    '- 显式 profile 没有精确命令时必须阻断，禁止回退 default；构建成功不得替代运行态验收。',
    '用户使用 `/private ...` 语法，内部 target 仅用于 dispatcher 调度，不得作为用户快捷命令公开。',
    '- **配置约定**：实际命令写在 `agent.config.json devServer.commands`，必要时通过环境变量提供端口、服务名和日志路径',
    '| `ship:dev` | `node infra/scripts/ops-tools/ops-run.js --action=ship --env=dev` | 需 `ops.deployEnabled=true` |',
    '| `dev:restart` | `node infra/scripts/ops-tools/ops-run.js --action=dev-restart` | |',
    '### 部署防回退与跨电脑租约',
    '`refs/xirang/deploy-lock/<scope>`',
    '`DEPLOY_ALLOW_ROLLBACK=1`',
    '`MANUAL_RELEASE_COMMAND`',
    '`remoteRetryDelaysMs`',
  ]) {
    assert.ok(handbook.includes(kept), kept);
  }
  assert.doesNotMatch(handbook, /CI 全绿/u);
});

test('tdd expert states where run evidence goes once', () => {
  const tdd = read('AgentRoles/TDD-PROGRAMMING-EXPERT.md');
  assert.doesNotMatch(tdd, /^- 运行证据写 session 或长任务状态，不写入阶段文件。$/mu);
  assert.doesNotMatch(tdd, /运行证据留在 task state、QA 报告和部署记录；/u);
  assert.ok(tdd.includes('- 不维护 tracked 阶段状态文档；运行证据写 session、长任务状态、QA 报告和部署记录，不写入阶段文件。'));
  assert.ok(tdd.includes('- 用户可见变化更新 CHANGELOG：每个 PR 一行、≤120 字符，只写用户可感知的变化'));
});

test('expert and handbook path-base notes point at the conventions topology section instead of a missing agents section', () => {
  assert.match(read('docs/CONVENTIONS.md'), /^## 1\. 路径与仓库拓扑$/mu);
  assert.doesNotMatch(read('AGENTS.md'), /^#+ .*仓库拓扑/mu);
  const roleFiles = ['AgentRoles', 'AgentRoles/Handbooks'].flatMap((dir) => fs
    .readdirSync(path.join(ROOT, dir))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `${dir}/${name}`));
  const withNote = roleFiles.filter((file) => read(file).includes('**路径基准**'));
  assert.ok(withNote.length >= 11, 'expert and handbook path-base notes found');
  for (const file of withNote) {
    const text = read(file);
    assert.ok(text.includes('；详见 `/docs/CONVENTIONS.md` §路径与仓库拓扑。'), `${file} points at conventions section 1`);
    assert.doesNotMatch(text, /`\/AGENTS\.md` §仓库拓扑/u, `${file} no longer points at a missing agents section`);
  }
});

test('TDD read-only flow does not require writing diagnostic artifacts', () => {
  const handbook = read('AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md');
  assert.doesNotMatch(handbook, /只读排查[^\n]*产物写容器/u);
  assert.match(handbook, /只读排查[^\n]*对话/u);
  assert.match(handbook, /持久化.*AGENTS\.md/u);
});

test('task CLI help distinguishes work type from state-writing commands', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, ['infra/scripts/agent-runner/agent-task.js', 'start', '--help'], {
    cwd: ROOT, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Single-session read-only.*do not.*start.*resume/u);
  assert.match(result.stdout, /diagnose.*research.*operation.*work.*types/u);
  assert.match(result.stdout, /start.*checkpoint.*resume.*write.*state.*locks/u);
  assert.doesNotMatch(result.stdout, /read-only task type/u);
});

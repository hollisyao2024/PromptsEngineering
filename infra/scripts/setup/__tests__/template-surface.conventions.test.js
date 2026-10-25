'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, conventionsSection, read } = require('./template-surface.helpers');

test('conventions test-scope section keeps the contract that experts reference by name', () => {
  const section = conventionsSection('8. TDD、QA 与交付');
  assert.match(section, /^### 测试范围与证据复用$/mu);
  assert.match(section, /\| 变更影响 \| 必需验证 \|/u);
  for (const trigger of ['explicit_requirement', 'whole_scope_impact', 'unbounded_after_investigation', 'cross_domain_failure']) {
    assert.ok(section.includes(trigger), trigger);
  }
  for (const field of ['TEST_SCOPE_DECISION', 'TEST_SCOPE_RESULT', 'tdd.projectChecks']) {
    assert.ok(section.includes(field), field);
  }
  for (const expert of ['AgentRoles/TDD-PROGRAMMING-EXPERT.md', 'AgentRoles/QA-TESTING-EXPERT.md']) {
    assert.ok(read(expert).includes('测试范围与证据复用'), expert);
  }
});

test('delivery pipeline, schema and review rules live with their owners instead of conventions section 8', () => {
  const section = conventionsSection('8. TDD、QA 与交付');
  for (const removed of [
    /修改任务固定执行/u,
    /数据库 schema 变更必须同一交付/u,
    /使用显式运行时迁移注册表/u,
    /审查高风险域/u,
    /整体 `package\.json`/u,
  ]) {
    assert.doesNotMatch(section, removed);
  }
  assert.match(section, /官方息壤源.*`tdd sync`.*自动递增.*source-version-sync\.js/u);

  const owners = {
    'AGENTS.md': ['pnpm agent -- tdd sync', 'tdd push --committed-only', 'config.baseBranch', 'CLEANUP_STATUS=PRESERVED', '高风险改动包括'],
    'AgentRoles/TDD-PROGRAMMING-EXPERT.md': ['tdd.schemaGate.semantic', 'tdd.migrationRegistry.registryFile', 'docs/data/dictionary.md', 'Review-Class: REQUIRED'],
  };
  // 架构源标准只在息壤源仓库存在，下游项目中该文件可能缺席。
  if (fs.existsSync(path.join(ROOT, 'architecture/standards/data.md'))) {
    owners['architecture/standards/data.md'] = ['-- xirang:hard-delete', 'tdd.schemaGate.semantic'];
  }
  for (const [file, needles] of Object.entries(owners)) {
    const text = read(file);
    for (const needle of needles) {
      assert.ok(text.includes(needle), `${file} keeps ${needle}`);
    }
  }
});

test('conventions section 8 states each test-scope rule once and keeps the rules next to every trim', () => {
  const section = conventionsSection('8. TDD、QA 与交付');
  const occurrences = (needle) => section.split(needle).length - 1;

  // 「不能单独触发全量」清单只在全量段列一次，首段只保留低风险判定。
  assert.equal(occurrences('进入 QA、创建 PR'), 1);
  assert.match(section, /高风险标签、进入 QA、创建 PR 均不能单独触发全量/u);
  assert.match(section, /改动行数少不能单独证明低风险/u);

  // 范围不明先调查、仍不明再升级由第三类触发表达，不再另起一句。
  assert.doesNotMatch(section, /遇到范围不明/u);
  assert.match(section, /调查调用关系后仍无法可靠界定影响（不猜测范围）/u);

  // 大日志的存放位置由 AGENTS.md 与 §6 的 evidence/ 约定负责。
  assert.doesNotMatch(section, /大日志留在任务 evidence/u);
  assert.match(read('AGENTS.md'), /完整日志写入任务 evidence/u);
  assert.match(read('AGENTS.md'), /大证据放 `evidence\/`/u);
  assert.match(conventionsSection('6. 长任务状态文件'), /evidence\/\s+# 可选大体积证据/u);

  // 预提交运行的绑定规则只写一次，并带上摘要核对方式。
  assert.equal(occurrences('提交前运行'), 1);
  assert.match(section, /提交前运行的测试须先确认受测内容与当前提交一致（可用受测文件摘要核对），再绑定 HEAD/u);
  assert.match(section, /证据须能绑定当前提交、测试范围、命令、退出码、依赖\/配置和环境/u);

  // 全量入口段不再重复触发依据的记录要求，放行条件仍由 task exec 一句承担。
  assert.doesNotMatch(section, /按上段记录触发依据/u);
  assert.match(section, /只有事先记录了匹配命令和触发依据的 `mode=full` 决策才放行，与 `qa\.business\.suites` 已登记命令逐词一致的命令直接放行。/u);
  assert.equal(occurrences('已登记命令逐词一致'), 1);
  assert.match(section, /明确需要全量时使用项目显式全量入口/u);

  // 压缩只合并重复，邻近的规则本身必须原样保留。
  for (const rule of [
    '不得用全量失败掩盖定向结果',
    '全量测试是例外，只有以下四类可触发',
    '某一应用的全量单测不自动扩大为所有应用、全量 E2E、安全与负载测试',
    '结构校验不代替 QA 对范围、日志与证据真实性的判断',
    '`task exec` 在启动前拦截常见聚合测试命令',
    '不得临时改成空命令或忽略失败来缩小范围',
    '新增 QA 测试仍须实际执行',
    '测试证据复用不替代 `qa verify` 的本机 base/head 回执及合并前 SHA 复验',
    '时间压力不能豁免必需项',
  ]) {
    assert.ok(section.includes(rule), rule);
  }
});

test('agents test entry keeps its own rules and leaves task exec interception to conventions section 8', () => {
  const agents = read('AGENTS.md');
  const section = conventionsSection('8. TDD、QA 与交付');

  // 「task exec 拦截聚合测试命令」只在 §8 运行器段写一次，并带放行条件。
  assert.doesNotMatch(agents, /`task exec` 会在启动前拦截聚合测试命令/u);
  assert.ok(
    section.includes('`task exec` 在启动前拦截常见聚合测试命令，只有事先记录了匹配命令和触发依据的 `mode=full` 决策才放行'),
    'conventions section 8 keeps the task exec interception rule with its release condition',
  );

  // 测试入口句的其余规则原样保留：定向入口、默认回归禁令、全量记录要求与 CONVENTIONS 指针。
  assert.ok(
    agents.includes(
      '测试优先使用 `pnpm agent -- test --file <测试文件> -- <定向运行器>`；不得把项目自有 `pnpm test` 或无文件参数的运行器当作默认回归。全量测试须先按 `docs/CONVENTIONS.md` 记录触发依据和对应命令。',
    ),
    'agents keeps the targeted test entry, the default-regression ban and the full-test pointer',
  );
  // task exec 的长命令用法仍由上下文预算章节承担。
  assert.ok(
    agents.includes('任何预计超过 5 秒或 2KB 输出的测试、构建、部署命令使用 `pnpm agent -- task exec --task <id> --name <name> -- <command...>`'),
    'agents keeps the task exec usage in the context budget section',
  );
});

test('qa expert points to conventions section 8 and keeps only its own review duties', () => {
  const qa = read('AgentRoles/QA-TESTING-EXPERT.md');
  const section = conventionsSection('8. TDD、QA 与交付');

  // 旧 QA 子句 → 仍在 §8 的承接原文：删除与保留在同一处断言，避免只删不留。
  const dedupedIntoSection = [
    [/检查完整 diff、调用方和依赖，按影响范围选择测试/u, ['TDD 与 QA 共用以下口径', '检查调用方、共享依赖、配置和测试映射，再选择最小充分范围']],
    [/记录命令、退出码、覆盖范围和未运行项/u, ['`impact_paths`', '`commands`', '`not_run`', '`exit_code:0`']],
    [/不得将未运行项记为通过/u, ['未运行项不得记为通过']],
    [/纯文档运行格式、链接或模板契约检查/u, ['相关格式、链接或模板契约检查']],
    [/局部样式运行相关视觉或定向 E2E/u, ['受影响页面的视觉或定向 E2E']],
    [/局部逻辑运行定向单元\/集成及消费者回归/u, ['定向单测及直接调用方回归', '涉及用户路径时补相关 E2E']],
    [/全局样式追踪受影响页面/u, ['全局样式须追踪受影响页面']],
    [/高风险标签不自动触发全量/u, ['高风险标签、进入 QA、创建 PR 均不能单独触发全量']],
    [/记录具体依据及全量的应用\/测试类型/u, ['记录具体触发项、调查证据、需要全量的应用/工作区和测试类型']],
    [/必需验证通过后，无新变更、失败或具体未解决风险不继续扩大或重复测试/u, ['必需验证通过后，仅因新变更、失败或具体未解决风险扩大或重跑测试']],
    [/时间限制不能豁免必需项/u, ['时间压力不能豁免必需项']],
    [/范围不明先调查再决定升级/u, ['调查调用关系后仍无法可靠界定影响（不猜测范围）', '先界定影响范围，再判断是否升级全量']],
  ];
  for (const [removed, kept] of dedupedIntoSection) {
    assert.doesNotMatch(qa, removed);
    for (const needle of kept) {
      assert.ok(section.includes(needle), 'conventions section 8 keeps ' + needle);
    }
  }

  // QA 自有职责保留：显式指针、§8 未列出的跨模块联动高风险清单、对 TEST_SCOPE 记录的审查与复用边界。
  for (const duty of [
    '- **测试执行**：遵循 `docs/CONVENTIONS.md` §测试范围与证据复用（变更影响表、全量触发与停止条件均以该节为准）。',
    '- **高风险变更**：认证权限、数据写删、事务、缓存、并发、外部 API、schema、共享基础库和跨模块联动补足对应专项及消费者回归。',
    '- **证据复用**：QA 审查当前任务的 `TEST_SCOPE_DECISION` 与 `TEST_SCOPE_RESULT`，核实影响分析、全量触发依据、未运行项及仍覆盖当前提交、依赖、配置和环境的 TDD 通过证据，只补新增或失效范围。',
  ]) {
    assert.ok(qa.includes(duty), duty);
  }

  // 门禁标题与四项保留；第 1 项只去掉与 §8 重复的升级尾句，第 2 项原样保留。
  const gateStart = qa.indexOf('## 测试执行验证门禁（/qa verify 前置，强制）');
  assert.ok(gateStart > 0, 'qa gate heading');
  const gate = qa.slice(gateStart, qa.indexOf('\n## ', gateStart + 1));
  for (const item of ['**测试范围已判定**', '**对应测试有有效结果**', '**测试覆盖摘要已输出**', '**专项验证按域完成**']) {
    assert.ok(gate.includes(item), item);
  }
  assert.match(gate, /全量时核实 `docs\/CONVENTIONS\.md` §测试范围与证据复用中的触发项、调查证据及具体应用\/测试类型$/mu);
  assert.match(gate, /逻辑变更有受影响的单元\/集成结果，涉及用户路径时有相关 E2E/u);
  assert.match(gate, /可复用符合 `docs\/CONVENTIONS\.md` §测试范围与证据复用的 TDD 证据/u);
  assert.ok(gate.includes('未满足任一条件 → 禁止执行 `/qa verify`，输出缺失项提示。'));
});

test('qa receipt scope stays with the receipt definition in conventions section 5', () => {
  const section = conventionsSection('5. Worktree 生命周期');
  assert.match(section, /回执不跨电脑共享.*重新执行 `qa verify`/u);
});

test('agents cleanup deferral keeps its principle and bounds and leaves the command to conventions section 6', () => {
  const agents = read('AGENTS.md');
  for (const removed of [/--defer-cleanup-step/u, /--cleanup-evidence/u, /独立性与保留措施/u]) {
    assert.doesNotMatch(agents, removed);
  }
  assert.ok(agents.includes(
    '独立清理失败不得自动升级为交付前置条件。进入 QA/OPS 时，可按 `docs/CONVENTIONS.md` §长任务状态文件 的条件与证据要求延后明确未开始的清理；不改变失败状态、不重试被拒绝操作、不豁免测试或最终完成门禁。',
  ));
  assert.ok(agents.includes(
    '开发 worktree 的未提交内容不阻止合并已通过 QA 的固定提交；推送已有提交而需保留本地内容时用 `tdd push --committed-only`。合并须在独立、干净的目标主干 worktree 写入；合并后开发目录仍有本地内容则保留目录、分支和恢复状态，明确报告 `MERGE_STATUS=MERGED` 与 `CLEANUP_STATUS=PRESERVED`，不把合并成功冒充清理完成。',
  ));
  const section = conventionsSection('6. 长任务状态文件');
  for (const kept of [
    '独立收尾清理可以在进入 QA/OPS 时显式延后',
    '`transition ... --defer-cleanup-step S5 --cleanup-evidence',
    '仅限有结构化失败证明 `not_started` 的 `blocked` 步骤，必须核实并说明不影响目标阶段的理由',
    '不得用于测试、验收、权限审批、发布前置条件或结果未知的副作用',
    '失败状态和恢复要求不变',
    '`task finish` 仍要求清理完成',
    '此参数不授权执行被拒绝的动作',
  ]) {
    assert.ok(section.includes(kept), kept);
  }
});

test('qa playbook points to the conventions test-scope section by name instead of a vague reference', () => {
  const playbook = read('AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md');
  for (const anchored of [
    '按 `docs/CONVENTIONS.md` §测试范围与证据复用选择定向、消费者及专项回归',
    '全量与证据复用遵循 `docs/CONVENTIONS.md` §测试范围与证据复用',
    '过滤参数的核实见 `docs/CONVENTIONS.md` §测试范围与证据复用；不逐条执行',
    '有效的 TDD 证据按 `docs/CONVENTIONS.md` §测试范围与证据复用的条件复用',
  ]) {
    assert.ok(playbook.includes(anchored), anchored);
  }
  for (const removed of [/全量与证据复用遵循通用约定/u, /TDD 证据按通用约定复用/u, /并核实过滤参数/u]) {
    assert.doesNotMatch(playbook, removed);
  }
  for (const kept of [
    '不逐条执行，不因进入 QA 自动运行全量或生成全仓覆盖率',
    '# 仅满足明确全量升级条件时执行',
    '具体门禁见 Expert 文件',
    '不适用项记录理由，不能据此默认新增测试类型或扩大为全量',
    '确认 §测试执行验证门禁（Expert 文件）全部满足',
  ]) {
    assert.ok(playbook.includes(kept), kept);
  }
  assert.ok(conventionsSection('8. TDD、QA 与交付').includes('确认测试运行器支持所用过滤参数'));
});

test('agents task exec usage rule stays consistent with the conventions syntax registry and cli limits', () => {
  assert.ok(read('AGENTS.md').includes(
    '使用 `pnpm agent -- task exec --task <id> --name <name> -- <command...>`，完整日志写入任务 evidence，只回传约 8KB/80 行摘要',
  ));
  const section = conventionsSection('7. 命令面');
  for (const syntax of [
    'pnpm agent -- task exec --task <id> --name <evidence-name> -- <command...>',
    'pnpm agent -- task context --task <id> [--max-bytes 8192] [--include <path#Lx-Ly>]...',
  ]) {
    assert.ok(section.includes(syntax), syntax);
  }
  const cli = read('infra/scripts/agent-runner/agent-task.js');
  for (const limit of [/DEFAULT_CONTEXT_BYTES\s*=\s*8192\b/u, /DEFAULT_SUMMARY_BYTES\s*=\s*8192\b/u, /DEFAULT_SUMMARY_LINES\s*=\s*80\b/u]) {
    assert.match(cli, limit);
  }
});

test('agents worktree section leaves the remote same-name branch rule to conventions section 5 and keeps its unique lifecycle rules', () => {
  const agents = read('AGENTS.md');
  for (const removed of [/远端同名分支/u, /固定 SHA 建立本机/u, /worktree resume/u]) {
    assert.doesNotMatch(agents, removed);
  }
  for (const kept of [
    '合并后清理由 session 封印和补偿器完成；存在未提交变更、HEAD 漂移或缺少封印时转为恢复状态，禁止删除。',
    '多 worktree、多电脑可并行开发；本机 session 与锁只保护本机生命周期，不承担跨电脑互斥。跨电脑通过远端分支 SHA 复验和主干普通非强制 push 的非快进拒绝协调。',
    '不得用拆分、改写、换工具或放宽权限重试被策略拒绝的同一操作。',
    '`policy_denied`（工具明确拒绝：保留原始理由和调用编号，停止该操作，不改写命令、换入口或扩大权限）',
    '禁止改写命令、换工具或迁移记录以重试被拒绝动作。',
  ]) {
    assert.ok(agents.includes(kept), kept);
  }
  const section = conventionsSection('5. Worktree 生命周期');
  for (const carried of [
    '如果 required fetch 后已经存在 `refs/remotes/origin/<branch>`，`worktree new` 必须阻断并提示显式恢复或更名',
    '只有 `worktree resume` 可以从远端分支固定 SHA 创建本机 tracking branch、worktree 和 session',
  ]) {
    assert.ok(section.includes(carried), carried);
  }
});

test('tdd playbook points to the conventions test-scope section by name instead of a vague reference', () => {
  const playbook = read('AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md');
  assert.ok(playbook.includes(
    '以下是命令示例，须按项目运行器核实过滤参数并选择受影响用例；全量命令仅在满足 `docs/CONVENTIONS.md` §测试范围与证据复用的升级条件时使用，不按示例逐条执行。',
  ));
  assert.doesNotMatch(playbook, /满足通用约定的升级条件/u);
  assert.ok(conventionsSection('8. TDD、QA 与交付').includes('\n### 测试范围与证据复用\n'));
});

test('experts and handbooks name the conventions test-scope section instead of a vague 通用约定 reference', () => {
  const roleFiles = ['AgentRoles', 'AgentRoles/Handbooks'].flatMap((dir) => fs
    .readdirSync(path.join(ROOT, dir))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `${dir}/${name}`));
  assert.ok(roleFiles.length >= 12, 'expert and handbook files found');
  for (const file of roleFiles) {
    assert.doesNotMatch(read(file), /通用约定/u, `${file} names docs/CONVENTIONS.md instead of 通用约定`);
  }
  assert.ok(read('AgentRoles/TDD-PROGRAMMING-EXPERT.md').includes(
    '高风险标签本身不触发全量，按 `docs/CONVENTIONS.md` §测试范围与证据复用界定范围。',
  ));
});

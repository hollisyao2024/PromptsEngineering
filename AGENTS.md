# AGENTS.md — 轻量路由与执行规范

> 目标：默认只加载本文件；通用约定、项目规则、专家资料和阶段文档按当前阶段点读。相对路径均以 Git 主 worktree 根 `repo/` 为基准。

## 必须加载的上下文

@./docs/CONVENTIONS.md
@./RULES.md

- `docs/CONVENTIONS.md` 是模板提供的通用约定；只读取与当前阶段和任务相关的章节，不要求每次全文加载。
- `RULES.md` 是实际项目自行维护的专用规则。模板源不提供、创建或覆盖它；只读取与当前变更相关的规则。
- 不得输出模型隐藏思维过程；用中文给出结论、证据、风险与下一动作。

## 仓库与状态边界

- `repo/`：主 worktree，保持在 base branch，用于协调、只读排查和生命周期入口。
- `../worktrees/`：修改 tracked 文件时使用的独立 linked worktree。
- `../tmp/`：运行状态、锁、报告与短期证据；linked worktree 中必须通过脚本解析，禁止手写 `../tmp`。
- `../cache/`：可重建缓存；`../artifacts/`：构建与发布产物。
- `node_modules` 必须在当前 worktree 独立建立，禁止链接到其他 worktree。

状态各有唯一职责：

- `../tmp/agent-task-runs/`：长任务断点状态，唯一事实来源是每个任务的 `state.json`。
- `../tmp/worktree-sessions/`：分支、PR、QA、合并和清理运行态。
- `docs/AGENT_STATE.md`：只保存六阶段稳定里程碑，不保存每次 PR、重试或运行日志。

## 任务输入门禁

- 开始前结合用户输入、仓库文档、代码和测试，明确目标、非目标、可观察验收与验证方式；不得把原始目标原样当作验收标准。
- 仓库内可发现的信息先自行检查；低风险、可逆的缺口可作最小假设继续，并在结果中说明。
- 若不同选择会实质改变产品行为、数据、安全、权限、外部合约或范围，修改前只提出解决该歧义所需的最少问题。
- mutation 任务在创建或恢复修改 worktree 前必须有显式验收；只读诊断、研究和运维可按现有目标继续。

## 两种执行流程

### 日常流程（默认）

适用于既有需求内的缺陷修复、重构、测试、文档和工具维护：

1. 只读诊断；需要修改时创建/恢复 worktree。
2. 激活 TDD，测试先行并实现。
3. 执行同步、推送、QA 和合并门禁。

### 治理流程

出现以下任一变化时使用 PRD → ARCH → TASK → TDD → QA；涉及环境或发布时再进入 DEVOPS：

- 用户可见需求或验收口径变化；
- 架构边界、数据库 schema、外部 API 合约变化；
- 安全、隐私、权限或跨模块行为变化；
- 部署拓扑、发布策略或运行环境变化。

纯解释、状态查询和只读诊断不要求激活专家。无法确定时读取 `docs/AGENT_STATE.md`，选择最小充分流程。

## 专家路由

| 阶段 | 触发 | 必须读取 |
| --- | --- | --- |
| PRD | 需求、规格、验收标准 | `AgentRoles/PRD-WRITER-EXPERT.md` |
| ARCH | 架构、边界、技术决策 | `AgentRoles/ARCHITECTURE-WRITER-EXPERT.md` |
| TASK | 依赖、里程碑、拆解 | `AgentRoles/TASK-PLANNING-EXPERT.md` |
| TDD | 代码、测试、修复 | `AgentRoles/TDD-PROGRAMMING-EXPERT.md` |
| QA | E2E、性能、安全、验收 | `AgentRoles/QA-TESTING-EXPERT.md` |
| DEVOPS | CI/CD、环境、部署 | `AgentRoles/DEVOPS-ENGINEERING-EXPERT.md` |

激活语法为 `[[ACTIVATE: PRD|ARCH|TASK|TDD|QA|DEVOPS]]`。激活后先完整读取对应专家文件，再按专家文件指引点读相关 handbook；同一时刻只激活一位专家。计划获批后不得只停在激活步骤。

治理文档只使用模块化结构：总纲负责索引，`docs/{prd|arch|task|qa}-modules/module-list.md` 维护模块清单，各功能域在独立目录维护详情。

## Worktree-First

- 只读排查不建 worktree；任何 tracked 文件修改必须先执行：
  `pnpm agent -- worktree new --phase=<phase> --task <id>`。
- 创建后，所有读写、测试、提交和 QA 命令必须在输出的 `NEXT_CWD` 中执行。
- `apply_patch` 不继承 shell `workdir`：创建 worktree 后，其所有目标必须使用经校验、位于 `NEXT_CWD` 下的绝对路径；写入容器层目录时先用 `resolveContainerPath()` 解析绝对路径。禁止以 `../` 等父级相对路径调用 `apply_patch`。若发生错误写入，删除错文件后还必须复核并清理遗留的空父目录。
- 依赖用 `pnpm agent -- worktree bootstrap` 建立；不得跨 worktree 调脚本或共享依赖目录。
- 合并后清理由 session 封印和补偿器完成；存在未提交变更、HEAD 漂移或缺少封印时转为恢复状态，禁止删除。
- 多 worktree、多电脑可并行开发；本机 session 与锁只保护本机生命周期，不承担跨电脑互斥。跨电脑通过远端分支 SHA 复验和主干普通非强制 push 的非快进拒绝协调。
- `worktree new` 在 required fetch 后发现远端同名分支时必须阻断；只有显式 `worktree resume` 可以按远端分支的固定 SHA 建立本机 worktree 和 session。

## 上下文预算与阶段交接

- 单个执行上下文的工作阈值是 `180000` token；Codex 配置应设置 `model_auto_compact_token_limit = 180000`。不得依赖接近模型最大窗口的长线程。
- 阶段开始先执行 `pnpm agent -- task resume --auto`，再执行 `pnpm agent -- task context --task <id>`；只携带胶囊、当前代码和必要的章节点读，不全文加载 `docs/AGENT_STATE.md`、Handbook 或大型模块文档。
- 普通工具调用默认输出不超过 `4000` token；任何预计超过 5 秒或 2KB 输出的测试、构建、部署命令使用 `pnpm agent -- task exec --task <id> --name <name> -- <command...>`，完整日志写入任务 evidence，只回传约 8KB/80 行摘要。
- 禁止对大日志反复执行 `write_stdin` 轮询；同一长命令最多做一次状态探测，之后等待完成或读取 `task exec` 生成的摘要。
- PRD、ARCH、TASK、TDD、QA、DEVOPS 每次阶段转换后必须生成上下文胶囊并在新的执行上下文继续；同一阶段内才允许自动连续续跑。
- 连续 10 次请求中，稳定阶段的缓存命中率必须达到 `70%`。不达标时先切换缓存可靠的模型或通道；无法切换时，同阶段最多连续执行 8 次模型请求后强制交接。
- 工具输出、摘要或上下文达到预算时不得偷偷截断为“完成”；必须保留日志路径、哈希、未验证状态和下一动作。

## 长任务断点续跑

修改 tracked 文件或执行提交、推送、部署、数据写删、Computer Use 等需恢复的副作用时，必须使用任务状态；用户明确要求持久化记录、持续执行，或预计跨会话、压缩、进程重启时也必须使用。单会话只读解释、状态查询、诊断和研究不因步骤数量而创建或恢复任务记录，不把“先建核查任务”作为前置条件。

```bash
pnpm agent -- task start --task <id> --phase <phase> --type mutation --desc "<目标>" --acceptance "<可观察验收>" --step "<安全步骤>" --verify-step "<副作用步骤>"
```

- 新任务默认 `type=mutation` 并执行 completion guard；能证明不会修改 tracked 文件时才显式使用 `diagnose|research|operation`。
- `diagnose|research` 描述工作类型，`task start/checkpoint/resume` 仍可能写状态或锁。需要记录但路径不明确时可选运行只读 `pnpm agent -- task paths --task <id>`，核对状态和锁绝对路径与实际会话可写范围；不以命令成功推断授权，不自动修改权限配置。
- 安全步骤仅在开始和结束/失败时 checkpoint；无需为无状态的微小动作反复写盘。
- 部署、推送、提交、数据库写入、文件系统变更和 Computer Use 等副作用步骤，执行前标记 `running`，结果不明时恢复为 `verify_required`，禁止盲目重放。
- 一个 checkpoint 可同时完成步骤和验收项，并记录简短证据、退出码、路径或哈希。
- 范围演进只用 `pnpm agent -- task extend --task <id> --reason "<原因>" ...` 追加步骤/验收项，不改写已完成历史。
- 治理阶段交接使用 `pnpm agent -- task transition --task <id> --phase <next> --evidence "<里程碑证据>"`；禁止跳阶段，回流只走状态机允许的路径。转换输出 `CONTEXT_HANDOFF_REQUIRED=true` 时必须先运行 `pnpm agent -- task context --task <id>`，当前上下文到此停止。
- 出错、等待用户或上下文即将压缩时必须写 `--next`。
- 任务记录、worktree 创建、提交和部署分别执行，一个工具调用只承载一个生命周期副作用；环境准备与这些操作分开，便于确认执行边界。不得用拆分、改写、换工具或放宽权限重试被策略拒绝的同一操作。
- 失败先按可观察证据区分普通工具故障、策略拒绝和执行结果未知；已有任务通过 checkpoint 的 `--failure-kind`、`--execution-state`、`--call-id` 留痕，恢复前提供 `--recovery-evidence`。具体协议见 docs/CONVENTIONS.md 的“失败分类与恢复”。
- 若 task start/checkpoint 本身不可执行，先在当前对话记录目标、验收、操作、时间、调用编号、启动状态和下一动作；仅有 `blocked by policy` 时说明“执行工具策略拒绝，具体规则未知”，不得擅自归因于 Auto-review、目录越界或 pnpm。继续获准且不依赖该操作的只读核查，不因记账失败停止整个查询；禁止改写命令、换工具或迁移记录以重试被拒绝动作。独立证据写入也需获准，不伪造 state.json；恢复后先核实副作用再补记，不跳过 mutation 的 worktree、QA 或安全门禁。
- 仅在需要任务状态的新会话、异常恢复或继续执行时，第一项任务动作是 `resume`；普通单会话只读请求不调用此写入型恢复入口：
  `pnpm agent -- task resume --auto`；多候选时必须显式选择，禁止猜测。
- 全部步骤、验收和仓库门禁通过后执行 `pnpm agent -- task finish --task <id>`；任务关闭只受该 task id 明确绑定的 worktree 生命周期状态阻断，无关任务的 recovery 不得阻止关闭。只有用户明确取消时才可 `cancel --force`。
- `state.json` 不得保存密钥、大段日志或隐藏思维过程；大证据放 `evidence/` 并只引用路径与哈希。

## 修改与交付门禁

TDD 收尾顺序固定：

开发 worktree 的未提交内容不阻止合并已通过 QA 的固定提交；推送已有提交而需保留本地内容时用 `tdd push --committed-only`。合并须在独立、干净的目标主干 worktree 写入；合并后开发目录仍有本地内容则保留目录、分支和恢复状态，明确报告 `MERGE_STATUS=MERGED` 与 `CLEANUP_STATUS=PRESERVED`，不把合并成功冒充清理完成。

独立清理失败不得自动升级为交付前置条件。进入 QA/DEVOPS 时，可按 `docs/CONVENTIONS.md` 的证据要求通过 `task transition --defer-cleanup-step <id> --cleanup-evidence "<独立性与保留措施>"` 延后明确未开始的清理；不改变失败状态、不重试被拒绝操作、不豁免测试或最终完成门禁。

1. `pnpm agent -- tdd sync`
2. `pnpm agent -- tdd push`
3. `pnpm agent -- qa plan`
4. `pnpm agent -- qa verify`
5. `pnpm agent -- qa merge`

除非用户明确要求不合并或只创建 PR，修改任务在 final 前必须完成合并、主分支同步和 completion guard。主 worktree 必须验证：

```bash
node infra/scripts/shared/github-auth-run.js -- git fetch origin <base>
git status --short --branch
git rev-parse HEAD
git rev-parse origin/<base>
pnpm agent -- finish
```

仓库级 `pnpm agent -- finish` 无 task scope，必须对全部受管理 worktree fail-closed；任务级 `task finish --task <id>` 只检查该任务明确拥有的 worktree 生命周期 blocker。只有适用门禁输出 `STATUS=OK` 且本地/远端主分支一致，才可宣告对应范围完成。最终报告必须包含 `MAIN_COMMIT`、`REMOTE_MAIN_COMMIT`、`MERGE_STATUS`、`PUSH_STATUS`、`MODIFIED_FILES` 和 `TEMPLATE_APPLY_CHECKLIST`。

高风险改动包括认证权限、数据写入删除、事务/缓存/并发、外部 API、schema、共享基础库、跨文件业务联动和 hotfix。命中时记录语义审查结论；Codex 按策略记录 `Codex review skipped by policy` 后继续门禁。

## GitHub 与安全

- 远端 Git/GitHub 操作只能走 `github-auth-run.js` 或仓库脚本，token 变量仅用 `GH_TOKEN`。
- 不得裸执行 `git fetch/pull/push/ls-remote`、`gh pr/repo/api/workflow/run`。
- PRD、ARCH、TASK、TDD、QA、DEVOPS 是阶段职责，不是电脑或账号身份；所有已获仓库权限的协作者均可在任意电脑执行任意阶段、合并 PR，或对配置主干执行普通非强制 push。
- `tdd push` 必须显式以 `config.baseBranch` 为 PR base。`qa verify` 通过后在本机原子写入绑定 base、branch、`BASE_SHA` 和 `HEAD_SHA` 的回执；`qa merge` 必须重新 fetch，并把回执与 PR base/head refs 逐项复验，任一漂移都阻断并要求重新 QA。
- 配置主干禁止 force push 和删除；功能分支只有在精确 expected SHA 的 `--force-with-lease` 保护下才可清理。主干并发更新失败时不得覆盖远端历史。
- TDD、QA 与合并门禁完全在本地执行，不创建、修改、触发或依赖 GitHub CI、required checks 或 `.github/workflows`；该目录始终由实际项目自行维护。
- 删除前解析并复核精确目标；失败、阻塞、等待确认和恢复态不得清理任务/worktree 状态。
- 不记录或提交密钥、凭据、个人信息和大段原始日志。

## 模板所有权与升级

- 本模板身份为“息壤”（ID `xirang`），官方源固定为 `https://github.com/hollisyao2024/PromptsEngineering.git` 的 `main` 分支。
- 在实际项目中，用户说“更新息壤模板”即视为显式 mutation 请求：按任务门禁创建或恢复专用 linked worktree，并在 `NEXT_CWD` 执行 `pnpm agent -- template sync`，随后完成项目的 TDD/QA 交付链；无需再次询问模板名称、仓库或命令。
- `template sync` 必须通过匿名 HTTPS required fetch 官方公开分支（不读取项目 GH_TOKEN，并隔离 Git 凭据配置）、锁定本次 commit SHA，并从该 SHA 内的 updater 应用；fetch、ref 或源校验失败必须阻断，禁止退回缓存或项目内旧模板。该命令只允许在实际项目的干净 linked worktree 执行，模板源仓库和主 worktree 均阻断。
- 模型作业包由 `agent/manifest.json` 登记，保留 `AGENTS.md`、`AgentRoles/`、`docs/CONVENTIONS.md`、`infra/scripts/` 兼容路径；技术标准、选型与初始化由独立 `architecture/` 包提供。
- 架构规划先按项目需求选择应用、存储、平台与目录，记录 `architecture.config.json`；用 `architecture plan/init/update/check` 落地。已选 shadcn 的控件和 DataTable 约束见架构标准，`RULES.md` 不重复抄写。
- 升级按文件/字段所有权执行，`xirang.lock.json` 与 `.xirang/baselines` 保存版本依据；未知基线、覆盖漂移、合并冲突或恢复态阻断，不静默丢弃定制。
- 项目差异只写入稀疏 `agent.config.json`、环境变量、CLI 参数或 project-owned 文件。
- `RULES.md`、业务源码、真实项目文档和部署实现属于项目；模板更新不得覆盖。
- 应用模板：`pnpm agent -- template update <target>`；必须先 dry-run、检查冲突，再写入并执行收敛 dry-run。
- 回灌模板是显式操作：`pnpm agent -- template backfill <source>`；不得回灌项目配置、规则、业务脚本或 generated 文件。

## 全仓扫描

跨目录且完整性影响正确性时，Discovery 与 Editing 必须分离。候选清单先写入主 repo 容器层 `tmp/scan-manifests/`，再编辑；最终报告 `scanned_count`、`matched_count`、`modified_count`、`skipped_count`，并满足 `matched = modified + skipped`。

## 稳定命令入口

优先使用 `pnpm agent -- <domain> <action>`：`task`、`worktree`、`tdd`、`qa`、`template`、`architecture`、`dev`、`ship`、`finish`。已有项目中的旧 package aliases 作为兼容入口保留；新模板不继续扩张别名集合。

# AGENTS.md — 轻量路由与执行规范

> 目标：默认只加载本文件、通用约定和项目规则；专家资料按阶段加载。相对路径均以 Git 主 worktree 根 `repo/` 为基准。

## 必须加载的上下文

@./docs/CONVENTIONS.md
@./RULES.md

- `docs/CONVENTIONS.md` 是模板提供的通用约定。
- `RULES.md` 是实际项目自行维护的专用规则。模板源不提供、创建或覆盖它；项目可按自身工具约定让缺失引用为空。
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
- 依赖用 `pnpm agent -- worktree bootstrap` 建立；不得跨 worktree 调脚本或共享依赖目录。
- 合并后清理由 session 封印和补偿器完成；存在未提交变更、HEAD 漂移或缺少封印时转为恢复状态，禁止删除。
- 多 worktree 可并行开发，合并必须通过串行 merge queue。

## 长任务断点续跑

用户明确要求持续执行、含至少 3 个可独立验证步骤，或可能跨会话时，必须创建任务状态：

```bash
pnpm agent -- task start --task <id> --desc "<目标>" --step "<安全步骤>" --verify-step "<副作用步骤>"
```

- 安全步骤仅在开始和结束/失败时 checkpoint；无需为无状态的微小动作反复写盘。
- 部署、推送、提交、数据库写入、文件系统变更和 Computer Use 等副作用步骤，执行前标记 `running`，结果不明时恢复为 `verify_required`，禁止盲目重放。
- 一个 checkpoint 可同时完成步骤和验收项，并记录简短证据、退出码、路径或哈希。
- 出错、等待用户或上下文即将压缩时必须写 `--next`。
- 新会话、异常恢复或继续执行时，第一项任务动作必须是：
  `pnpm agent -- task resume --auto`；多候选时必须显式选择，禁止猜测。
- 全部步骤、验收和仓库门禁通过后执行 `pnpm agent -- task finish --task <id>`；只有用户明确取消时才可 `cancel --force`。
- `state.json` 不得保存密钥、大段日志或隐藏思维过程；大证据放 `evidence/` 并只引用路径与哈希。

## 修改与交付门禁

TDD 收尾顺序固定：

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

只有 guard 输出 `STATUS=OK` 且本地/远端主分支一致，才可宣告完成。最终报告必须包含 `MAIN_COMMIT`、`REMOTE_MAIN_COMMIT`、`MERGE_STATUS`、`PUSH_STATUS`、`MODIFIED_FILES` 和 `TEMPLATE_APPLY_CHECKLIST`。

高风险改动包括认证权限、数据写入删除、事务/缓存/并发、外部 API、schema、共享基础库、跨文件业务联动和 hotfix。命中时记录语义审查结论；Codex 按策略记录 `Codex review skipped by policy` 后继续门禁。

## GitHub 与安全

- 远端 Git/GitHub 操作只能走 `github-auth-run.js` 或仓库脚本，token 变量仅用 `GH_TOKEN`。
- 不得裸执行 `git fetch/pull/push/ls-remote`、`gh pr/repo/api/workflow/run`。
- 删除前解析并复核精确目标；失败、阻塞、等待确认和恢复态不得清理任务/worktree 状态。
- 不记录或提交密钥、凭据、个人信息和大段原始日志。

## 模板所有权与升级

- 模板提供 `AGENTS.md`、`AgentRoles/`、`docs/CONVENTIONS.md`、`infra/scripts/` 和协议模板。
- 项目差异只写入稀疏 `agent.config.json`、环境变量、CLI 参数或 project-owned 文件。
- `RULES.md`、业务源码、真实项目文档和部署实现属于项目；模板更新不得覆盖。
- 应用模板：`pnpm agent -- template update <target>`；必须先 dry-run、检查冲突，再写入并执行收敛 dry-run。
- 回灌模板是显式操作：`pnpm agent -- template backfill <source>`；不得回灌项目配置、规则、业务脚本或 generated 文件。

## 全仓扫描

跨目录且完整性影响正确性时，Discovery 与 Editing 必须分离。候选清单先写入主 repo 容器层 `tmp/scan-manifests/`，再编辑；最终报告 `scanned_count`、`matched_count`、`modified_count`、`skipped_count`，并满足 `matched = modified + skipped`。

## 稳定命令入口

优先使用 `pnpm agent -- <domain> <action>`：`task`、`worktree`、`tdd`、`qa`、`template`、`dev`、`ship`、`finish`。已有项目中的旧 package aliases 作为兼容入口保留；新模板不继续扩张别名集合。

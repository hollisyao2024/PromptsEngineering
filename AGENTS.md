# AGENTS.md — 轻量路由与最小上下文规范
> 目的：用**一个**上下文文件在三款 CLI 中协同 6 位专家，**分阶段按需激活**，避免一次性加载过多上下文。

## 目录与角色
- 专家文件：`/AgentRoles/PRD-WRITER-EXPERT.md`、`/AgentRoles/ARCHITECTURE-WRITER-EXPERT.md`、`/AgentRoles/TASK-PLANNING-EXPERT.md`、`/AgentRoles/TDD-PROGRAMMING-EXPERT.md`、`/AgentRoles/QA-TESTING-EXPERT.md`、`/AgentRoles/DEVOPS-ENGINEERING-EXPERT.md`
- 手册与模板：详见各 `AgentRoles/Handbooks/*.playbook.md`
- 主要产物：`/docs/PRD.md`、`/docs/ARCH.md`、`/docs/TASK.md`、`/docs/QA.md`、`/docs/data/traceability-matrix.md`、`/CHANGELOG.md`、`/docs/AGENT_STATE.md`、代码
- 你全程用中文回复并展示思考过程。

@./docs/CONVENTIONS.md

## 路由总则（只读）
- **单阶段激活**：任一时刻仅激活 1 位专家，未激活专家不加载对应专家文件。
- **强制加载**：激活任何专家时，**必须先读取**对应专家文件（`AgentRoles/<对应专家>.md`）；**未完成读取前，禁止执行该专家的任何操作或产出**。
- **状态驱动**：每个阶段的输出作为下阶段的唯一输入；状态勾选记录在 `/docs/AGENT_STATE.md`。
- **点读手册**：完成专家文件读取后，**必须浏览**对应 `AgentRoles/Handbooks/*.playbook.md` 中的相关章节，再开始执行。

## 角色工作流
1. **PRD 专家**：根据用户信息产出需求文档，确保后续架构/任务/实现有清晰、可验收的依据。
2. **ARCH 专家**：根据需求文档输出架构视图，确立实现边界与质量特性。
3. **TASK 专家**：基于各模块需求、架构，定义依赖、里程碑、资源与风险，为 TDD 专家开发提供明确顺序与验收口径。
4. **TDD 专家**：按任务列表顺序实现代码与测试（单元/集成/契约/降级），修复缺陷，并根据情况更新任务状态和测试状态。
5. **QA 专家**：在 TDD 专家交付后，负责编写系统级测试（E2E/性能/安全）并执行全量验证，缺陷跟踪与发布建议，确保产品在交付前达到可发布标准。
6. **DevOps 专家**：负责 CI/CD 流水线配置与执行、环境管理（dev/staging/production）、部署运维与部署后验证，确保代码从构建到上线的全链路自动化。

## TDD 开发全流程（分支 → 编码 → PR → QA → 部署）

## 状态机（六阶段）
1. `PRD_CONFIRMED`
2. `ARCHITECTURE_DEFINED`
3. `TASK_PLANNED`
4. `TDD_DONE`
5. `QA_VALIDATED`
6. `DEPLOYED`

## 激活触发语法（跨 CLI 通用）
在对话或命令中显式写入下列控制语句可触发对应专家：
- `[[ACTIVATE: PRD]]` / `[[DEACTIVATE: PRD]]`
- `[[ACTIVATE: ARCH]]`
- `[[ACTIVATE: TASK]]`
- `[[ACTIVATE: TDD]]`
- `[[ACTIVATE: QA]]`
- `[[ACTIVATE: DEVOPS]]` / `[[DEACTIVATE: DEVOPS]]`

### 软触发与别名
- **短命令**：`/prd`、`/arch`、`/task`、`/tdd`、`/qa`、`/devops`
- **中文自然语言**：如"你是 PRD 专家"激活 PRD、"进入架构阶段"激活 ARCH、"进入部署阶段"或"配置 CI"激活 DevOps，依此类推。
- **停用/切换**：完成某阶段后仅勾选对应状态；若要进入下一阶段，请显式发 `/arch`、`/task` 等或 `[[ACTIVATE: ...]]`。
- **优先级**：同条消息内若同时包含 `[[ACTIVATE: ...]]` 与别名，以 `[[ACTIVATE: ...]]` 为准；如出现多个角色，以最后一个为准；无明确触发则保持当前阶段。

## Phase 1 — PRD 专家路由
**激活条件**：项目启动、需求变更或 `/docs/PRD.md` 需创建/重写。

**加载（门禁）**：激活后**必须立即读取**专家文件 `/AgentRoles/PRD-WRITER-EXPERT.md`，未读取前禁止执行任何操作。

**完成状态**：在 `/docs/AGENT_STATE.md` 勾选 `PRD_CONFIRMED`。

**快捷命令**：`/prd confirm`（自动执行 `[[ACTIVATE: PRD]]` 并读取专家文件）。

## Phase 2 — ARCH 专家路由
**激活条件**：`PRD_CONFIRMED` 之后，准备定义系统视图与架构决策。

**加载（门禁）**：激活后**必须立即读取**专家文件 `/AgentRoles/ARCHITECTURE-WRITER-EXPERT.md`，未读取前禁止执行任何操作。

**完成状态**：在 `/docs/AGENT_STATE.md` 勾选 `ARCHITECTURE_DEFINED`。

**快捷命令**：`/arch data-view`、`/arch sync`（调用时自动激活 ARCH，并加载对应专家文件）。

## Phase 3 — TASK 规划专家路由
**激活条件**：`ARCHITECTURE_DEFINED` 后，进入任务分解与依赖规划。

**加载（门禁）**：激活后**必须立即读取**专家文件 `/AgentRoles/TASK-PLANNING-EXPERT.md`，未读取前禁止执行任何操作。

**完成状态**：在 `/docs/AGENT_STATE.md` 勾选 `TASK_PLANNED`。

**快捷命令**：`/task plan`（自动触发 TASK 专家并同期读取模板）。

## Phase 4 — TDD 编程专家路由
**激活条件**：`TASK_PLANNED` 勾选后，进入实现与持续回写。

**加载（门禁）**：激活后**必须立即读取**专家文件 `/AgentRoles/TDD-PROGRAMMING-EXPERT.md`，未读取前禁止执行任何操作。

**完成状态**：Post-Push Gate（code-review）通过后自动勾选 `TDD_DONE`，并**默认自动串联 QA 流程**（`/qa plan` → 智能测试编写 → `/qa verify` → `/qa merge`）。使用 `--no-qa` 跳过串联。

**快捷命令**：
- **作用域规则**：`/tdd sync`、`/tdd push` 裸命令默认 `session`（仅当前会话/当前分支范围）；传入描述/参数或显式 `--project` 时进入 `project`（全项目）模式。`/tdd push` 在两种作用域下都只处理当前分支/当前 PR，不会操作其他分支。
- `/tdd diagnose`：诊断当前代码/测试问题
- `/tdd fix`：修复已识别问题
- `/tdd sync`：**首先执行** `pnpm run tdd:sync` **脚本**（同步当前会话涉及的 TASK/模块文档，自动勾选复选框、更新状态；`--project` 全量扫描）。完成后自动串联 Pre-Push Gate → `/tdd push` → Post-Push Gate → **自动 QA 流程**；使用 `--no-qa` 跳过 QA 串联
- `/tdd push`：**首先执行** `pnpm run tdd:push` **脚本**（推代码 + 自动创建当前分支 PR）；`--project` 可显式进入项目模式。两种模式都不触发 Gate，执行前须确认 Pre-Push Gate 已完成；Post-Push Gate 通过后自动串联 QA 流程，`--no-qa` 可跳过
- `/tdd new-branch`：**首先执行** `pnpm run tdd:new-branch` **脚本**，创建 feature/fix 分支（单分支模式，通常由分支门禁自动调用，也可手动执行）
- `/tdd new-worktree`：**首先执行** `pnpm run tdd:new-worktree` **脚本**，在 `.worktrees/` 下创建 Git Worktree 并行开发环境（推荐用于多任务并行开发）
- `/tdd worktree list`：**首先执行** `pnpm run tdd:worktree-list` **脚本**，列出当前所有活跃的 worktree
- `/tdd worktree remove`：**首先执行** `pnpm run tdd:worktree-remove` **脚本**，清理指定 worktree（检查未提交变更后安全移除）
- `/tdd resume [branch]`：**首先执行** `pnpm run tdd:resume` **脚本**，自动感知 worktree/stash 双模式恢复之前的开发环境；不带参数时列出所有可恢复目标

**分支门禁**（自动执行，无需手动触发）：
  - TDD 专家激活后（含 `/tdd`、`/tdd diagnose`、`/tdd fix` 等所有入口），**第一步**自动检查当前 Git 分支。
  - 若在 `main`/`master`/`develop` 等主干分支上 → 禁止执行任何代码操作，默认执行 `/tdd new-branch`（单分支模式，Claude Code 会话完整保留）；显式指定 `--worktree` 时走 `/tdd new-worktree`（高级备选，会重启会话）。
  - 已在正确的 `feature/TASK-*` 或 `fix/*` 分支上，或已在对应 worktree 中工作则跳过。
  - 若在无关分支上 → 自动 stash 未提交变更，提示用户切换或创建新分支；稍后用 `/tdd resume` 恢复。

**分支生成**（`/tdd new-branch`）：
  - **有 Task**：`/tdd new-branch TASK-<DOMAIN>-<编号>` → 自动从 TASK.md WBS 的"名称"列提取任务名称，转 kebab-case 英文短语（≤30 字符）作为描述 → `feature/TASK-XXX-<auto-desc>`
  - **无 Task**（bug 修复/临时需求）：`/tdd new-branch` 不带 Task ID → 从用户描述提取关键词 → `fix/<desc>` 或 `feature/<desc>`
  - 两种模式下用户可显式传入描述来覆盖自动生成。该命令通常由分支门禁自动调用，也可手动执行。

CI/CD 流水线配置与部署由 DevOps 专家负责。

## Phase 5 — QA 专家路由
**激活条件**：`TDD_DONE` 勾选后**自动激活**（从 TDD Post-Push Gate 串联）；也可手动激活进行独立验证或回归测试。

**加载（门禁）**：激活后**必须立即读取**专家文件 `/AgentRoles/QA-TESTING-EXPERT.md`，未读取前禁止执行任何操作。

**完成状态**：`/qa merge` 合并当前分支对应 PR 到 main 后勾选 `QA_VALIDATED`；如发现阻塞问题，可退回前一阶段重新处理。

**快捷命令**：
- **作用域规则**：`/qa plan`、`/qa verify`、`/qa merge` 裸命令默认 `session`（仅当前会话范围）；传入描述/参数或显式 `--project` 时进入 `project`（全项目）模式。`/qa merge` 在两种作用域下都只处理当前分支 PR，不会操作其他分支。
- `/qa plan`：**首先执行** `pnpm run qa:generate` **脚本**（读取 PRD/ARCH/TASK，解析数据，生成测试用例和策略，记录会话上下文）。默认 `session`；`--project` 执行全量刷新。支持 `--modules <list>` 指定模块、`--dry-run` 预览
- `/qa verify`：**首先执行** `pnpm run qa:verify` **脚本**（优先基于 `/qa plan` 会话状态文件验证，检查文档完整性，生成验收建议）。默认 `session`；`--project` 执行全项目验证（Go/Conditional/No-Go）
- `/qa merge`：**首先执行** `pnpm run qa:merge` **脚本**（包含自动 rebase、发布门禁检查、双策略合并、版本递增 + CHANGELOG + tag、AGENT_STATE 更新、worktree 清理等 17 个关键步骤），合并**当前分支对应 PR** 到 main。支持 `--skip-checks`（跳过门禁）、`--dry-run`（预览）。脚本自动完成全部操作（含版本递增 + tag + AGENT_STATE + worktree 清理 + push），完成后交接 DevOps（确保工作区干净后再部署）

部署命令（`/ship`、`/cd`）已迁移至 DevOps 专家。

## Phase 6 — DevOps 专家路由
**激活条件**：`TASK_PLANNED` 后可激活（CI 配置模式）；`QA_VALIDATED` 后可激活（部署执行模式）。

**加载（门禁）**：激活后**必须立即读取**专家文件 `/AgentRoles/DEVOPS-ENGINEERING-EXPERT.md`，未读取前禁止执行任何操作。

**完成状态**：部署成功并通过冒烟验证后，在 `/docs/AGENT_STATE.md` 勾选 `DEPLOYED`。

**快捷命令**：
- CI 命令：`/ci run`、`/ci status`（自动激活 DevOps 专家）
- 部署命令：
  - `/ship dev`：**首先执行** `pnpm ship:dev` **脚本**（本地部署到开发环境，支持 `:quick` 快速模式）
  - `/ship staging`：**首先执行** `pnpm ship:staging` **脚本**（本地部署到预发环境，支持 `:quick` 快速模式）
  - `/ship prod`：**首先执行** `pnpm ship:prod` **脚本**（本地部署到生产环境，仅完整检查）
  - `/cd staging`：**首先执行** `pnpm cd:staging` **脚本**，通过 CI/CD 远程部署到预发环境
  - `/cd prod`：**首先执行** `pnpm cd:prod` **脚本**，通过 CI/CD 远程部署到生产环境
- 环境命令：`/env check <env>`、`/env status`（自动激活 DevOps 专家）
- 本地服务命令：`/restart`（自动激活 DevOps 专家，**首先执行** `pnpm dev:restart` **脚本** → `server-dev-pm2.sh restart`，PM2 服务名 `server-dev`，端口 `4000`，日志 `/tmp/server-dev.log`）

## 包管理器
本项目使用 pnpm，禁止使用 npm 或 yarn。
- 安装依赖：`pnpm install`
- 添加依赖：`pnpm add <package>`
- 运行脚本：`pnpm run <script>` 或 `pnpm <script>`

---

> 本文件仅描述激活及路由规范，具体职责、产出内容与工具详见各自 `AgentRoles/*.md` 和 Handbook。

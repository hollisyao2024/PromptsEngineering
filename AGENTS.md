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
- **执行衔接**：收到任务指令后，**第一步**根据用户意图识别并激活对应专家，再开始任何操作：
  - 定义/变更需求、功能规格、UI 设计规格、验收标准 → PRD
  - 设计/变更系统架构、技术选型、模块划分 → ARCH
  - 拆解/调整任务、优先级、里程碑 → TASK
  - 编写/修改代码实现功能、修复 bug、编写单元/集成测试 → TDD
  - 编写/执行 E2E、性能、安全测试 → QA
  - 配置/执行 CI/CD、部署或管理环境 → DEVOPS
  - 仍不确定时，读取 `/docs/AGENT_STATE.md` 判断当前所处阶段
- **搜索节约**：搜索代码前，先检查 memory 和本文件中是否已有目标文件路径。优先用文件名匹配搜索（Claude Code: `Glob` / Gemini CLI: `glob` / Codex CLI: shell `find`/`fd`）定位文件，再精确读取目标行范围（Claude Code: `Read` / Gemini CLI: `read_file` / Codex CLI: shell `cat`/`head`），避免全项目内容搜索（Claude Code: `Grep` / Gemini CLI: `grep_search` / Codex CLI: shell `rg`/`grep`）。具体优先级：
  1. 已知路径 → 直接读取文件（零搜索成本）
  2. 知道文件名模式 → 文件名匹配搜索（仅返回路径，token 极低）
  3. 必须搜内容 → 先用文件名匹配缩小目录范围，再对目标目录做内容搜索（避免全项目扫描）
  4. 项目有 `docs/data/CODEBASE_MAP.md` 时，搜索前优先读取该文件定位目标

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
- **作用域规则**：`/tdd sync`、`/tdd push` 裸命令默认 `session`；传入描述/参数或显式 `--project` 时进入 `project` 模式。
- `/tdd diagnose`：诊断当前代码/测试问题
- `/tdd fix`：修复已识别问题
- `/tdd sync`：**首先执行** `pnpm run tdd:sync` **脚本**（同步 TASK/模块文档，自动勾选复选框、更新状态）。完成后自动串联后续 Gate + QA（`--no-qa` 跳过）
- `/tdd push`：**首先执行** `pnpm run tdd:push` **脚本**（推代码 + 自动创建当前分支 PR）。不触发 Gate；Post-Push 通过后串联 QA（`--no-qa` 跳过）
- `/tdd new-branch`：**首先执行** `pnpm run tdd:new-branch` **脚本**，创建 feature/fix 分支（单分支模式，通常由分支门禁自动调用，也可手动执行）
- `/tdd new-worktree`：**首先执行** `pnpm run tdd:new-worktree` **脚本**，在 `.worktrees/` 下创建 Git Worktree 并行开发环境（推荐用于多任务并行开发）
- `/tdd worktree list`：**首先执行** `pnpm run tdd:worktree-list` **脚本**，列出当前所有活跃的 worktree
- `/tdd worktree remove`：**首先执行** `pnpm run tdd:worktree-remove` **脚本**，清理指定 worktree（检查未提交变更后安全移除）
- `/tdd resume [branch]`：**首先执行** `pnpm run tdd:resume` **脚本**，自动感知 worktree/stash 双模式恢复之前的开发环境；不带参数时列出所有可恢复目标

分支门禁与分支生成规则详见 Expert 文件 §输入→预检查 和 §命令说明。

CI/CD 流水线配置与部署由 DevOps 专家负责。

## Phase 5 — QA 专家路由
**激活条件**：`TDD_DONE` 勾选后**自动激活**（从 TDD Post-Push Gate 串联）；也可手动激活进行独立验证或回归测试。

**加载（门禁）**：激活后**必须立即读取**专家文件 `/AgentRoles/QA-TESTING-EXPERT.md`，未读取前禁止执行任何操作。

**完成状态**：`/qa merge` 合并当前分支对应 PR 到 main 后勾选 `QA_VALIDATED`；如发现阻塞问题，可退回前一阶段重新处理。

**快捷命令**：
- **作用域规则**：裸命令默认 `session`；传入描述/参数或显式 `--project` 时进入全项目模式。
- `/qa plan`：**首先执行** `pnpm run qa:generate` **脚本**（生成测试用例和策略）。支持 `--modules <list>`、`--dry-run`
- `/qa verify`：**首先执行** `pnpm run qa:verify` **脚本**（验证文档完整性，输出 Go/Conditional/No-Go）
- `/qa merge`：**首先执行** `pnpm run qa:merge` **脚本**（含 rebase/门禁/合并/版本递增等 17 步），合并当前分支 PR 到 main。支持 `--skip-checks`、`--dry-run`

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
- 本地服务命令：`/restart`（自动激活 DevOps 专家，**首先执行** `pnpm dev:restart` **脚本**，重启本地开发服务）

## 包管理器
本项目使用 pnpm，禁止使用 npm 或 yarn。
- 安装依赖：`pnpm install`
- 添加依赖：`pnpm add <package>`
- 运行脚本：`pnpm run <script>` 或 `pnpm <script>`

---

> 本文件仅描述激活及路由规范，具体职责、产出内容与工具详见各自 `AgentRoles/*.md` 和 Handbook。

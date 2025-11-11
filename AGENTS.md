---
name: agents-router
summary: 单文件、多模型（Codex CLI / Claude Code CLI / Gemini CLI）通用的轻量级 Agent 路由说明；按需加载角色，最小上下文占用。
version: 1.7 (2025-11-02)
---

# AGENTS.md — 轻量路由与最小上下文规范
> 目的：用**一个**上下文文件在三款 CLI 中协同 5 位专家，**分阶段按需激活**，避免一次性加载过多上下文。

## 目录与角色
- 角色文件：`/AgentRoles/PRD-WRITER-EXPERT.md`、`/AgentRoles/ARCHITECTURE-WRITER-EXPERT.md`、`/AgentRoles/TASK-PLANNING-EXPERT.md`、`/AgentRoles/TDD-PROGRAMMING-EXPERT.md`、`/AgentRoles/QA-TESTING-EXPERT.md`
- 手册与模板：详见各 `AgentRoles/Handbooks/*.playbook.md`
- 主要产物：`/docs/PRD.md`、`/docs/ARCH.md`、`/docs/TASK.md`、`/docs/QA.md`、`/docs/data/traceability-matrix.md`、`/CHANGELOG.md`、`/docs/AGENT_STATE.md`、代码
- 你全程用中文回复并展示思考过程。

## 路由总则（只读）
- **单阶段激活**：任一时刻仅激活 1 位专家，未激活专家不加载对应角色文档。
- **就近读取**：激活阶段时再读取对应 `AgentRoles/*.md`，避免一次性将所有角色铺开。
- **状态驱动**：每个阶段的输出作为下阶段的唯一输入；状态勾选记录在 `/docs/AGENT_STATE.md`。
- **点读手册**：激活后优先浏览 `AgentRoles/Handbooks/*.playbook.md` 中对应节内容。

## 角色工作流
1. **PRD 专家**：根据用户信息产出需求文档，确保后续架构/任务/实现有清晰、可验收的依据。
2. **ARCH 专家**：根据需求文档输出架构视图，确立实现边界与质量特性。
3. **TASK 专家**：基于各模块需求、架构，定义依赖、里程碑、资源与风险，为 TDD 专家开发提供明确顺序与验收口径。
4. **TDD 专家**：按任务列表顺序实现代码、修复缺陷和测试，并根据情况更新任务状态和测试状态。
5. **QA 专家**：在 TDD 专家交付后，负责系统级验证、缺陷跟踪与发布建议，确保产品在交付前达到可发布标准。

## 状态机（五阶段）
1. `PRD_CONFIRMED`
2. `ARCHITECTURE_DEFINED`
3. `TASK_PLANNED`
4. `TDD_DONE`
5. `QA_VALIDATED`

### 状态文件示例
```markdown
# AGENT_STATE
- [ ] 1. PRD_CONFIRMED
- [ ] 2. ARCHITECTURE_DEFINED
- [ ] 3. TASK_PLANNED
- [ ] 4. TDD_DONE (代码合并前)
- [ ] 5. QA_VALIDATED (发布前)
```

## 激活触发语法（跨 CLI 通用）
在对话或命令中显式写入下列控制语句可触发对应专家：
- `[[ACTIVATE: PRD]]` / `[[DEACTIVATE: PRD]]`
- `[[ACTIVATE: ARCH]]`
- `[[ACTIVATE: TASK]]`
- `[[ACTIVATE: TDD]]`
- `[[ACTIVATE: QA]]`

### 软触发与别名
- **短命令**：`/prd`、`/arch`、`/task`、`/tdd`、`/qa`
- **中文自然语言**：如“你是 PRD 专家”激活 PRD、”进入架构阶段”激活 ARCH，依此类推。
- **停用/切换**：完成某阶段后仅勾选对应状态；若要进入下一阶段，请显式发 `/arch`、`/task` 等或 `[[ACTIVATE: ...]]`。
- **优先级**：同条消息内若同时包含 `[[ACTIVATE: ...]]` 与别名，以 `[[ACTIVATE: ...]]` 为准；如出现多个角色，以最后一个为准；无明确触发则保持当前阶段。

## Phase 1 — PRD 专家路由
**激活条件**：项目启动、需求变更或 `/docs/PRD.md` 需创建/重写。

**加载**：激活时读取 `/AgentRoles/PRD-WRITER-EXPERT.md`（需求与 PRD 细节由该文件维护）。

**完成状态**：在 `/docs/AGENT_STATE.md` 勾选 `PRD_CONFIRMED`。

**快捷命令**：`/prd confirm`（自动执行 `[[ACTIVATE: PRD]]` 并读取角色文件）。

**说明**：具体产出、拆分规则与校验工具请见 `/AgentRoles/PRD-WRITER-EXPERT.md` 及其 Handbook。

## Phase 2 — ARCH 专家路由
**激活条件**：`PRD_CONFIRMED` 之后，准备定义系统视图与架构决策。

**加载**：激活时读取 `/AgentRoles/ARCHITECTURE-WRITER-EXPERT.md`。

**完成状态**：在 `/docs/AGENT_STATE.md` 勾选 `ARCHITECTURE_DEFINED`。

**快捷命令**：`/arch data-view`、`/arch sync`（调用时自动激活 ARCH，并加载对应角色文档）。

**说明**：具体架构产出与 ADR 创建细节由该角色文件和 Handbook 说明。

## Phase 3 — TASK 规划专家路由
**激活条件**：`ARCHITECTURE_DEFINED` 后，进入任务分解与依赖规划。

**加载**：激活时读取 `/AgentRoles/TASK-PLANNING-EXPERT.md`。

**完成状态**：在 `/docs/AGENT_STATE.md` 勾选 `TASK_PLANNED`。

**快捷命令**：`/task plan`（自动触发 TASK 专家并同期读取模板）。

**说明**：WBS、依赖矩阵等任务细节由 `AgentRoles/TASK-PLANNING-EXPERT.md` 及手册支撑。

## Phase 4 — TDD 编程专家路由
**激活条件**：`TASK_PLANNED` 勾选后，进入实现与持续回写。

**加载**：激活时读取 `/AgentRoles/TDD-PROGRAMMING-EXPERT.md`。

**完成状态**：合并前在 `/docs/AGENT_STATE.md` 勾选 `TDD_DONE`；如被退回则取消并回到对应阶段。

**快捷命令**：`/tdd diagnose`、`/tdd fix`、`/tdd sync`、`/tdd new-branch`（每个命令触发即激活 TDD 专家）。
**分支生成**：
  - `/tdd new-branch` TASK-<DOMAIN>-<编号>（如 `/tdd new-branch` TASK-EXPORT-004）可直接创建具有 Task ID 的 feature 分支，`TASK_SHORT` 只在需要附加简短描述时才额外填写。
  - 该命令会把 `TASK_ID` 装进 `feature/TASK-XXX-<desc>` 分支并执行 `git checkout -b`，保持 `/tdd` 流程所需的命名约束。

**说明**：TDD、文档回写、CI/CD 实施规范在角色卡片与 Handbook 中对齐。

## Phase 5 — QA 专家路由
**激活条件**：`TDD_DONE` 勾选后，发布前需独立验证或回归测试时。

**加载**：激活时读取 `/AgentRoles/QA-TESTING-EXPERT.md`。

**完成状态**：所有阻塞缺陷关闭后勾选 `QA_VALIDATED`；如发现阻塞问题，可退回前一阶段重新处理。

**快捷命令**：`/qa plan`、`/qa verify`、`/ship staging`/`/ship prod`、`/cd staging`/`/cd prod`（均自动激活 QA 专家）。

**说明**：测试策略、验证矩阵与发布建议由 QA 角色文档与 Handbook 描述，追溯矩阵同步也在其中。

---

## 快捷命令速查（按专家分组）
> **执行规则**：使用任一快捷命令时，会**自动激活**对应专家并读取其角色文件。

### PRD 专家
- `/prd confirm` — 收口 PRD（范围/AC/追溯/开放问题），勾选 `PRD_CONFIRMED`

### ARCH 专家
- `/arch data-view` — 刷新数据视图（更多操作见角色卡片）
- `/arch sync` — 验证 PRD ↔ ARCH ID 双向追溯（Story ID、Component ID）

### TASK 专家
- `/task plan` — 刷新 WBS/依赖（更多操作见角色卡片）

### TDD 专家
- `/tdd diagnose` — 诊断当前代码/测试问题
- `/tdd fix` — 修复已识别问题
- `/tdd sync` — 执行文档回写 Gate（同步 PRD/ARCH/TASK/CHANGELOG/ADR）
- `/tdd push`：执行版本号递增，并推送到远程仓库
- `/tdd new-branch`：在 TDD 编码前，新开一个任务分支
- `/ci run` — 触发 CI 流水线
- `/ci status` — 查看 CI 状态

### QA 专家
- `/qa plan` — 基于 PRD+ARCH+TASK 自动生成/刷新 QA.md，包含测试策略、测试用例、测试矩阵
- `/qa verify` — 快速聚焦验收项（更多操作见角色卡片）
- `/ship staging` — 在本地直接部署到预发环境
- `/ship prod` — 在本地直接部署到生产环境
- `/cd staging` — 通过 GitHub Actions 触发远程部署到预发环境
- `/cd prod` — 通过 GitHub Actions 触发远程部署到生产环境

---

> 本文件仅描述激活及路由规范，具体职责、产出内容与工具详见各自 `AgentRoles/*.md` 和 Handbook。

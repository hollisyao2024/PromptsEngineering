# /AgentRoles/TASK-PLANNING-EXPERT.md

> **路径基准**：本文件中所有相对路径以 `repo/`（Git 主 worktree 根）为基准；详见 `/AGENTS.md` §仓库拓扑。

## 角色宗旨
将 PRD 与架构设计**分解为可执行任务（WBS）**，定义依赖、里程碑、资源与风险，为 TDD 开发提供明确顺序与验收口径。

## 激活与边界
- **仅在激活时**才被读取；未激活时请勿加载本文件全文。
- 允许读取：`/docs/PRD.md`、`/docs/ARCH.md`、目录规范 `/docs/CONVENTIONS.md`。
- 阶段入口和边界遵循 `AGENTS.md`“上下文预算与阶段交接”；先使用 `pnpm agent -- task context --task <id>` 获取胶囊，相关总纲和模块按标题点读，不全文加载。
- 禁止行为：编写功能代码。
- Worktree Gate：只读任务评审不创建 worktree；若要创建或修改 `/docs/TASK.md`、模块 TASK、任务依赖矩阵等 tracked 文件，必须执行 `pnpm agent -- worktree new --phase=task --task <task-id>` 并进入脚本输出的 `NEXT_CWD`。

## 长任务门禁
- 任务状态、恢复与阶段切换遵循 `AGENTS.md`“长任务断点续跑”；本阶段新建记录使用 `--phase task`。
- 新依赖、里程碑或 WBS 范围只能用 `task extend` 追加运行步骤/验收项；文档写入、提交和推送均使用 `pnpm agent -- task checkpoint ...`。
- `TASK_PLANNED` 有证据后执行 `pnpm agent -- task transition --task <id> --phase tdd --evidence "TASK_PLANNED: <证据>"`；设计或需求缺口分别回流 `arch`/`prd`。
- 综合任务继续交接；独立 TASK-only 任务仅在验收和仓库门禁全部通过后执行 `pnpm agent -- task finish --task <id>`。

## 输入
- 已确认的`/docs/PRD.md`（作为总纲）、`/docs/ARCH.md`（作为总纲）。
- 从 PRD/ARCH 模块清单点读当前范围对应行，再读取相关模块文档，不全文加载全部模块：
  - `/docs/prd-modules/{domain}/PRD.md`
  - `/docs/arch-modules/{domain}/ARCH.md`
- 同步读取 `/docs/task-modules/module-list.md`（如尚未创建则在规划时创建）：该文件记录模块范围、负责人和规划依赖，用作主 TASK 的模块索引。
- 若模块同时维护 `/docs/task-modules/{domain}/TASK.md`，核对模块 WBS 与主 TASK 的索引和依赖矩阵；执行进度与交付事件以 task state 和 session 为准。

## 输出

### 核心产物
- **`/docs/TASK.md`**：主 TASK 总纲与模块索引，承载跨模块里程碑、依赖矩阵、资源/时间线和全局风险，不承载模块级详细 WBS 或运行态。
- **子模块 TASK 文档**：目录结构、模板、ID 规范详见 `/docs/task-modules/MODULE-TEMPLATE.md`。模块 TASK 文档负责模块级 WBS、Deliverable 和 QA 验收口径；规划依赖变化时同步主文档索引与依赖矩阵。
- **模块清单同步**：主 TASK 中的"模块任务索引"与 `/docs/task-modules/module-list.md` 保持模块范围和规划依赖一致，不镜像子任务执行状态。

### 文档结构（强制）
所有项目统一使用“主 TASK 总纲与索引 + 模块 TASK”结构，不支持单一 TASK 模式。每个 PRD/ARCH 模块必须有对应 `/docs/task-modules/{domain}/TASK.md`，详细 WBS 只维护在模块 TASK 中。

### 全局数据（`/docs/data/`）
- **任务依赖矩阵（跨模块）**：`/docs/data/task-dependency-matrix.md`（由 `docs/data/templates/task/TASK-DEPENDENCY-MATRIX-TEMPLATE.md` 生成），记录所有模块 Task 之间的前后依赖、提前量与关键路径，供 ARCH/TDD/QA 协同排期与验证。
- 生成 `task-dependency-matrix.md` 后同步 `/docs/TASK.md` 的依赖段、`module-list.md` 的规划依赖，以及 `docs/data/traceability-matrix.md` 中对应 Story/AC/Test Case ID 的稳定映射；执行结果留在任务与 QA 证据中。

## 模块化任务流程

- 先从 `/docs/task-modules/module-list.md` 确认各模块的范围、负责人与规划依赖，主 TASK 只保留总纲、重要依赖与跨模块里程碑，具体 Story/Task 由 `/docs/task-modules/{domain}/TASK.md` 维护。
- 每个模块必须包含：
  - Story → Task → Deliverable 的模块级 WBS（Owner/Estimate/依赖）
  - DB/接口/事件迁移/监控/QA 验收清单
  - 规划风险与验收口径；子任务完成证据记录在 task state/session，不即时回写 tracked 规划文档
- 规划文档更新触发点：依赖或范围变化时同步主 TASK、模块 TASK 和模块清单；新增模块时建立对应索引与链接。运行进度不触发文档镜像更新。

### 基础设施任务
- WBS 应包含基础设施任务（CI 流水线配置、部署脚本准备、环境配置），标记 Owner 为 DevOps，关联 ARCH 运维视图的对应条目。这些任务在 `TASK_PLANNED` 后由 DevOps 专家领取执行。

## 完成定义（DoD）
- `/docs/TASK.md` 已生成或刷新，WBS 包含所有 Story 对应的 Task
- 依赖矩阵与关键路径已计算并可视化
- DB 任务表头已填充（Expand/Migrate/Contract、Backfill/对账/回滚）
- CI/CD 和部署相关任务已纳入 WBS 并标记 Owner（DevOps）
- 定义里程碑（含通过条件）
- 主/模块 TASK 文档联动核查完成
- PRD、ARCH、TASK 三套模块清单的模块集合一致
- 在任务 state 中记录 `TASK_PLANNED` 证据

## 交接
- 交接前复查主/模块 TASK 文档的里程碑与规划依赖，确保同步。
- 移交给 TDD 编程专家（TDD）。

## TASK 模板

> 使用时先按照模板写出章节，再回到 Playbook 做完整性/质量自检。

复制 `/docs/data/templates/task/TASK-TEMPLATE.md` 到 `/docs/TASK.md`，并参照 `/docs/task-modules/MODULE-TEMPLATE.md` 为每个功能域生成模块任务文档。

### 模块 TASK 文档模板
详见 `/docs/task-modules/MODULE-TEMPLATE.md`（含 Appendix A 模块骨架）。

## 快捷命令
- `/task plan`：基于主/模块 PRD 与 ARCH 生成或刷新 `/docs/TASK.md`、`task-modules/module-list.md` 和全部模块 TASK 文档（**WBS、依赖矩阵、关键路径、里程碑、风险**），并填充"**DB 任务段**"（固定表头：Backfill/双写观察/对账/回滚等）。完成后在任务 state 中记录 `TASK_PLANNED` 证据。

## ADR 触发规则（TASK 阶段）
- 出现重要取舍（例如：任务分配策略变化、里程碑调整）→ 新增 ADR；状态 `Proposed/Accepted`。

## 参考资源
- Handbook: `/AgentRoles/Handbooks/TASK-PLANNING-EXPERT.playbook.md`
- Module template: `/docs/task-modules/MODULE-TEMPLATE.md`

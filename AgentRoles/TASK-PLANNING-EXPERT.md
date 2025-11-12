# /AgentRoles/TASK-PLANNING-EXPERT.md

## 角色宗旨
将 PRD 与架构设计**分解为可执行任务（WBS）**，定义依赖、里程碑、资源与风险，为 TDD 开发提供明确顺序与验收口径。

## 激活与边界
- **仅在激活时**才被读取；未激活时请勿加载本文件全文。
- 允许读取：`/docs/PRD.md`、`/docs/ARCH.md`、目录规范 `/docs/CONVENTIONS.md`。
- 禁止行为：编写功能代码。

## 输入
- 已确认的`/docs/PRD.md`（作为总纲）、`/docs/ARCH.md`（作为总纲）。
- 若 PRD/ARCH 已模块化，按需读取对应的模块文档：
  - `/docs/prd-modules/{domain}/PRD.md`
  - `/docs/arch-modules/{domain}/ARCH.md`
- 若项目拆分为模块，请同步读取 `/docs/task-modules/module-list.md`：该文件记录各模块的状态、负责人、依赖与最后更新，用作主 TASK 的模块索引与进度参考；在生成模块任务前需确认该表格的状态/依赖列反映最新计划。
- 若模块同时维护 `/docs/task-modules/{domain}/TASK.md`，在分析主/模块任务时务必同步批注并明确哪些字段由模块文档决定（如模块 WBS、交付事件、状态），以确保主 TASK 的模块索引/依赖矩阵与模块 TASK 文档保持一致。

## 输出

### 核心产物
- **`/docs/TASK.md`**：主 TASK 文档，唯一权威版本，模板参考本文件 § TASK 模板。TASK 文档承载项目任务、模块任务索引、里程碑、WBS、依赖矩阵、资源/时间线、风险/沟通等，与对应 PRD/ARCH 模块对齐。为每个模块 Task 描述提供模块 TASK 文档路径、当前状态与最后更新说明，确保主文档不仅列出总纲，也能从索引直接跳转到具体模块任务；如模块文档发生状态/依赖/里程碑变更，必须同步反映在主 TASK 的模块索引/依赖矩阵中。
- **子模块 TASK 文档**：所有模块目录结构、子模块模板、ID 规范等均在 `/docs/task-modules/MODULE-TEMPLATE.md` 详解。模块 TASK 文档负责模块级 WBS、Deliverable、QA 验收等具体内容，并在每次交付或依赖调整时回写主文档的模块索引状态与更新时间，保持双向追溯。
- **模块清单同步**：主 TASK 中的“模块任务索引”表需定期与 `/docs/task-modules/module-list.md` 中的状态/依赖/最后更新字段互为镜像；每次模块级子任务完成、里程碑变更或依赖调整时，都要同步更新模块清单并在主 TASK 记录新状态与更新时间，以便 ARCH/TDD/QA 能一眼识别当前模块交付节奏。

### 拆分条件
- **拆分触发条件**（任一成立）：
  - 主任务文档 > 1000 行
  - 工作包WBS > 50 个
  - 存在 3+ 并行开发流
  - 项目周期 > 6 个月
  - 跨模块依赖复杂 > 10 条

## 模块化任务流程

- 在模块化项目中，先从 `/docs/task-modules/module-list.md` 中确认各模块的阶段、负责人与依赖，主 TASK 只保留总纲、重要依赖与跨模块里程碑，其余具体 Story/Task 由对应 `/docs/task-modules/{domain}/TASK.md` 维护。
- 每个模块必须包含：
  - Story → Task → Deliverable 的模块级 WBS，明确 Owner/Estimate/依赖；
  - DB/接口/事件迁移/监控/QA 验收清单，提供模块双向追溯；
  - 模块状态与风险，随着子任务完成即时在当前模块文档、主 TASK 的模块索引表及 `module-list.md` 更新“状态”“最后更新”字段。
- 模块任务更新触发点：
  1. 子任务完成：在 `/docs/task-modules/{domain}/TASK.md` 中勾选复选框并补写简要交付说明，任务列表状态列手动写入`✅ 已完成 (YYYY-MM-DD)`（示例：`✅ 已完成 (2025-11-09)`）记录实际交付日期；同时在 `module-list.md` 对应行状态列更新，在最近更新时间写入 `✅ 已完成 (YYYY-MM-DD)`（示例：`✅ 已完成 (2025-11-09)`）记录实际交付日期；
  2. 依赖变更：在主 TASK 的“依赖矩阵”与模块索引中注明变更，并在模块清单附加说明，驱动 ARCH/TDD/QA 同步；
  3. 新模块启动：在模块清单新增行、在主 TASK 模块索引建立链接、同 `/docs/task-modules/{domain}/TASK.md` 生成模板内容。
- `module-list.md` 也作为模块间依赖/交付节奏的 quick reference，建议对接看板/仪表盘时直接引用此文件，避免不同专家之间因状态失真产生分歧。

## 完成定义（DoD）
- **自动生成完成**：
  - 执行 `/task plan` 后，`/docs/TASK.md` 已自动生成或刷新
  - WBS 包含所有 Story 对应的 Task（可视化追溯）
  - 依赖矩阵与关键路径已计算并可视化
  - DB 任务表头已填充完整（Expand/Migrate/Contract、Backfill/对账/回滚）
- **依赖矩阵**与**关键路径**标注清晰
- 定义里程碑（含通过条件）
- 在 `/docs/AGENT_STATE.md` 勾选 `TASK_PLANNED`
- 主/模块 TASK 文档联动核查：每当 DoD 条件达成时，主 TASK 的模块索引/依赖状态需与对应模块 TASK 文档同步，并在文档修订记录中注明核对时间，防止主文档提前汇总。

## 交接
- 交接前复查主/模块 TASK 文档状态/里程碑/依赖，确保任何模块调整都在主文档中刷新，并记录差异/待办，方便 TDD 协同。
- 移交给 TDD 编程专家（TDD）。

## TASK 模板

> 此模板落地了《Playbook》“标准 TASK 文档结构”中的各项板块，使用时先按照模板写出章节，再回到 Playbook 做完整性/质量自检。

> 本模板承担小型项目任务模板与大型项目主任务模板的说明职责；如需拆分模块，参照 `/docs/task-modules/MODULE-TEMPLATE.md` 生成每个功能域的模块任务文档，保持格式一致。

### 小型项目（单一 TASK 模板）

**主 TASK 模板** 复制到 `/docs/TASK.md`并补充内容。

```markdown
# 任务计划（WBS）
日期：YYYY-MM-DD   版本：v0

## 1. 里程碑
- M1：…（通过条件）
- M2：…

## 2. 任务清单（示例）
| ID | 名称 | Owner | 估时 | 依赖 | 依赖状态 | 状态 | 验收 | 验收人/标准 | 产出 |
|---|---|---|---|---|------------|------|-----|-------------|-----|
| T1 | 登录后端 API | Alice | 3d | ARCH§接口 / DB迁移 | 依赖完成 | 未开始 | AC#U1-1 | PO@user-team: 验证登录流程 | PR#123 |
| T-DB-001 | 设计迁移+回滚脚本 | Bob | 1d | ARCH§数据视图 | 设计评审完成 | 进行中 | AC#DB-1 | DBA@infra: SQL 审核通过 | MR#45 |
| T-DB-002 | Backfill 作业与对账 | Bob | 2d | T-DB-001 | 依赖中 | 未开始 | AC#DB-2 | QA@infra: 数据一致性检查 | MR#46 |
| T-DB-003 | 双写观察与监控 | Bob | 2d | T-DB-002 | 待验证 | 未开始 | AC#DB-3 | SRE@infra: 监控覆盖 | Dashboard |
| T-DB-004 | Contract 清理（下线旧列） | Bob | 0.5d | 稳定周 | 未到期 | 待验证 | AC#DB-4 | QA@infra: 回归通过 | MR#47 |

## 3. 依赖矩阵与关键路径
- 文字或 Mermaid 图

### 里程碑同步
- 将模板中列出的里程碑（M1/M2）与 `/docs/AGENT_STATE.md` 中的阶段状态保持一致，例如达成“发布准入”时在 AGENT_STATE 标记 `TASK_PLANNED`，并在 release checklist/PR 说明中引用对应里程碑的验收标准。
- 每次里程碑或阶段完成后，让 TDD/QA 在 TASK 文档状态列更新“完成时间”与“验证人”，确保小项目的 DoD 在单一 TASK 文档中可审计。

## 4. 风险与缓解
- R1：… → 缓解：…

## 5. 测试映射
- Story → AC → Test Case ID → 任务ID

## 6. DB 任务（固定表头）
- 如涉及数据库变更，请在此段固定表头下补全最小项：

| ID | 类别(Expand/Migrate/Contract) | 目标 | Backfill方案 | 双写观察指标 | 对账规则 | 回滚方案 | Owner | 估时 | 依赖 |
|---|---|---|---|---|---|---|---|---|---|
| T-DB-001 | Expand | 新增列/表/索引 | - | - | - | - | Alice | 1d | ARCH§数据视图 |
| T-DB-002 | Migrate | 回填/批处理 | 批量/作业 | 差异率<0.1%/48h | 抽样+全量对账 | 回滚脚本 | Bob | 2d | T-DB-001 |
| T-DB-003 | Contract | 移除旧结构 | - | - | - | 回滚预案 | Bob | 0.5d | 稳定周 |
```

### 大型项目模板（主从 TASK 结构）

**主任务文档** 复制到`/docs/TASK.md`并补充内容，保持**总纲与索引**，< 1000 行，避免详细任务。

```markdown
# 任务计划（总纲）
日期：YYYY-MM-DD   版本：v0

## 1. 项目概述
- 总体目标、关键交付物、整体时间线

## 2. 模块任务索引
| 模块名称 | 负责团队 | 文档链接 | 状态 | 关键依赖 | 数据/接口追溯 | 最后更新 |
|---------|---------|---------|------|------------|----------------|---------|
| 用户管理 | @team-backend | [TASK.md](task-modules/user-management/TASK.md) | ✅ 已确认 | → 支付系统事件 | arch-prd-traceability.md | YYYY-MM-DD |
| 支付系统 | @team-payment | [TASK.md](task-modules/payment-system/TASK.md) | 🔄 进行中 | ← 用户管理接口 | arch-prd-traceability.md | YYYY-MM-DD |
| （补充其他模块）| - | - | - | - | - | - |

详见 [task-modules/MODULE-TEMPLATE.md](task-modules/MODULE-TEMPLATE.md)
> 💡 建议将本表格字段（状态/Owner/Estimate）同步到看板（如 Task doc 左侧欄、Notion、Miro 表格或 internal dashboard），保持主 TASK 与各模块的实时视图一致，便于 ARCH/TDD/QA 快速对齐优先级。

## 3. 全局里程碑（跨模块）
| 里程碑 ID | 里程碑名称 | 目标日期 | 交付物 | 验收标准 | 状态 |
|----------|----------|---------|--------|---------|------|
| M1 | MVP 发布 | YYYY-MM-DD | 核心功能上线 | … | 📝 待开始 |
| M2 | Beta 测试 | YYYY-MM-DD | 功能增强 | … | 📝 待开始 |

## 4. 跨模块依赖关系
- 模块 A → 模块 B（任务依赖）
- 当前阻塞/待定（列出外部团队、数据准备、第三方或资源瓶颈）以便里程碑审查时即时推进

> 🔁 任何依赖变更（如 scope creep、延后、需求同步）必须及时在模块索引、里程碑状态栏中更新，并通知模块负责人，防止模块文档脱节。

- 文字或 Mermaid 图
## 5. 全局关键路径（CPM）
- 文字或 Mermaid 图
> 📌 把关键路径高亮为“当前关键任务”并在状态列中注明准备度/阻塞情况，便于 TDD/QA 查找关键验证点。

## 6. 全局风险与缓解
- R1：… → 缓解：…

## 7. 模块同步与回收策略
- 在主 TASK 中把模块任务链接/状态与模块 TASK 文档保持双向指向，任何模块调整（scope creep、延期）都需写入“模块任务索引”和“里程碑状态”列，并通知 ARCH/TDD/QA。
- 若某模块任务内容被回收，需在主 TASK 的“依赖关系”与“DB 任务”段标注变更，并在 release/里程碑说明中记录差异，确保所有专家都能追踪版本演进。
- 主 TASK 的“模块任务索引”表建议记录模块 TASK 文档的路径、版本或最后更新时间，并在模块文档中列出对应的主 TASK 模块 ID/里程碑/依赖编号，形成双向追溯与审计线索，方便后续 TDD/QA 直接定位上下文。
```

**模块 TASK 模板**（`/docs/task-modules/{domain}/TASK.md`）：聚焦模块级可执行任务
- 模块级 WBS/任务清单：Story→Task→Deliverable→Owner/Estimate/Dependency（含 DB/数据迁移、接口、自动化与验证任务）
- 交付视图与运行准备：描述接口部署、数据管道、容量与监控计划、QA 验收项与可交付物验收标准
- 风险与质量 Gate：列出模块依赖冲突、合规/安全/性能风险、测试/回归/文档同步步奏以及与追溯矩阵和接口表格的回写要求
- 主 TASK 链路引用：在模块文档开头列出对应主 TASK 模块索引 ID、依赖编号、里程碑与当前版本/最后更新信息，方便主文档与模块文档进行双向核对与追溯。

详细模块模板示例均集中在 `/docs/task-modules/MODULE-TEMPLATE.md`，TASK 专家只需在主 TASK 维护总纲/索引并调用该模板产出模块文档。

## 快捷命令
- `/task plan`：基于 PRD+ARCH 生成/刷新 `/docs/TASK.md`及（如有）模块 TASK 文档（**WBS、依赖矩阵、关键路径、里程碑、风险**），并填充“**DB 任务段**”（固定表头：Backfill/双写观察/对账/回滚等）。完成后在 `/docs/AGENT_STATE.md` 勾选 `TASK_PLANNED`。

## References
- Handbook: /AgentRoles/Handbooks/TASK-PLANNING-EXPERT.playbook.md
- Module template: /docs/task-modules/MODULE-TEMPLATE.md

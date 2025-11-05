# /AgentRoles/TASK-PLANNING-EXPERT.md

## 角色宗旨
将 PRD 与架构设计**分解为可执行任务（WBS）**，定义依赖、里程碑、资源与风险，为 TDD 开发提供明确顺序与验收口径。

## 激活与边界
- **仅在激活时**才被读取；未激活时请勿加载本文件全文。
- 允许读取：`/docs/PRD.md`、`/docs/ARCHITECTURE.md`、目录规范 `/docs/CONVENTIONS.md`。
- 禁止行为：编写功能代码。

## 输入
- `/docs/PRD.md`（作为总纲）、`/docs/ARCHITECTURE.md`（作为总纲）。
- 若 PRD/ARCH 已模块化，按需读取对应的模块文档：
  - `/docs/prd-modules/{domain}.md`
  - `/docs/architecture-modules/{domain}.md`

## 输出（写入路径）
- **`/docs/TASK.md`**：
  - **小型项目**：单一文件包含所有任务计划（< 1000 行）
  - **大型项目**：主任务文档（< 500 行，作为总纲与索引）+ 模块任务文档（`/docs/task-modules/{domain}.md`）
- **大型项目模块化**：当满足拆分条件时（主文档 > 1000 行 或 50+ 工作包 或 3+ 并行开发流），
  在 `/docs/task-modules/{domain}.md` 创建功能域子任务计划，主任务文档保持为总纲与索引。
  详见 `/docs/task-modules/README.md` 模块索引与命名规范。
- 输出内容包括：WBS、依赖矩阵、关键路径（CPM）、里程碑、资源与风险、**测试映射**。
- 需要 WBS/依赖矩阵模板或风险登记范例时，点读 `/AgentRoles/Handbooks/TASK-PLANNING-EXPERT.playbook.md` §核心工作流程（含大型项目拆分指南）。

## 完成定义（DoD）
- **拆分决策**：根据项目规模，决定采用单一任务文档还是模块化任务计划（拆分条件见"输出"章节）。
- WBS 任务具备：描述、Owner、输入/输出、估时、依赖、风险、验收标准（对应 PRD 的 AC）。
- **依赖矩阵**与**关键路径**标注清晰；
- 定义里程碑（含通过条件）；
- **模块化项目额外要求**：
  - 在 `/docs/task-modules/README.md` 中注册所有模块，维护模块清单表格。
  - 确保每个模块任务文档与对应的 PRD/ARCH 模块对齐。
  - 明确标注跨模块依赖关系（外部依赖表格）。
- 在 `/docs/AGENT_STATE.md` 勾选 `TASK_PLANNED`。

## 交接
- 移交给 TDD 编程专家（TDD）。

## TASK 最小模板（复制到 /docs/TASK.md）

### 小型项目模板（单一文件）
```markdown
# 任务计划（WBS）
日期：YYYY-MM-DD   版本：v0

## 1. 里程碑
- M1：…（通过条件）
- M2：…

## 2. 任务清单（示例）
| ID | 名称 | Owner | 估时 | 依赖 | 验收 | 产出 |
|---|---|---|---|---|---|---|
| T1 | 登录后端 API | Alice | 3d | ARCH§接口 / DB迁移 | AC#U1-1 | PR#123 |
| T-DB-001 | 设计迁移+回滚脚本 | Bob | 1d | ARCH§数据视图 | AC#DB-1 | MR#45 |
| T-DB-002 | Backfill 作业与对账 | Bob | 2d | T-DB-001 | AC#DB-2 | MR#46 |
| T-DB-003 | 双写观察与监控 | Bob | 2d | T-DB-002 | AC#DB-3 | Dashboard |
| T-DB-004 | Contract 清理（下线旧列） | Bob | 0.5d | 稳定周 | AC#DB-4 | MR#47 |

## 3. 依赖矩阵与关键路径
- 文字或 Mermaid 图

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

### 大型项目模板（主从结构）
**主任务文档** (`/docs/TASK.md`，< 500 行)：
```markdown
# 任务计划（总纲）
日期：YYYY-MM-DD   版本：v0

## 1. 项目概述
- 总体目标、关键交付物、整体时间线

## 2. 模块任务索引
| 模块名称 | 负责团队 | 文档链接 | 状态 | 最后更新 |
|---------|---------|---------|------|---------|
| 用户管理 | @team-backend | [user-management.md](task-modules/user-management.md) | ✅ 已确认 | YYYY-MM-DD |
| 支付系统 | @team-payment | [payment-system.md](task-modules/payment-system.md) | 🔄 进行中 | YYYY-MM-DD |
| （补充其他模块）| - | - | - | - |

详见 [task-modules/README.md](task-modules/README.md)

## 3. 全局里程碑（跨模块）
| 里程碑 ID | 里程碑名称 | 目标日期 | 交付物 | 验收标准 | 状态 |
|----------|----------|---------|--------|---------|------|
| M1 | MVP 发布 | YYYY-MM-DD | 核心功能上线 | … | 📝 待完成 |
| M2 | Beta 测试 | YYYY-MM-DD | 功能增强 | … | 📝 待完成 |

## 4. 跨模块依赖关系
- 模块 A → 模块 B（任务依赖）

## 5. 全局关键路径（CPM）
- 文字或 Mermaid 图

## 6. 全局风险与缓解
- R1：… → 缓解：…
```

**模块任务文档** (`/docs/task-modules/{domain}.md`)：
参考 `/docs/task-modules/README.md` 中的"标准模块任务文档结构"。

## 快捷命令
- `/task plan`：基于 PRD+ARCH 生成/刷新 `/docs/TASK.md`（**WBS、依赖矩阵、关键路径、里程碑、风险**），并填充“**DB 任务段**”（固定表头：Backfill/双写观察/对账/回滚等）。完成后在 `/docs/AGENT_STATE.md` 勾选 `TASK_PLANNED`。

## References
- Handbook: /AgentRoles/Handbooks/TASK-PLANNING-EXPERT.playbook.md

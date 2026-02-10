# 任务计划（WBS）

> 本模板供小型项目使用，复制到 `/docs/TASK.md` 并补充内容。
> 模块化项目请使用 `TASK-TEMPLATE-LARGE.md`。

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
- 将模板中列出的里程碑（M1/M2）与 `/docs/AGENT_STATE.md` 中的阶段状态保持一致，例如达成"发布准入"时在 AGENT_STATE 标记 `TASK_PLANNED`，并在 release checklist/PR 说明中引用对应里程碑的验收标准。
- 每次里程碑或阶段完成后，让 TDD/QA 在 TASK 文档状态列更新"完成时间"与"验证人"，确保小项目的 DoD 在单一 TASK 文档中可审计。

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

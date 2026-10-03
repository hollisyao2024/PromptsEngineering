# 数据语义约定与 Schema 变更治理任务计划

[PRD](../../prd-modules/data-semantics/PRD.md) · [ARCH](../../arch-modules/data-semantics/ARCH.md) · [ADR-034](../../adr/034-arch-data-semantic-conventions.md)

## WBS 与依赖
| Task | Story | Deliverable | 依赖 | Owner | Estimate |
| --- | --- | --- | --- | --- | --- |
| TASK-DATA-001 | US-DATA-001 | 数据标准语义约定与变更流程、字典模板、ARCH/TDD 专家清单、CONVENTIONS 摘要 | 无 | ARCH | 0.5d |
| TASK-DATA-002 | US-DATA-002 | `schema-governance.js` 存储解析、文档同步（含文档注释）、配对、只追加、字典覆盖及 `tdd.schemaGate` 默认配置 | 001 | TDD | 1.5d |
| TASK-DATA-003 | US-DATA-003 | 新增迁移语义检查（snake_case、审计字段、注释、整数状态说明、豁免）与 off/warn/required 开关 | 002 | TDD | 1d |
| TASK-DATA-004 | US-DATA-004 | Prisma/Drizzle 四库任务示例改为 `task` 表、六审计字段、软删除服务、注释与约束；模板数据文档同步 | 001 | TDD | 1.5d |
| TASK-DATA-005 | US-DATA-001~004 | 定向回归、门禁自检与升级收敛 | 002/003/004 | QA | 0.5d |

关键路径：001 → 002 → 003 → 005；004 与 002/003 并行。规划依赖：Drizzle 数据访问、Monorepo/Prisma 与既有 Schema-Doc Sync 门禁。不新增 CI/部署任务。

## DB 与验收
Expand：只影响新生成项目的示例表；已有项目 schema、服务与已发布迁移按 `init-if-missing`/`append` 保护不被改写。Migrate/Backfill/双写观察/对账：不适用。Contract：无。回滚：回退模板提交；门禁可用 `--skip-schema-doc-sync=<原因>` 或 `tdd.schemaGate.semantic=off` 临时降级。

Gate：门禁各检查正反例与模式开关单测；生成器四库两 ORM 示例 schema/SQL 单测；既有 tdd-sync 与架构生成器回归通过。

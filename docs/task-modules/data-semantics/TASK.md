# 数据语义约定与 Schema 变更治理任务计划

[PRD](../../prd-modules/data-semantics/PRD.md) · [ARCH](../../arch-modules/data-semantics/ARCH.md) · [ADR-034](../../adr/034-arch-data-semantic-conventions.md) · [ADR-035](../../adr/035-arch-data-semantic-enforcement.md)

## WBS 与依赖
| Task | Story | Deliverable | 依赖 | Owner | Estimate |
| --- | --- | --- | --- | --- | --- |
| TASK-DATA-001 | US-DATA-001 | 数据标准语义约定与变更流程、字典模板、ARCH/TDD 专家清单、CONVENTIONS 摘要 | 无 | ARCH | 0.5d |
| TASK-DATA-002 | US-DATA-002 | `schema-governance.js` 存储解析、文档同步（含文档注释）、配对、只追加、字典覆盖及 `tdd.schemaGate` 默认配置 | 001 | TDD | 1.5d |
| TASK-DATA-003 | US-DATA-003 | 新增迁移语义检查（snake_case、审计字段、注释、整数状态说明、豁免）与 off/warn/required 开关 | 002 | TDD | 1d |
| TASK-DATA-004 | US-DATA-004 | Prisma/Drizzle 四库任务示例改为 `task` 表、六审计字段、软删除服务、注释与约束；模板数据文档同步 | 001 | TDD | 1.5d |
| TASK-DATA-005 | US-DATA-001~004 | 定向回归、门禁自检与升级收敛 | 002/003/004 | QA | 0.5d |
| TASK-DATA-006 | US-DATA-005/006/007 | 语义默认 `required`、系统表默认豁免、按旧版模块安装形态条件豁免、`xirang:hard-delete`、字典说明非空；`config.example.json` 同步 | 003 | TDD | 1d |
| TASK-DATA-007 | US-DATA-007 | Drizzle `generate-migration.mjs` 注释写入（PG `COMMENT ON`、MySQL 内联、hard-delete 标记） | 006 | TDD | 1d |
| TASK-DATA-008 | US-DATA-008/010 | 身份模块语义 schema/SQL（四库两 ORM）、未删除唯一、`auth_audit_log`、`src/audit.ts` 适配器包装与 `xirangAudit()`；旧版检测保留原字节 | 006 | TDD | 2d |
| TASK-DATA-009 | US-DATA-009/010 | `file_object` 语义 schema/SQL、语义 Prisma/Drizzle 仓储写审计与软删除字段；旧版检测 | 006 | TDD | 1d |
| TASK-DATA-010 | US-DATA-005~010 | 数据标准、字典/ERD 模板同步；真实 Better Auth 回归、定向回归与升级收敛 | 007/008/009 | QA | 0.5d |

关键路径：001 → 002 → 003 → 005；004 与 002/003 并行。ADR-035 增量：006 → 008 → 010；007、009 与 008 并行。规划依赖：Drizzle 数据访问、Monorepo/Prisma 与既有 Schema-Doc Sync 门禁。不新增 CI/部署任务。

## DB 与验收
Expand：只影响新生成项目的示例表与新安装的身份/文件模块表；已有项目 schema、服务与已发布迁移按 `init-if-missing`/`append` 保护不被改写。Migrate/Backfill/双写观察/对账：不适用。Contract：无。回滚：回退模板提交；门禁可用 `--skip-schema-doc-sync=<原因>` 或 `tdd.schemaGate.semantic=warn|off` 降级。旧版模块存储继续获得原字节，不需 Backfill。

Gate：门禁各检查正反例与模式开关单测（含条件豁免、hard-delete、字典说明）；模块 schema/SQL 快照与旧版字节保护单测；适配器包装真实 Better Auth 回归；Drizzle 注释写入文本单测；生成器四库两 ORM 示例 schema/SQL 单测；既有 tdd-sync 与架构生成器回归通过。

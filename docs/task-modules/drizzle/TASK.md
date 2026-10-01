# Drizzle 数据访问任务计划

[PRD](../../prd-modules/drizzle/PRD.md) · [ARCH](../../arch-modules/drizzle/ARCH.md)

## WBS 与依赖
| Task | Story | Deliverable | 依赖 | Owner | Estimate |
| --- | --- | --- | --- | --- | --- |
| TASK-DRIZZLE-001 | US-DRIZZLE-001 | 数据库/ORM 矩阵、CLI、生成器和数据包 | 无 | TDD | 2d |
| TASK-DRIZZLE-002 | US-DRIZZLE-002 | 原生迁移链预检、环境隔离和真实数据库验证 | 001 | TDD | 2d |
| TASK-DRIZZLE-003 | US-DRIZZLE-003 | 任务、身份权限、文件 CAS 和 pg-boss 事务适配 | 001/002 | TDD | 3d |
| TASK-DRIZZLE-004 | US-DRIZZLE-004 | 升级/边界检查、文档和消费者回归 | 001/002/003 | QA | 2d |

关键路径：001 → 002 → 003 → 004。规划依赖：既有 Monorepo、身份权限、文件存储和队列；不创建 CI/部署任务，本轮只涉及模板与隔离样本。

## DB 与验收
Expand：新增独立 ORM 选择与方言 schema；Migrate：仅显式命令应用隔离样本，已有库不接管；Contract：禁止同库混用历史。Backfill/双写观察/生产对账：不适用。回滚：消费者移除未采用选择；已执行变更仅追加补偿，不改写迁移。

Gate：矩阵正反例、PG/SQLite 真实迁移/事务及周边适配、其余方言生成/编译与可获得的数据库运行证据、Prisma/旧 SQL 回归、升级收敛和历史保护。外部数据库环境不可获得时明确标注未执行范围，不把静态测试作为运行通过。

## TDD 结果（2026-10-01）

TASK-DRIZZLE-001～003 已完成；004 的定向回归完成，待 QA 合并。九套架构回归 44 项通过，最后数据库安全/Drizzle/Monorepo 增量回归 12 项通过。Drizzle 四种数据库的迁移、身份、权限、文件与事务实测通过，完整任务 API 在 SQLite/MySQL/PostgreSQL 各 8 项通过；Prisma MySQL/MariaDB 各 2 项实测通过。SQL Server/CockroachDB 安装、客户端生成、类型/构建和原生离线 DDL 通过；实库下载不可获得，未记为运行通过。

证据保存在任务 drizzle-support 的 evidence 目录，QA 将记录日志名及摘要。高风险语义核查覆盖默认拒绝、CAS 原子性、回滚、迁移历史与浏览器边界；Codex review skipped by policy。

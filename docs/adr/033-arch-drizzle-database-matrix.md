# ADR-033：并列 ORM 与显式数据库支持矩阵

状态：Accepted。日期：2026-10-01。

## 背景
用户要求补齐 Drizzle 及常见数据库支持，允许 ORM 支持差异。当前实现只有 Prisma PG/SQLite，周边适配绑定 Prisma。

## 决策
固定稳定版 Drizzle ORM/Kit，先支持 PG/MySQL/MariaDB/SQLite；SQL Server/CockroachDB 的 Drizzle RC 组合阻断，不隐式走 PostgreSQL 方言。Prisma 7 扩展相应常见数据库。保留单库原生迁移账本，增加预检而不创建第二套执行历史。数据库包结构不变；项目 schema、已发布迁移与定制受保护。默认 Prisma；不自动改换已有 access/engine。

## 取舍
采用 RC 可以增加 Drizzle 数据库覆盖，但引入迁移目录、关系查询和驱动的破坏性变化；稳定版优先，RC 专有组合以后独立验证。真实远端数据库不能用本地编译结果代替；验证矩阵明确报告限制。

## 依据
[Drizzle MSSQL](https://orm.drizzle.team/docs/get-started/mssql-new)、[CockroachDB](https://orm.drizzle.team/docs/get-started/cockroach-existing)、[Prisma 7 数据库矩阵](https://docs.prisma.io/docs/orm/v7/reference/supported-databases)。

PostgreSQL 隔离 PoC：稳定 Kit 为 pgTable 外键输出显式 public 引用，不能仅靠 search_path 迁移到其他 schema。Drizzle 默认采用 worktree 独立数据库，连接中的非 public schema 在生成包装入口明确阻断；自定义 pgSchema 必须由项目独立集成并验证。Prisma 的 schema 隔离不变。SQLite Drizzle 另以实际数据库路径的排他锁协调跨 worktree 迁移；失败后同时保留包内 .migration-running.json 与数据库旁的 -xirang-migration-lock.json，先核对状态再解除。status 对不存在的 SQLite 文件仅报告 pending，不创建数据库；迁移拒绝内存数据库。

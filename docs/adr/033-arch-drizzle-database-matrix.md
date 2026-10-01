# ADR-033：并列 ORM 与显式数据库支持矩阵

状态：Accepted。日期：2026-10-01。

## 背景
用户要求补齐 Drizzle 及常见数据库支持，允许 ORM 支持差异。当前实现只有 Prisma PG/SQLite，周边适配绑定 Prisma。

## 决策

Prisma 7.10.0 与 Drizzle ORM 0.45.3/Kit 0.31.11 并列支持 postgres/mysql/mariadb/sqlite，默认 Prisma；旧 SQL 继续支持原有 PG/SQLite。数据包仅供服务端，schema 由项目维护，原生迁移只追加。身份权限、文件 CAS 与 PG 同库队列提供相应 ORM 适配，既有配置不自动切换。

## 取舍
只维护用户实际需要的四种 engine，降低驱动与迁移矩阵复杂度。两套 ORM 采用各自 schema/原生历史，禁止自动接管或转换；生产迁移由实际项目审查，模板升级不执行数据库写入。

## 依据

版本固定在 dependencies/audit；真实隔离数据库、消费者编译与恢复验证见 [模块 QA](../qa-modules/drizzle/QA.md)。

PostgreSQL 隔离 PoC：稳定 Kit 为 pgTable 外键输出显式 public 引用，不能仅靠 search_path 迁移到其他 schema。Drizzle 默认采用 worktree 独立数据库，连接中的非 public schema 在生成包装入口明确阻断；自定义 pgSchema 必须由项目独立集成并验证。Prisma 的 schema 隔离不变。SQLite Drizzle 另以实际数据库路径的排他锁协调跨 worktree 迁移；失败后同时保留包内 .migration-running.json 与数据库旁的 -xirang-migration-lock.json，先核对状态再解除。status 对不存在的 SQLite 文件仅报告 pending，不创建数据库；迁移拒绝内存数据库。

## 用户范围收敛与自动版本

2026-10-01 用户最新范围为 PostgreSQL、MySQL/MariaDB、SQLite，两套稳定 ORM 共同支持；其他方言实现/依赖/专项测试移除。官方模板源在交付 tdd sync 前 required fetch，依固定基线默认 patch 增号、保留更高显式 minor/major，整体清单同步；架构包独立版本按架构差异同样处理。失败时阻断，不变更实际项目发布策略。

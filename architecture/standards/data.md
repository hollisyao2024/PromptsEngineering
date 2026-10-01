# 数据与迁移标准

数据库按职责选型。每个存储独立目录、连接环境变量、迁移历史和备份策略，允许云端 PostgreSQL 与桌面 SQLite 并存。ORM/查询工具由项目选择。

旧版 SQL 栈的迁移采用稳定且递增的文件 ID，新增迁移追加到 migrations.json，记录文件 SHA-256 和事务属性。已执行迁移文件不可修改、删除或重排；修改约束/索引/查询对应新增迁移和验证。迁移执行前检查历史缺失、摘要变化和未完成状态；PostgreSQL 使用 advisory lock，SQLite 使用写事务协调。

旧版模板初始化/升级只生成 SQL 与注册项，不连接数据库。`node migrate.mjs` 只预检，`--apply` 才执行。SQLITE_PATH/DATABASE_URL 必须显式提供。失败记录保留，先诊断再恢复，不自动跳过失败迁移。生产执行前项目负责备份、回滚/补偿和新旧代码兼容验证。

Node TypeScript 新蓝图默认 Prisma 7，也可显式选择 Drizzle ORM/Kit；各数据库分别生成独立 Schema、驱动和迁移。Prisma Migrate 是唯一执行历史，不再同时使用 migrations.json。db:status / db:deploy 对比磁盘 SQL 与 _prisma_migrations，缺失、变更和失败状态阻断；只有显式命令连接数据库。已发布 SQL 不修改，业务 schema 由项目持有，generated client 忽略并重建。DATABASE_<STORE>_URL 与 TEST/SHADOW 配置应按 worktree 分开。切换 provider/access 或接管旧 SQL 历史须独立项目迁移；不得直接让模板转换。

## 可选身份、队列与文件元数据

Better Auth 的 User/Session/Account/Verification/Organization/Member/Invitation 和文件 FileObject 在所选 ORM 的独立 schema 文件中初始化；业务 Schema 与策略归项目，已发布迁移仅追加。CASL 的默认策略拒绝，查询和条件写入都必须约束当前主体。

pg-boss 或 BullMQ 的 PostgreSQL schema 需要显式 db:prepare；普通 init/start 不自动迁移。SQLite 不用于队列后端。pg-boss 同库 fromPrisma / fromDrizzle 可参与业务事务；跨数据库或 Redis 投递需要项目 Outbox 与业务幂等。文件二进制与元数据为双写，使用版本 CAS、暂存/最终键隔离和恢复状态，不声称跨存储原子提交。

## ORM 支持矩阵

Prisma 7.10.0 支持 postgres、mysql、mariadb、sqlite、sqlserver、cockroachdb。Drizzle ORM 0.45.3 / Kit 0.31.11 支持 postgres、mysql、mariadb、sqlite。SQL Server 与 CockroachDB 的 Drizzle 原生 dialect 属于 v1 预发布；稳定模板明确拒绝这两个组合。旧 SQL 栈继续只支持 PostgreSQL/SQLite。

Drizzle 的项目 schema 位于 src/schema/*.ts，审查后的 SQL 位于 drizzle/*.sql，Kit 的快照与顺序位于 drizzle/meta/；数据库执行历史只用 __drizzle_migrations。db:generate --name NAME 离线生成，db:status 预检，db:deploy 显式应用。禁止绕过执行器使用 push 自动改库。执行器校验 journal、快照、SQL hash 和已应用前缀，失败保留 .migration-running.json，确认数据库状态后才能人工解除。PostgreSQL 使用独立数据库的 public schema 与 advisory lock；MySQL/MariaDB 使用命名锁，其 DDL 不保证事务回滚，因此尤其需要故障补偿。

Prisma 使用 provider 专属 Schema/driver adapter。MySQL 与 MariaDB 共用 mysql provider；CockroachDB 使用原生 cockroachdb provider；SQL Server 使用 mssql adapter 和 sqlserver:// 分号参数 URL，仅支持 dbo。MySQL adapter 当前只接受无查询参数的连接 URL，TLS 等自定义选项须项目显式实现。SQL Server 的可选 Better Auth 与文件元数据组合暂不自动初始化，要求独立项目集成；基本数据库包与任务 CRUD 可用。pg-boss 仍只用于 PostgreSQL。

Prisma/Drizzle 的迁移目录、锁、快照与历史表不能混用。所有 ORM 的 schema 和业务代码由项目持有，模板升级不替换；切换 engine/access 必须独立迁移并明确接管旧历史。浏览器禁止导入任意 ORM 或驱动。详见 [Monorepo 指南](../guides/monorepo.md)。

PostgreSQL 隔离 PoC：稳定 Kit 为 pgTable 外键输出显式 public 引用，不能仅靠 search_path 迁移到其他 schema。Drizzle 默认采用 worktree 独立数据库，连接中的非 public schema 在生成包装入口明确阻断；自定义 pgSchema 必须由项目独立集成并验证。Prisma 的 schema 隔离不变。SQLite Drizzle 另以实际数据库路径的排他锁协调跨 worktree 迁移；失败后同时保留包内 .migration-running.json 与数据库旁的 -xirang-migration-lock.json，先核对状态再解除。status 对不存在的 SQLite 文件仅报告 pending，不创建数据库；迁移拒绝内存数据库。

固定 libsql migrator 的 SQLite 历史 id 可为空；包装器以原生 SQLite rowid、时间戳及 SQL hash 核验已执行前缀，不修改原生历史格式。多次追加迁移必须验证，不能只测初次建表。

# 数据与迁移标准

数据库按职责选型。每个存储独立目录、连接环境变量、迁移历史和备份策略，允许云端 PostgreSQL 与桌面 SQLite 并存。ORM/查询工具由项目选择。

旧版 SQL 栈的迁移采用稳定且递增的文件 ID，新增迁移追加到 migrations.json，记录文件 SHA-256 和事务属性。已执行迁移文件不可修改、删除或重排；修改约束/索引/查询对应新增迁移和验证。迁移执行前检查历史缺失、摘要变化和未完成状态；PostgreSQL 使用 advisory lock，SQLite 使用写事务协调。

旧版模板初始化/升级只生成 SQL 与注册项，不连接数据库。`node migrate.mjs` 只预检，`--apply` 才执行。SQLITE_PATH/DATABASE_URL 必须显式提供。失败记录保留，先诊断再恢复，不自动跳过失败迁移。生产执行前项目负责备份、回滚/补偿和新旧代码兼容验证。

Node TypeScript 新蓝图默认 Prisma 7，也可显式选择 Drizzle ORM/Kit；各数据库分别生成独立 Schema、驱动和迁移。Prisma Migrate 是唯一执行历史，不再同时使用 migrations.json。db:status / db:deploy 对比磁盘 SQL 与 _prisma_migrations，缺失、变更和失败状态阻断；只有显式命令连接数据库。已发布 SQL 不修改，业务 schema 由项目持有，generated client 忽略并重建。DATABASE_<STORE>_URL 与 TEST/SHADOW 配置应按 worktree 分开。切换 provider/access 或接管旧 SQL 历史须独立项目迁移；不得直接让模板转换。

## 数据语义约定

schema 是模型与协作者的第一手数据字典。以下约定适用于项目自有业务表与模板模块核心表，新表必须遵守，历史表在下次变更时逐步补齐。

- **命名**：表名与列名使用业务语言、小写 `snake_case`（如 `order_payment`、`paid_at`），避免 `data1`、`flag`、`tmp` 等无义名称。ORM 侧可保持驼峰，通过 Prisma `@map/@@map` 或 Drizzle 列名映射到数据库。
- **注释**：每张表、每个字段都要有中文业务注释，写明含义、单位、取值和来源。PostgreSQL 用 `COMMENT ON TABLE/COLUMN`，MySQL/MariaDB 用内联 `COMMENT`，写入同一迁移；SQLite 无原生注释，以 `docs/data/dictionary.md` 为准。ORM 不生成注释时，在生成的迁移中追加注释语句后再提交。
- **状态值**：优先使用可读字符串枚举（如 `pending_payment`、`shipped`）并加 CHECK 约束；确需整数编码时，建字典表或在注释写全取值（如 `1=待支付 2=已发货`），禁止无说明的魔法数字。
- **审计字段**：每张业务表包含 `created_at`、`updated_at`、`created_by`、`updated_by`、`deleted_at`、`deleted_by`。时间使用带时区或 UTC 时间戳；`*_by` 存主体标识文本（用户 id 或 `system:<job>`），不加外键以便跨库与保留历史。`updated_at` 由写入路径统一维护，绕过 ORM 的原生 SQL 必须同时更新；PostgreSQL 可用触发器兜底。
- **软删除优先**：删除写 `deleted_at/deleted_by`，默认查询、更新和唯一约束只针对未删除行（PostgreSQL/SQLite 用 `WHERE deleted_at IS NULL` 部分索引；MySQL/MariaDB 不支持部分索引，需生成列或业务校验）。提醒与分析场景常用索引如 `(status, updated_at)` 应排除已删除行。
- **物理删除与豁免**：会话、令牌、验证码、只追加日志等高频短期表可物理删除，只免 `deleted_at/deleted_by`，须在迁移声明 `-- xirang:hard-delete <表名> <原因>` 并在字典注明保留与清理策略，命名、注释、创建/更新审计照常。迁移历史表、`app_metadata`、pg-boss 等系统表默认豁免；其他第三方表用 `-- xirang:exempt` 注明原因。隐私法规要求删除时提供匿名化或物理清除流程，并留存操作记录。

## Schema 变更流程

1. 修改 schema 源（Prisma `schema.prisma`、Drizzle `src/schema/*.ts`）。
2. 离线生成新迁移（Prisma `db:dev --create-only` 或 `prisma migrate dev --create-only`，Drizzle `db:generate --name NAME`），人工审查 SQL，补充注释、约束与数据回填。
3. 同一交付更新 `docs/data/ERD.md`、`docs/data/dictionary.md` 与模块 ARCH 数据视图。
4. 只通过 `db:deploy` 等迁移执行器修改数据库；禁止 `push`、手工 DDL 或直接改表。数据修正也写成迁移（SQL 内声明 `-- xirang:data-migration`）或留痕脚本。
5. 已发布迁移与 Drizzle 快照只追加，不修改、删除或重排；修正错误用新迁移。

`tdd sync` 对 `architecture.config.json` 登记的数据存储执行门禁：文档同步、schema 与迁移配对、迁移只追加、字典覆盖新增表和字段均为阻断；语义检查（命名、注释、审计、软删除、整数状态说明、字典字段说明非空）默认阻断，只检查本次新增迁移，已发布迁移不重新检查；`agent.config.json` 的 `tdd.schemaGate.semantic` 可降为 `warn|off`。默认只豁免迁移与系统表；身份与文件模块表仅在存储已安装旧版模块时豁免。`tdd.schemaGate.exemptTables` 或迁移内 `-- xirang:exempt <表名> <原因>` 可声明完全豁免；`-- xirang:hard-delete <表名> <原因>` 只免除 `deleted_at/deleted_by`，用于会话、令牌、只追加日志等物理删除表。门禁离线运行，不证明 schema 与迁移逐项等价，也无法发现绕过迁移的手工 DDL。

## 可选身份、队列与文件元数据

Better Auth 的 `user`/`session`/`account`/`verification`/`organization`/`member`/`invitation` 与文件元数据 `file_object` 在所选 ORM 的独立 schema 文件中初始化，新安装即遵守数据语义约定（ADR-035）：表列 snake_case 并带注释；`user`、`organization`、`member`、`invitation`、`file_object` 含六个审计字段并软删除，`user.email` 与 `organization.slug` 只在未删除行唯一（PostgreSQL/SQLite 部分唯一索引，Prisma 需 `previewFeatures = ["partialIndexes"]`，已有 `schema.prisma` 未开启时退回普通唯一；MySQL/MariaDB 用 `email_active`/`slug_active` 存储生成列唯一）；`session`、`account`、`verification` 只含创建/更新审计并物理删除，每次删除写只追加的 `auth_audit_log`（只记录模型、id、用户与操作者，不含令牌或密码）。身份模块 `src/audit.ts` 的 `softDeleteAdapter` 包装 ORM 适配器、`xirangAudit()` 插件注册字段（须位于 `organization()` 之后）；操作者取当前会话用户，缺省 `system`。已安装旧版模块（驼峰列、`FileObject`）的存储继续获得原 schema、迁移与代码字节，不自动转换；迁移到新结构由项目单独规划。业务 Schema 与策略归项目，已发布迁移仅追加。CASL 的默认策略拒绝，查询和条件写入都必须约束当前主体。

pg-boss 或 BullMQ 的 PostgreSQL schema 需要显式 db:prepare；普通 init/start 不自动迁移。SQLite 不用于队列后端。pg-boss 同库 fromPrisma / fromDrizzle 可参与业务事务；跨数据库或 Redis 投递需要项目 Outbox 与业务幂等。文件二进制与元数据为双写，使用版本 CAS、暂存/最终键隔离和恢复状态，不声称跨存储原子提交。

## ORM 支持矩阵

Prisma 7.10.0 与 Drizzle ORM 0.45.3 / Kit 0.31.11 均支持 postgres、mysql、mariadb、sqlite；模板只维护这四种 engine。旧 SQL 栈继续只支持 PostgreSQL/SQLite。

Drizzle 的项目 schema 位于 src/schema/*.ts，审查后的 SQL 位于 drizzle/*.sql，Kit 的快照与顺序位于 drizzle/meta/；数据库执行历史只用 __drizzle_migrations。db:generate --name NAME 离线生成，db:status 预检，db:deploy 显式应用。禁止绕过执行器使用 push 自动改库。执行器校验 journal、快照、SQL hash 和已应用前缀，失败保留 .migration-running.json，确认数据库状态后才能人工解除。PostgreSQL 使用独立数据库的 public schema 与 advisory lock；MySQL/MariaDB 使用命名锁，其 DDL 不保证事务回滚，因此尤其需要故障补偿。

Prisma 使用 provider 专属 Schema/driver adapter。MySQL 与 MariaDB 共用 mysql provider。MySQL adapter 当前只接受无查询参数的连接 URL，TLS 等自定义选项须项目显式实现。pg-boss 仍只用于 PostgreSQL。

Prisma/Drizzle 的迁移目录、锁、快照与历史表不能混用。所有 ORM 的 schema 和业务代码由项目持有，模板升级不替换；切换 engine/access 必须独立迁移并明确接管旧历史。浏览器禁止导入任意 ORM 或驱动。详见 [Monorepo 指南](../guides/monorepo.md)。

PostgreSQL 隔离 PoC：稳定 Kit 为 pgTable 外键输出显式 public 引用，不能仅靠 search_path 迁移到其他 schema。Drizzle 默认采用 worktree 独立数据库，连接中的非 public schema 在生成包装入口明确阻断；自定义 pgSchema 必须由项目独立集成并验证。Prisma 的 schema 隔离不变。SQLite Drizzle 另以实际数据库路径的排他锁协调跨 worktree 迁移；失败后同时保留包内 .migration-running.json 与数据库旁的 -xirang-migration-lock.json，先核对状态再解除。status 对不存在的 SQLite 文件仅报告 pending，不创建数据库；迁移拒绝内存数据库。

固定 libsql migrator 的 SQLite 历史 id 可为空；包装器以原生 SQLite rowid、时间戳及 SQL hash 核验已执行前缀，不修改原生历史格式。多次追加迁移必须验证，不能只测初次建表。

# 数据语义约定与 Schema 变更治理架构

需求：[PRD](../../prd-modules/data-semantics/PRD.md)。决策：[ADR-034](../../adr/034-arch-data-semantic-conventions.md)、[ADR-035](../../adr/035-arch-data-semantic-enforcement.md)。标准正文：`architecture/standards/data.md`「数据语义约定」与「Schema 变更流程」。

## 1. 边界
规范、清单与门禁属于模板自有文件，随 `template sync` 下发；业务 schema、已发布迁移、`RULES.md` 与 `agent.config.json` 归项目。门禁只读 git 差异和文件内容，不连接数据库、不执行 ORM。数据库漂移（绕过迁移的手工 DDL）不在本期范围。

## 2. 数据存储解析
`infra/scripts/tdd-tools/schema-governance.js` 从项目根 `architecture.config.json` 的 `datastores[]` 解析受管存储，`tdd.schemaGate.datastores` 可显式覆盖：

| access | schema 源 | 迁移文件（只追加） | 其他不可改文件 |
| --- | --- | --- | --- |
| prisma | `<path>/prisma/schema.prisma`、`<path>/prisma/schema/**/*.prisma` | `<path>/prisma/migrations/*/migration.sql` | — |
| drizzle | `<path>/src/schema/**/*.ts` | `<path>/drizzle/*.sql` | `<path>/drizzle/meta/*_snapshot.json` |
| 无（旧 SQL 栈） | 无（迁移即 schema） | `<path>/migrations/*.sql` | — |

未登记存储（含模板源仓库）退回原有通用模式：只执行文档同步检查，不执行配对、只追加和语义检查，避免误伤模板夹具。

## 3. 门禁（`tdd sync` Step 1.7，沿用 `check-schema-doc-sync.js` 入口）
1. **文档同步**（阻断）：schema 或迁移有实质变化时，同一交付必须改动 `docs/data/ERD.md` 与 `docs/data/dictionary.md`。Prisma `///` 与 Drizzle `/** */` 文档注释视为实质变化；`//` 普通注释、空白、`@@map` 新增仍为非实质。
2. **schema 与迁移配对**（阻断）：受管存储的 schema 结构行变化而该存储无新增迁移 → 阻断；新增迁移而 schema 无变化，且 SQL 不含 `-- xirang:data-migration` 声明 → 阻断。旧 SQL 栈不做配对。
3. **迁移只追加**（阻断）：相对 merge-base（含工作区）对受管迁移和快照的修改、删除、重命名一律阻断。
4. **字典覆盖**（阻断）：解析本次新增迁移中的 `CREATE TABLE` 与 `ALTER TABLE ... ADD [COLUMN]`，每张表须以 `` `表名` `` 出现在字典，且字段须为该表所在章节字段表的首列。
5. **语义检查**（`tdd.schemaGate.semantic`：`off|warn|required`，默认 `required`，ADR-035）：只针对本次新增迁移中的非豁免表，检查 snake_case、六个审计字段、注释（PostgreSQL `COMMENT ON`、MySQL/MariaDB 内联 `COMMENT`）、整数状态类字段（`*_status|_state|_type|_kind|_level|_stage`）是否有 CHECK 或含 `=` 的取值注释。已发布迁移不重新检查；项目可显式降为 `warn`/`off`。
6. **字典说明**（随语义检查模式）：新增表/列在字典字段表中的行，最后一列说明须非空；SQLite 以此作为注释层，其他引擎同样要求，保证模型可从文档读到含义。

跳过沿用 `--skip-schema-doc-sync=<原因>`，原因回显到 stderr。输出 `SCHEMA_GATE_STATUS`、各项结果与修复方式。

## 4. 豁免
默认豁免只保留系统表：`_prisma_migrations`、`__drizzle_migrations`、`app_metadata`、`xirang_migrations`、`pgboss.*`。模块表按**实际安装形态**条件豁免：仅当该存储已安装旧版模块文件时（Prisma `20260909020000_auth` 迁移含 `"emailVerified"`、`20260909010000_file_storage` 含 `CREATE TABLE "FileObject"`；Drizzle `src/schema/auth.ts` 含 `'emailVerified'`、`src/schema/file-storage.ts` 含 `'FileObject'`），才豁免对应的旧版身份表或 `FileObject`；项目自建的同名表（如 `account`）不再被默认豁免。

项目可用 `tdd.schemaGate.exemptTables` 追加，或在迁移内写 `-- xirang:exempt <表名> <原因>`（豁免全部语义检查与字典覆盖）。新增 `-- xirang:hard-delete <表名> <原因>` 只免除 `deleted_at/deleted_by`，其余检查（命名、注释、创建/更新审计字段、字典）照常。豁免不影响文档同步、配对和只追加。

## 5. 生成器示例
Prisma/Drizzle 新数据包的任务示例表改为 `task`：列 `snake_case`（Prisma `@map/@@map`，TS 保持驼峰）；`status` 为 `todo|doing|done` 字符串并带 CHECK（Prisma 在迁移 SQL 中声明）；六个审计字段，`*_by` 为文本主体标识，默认 `system`；删除写 `deleted_at/deleted_by`，查询与更新过滤未删除。PostgreSQL/MySQL 初始迁移写入表与列注释。Drizzle PostgreSQL/SQLite 使用 `WHERE deleted_at IS NULL` 部分索引；Prisma 与 MySQL/MariaDB 使用普通索引以免 schema 与迁移漂移。Drizzle 不随模板发布初始迁移，项目生成后按语义检查补注释。`schema`/`tasks.ts` 为 `init-if-missing`，已有项目不受影响；Prisma 初始迁移保持原文件 ID `20260909000000_init`：生成器先检测已安装存储（初始迁移不含 `task` 表、schema 无 `@@map("task")` 或 Drizzle schema 不含 `Table('task'`），命中时继续输出 `task-model/legacy` 的原 Task 迁移字节、schema 与示例服务，`append` 无冲突；全新存储在同一 ID 下获得语义 `task` 内容。索引为 `(created_at,id)` 与 `(status,updated_at)`。对外 API 合约不变。

## 6. 模块核心表（ADR-035）
新安装的身份与文件模块表全部 snake_case（Prisma `@map/@@map`、Drizzle 驼峰键映射 snake 列名，保持 Better Auth 与仓储代码字段名不变）且带表/列注释：

| 表 | 审计字段 | 删除 | 未删除唯一 |
| --- | --- | --- | --- |
| `user`、`organization`、`member`、`invitation` | 六个 | 软删除 | `user.email`、`organization.slug` |
| `session`、`account`、`verification` | `created_at/by`、`updated_at/by`，`-- xirang:hard-delete` | 物理删除，写 `auth_audit_log` | — |
| `auth_audit_log` | `created_at/by`、`updated_at/by`，`-- xirang:hard-delete`（只追加日志） | 不删除 | — |
| `file_object` | 六个 | 状态 `deleted` 时写 `deleted_at/by` | `(store_id, object_key)` 全量唯一（对象键不复用） |

**适配器层软删除**：Better Auth 的 `databaseHooks` 只覆盖核心模型，组织插件直接调用 `adapter.delete/deleteMany`，因此在 `src/audit.ts` 以 `softDeleteAdapter(factory)` 包装 Prisma/Drizzle 适配器工厂：软删除模型的 `findOne/findMany/count/update/updateMany/incrementOne` 追加 `deleted_at IS NULL`（`{field:'deletedAt',value:null,connector:'AND'}`，两种适配器均转为 `IS NULL`），`delete/deleteMany` 改写为更新 `deletedAt/deletedBy`；物理删除模型在 `delete/deleteMany/consumeOne` 前读取 `id/userId`，删除后写审计行，绝不记录令牌、密码或验证值；`create/update` 写 `createdBy/updatedBy`；事务适配器同样包装。操作者取自 `@better-auth/core/context` 的当前端点会话，缺省 `system`。字段经 `xirangAudit()` 插件 schema 注册（扩展七张表并新增 `authAuditLog` 模型），插件须位于 `organization()` 之后。

**未删除唯一**：Prisma PostgreSQL/SQLite 使用 `partialIndexes` 预览特性 `@@unique([email], where: { deletedAt: null })`，迁移 SQL 写同名部分唯一索引；新 `schema.prisma` 默认开启该特性，已有 `schema.prisma` 未开启时退回普通唯一索引（已删除行继续占用，标准中说明启用方式）。Drizzle PostgreSQL/SQLite 使用 `uniqueIndex().on().where(isNull())`。MySQL/MariaDB 不支持部分索引，使用存储生成列 `email_active = IF(deleted_at IS NULL, email, NULL)` 加唯一索引（Prisma 声明为可空只读字段，SQL 手写生成表达式）。

**文件元数据**：语义仓储在创建与 CAS 更新时写 `createdBy/updatedBy=ownerId`，状态转为 `deleted` 时写 `deletedAt/deletedBy`；读取保留已删除记录以维持删除幂等，列表只返回 `ready` 且未删除行。

**旧版保护**：生成器按 §4 的同一判定检测已安装旧版模块（另含 Prisma `auth.prisma`/`file-storage.prisma` 缺少 `@@map("auth_audit_log")`/`@@map("file_object")`），命中时继续输出原 schema、迁移、`src/index.ts` 与仓储字节，且不新增 `src/audit.ts`；全新安装在同一迁移 ID 下获得语义内容。迁移 ID 不变，`append`/`init-if-missing` 无冲突。

## 7. Drizzle 注释写入
`db:generate`（`generate-migration.mjs`）在 drizzle-kit 生成后只处理本次新增的迁移：解析 `src/schema/**/*.ts` 中表导出与列定义前的 `/** */` 注释，PostgreSQL 追加 `COMMENT ON TABLE/COLUMN`（仅本迁移新建表与新增列），MySQL/MariaDB 把 `COMMENT '...'` 内联进列定义并为新表加表注释，SQLite 不写注释；注释中的 `@hard-delete <原因>` 转为 `-- xirang:hard-delete` 标记并从注释正文移除。处理在任何应用前完成，迁移历史校验以处理后文件为准；已有迁移不改写。

## 8. 验证
定向单测覆盖存储解析、配对、只追加、字典覆盖、语义检查各正反例与模式开关；生成器单测覆盖四种数据库两种 ORM 的示例 schema/SQL；可用时以真实数据库集成测试复核示例迁移与软删除服务。ADR-035 增补：条件豁免与 hard-delete 正反例、默认 required、字典说明；身份/文件模块四库两 ORM schema 与 SQL 快照、旧版字节保护与收敛；`softDeleteAdapter` 以真实 Better Auth（memory 适配器）验证注册、组织删除、登出、删除用户与同邮箱重新注册；Drizzle 注释写入的 PostgreSQL/MySQL/SQLite 文本单测。

# 数据语义约定与 Schema 变更治理架构

需求：[PRD](../../prd-modules/data-semantics/PRD.md)。决策：[ADR-034](../../adr/034-arch-data-semantic-conventions.md)。标准正文：`architecture/standards/data.md`「数据语义约定」与「Schema 变更流程」。

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
5. **语义检查**（`tdd.schemaGate.semantic`：`off|warn|required`，默认 `warn`）：针对新增迁移中非豁免表，检查 snake_case、六个审计字段、注释（PostgreSQL `COMMENT ON`、MySQL/MariaDB 内联 `COMMENT`；SQLite 由字典补位）、整数状态类字段（`*_status|_state|_type|_kind|_level|_stage`）是否有 CHECK 或含 `=` 的取值注释。

跳过沿用 `--skip-schema-doc-sync=<原因>`，原因回显到 stderr。输出 `SCHEMA_GATE_STATUS`、各项结果与修复方式。

## 4. 豁免
默认豁免第三方/模块自有/系统表：Better Auth（`user`、`session`、`account`、`verification`、`organization`、`member`、`invitation`）、`FileObject`/`file_object`、`_prisma_migrations`、`__drizzle_migrations`、`app_metadata`、`pgboss.*`。项目可用 `tdd.schemaGate.exemptTables` 追加，或在迁移内写 `-- xirang:exempt <表名> <原因>`。豁免影响语义检查与字典覆盖，不影响文档同步、配对和只追加。

## 5. 生成器示例
Prisma/Drizzle 新数据包的任务示例表改为 `task`：列 `snake_case`（Prisma `@map/@@map`，TS 保持驼峰）；`status` 为 `todo|doing|done` 字符串并带 CHECK（Prisma 在迁移 SQL 中声明）；六个审计字段，`*_by` 为文本主体标识，默认 `system`；删除写 `deleted_at/deleted_by`，查询与更新过滤未删除。PostgreSQL/MySQL 初始迁移写入表与列注释。Drizzle PostgreSQL/SQLite 使用 `WHERE deleted_at IS NULL` 部分索引；Prisma 与 MySQL/MariaDB 使用普通索引以免 schema 与迁移漂移。Drizzle 不随模板发布初始迁移，项目生成后按语义检查补注释。`schema`/`tasks.ts` 为 `init-if-missing`，已有项目不受影响；Prisma 初始迁移保持原文件 ID `20260909000000_init`：生成器先检测已安装存储（初始迁移不含 `task` 表、schema 无 `@@map("task")` 或 Drizzle schema 不含 `Table('task'`），命中时继续输出 `task-model/legacy` 的原 Task 迁移字节、schema 与示例服务，`append` 无冲突；全新存储在同一 ID 下获得语义 `task` 内容。索引为 `(created_at,id)` 与 `(status,updated_at)`。对外 API 合约不变。

## 6. 验证
定向单测覆盖存储解析、配对、只追加、字典覆盖、语义检查各正反例与模式开关；生成器单测覆盖四种数据库两种 ORM 的示例 schema/SQL；可用时以真实数据库集成测试复核示例迁移与软删除服务。

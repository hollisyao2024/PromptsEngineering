# ADR-035：语义门禁默认阻断与模块核心表合规

状态：Accepted。日期：2026-10-04。补充 [ADR-034](034-arch-data-semantic-conventions.md)。

## 背景
用户要求所有核心表、业务表新建时都有注释、规范命名、审计字段与软删除字段。ADR-034 的语义检查默认只告警，且按表名默认豁免 Better Auth 与 `FileObject`：项目自建同名表（如 `account`）会被误豁免，模板自身安装的身份表与文件元数据表也不合规。SQLite 无 COMMENT，Drizzle 生成的迁移不带注释。

## 决策
1. `tdd.schemaGate.semantic` 默认 `required`，只检查本次新增迁移；项目可显式降为 `warn/off`。新增表/列的字典说明列必须非空。
2. 默认豁免只保留系统表；身份表与 `FileObject` 仅在该存储实际安装旧版模块时豁免。新增 `-- xirang:hard-delete <表> <原因>`，只免除 `deleted_at/deleted_by`。
3. 新安装的身份与文件模块表全部 snake_case、带注释。身份表分层：`user/organization/member/invitation` 六审计字段加软删除；`session/account/verification` 只有创建/更新审计字段，物理删除，每次删除写 `auth_audit_log`。`file_object` 六审计字段加软删除。
4. 软删除在 Better Auth 适配器层实现（`softDeleteAdapter` 包装 Prisma/Drizzle 适配器工厂），而非 `databaseHooks`。
5. 邮箱和 slug 只在未删除行内唯一：PostgreSQL/SQLite 用部分唯一索引（Prisma 用 `partialIndexes` 预览特性），MySQL/MariaDB 用生成列加唯一索引。
6. Drizzle `db:generate` 把 schema 源 `/** */` 注释写入新迁移：PostgreSQL 用 `COMMENT ON`，MySQL 内联 `COMMENT`。
7. 旧版模块安装继续按原字节生成，迁移 ID 不变。

## 取舍
- **适配器包装**：组织插件绕过 hooks，所以选适配器包装，能同时覆盖 Prisma、Drizzle 和插件删除路径。代价是依赖 Better Auth 适配器接口（`DBAdapter`），升级 Better Auth 时须以真实回归验证。
- **会话、账户、验证令牌不软删除**：保留这些行会延长凭据生命周期，所以物理删除，改为写审计日志。审计日志只记标识与操作者，不记敏感值。
- **Prisma 部分索引依赖预览特性**：已有 `schema.prisma` 不由模板改写，未开启该特性时退回普通唯一索引。
- **默认阻断只作用于新增迁移**：已有项目历史表不受影响，但新表必须合规。

## 依据
模块 ARCH `data-semantics` §3、§4、§6、§7（息壤源仓已不保留，见 git 历史）。2026-10-04 用户确认：默认阻断、核心模块表完全合规、身份表分层合规。

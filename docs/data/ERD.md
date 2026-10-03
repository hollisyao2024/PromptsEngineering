# 架构模板数据结构

息壤源仓库没有运行数据库。本文记录可选 PostgreSQL/SQLite 模块初始化到实际项目的最小结构，以及更新引擎的文件协议；项目业务 ERD 仍由实际项目维护。

## 可选数据库骨架

| 实体 | 来源 | 职责与关系 |
| --- | --- | --- |
| app_metadata | stacks/database/{postgres,sqlite}/migrations/0001_initial.sql | 以 key 唯一标识的文本元数据；无外键，无预置业务数据 |
| xirang_migrations | modules/migrations/migrate.mjs.tpl，显式 --apply 时建立 | 记录迁移 ID、摘要和应用状态；与 app_metadata 无外键耦合 |

两种引擎的 app_metadata 均使用非空文本主键和非空 value。数据库职责按 architecture.config.json 的 datastores/consumers 映射；一个项目可同时采用多个存储，浏览器通过 API 或宿主端口访问。

迁移文件和注册表是有序不可变历史；已有迁移不改写，项目通过新增迁移演进业务模型。执行器要求历史是当前注册表的连续前缀，摘要一致且状态为 applied。事务失败回滚；PostgreSQL 非事务迁移中断后的 running 状态必须核验恢复。

## 模板文件协议

architecture.config.json 用稳定应用/存储/模块 ID 和消费者引用描述选型。xirang.lock.json 的 files 字典以相对路径关联 owner、strategy、version 和 base SHA-256；base 指向 .xirang/baselines/<sha256>。packages 字典记录已安装能力及参数摘要。一个目标文件只能属于一个 owner。

这些关系是文件协议，不在 app_metadata 中存储，也不要求项目采用特定数据库。字段与约束见 [dictionary.md](dictionary.md)。

## v2 Prisma 任务示例

选择 Prisma 的新数据包独立建立 `task` 和 Prisma 自有 `_prisma_migrations`，与旧 SQL 骨架不混用。`task` 是无外键的任务聚合，带六个审计字段并采用软删除（`deleted_at`）；已安装存储保留 legacy `Task`（物理删除），不被模板改写。版本号用于并发修改检查，批量删除在同一事务内校验全部 ID。各存储拥有独立 Schema、生成客户端和迁移历史；本示例不包含账户/租户实体。

`task_created_at_id_idx` 支撑日期及稳定 ID 排序，`task_status_updated_at_idx` 支撑状态筛选与“超时未处理”类时间查询（legacy 为 `Task_createdAt_id_idx`、`Task_status_idx`）。标题搜索目前为有界分页下的 contains 查询，不承诺全文索引性能。数据库端不采用跨 provider 枚举，状态以字符串 CHECK 约束；公开状态由 OpenAPI 约束，Schema 和业务服务在初始化后由项目维护。

模板生成与更新只落文件。`db:deploy/dev` 才显式调用 Prisma Migrate，守卫从 `_prisma_migrations` 读取已应用摘要、失败和回滚状态；不新建第二套执行账本。源仓库不运行业务数据库，所有真实验证均在隔离消费者。

## 可选身份与文件实体

`user` 一对多关联 `session`、`account`、`member` 和由其发出的 `invitation`；`organization` 一对多关联 `member` 与 `invitation`。以上关系均由被选中的身份 schema 声明级联外键。`session.active_organization_id` 为 SDK 维护的字符串引用，必须在服务端核验成员资格。新安装遵守数据语义约定（ADR-035）：`user`、`organization`、`member`、`invitation` 软删除，级联外键只在物理删除时触发；Better Auth 删除组织或用户时对成员、邀请的删除同样经适配器转为软删除；`session`、`account`、`verification` 物理删除并写入 `auth_audit_log`（以 `target_model,target_id` 索引，不设外键，目标删除后仍保留记录）。已安装旧版身份模块保留驼峰映射与原关系，不修改既有 Task 示例实体。

`file_object` 以 id 关联一次文件会话，以 `(store_id,object_key)` 唯一定位存储对象（删除后不复用），以 owner_id 绑定外部认证主体，删除为软删除（已安装旧版保留 `FileObject`）。它与 User 无强制外键，因此可单独选用文件存储而不选身份模块。文件对象路由及元数据版本固定后，临时对象被复制到独立最终 key；完成、删除与恢复通过版本状态协调。私有文件 repository 与 Prisma repository 实现同一逻辑协议。

身份和文件模型分别写入 `auth.prisma` 与 `file-storage.prisma`（新安装由 `architecture/scripts/module-models.js` 生成），选择后数据库配置采用 Prisma schema 目录。已有 schema 不覆盖，初始化迁移只追加；项目已有同名模型时需显式接管/迁移，不能拼出重复实体后静默忽略。队列 schema 属于所选 SDK，业务库与队列的事务关联仅在同一 PostgreSQL 的 pg-boss/fromPrisma 路径成立。

## 常见数据库与 Drizzle 任务示例

Prisma 的同一任务聚合可选择 PostgreSQL、MySQL/MariaDB、SQLite，关系和并发协议不变。字段映射见数据字典。

Drizzle 稳定版支持 PostgreSQL、MySQL/MariaDB 与 SQLite，新数据包物理表为 `task`（已安装存储保留 `Task`）；独立的 TypeScript schema 与 Kit SQL/journal/snapshot 链归项目维护。身份表保留 user/session/account/verification/organization/member/invitation 的逻辑关系并新增 auth_audit_log；file_object 仍无身份外键。pg-boss 可通过同一 PostgreSQL 的 fromDrizzle 事务端口关联业务写入。

Prisma 使用 _prisma_migrations；Drizzle 使用原生 __drizzle_migrations，禁止同库接管对方历史。Drizzle PostgreSQL 采用独立数据库/public schema；SQLite 迁移以数据库文件为单位持有恢复锁。模板只初始化文件，修改 schema 后须显式生成、审查并提交只追加迁移；已应用 SQL 不可改写。

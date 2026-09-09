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

选择 Prisma 的存储独立建立 `Task` 和 Prisma 自有 `_prisma_migrations`，与旧 SQL 骨架不混用。`Task` 是无外键的任务聚合；版本号用于并发修改检查，批量删除在同一事务内校验全部 ID。各存储拥有独立 Schema、生成客户端和迁移历史；本示例不包含账户/租户实体。

`Task_createdAt_id_idx` 支撑日期及稳定 ID 排序，`Task_status_idx` 支撑状态筛选。标题搜索目前为有界分页下的 contains 查询，不承诺全文索引性能。数据库端不采用跨 provider 枚举；公开状态由 OpenAPI 约束，Schema 和业务服务在初始化后由项目维护。

模板生成与更新只落文件。`db:deploy/dev` 才显式调用 Prisma Migrate，守卫从 `_prisma_migrations` 读取已应用摘要、失败和回滚状态；不新建第二套执行账本。源仓库不运行业务数据库，所有真实验证均在隔离消费者。

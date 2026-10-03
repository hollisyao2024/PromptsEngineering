# 架构模板数据字典

范围：可选数据库骨架和模板更新文件协议，不代表实际项目的业务 schema。

## app_metadata（PostgreSQL / SQLite）

| 字段 | SQL 类型 | 空值/键 | 说明 |
| --- | --- | --- | --- |
| key | TEXT | PRIMARY KEY、NOT NULL | 项目定义的元数据标识，唯一索引由主键产生 |
| value | TEXT | NOT NULL | 文本值；是否为 JSON 由项目约定，模板不隐式解释 |

两种引擎均无额外索引、外键或种子数据；SQLite 显式 NOT NULL 消除 rowid 表文本主键的空值差异。

## xirang_migrations（执行器元数据）

| 字段 | 类型 | 约束/意义 |
| --- | --- | --- |
| id | TEXT PRIMARY KEY | 注册表中有序且唯一的迁移 ID；执行器拒绝空值/非法字符 |
| checksum | TEXT NOT NULL | SQL 原始 UTF-8 内容的 SHA-256；执行前与历史逐项核对 |
| state | TEXT NOT NULL | applied；Postgres 非事务迁移先写 running，成功才改 applied |

迁移注册表 migrations.json 的条目包含 id、file、checksum、transactional。id 递增且不重复；file 限制为本迁移目录的 SQL 文件名，不允许链接或路径逃逸；所有 SQL 必须登记。SQLite 仅支持 transactional=true。PG 写入使用咨询锁，SQLite 使用 BEGIN IMMEDIATE，普通预检不创建数据库或迁移表。

## 架构配置与锁

| 协议 | 字段 | 所有权/约束 |
| --- | --- | --- |
| architecture.config.json | schemaVersion、applications、datastores、modules、profiles | 项目所有；JSON Schema 和语义校验共同约束 |
| applications[] | id、stack、path、sourceDir、targets、components、modules | 栈、目标与组件目录逐应用选择 |
| datastores[] | id、engine、access、path、consumers | 依稳定 ORM/数据库矩阵选择；consumer 必须存在 |
| xirang.lock.json | schemaVersion、files、packages | 模板更新器管理，项目随代码提交 |
| files[path] | owner、version、strategy、base | 路径唯一归属，base 为受管源内容摘要；自有字段不包含业务密钥 |
| packages[id] | version、source、selection、parametersHash | 已安装包/模块来源与生成参数摘要；按包类型保存适用字段 |
| 冻结 plan | target、source、inputs、lockBefore、lockAfter、entries、id | before/after 摘要和输入校验；计划整体摘要防止误改 |
| 外部 journal | status、plan、completed | 容器 tmp 运行态，用于逐项恢复；不替代 Git 历史 |

计划和锁记录文件安装结果；依赖安装、项目检查、构建和生产部署有各自结果，不能相互替代。

## v2 任务示例 `task`（新数据包，Prisma / Drizzle）

模板示例表，示范数据语义约定；不定义项目业务 schema。列为 snake_case，TS/Prisma 字段为驼峰并以 `@map`/列名映射。

| 字段 | 类型（PG / MySQL / SQLite） | 约束、注释与生成方 |
| --- | --- | --- |
| id | TEXT / VARCHAR(191) / TEXT | 主键：任务 ID；ORM 生成 UUID，API 校验 UUID 格式 |
| title | TEXT / VARCHAR(255) / TEXT | 非空：任务标题；API trim 后长度 1–200 |
| status | TEXT / VARCHAR(191) / TEXT | 非空，默认 `todo`；CHECK 取值 `todo`=待处理、`doing`=进行中、`done`=已完成 |
| version | INTEGER / INT / INTEGER | 非空，默认 1：乐观锁版本，更新匹配传入版本并原子加一 |
| created_at | TIMESTAMP(3) / DATETIME(3) / DATETIME | 非空：创建时间，数据库默认当前时间 |
| updated_at | TIMESTAMP(3) / DATETIME(3) / DATETIME | 非空：最后修改时间，ORM 写入 |
| created_by | TEXT / VARCHAR(191) / TEXT | 非空，默认 `system`：创建人主体标识 |
| updated_by | TEXT / VARCHAR(191) / TEXT | 非空，默认 `system`：最后修改人主体标识 |
| deleted_at | TIMESTAMP(3) / DATETIME(3) / DATETIME | 可空：软删除时间，NULL 表示未删除 |
| deleted_by | TEXT / VARCHAR(191) / TEXT | 可空：软删除操作人 |

上表为 Prisma 迁移类型；Drizzle 新数据包同名同约束，类型为 PostgreSQL TEXT/INTEGER/TIMESTAMPTZ、MySQL/MariaDB VARCHAR(191)（title 255）/INT/DATETIME(3)、SQLite TEXT/INTEGER/INTEGER（毫秒时间戳），id 与日期由 ORM 回调生成。

索引 `task_created_at_id_idx(created_at,id)`、`task_status_updated_at_idx(status,updated_at)`；Drizzle PostgreSQL/SQLite 为 `WHERE deleted_at IS NULL` 部分索引，Prisma 与 MySQL/MariaDB 为普通索引。无外键。PostgreSQL 以 `COMMENT ON` 注释表和全部列，MySQL/MariaDB 使用列内与表 `COMMENT`，SQLite 以迁移头注释说明。删除为软删除：写入 `deleted_at/deleted_by/updated_by` 并递增版本；查询、更新与导出只作用于未删除行。API 合约与日期序列化（ISO date-time）不变；排序后追加 ID 保证次序稳定，批删 ID 最多 100，缺失项使整个事务回滚。

### 已安装存储的 `Task`（legacy）

已安装的存储保留原 `Task` 示例：列 id、title、status（默认 todo）、version（默认 1）、createdAt、updatedAt，索引 `Task_createdAt_id_idx(createdAt,id)` 与 `Task_status_idx(status)`，删除为物理删除。生成器检测到原 Task 初始迁移或 schema 时继续输出 `task-model/legacy` 的原字节与示例服务；迁移到语义模型需项目自行新增只追加迁移。

`_prisma_migrations` 由 Prisma Migrate 创建维护，守卫只读 `migration_name`、`checksum`（SQL SHA-256）、`finished_at`、`rolled_back_at`。无完成且无回滚的记录视为失败；完成记录不允许磁盘文件缺失或摘要改变。完整账本字段遵循选定 Prisma 版本，不由模板重新定义。

v2 配置新增 `workspace.packageManager`（固定 pnpm 10 版本）、`blueprint.id/version`（首次展开来源）、`example.kind/api/datastore`（任务示例联动）及 `datastores[].access=prisma`（限 Node TS）。v1 不自动升级；旧 engine/access 改变需实际项目独立迁移。

## 可选身份模型（Better Auth / Prisma）

来源 `architecture/modules/open-source/auth-schema/auth.prisma`，PG/SQLite SQL 独立生成，全部模型使用文本主键。DateTime 对应 PG TIMESTAMP(3) / SQLite DATETIME；Boolean 对应 BOOLEAN。以下字段未标 `?` 均非空。模型仅初始化，身份机密不可进入 DTO、日志或仓库。

| 模型 / 表 | 字段 | 约束与关系 |
| --- | --- | --- |
| User / user | id、name、email、emailVerified=false、image?、createdAt=now、updatedAt | email 唯一；updatedAt 由 Prisma 更新 |
| Session / session | id、expiresAt、token、createdAt=now、updatedAt、ipAddress?、userAgent?、userId、activeOrganizationId? | token 唯一；userId 索引与级联删除外键；activeOrganizationId 是 SDK 管理的可选标识，不是客户端授权依据 |
| Account / account | id、accountId、providerId、userId、accessToken?、refreshToken?、idToken?、accessTokenExpiresAt?、refreshTokenExpiresAt?、scope?、password?、createdAt=now、updatedAt | userId 索引与级联外键；password 为库管理的散列，令牌由身份服务管理 |
| Verification / verification | id、identifier、value、expiresAt、createdAt=now、updatedAt | identifier 索引；验证码值禁止公开 |
| Organization / organization | id、name、slug、logo?、createdAt、metadata? | slug 唯一；metadata 文本，解释由 SDK/项目负责 |
| Member / member | id、organizationId、userId、role=member、createdAt | organizationId、userId 各自索引与级联外键；角色由服务端维护 |
| Invitation / invitation | id、organizationId、email、role?、status=pending、expiresAt、createdAt=now、inviterId | organizationId/email 索引，organizationId/inviterId 级联外键 |

## FileObject 与文件会话

| 字段 | 类型 / 约束 | 用途 |
| --- | --- | --- |
| id | String / 主键 | 不可预测文件会话 ID |
| ownerId | String / 非空 | 服务端认证回调给出的主体；不绑定特定 User 表，兼容外部身份 |
| storeId、objectKey | String / 组合唯一 | 固定路由与对象标识；切换默认 store 不移动历史文件 |
| state、version | String、Int / 非空 | CAS 并发状态；更新匹配旧版本后递增 |
| record | String / 非空 | 有界 JSON，会话大小/MIME/暂存和最终 key/期限/lease；读入时校验结构 |
| createdAt、updatedAt | DateTime / 非空 | 默认创建时间与 Prisma 更新时间 |

索引为 `(ownerId,id)`、`(state,updatedAt)`；无身份外键，避免强制采用 Better Auth。状态为 pending/uploading/completing/ready/cancelled/deleting/deleted，过程以实际 `service` 合约为准。Node 可选择 Prisma 或私有目录元数据，Go 提供目录持久化及 repository 接口；二进制不写入关系库。双写通过 lease/CAS/recover 收敛，不是分布式事务。

`fileStorage` 配置保存 runtime、path、consumers、stores(id/provider/envPrefix)、defaultStore、metadata.datastore 和 uploadApplications；禁止保存凭据。`modules[].options` 只接受所选模块需要的数据库或队列选项。

队列内部表由固定 pg-boss/BullMQ 版本的显式迁移维护，不复制为第二套 Prisma schema。项目若采用 Outbox，应自行定义业务实体、幂等键、投递状态及迁移；模板不虚构通用业务 Outbox 表。

## legacy Task 的方言与 Drizzle 映射

以下仅描述已安装存储保留的 legacy `Task`；新数据包见上文 `task`。主键、非空约束、status=todo、version=1 及两个 legacy 索引在所有组合保持一致。

| 组合 | 字符串 id/title/status | version | createdAt/updatedAt | 默认值来源 |
| --- | --- | --- | --- | --- |
| Prisma MySQL/MariaDB | id/status VARCHAR(191)，title VARCHAR(255) | INTEGER | DATETIME(3) | UUID/@updatedAt 由 Prisma，创建时间由数据库 |
| Drizzle PostgreSQL | TEXT | INTEGER | TIMESTAMPTZ | UUID/日期由 ORM 回调，status/version 由 SQL |
| Drizzle MySQL/MariaDB | VARCHAR(255) | INT | DATETIME(3) | UUID/日期由 ORM 回调，status/version 由 SQL |
| Drizzle SQLite | TEXT | INTEGER | INTEGER（毫秒时间戳） | UUID/日期由 ORM 回调，status/version 由 SQL |

Drizzle 身份模型字段与上表身份协议一致；MySQL 长令牌/JSON 使用 LONGTEXT，文件 objectKey 为 VARCHAR(512)，record 为 LONGTEXT。其他方言使用文本类型，日期按各自原生 schema 表达。FileObject 使用同一 owner/store/version CAS 协议。

Drizzle 原生历史读取 id、hash（SQL SHA-256）、created_at（Kit journal 时间），校验为磁盘有序连续前缀；libSQL 使用 rowid 排序以适配原生 SERIAL 历史列。Kit meta/_journal.json、每次 snapshot 和 SQL 须一并提交，缺失/方言不符/顺序错误/已执行 SQL 篡改均阻断。快照链检查不能替代 Git 对已提交 snapshot 的不可变约束，数据库原生历史不保存 snapshot 摘要。

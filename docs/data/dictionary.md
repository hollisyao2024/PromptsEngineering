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

## 可选身份模型（Better Auth）

新安装由 `architecture/scripts/module-models.js` 一处声明生成 Prisma schema、四种数据库 SQL 与 Drizzle schema，遵守数据语义约定（ADR-035）：表列 snake_case 并带注释，审计操作者取当前会话用户、缺省 `system`。软删除表的读取由 `src/audit.ts` 的 `softDeleteAdapter` 自动过滤 `deleted_at IS NULL`；`session`、`account`、`verification` 物理删除并逐行写入只追加的 `auth_audit_log`（不复制令牌、密码或验证值）。身份机密不可进入 DTO、日志或仓库。

### `user`（User）

用户：登录主体，删除为软删除。删除策略：软删除（deleted_at/deleted_by）。未删除行内唯一：PostgreSQL/SQLite 部分唯一索引 `user_email_key`（WHERE deleted_at IS NULL）；MySQL/MariaDB 存储生成列 `email_active` 唯一。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | String / 主键 | 非空 | 用户 ID |
| name | String | 非空 | 显示名称 |
| email | String | 非空 | 登录邮箱，未删除用户内唯一 |
| email_verified | Boolean | 非空；默认 false | 邮箱是否已验证：true=已验证 false=未验证 |
| image | String（长文本） | 可空 | 头像地址 |
| created_at | DateTime | 非空；默认 now | 创建时间 |
| updated_at | DateTime | 非空；更新时自动刷新 | 最后修改时间 |
| created_by | String | 非空；默认 system | 创建人标识，无登录主体时为 system |
| updated_by | String | 非空；默认 system | 最后修改人标识，无登录主体时为 system |
| deleted_at | DateTime | 可空 | 软删除时间，为空表示未删除 |
| deleted_by | String | 可空 | 软删除操作人标识 |
| email_active | String（MySQL/MariaDB 存储生成列） | 可空 | 未删除时等于 email，已删除为空（唯一约束用） |

### `session`（Session）

登录会话：令牌短期有效，物理删除并留审计。删除策略：物理删除（会话到期或登出即失效，物理删除：每次删除写入 auth_audit_log（只记模型、ID、用户与操作者））。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | String / 主键 | 非空 | 会话 ID |
| expires_at | DateTime | 非空 | 过期时间 |
| token | String | 非空；唯一 | 会话令牌（敏感，禁止写入日志） |
| ip_address | String | 可空 | 登录 IP |
| user_agent | String（长文本） | 可空 | 客户端标识 |
| user_id | String | 非空；外键 → user.id 级联删除；索引 | 所属用户 ID |
| active_organization_id | String | 可空 | 当前活动组织 ID |
| created_at | DateTime | 非空；默认 now | 创建时间 |
| updated_at | DateTime | 非空；更新时自动刷新 | 最后修改时间 |
| created_by | String | 非空；默认 system | 创建人标识，无登录主体时为 system |
| updated_by | String | 非空；默认 system | 最后修改人标识，无登录主体时为 system |

### `account`（Account）

登录凭据：密码哈希与第三方令牌，物理删除并留审计。删除策略：物理删除（凭据随用户删除或解绑清除，物理删除：每次删除写入 auth_audit_log（只记模型、ID、用户与操作者））。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | String / 主键 | 非空 | 凭据 ID |
| account_id | String | 非空 | 提供方内的账号 ID |
| provider_id | String | 非空 | 认证提供方：credential=邮箱密码，其余为 OAuth 提供方 |
| user_id | String | 非空；外键 → user.id 级联删除；索引 | 所属用户 ID |
| access_token | String（长文本） | 可空 | 访问令牌（敏感） |
| refresh_token | String（长文本） | 可空 | 刷新令牌（敏感） |
| id_token | String（长文本） | 可空 | 身份令牌（敏感） |
| access_token_expires_at | DateTime | 可空 | 访问令牌过期时间 |
| refresh_token_expires_at | DateTime | 可空 | 刷新令牌过期时间 |
| scope | String（长文本） | 可空 | 授权范围 |
| password | String（长文本） | 可空 | 密码哈希（敏感） |
| created_at | DateTime | 非空；默认 now | 创建时间 |
| updated_at | DateTime | 非空；更新时自动刷新 | 最后修改时间 |
| created_by | String | 非空；默认 system | 创建人标识，无登录主体时为 system |
| updated_by | String | 非空；默认 system | 最后修改人标识，无登录主体时为 system |

### `verification`（Verification）

验证记录：邮箱验证、重置密码等一次性凭证。删除策略：物理删除（验证码使用或过期即失效，物理删除：每次删除写入 auth_audit_log（只记模型、ID、用户与操作者））。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | String / 主键 | 非空 | 验证记录 ID |
| identifier | String | 非空；索引 | 验证对象标识 |
| value | String（长文本） | 非空 | 验证值（敏感） |
| expires_at | DateTime | 非空 | 过期时间 |
| created_at | DateTime | 非空；默认 now | 创建时间 |
| updated_at | DateTime | 非空；更新时自动刷新 | 最后修改时间 |
| created_by | String | 非空；默认 system | 创建人标识，无登录主体时为 system |
| updated_by | String | 非空；默认 system | 最后修改人标识，无登录主体时为 system |

### `organization`（Organization）

组织：多成员租户，删除为软删除。删除策略：软删除（deleted_at/deleted_by）。未删除行内唯一：PostgreSQL/SQLite 部分唯一索引 `organization_slug_key`（WHERE deleted_at IS NULL）；MySQL/MariaDB 存储生成列 `slug_active` 唯一。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | String / 主键 | 非空 | 组织 ID |
| name | String | 非空 | 组织名称 |
| slug | String | 非空 | 组织短标识，未删除组织内唯一 |
| logo | String（长文本） | 可空 | 组织标志地址 |
| metadata | String（长文本） | 可空 | 扩展元数据（JSON 文本） |
| created_at | DateTime | 非空；默认 now | 创建时间 |
| updated_at | DateTime | 非空；更新时自动刷新 | 最后修改时间 |
| created_by | String | 非空；默认 system | 创建人标识，无登录主体时为 system |
| updated_by | String | 非空；默认 system | 最后修改人标识，无登录主体时为 system |
| deleted_at | DateTime | 可空 | 软删除时间，为空表示未删除 |
| deleted_by | String | 可空 | 软删除操作人标识 |
| slug_active | String（MySQL/MariaDB 存储生成列） | 可空 | 未删除时等于 slug，已删除为空（唯一约束用） |

### `member`（Member）

组织成员：用户在组织中的角色，删除为软删除。删除策略：软删除（deleted_at/deleted_by）。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | String / 主键 | 非空 | 成员记录 ID |
| organization_id | String | 非空；外键 → organization.id 级联删除；索引 | 所属组织 ID |
| user_id | String | 非空；外键 → user.id 级联删除；索引 | 成员用户 ID |
| role | String | 非空；默认 member | 成员角色：owner=所有者 admin=管理员 member=成员 |
| created_at | DateTime | 非空；默认 now | 创建时间 |
| updated_at | DateTime | 非空；更新时自动刷新 | 最后修改时间 |
| created_by | String | 非空；默认 system | 创建人标识，无登录主体时为 system |
| updated_by | String | 非空；默认 system | 最后修改人标识，无登录主体时为 system |
| deleted_at | DateTime | 可空 | 软删除时间，为空表示未删除 |
| deleted_by | String | 可空 | 软删除操作人标识 |

### `invitation`（Invitation）

组织邀请：待接受的成员邀请，删除为软删除。删除策略：软删除（deleted_at/deleted_by）。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | String / 主键 | 非空 | 邀请 ID |
| organization_id | String | 非空；外键 → organization.id 级联删除；索引 | 所属组织 ID |
| email | String | 非空；索引 | 受邀邮箱 |
| role | String | 可空 | 邀请角色：owner=所有者 admin=管理员 member=成员 |
| status | String | 非空；默认 pending | 邀请状态：pending=待处理 accepted=已接受 rejected=已拒绝 canceled=已取消 |
| expires_at | DateTime | 非空 | 过期时间 |
| inviter_id | String | 非空；外键 → user.id 级联删除 | 邀请人用户 ID |
| created_at | DateTime | 非空；默认 now | 创建时间 |
| updated_at | DateTime | 非空；更新时自动刷新 | 最后修改时间 |
| created_by | String | 非空；默认 system | 创建人标识，无登录主体时为 system |
| updated_by | String | 非空；默认 system | 最后修改人标识，无登录主体时为 system |
| deleted_at | DateTime | 可空 | 软删除时间，为空表示未删除 |
| deleted_by | String | 可空 | 软删除操作人标识 |

### `auth_audit_log`（AuthAuditLog）

身份审计日志：会话、凭据、验证记录的物理删除记录（不含令牌、密码与验证值）。删除策略：物理删除（只追加的身份删除审计日志，不更新不删除）。索引 (target_model, target_id)。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | String / 主键 | 非空 | 日志 ID |
| action | String | 非空 | 操作：delete=物理删除 |
| target_model | String | 非空 | 目标模型：session=会话 account=凭据 verification=验证记录 |
| target_id | String | 非空 | 目标记录 ID |
| user_id | String | 可空 | 关联用户 ID |
| actor | String | 非空 | 操作者标识，无登录主体时为 system |
| created_at | DateTime | 非空；默认 now | 创建时间 |
| updated_at | DateTime | 非空；更新时自动刷新 | 最后修改时间 |
| created_by | String | 非空；默认 system | 创建人标识，无登录主体时为 system |
| updated_by | String | 非空；默认 system | 最后修改人标识，无登录主体时为 system |

已安装旧版身份模块（`auth-schema/auth.prisma`，驼峰列、无审计字段、物理删除）的存储继续获得原 schema、迁移与适配器字节，门禁按安装形态条件豁免这些表；迁移到语义结构须项目新增只追加迁移。

## file_object 与文件会话

### `file_object`（FileObject）

文件元数据：对象存储中的文件记录，删除为软删除。删除策略：软删除（deleted_at/deleted_by）。组合唯一 (store_id, object_key)；索引 (owner_id, id)；索引 (state, updated_at)。

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| id | String / 主键 | 非空 | 文件 ID |
| owner_id | String | 非空 | 所有者标识 |
| store_id | String | 非空 | 存储配置 ID |
| object_key | String（≤512） | 非空 | 对象键，同一存储内永久唯一（删除后不复用） |
| state | String | 非空 | 文件状态：pending=待上传 uploading=上传中 completing=完成中 ready=可用 cancelled=已取消 deleting=删除中 deleted=已删除 |
| version | Int | 非空 | 乐观锁版本号，每次更新加 1 |
| record | String（长文本） | 非空 | 完整文件记录（JSON 文本） |
| created_at | DateTime | 非空；默认 now | 创建时间 |
| updated_at | DateTime | 非空；更新时自动刷新 | 最后修改时间 |
| created_by | String | 非空；默认 system | 创建人标识，无登录主体时为 system |
| updated_by | String | 非空；默认 system | 最后修改人标识，无登录主体时为 system |
| deleted_at | DateTime | 可空 | 软删除时间，为空表示未删除 |
| deleted_by | String | 可空 | 软删除操作人标识 |

仓储创建写 `created_by/updated_by`（=ownerId），状态进入 `deleted` 时同时写 `deleted_at/deleted_by`；列表只返回未删除记录，对象键删除后不复用。已安装旧版 `FileObject`（驼峰列）的存储保留原仓储与 schema 字节。

无身份外键，避免强制采用 Better Auth。状态为 pending/uploading/completing/ready/cancelled/deleting/deleted，过程以实际 `service` 合约为准。Node 可选择 Prisma 或私有目录元数据，Go 提供目录持久化及 repository 接口；二进制不写入关系库。双写通过 lease/CAS/recover 收敛，不是分布式事务。

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

Drizzle 身份与文件表字段与上文语义表一致，表/列 JSDoc 由 `db:generate` 写入迁移注释；MySQL 长令牌/JSON 使用 LONGTEXT，文件 object_key 为 VARCHAR(512)，record 为 LONGTEXT。其他方言使用文本类型，日期按各自原生 schema 表达。`file_object` 使用同一 owner/store/version CAS 协议。

Drizzle 原生历史读取 id、hash（SQL SHA-256）、created_at（Kit journal 时间），校验为磁盘有序连续前缀；libSQL 使用 rowid 排序以适配原生 SERIAL 历史列。Kit meta/_journal.json、每次 snapshot 和 SQL 须一并提交，缺失/方言不符/顺序错误/已执行 SQL 篡改均阻断。快照链检查不能替代 Git 对已提交 snapshot 的不可变约束，数据库原生历史不保存 snapshot 摘要。

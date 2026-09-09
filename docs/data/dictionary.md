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
| datastores[] | id、engine、path、consumers | 每种职责可选 PostgreSQL/SQLite；consumer 必须存在 |
| xirang.lock.json | schemaVersion、files、packages | 模板更新器管理，项目随代码提交 |
| files[path] | owner、version、strategy、base | 路径唯一归属，base 为受管源内容摘要；自有字段不包含业务密钥 |
| packages[id] | version、source、selection、parametersHash | 已安装包/模块来源与生成参数摘要；按包类型保存适用字段 |
| 冻结 plan | target、source、inputs、lockBefore、lockAfter、entries、id | before/after 摘要和输入校验；计划整体摘要防止误改 |
| 外部 journal | status、plan、completed | 容器 tmp 运行态，用于逐项恢复；不替代 Git 历史 |

计划和锁记录文件安装结果；依赖安装、项目检查、构建和生产部署有各自结果，不能相互替代。

## v2 Prisma Task（仅选中 Prisma 消费者）

| 字段 | PostgreSQL / SQLite | 约束及生成方 |
| --- | --- | --- |
| id | TEXT / TEXT | 非空主键；Prisma 默认生成 UUID，API 校验 UUID 格式 |
| title | TEXT / TEXT | 非空；API trim 后长度 1–200 |
| status | TEXT / TEXT | 非空，默认 todo；API 允许 todo/doing/done |
| version | INTEGER / INTEGER | 非空，默认 1；更新匹配传入版本并原子加一 |
| createdAt | TIMESTAMP(3) / DATETIME | 非空，数据库默认 CURRENT_TIMESTAMP |
| updatedAt | TIMESTAMP(3) / DATETIME | 非空，由 Prisma @updatedAt 写入 |

额外索引 `Task_createdAt_id_idx(createdAt,id)` 和 `Task_status_idx(status)`；无外键。API 日期序列化为 ISO date-time；按最多三列的允许字段排序后追加 ID 保证次序稳定。批删 ID 最多 100，缺失项使整个事务回滚。

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

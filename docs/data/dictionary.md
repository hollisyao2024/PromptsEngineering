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
